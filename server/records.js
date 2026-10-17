// server/records.js — [ACH-STORE] 服务端权威对局记录与成就：校验、归并、评分（纯服务端模块，不属上游包）。
//
//   * sanitizeRecord()  校验并裁剪一条客户端记录，只保留**评分投影**与玩家自己那一行（与 ui/stats.js
//                       compactRecord 产出的紧凑形状一致）：成就只读「帧 + 自己行」，服务端因此不存队友的
//                       阵容 / 羁绊 / 名字。
//   * projection()      同 id 的两条记录必须一致的字段；不一致即「冲突」，保留云端版、暂存待定。
//   * mergeRecords()    把新记录并进账号的规范列表（按 id 去重、新到旧、封顶），返回需要人工裁决的冲突。
//   * scoreRecords()    规范列表的成就评分（shared/achievement.js scoreRecord 求和）。
//
// 反作弊只做到「合理校验」：schema、枚举、数值范围、时间（不在未来、不早于游戏存在）、时长上限、
// 单条 / 单批 / 单账号体积上限。它证明不了一局真的发生过 —— 对局在服务端内存里、没有身份 ——
// 伪造但形状合法的结果不在防御范围内（要签名的结果得在结算处挂钩）。
//
// 与 A 服的偏离：A 的 `account.records` 支持密文 `enc`，本 fork 也支持（server/net.js 解密后交给本模块）；
// 冲突只在服务端暂存（TTL / 上限），客户端暂无「逐条裁决」UI —— 见测试与报告。

import { DIFFICULTIES } from '../shared/constants.js';
import { scoreRecord } from '../shared/achievement.js';

/** 一个账号最多保留的记录数；超出的最旧记录被丢弃。 */
export const RECORDS_MAX = 5000;
/** 一个账号记录的序列化字符预算；超出的最旧记录被压紧 / 丢弃。 */
export const RECORDS_CHARS_MAX = 4_000_000;
/** 一个 `account.records` 帧最多携带的记录数（shared/protocol.js 同值）。 */
export const RECORDS_BATCH_MAX = 32;
/** 单条上行记录 JSON 的上限（本 fork 客户端已在本地压缩，旧客户端可能仍发全量行）。 */
export const RECORD_MAX_CHARS = 16_000;

/** 早于这个时间戳的不是真实对局（本作 2025+）：挡住手改 / 0 值。 */
export const MIN_T = Date.UTC(2024, 0, 1);
/** 超过这个未来偏移的时间戳被拒绝（时钟偏差余量）。 */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** 回合数 / 时长合理上限。 */
export const MAX_ROUNDS = 99;
export const MAX_MATCH_MS = 12 * 3600_000;

const MAX_PLAYERS = 6;
const MAX_STAT_KEYS = 24;
const MAX_NAME = 24;
const MAX_BONDS = 24;
const MAX_LINEUP = 12;
const MAX_ITEMS = 4;
const DIF_SET = new Set(DIFFICULTIES);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
const num = (v) => (Number.isFinite(v) ? v : null);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const str = (v, max = 64) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);

function normalizeStatBlock(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!Number.isFinite(v) || k.length > 32) continue;
    out[k] = v;
    if (++n >= MAX_STAT_KEYS) break;
  }
  return out;
}

/** 一行玩家（评分只读 victory / roundsPassed；其余是展示）。 */
function normalizePlayerRow(raw, quit = false) {
  const p = isObj(raw) ? raw : {};
  const title = isObj(p.title) && str(p.title.id) ? { id: str(p.title.id) } : null;
  const lineup = (Array.isArray(p.lineup) ? p.lineup : []).filter(isObj).slice(0, MAX_LINEUP).map((u) => {
    const e = { id: str(u.id) || '', golden: bool(u.golden), tier: int(u.tier, 0), items: (Array.isArray(u.items) ? u.items : []).filter((i) => typeof i === 'string' && i.length).slice(0, MAX_ITEMS).map((i) => i.slice(0, 64)) };
    if (u.kind === 'token') e.kind = 'token';
    return e;
  }).filter((u) => u.id);
  const bonds = (Array.isArray(p.bonds) ? p.bonds : []).filter(isObj).slice(0, MAX_BONDS).map((b) => ({ bondId: str(b.bondId) || str(b.id) || '', layers: int(b.layers, 0), active: bool(b.active) })).filter((b) => b.bondId);
  return {
    playerId: str(p.playerId) || '',
    seat: int(p.seat, 0),
    name: str(p.name, MAX_NAME) || '',
    isBot: bool(p.isBot),
    left: bool(p.left),
    alive: bool(p.alive, true),
    victory: bool(p.victory),
    roundsPassed: quit ? num(p.roundsPassed) : int(p.roundsPassed, 0),
    eliminatedRound: num(p.eliminatedRound),
    bandId: str(p.bandId),
    title,
    lineup,
    bonds,
    stats: normalizeStatBlock(p.stats),
  };
}

/** 「就是我」的那一行（selfId，其次唯一真人，最后第一条）。 */
function selfRowOf(players, selfId) {
  return players.find((p) => p.playerId && p.playerId === selfId)
    || players.find((p) => !p.isBot)
    || players[0]
    || null;
}

/**
 * 把一条客户端原始记录校验 + 裁剪成服务端规范形状（紧凑：帧 + 自己行）。不可救 / 校验失败返回 null。
 * @param {any} raw @param {{ now?: number }} [ctx]
 * @returns {any|null}
 */
export function sanitizeRecord(raw, ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  if (!isObj(raw)) return null;
  try { if (JSON.stringify(raw).length > RECORD_MAX_CHARS) return null; } catch { return null; }
  const id = str(raw.id, 64);
  if (!id) return null;
  const t = int(raw.t, 0);
  if (!(t >= MIN_T && t <= now + MAX_FUTURE_SKEW_MS)) return null;
  const playersRaw = (Array.isArray(raw.players) ? raw.players : []).filter(isObj).slice(0, MAX_PLAYERS);
  if (!playersRaw.length) return null;
  const quit = raw.end === 'quit';
  const selfId = str(raw.selfId);
  const players = playersRaw.map((p) => normalizePlayerRow(p, quit));
  const self = selfRowOf(players, selfId) || players[0];
  if (!self || !self.playerId) return null;
  const roundsPassed = quit ? num(self.roundsPassed ?? raw.roundsPassed) : int(self.roundsPassed ?? raw.roundsPassed, 0);
  if (roundsPassed != null && (roundsPassed < 0 || roundsPassed > MAX_ROUNDS)) return null;
  const durationMs = num(raw.durationMs);
  if (durationMs != null && (durationMs < 0 || durationMs > MAX_MATCH_MS)) return null;
  const difficulty = DIF_SET.has(raw.difficulty) ? raw.difficulty : null; // 未知难度保留但计 0 分
  const modeId = str(raw.modeId, 64);
  if (!modeId) return null;
  const roomMode = raw.roomMode === 'solo' || raw.roomMode === 'coop' ? raw.roomMode : null;
  return {
    id,
    v: 1,
    t,
    end: quit ? 'quit' : 'settled',
    victory: bool(self.victory ?? raw.victory),
    roundsPassed,
    lastRound: num(raw.lastRound),
    hiddenReached: bool(raw.hiddenReached),
    hiddenCleared: bool(raw.hiddenCleared),
    reason: str(raw.reason, 32),
    modeId,
    difficulty,
    roomMode,
    durationMs,
    selfId: self.playerId,
    compact: true,
    players: [{
      playerId: self.playerId, seat: self.seat, alive: self.alive, victory: self.victory, roundsPassed: self.roundsPassed,
      eliminatedRound: self.eliminatedRound, bandId: self.bandId, title: self.title, left: self.left, stats: self.stats,
    }],
  };
}

/** 记录的评分投影：同 id + 同投影 = 同一结果，无冲突。 */
export function projection(rec) {
  if (!isObj(rec)) return '';
  const self = selfRowOf(Array.isArray(rec.players) ? rec.players : [], rec.selfId);
  return JSON.stringify([
    rec.id, rec.end, rec.victory, rec.roundsPassed, rec.lastRound, rec.hiddenReached, rec.hiddenCleared,
    rec.difficulty, rec.modeId, rec.roomMode, rec.durationMs,
    self ? [self.victory, self.roundsPassed, self.alive, self.eliminatedRound, self.bandId] : null,
  ]);
}

/** 一条规范列表的评分（逐条求和）。@param {any[]} records */
export function scoreRecords(records) {
  let sum = 0;
  for (const rec of Array.isArray(records) ? records : []) sum += scoreRecord(rec);
  return sum;
}

/** 新到旧，按 id 稳定。 */
const newestFirst = (a, b) => (b.t - a.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 丢弃最旧记录（及其冲突）直到数量与字符预算内。 */
export function fitRecords(records, conflicts) {
  const list = Array.isArray(records) ? [...records].sort(newestFirst) : [];
  let chars = 0;
  const kept = [];
  for (const rec of list) {
    let n;
    try { n = JSON.stringify(rec).length; } catch { n = 0; }
    if (kept.length >= RECORDS_MAX) break;
    if (kept.length && chars + n > RECORDS_CHARS_MAX) break;
    chars += n;
    kept.push(rec);
  }
  if (kept.length !== list.length || (conflicts && Object.keys(conflicts).length)) {
    const ids = new Set(kept.map((r) => r.id));
    for (const id of Object.keys(conflicts || {})) if (!ids.has(id)) delete conflicts[id];
  }
  return kept;
}

/**
 * 把上行原始记录并进规范列表。
 * @param {any[]} existing 规范（已紧凑）
 * @param {any[]} incoming 客户端原始记录
 * @param {{ now?: number, conflicts?: Record<string, any> }} [ctx] conflicts 原地修改（待定 map id → {cloud, local}）
 * @returns {{ records: any[], conflicts: Record<string, any>, added: number, rejected: number, duplicated: number }}
 */
export function mergeRecords(existing, incoming, ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const conflicts = ctx.conflicts || {};
  const byId = new Map();
  for (const rec of Array.isArray(existing) ? existing : []) byId.set(rec.id, rec);
  let added = 0, rejected = 0, duplicated = 0;
  const list = Array.isArray(incoming) ? incoming : [];
  for (const raw of list) {
    const rec = sanitizeRecord(raw, { now });
    if (!rec) { rejected++; continue; }
    const cur = byId.get(rec.id);
    if (!cur) { byId.set(rec.id, rec); added++; continue; }
    if (projection(cur) === projection(rec)) { duplicated++; continue; }
    // 同 id 不同投影：留给人裁决；在裁决前云端（已存）版不动
    conflicts[rec.id] = { id: rec.id, t: cur.t, cloud: cur, local: rec, at: now };
  }
  const records = fitRecords([...byId.values()], conflicts);
  return { records, conflicts, added, rejected, duplicated };
}

/** 裁决一条冲突：keep = 'cloud' | 'local'。原地修改并返回新列表。 */
export function resolveConflict(records, conflicts, id, keep) {
  const c = conflicts[id];
  if (!c) return records;
  const chosen = keep === 'local' ? c.local : c.cloud;
  const list = (Array.isArray(records) ? records : []).filter((r) => r.id !== id);
  if (chosen) list.push(chosen);
  delete conflicts[id];
  return fitRecords(list, conflicts);
}
