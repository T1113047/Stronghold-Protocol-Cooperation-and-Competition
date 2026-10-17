// server/recordStore.js — [ACH-STORE] 成就库：每个 QQ 一个 JSON 文件，放在 ACCOUNT_DIR/records（默认
// `<app>/.account/records`），**在静态目录之外，永不经 HTTP 下发**。与账号库（server/account.js）分开：
// 账号文件只留身份 + prefs，对局记录一律搬到本库，用 server/records.js 的规范化格式保存。
//
// 文件结构（本库自己的 schema）：
//   { qq, v: 1, created, updatedAt, records: [ <记录> ], conflicts: { <id>: { id, t, cloud, local } } }
//
// 与 A 服的偏离：
//   * **懒加载**：A 在进程启动时就建目录、读文件、迁移 `prefs.stats`；本 fork 的账号库也是懒加载，且本 fork 的
//     账号白名单从未含 `stats`（盟约那边早已迁移过），所以这里**不做启动迁移**，只在第一次用到成就库时读盘。
//     这样测试 / 未绑定账号的服务器不会碰到 `ACCOUNT_DIR`（共享目录）里的任何文件。
//   * 冲突只做 TTL / 上限清理；暂无客户端「逐条裁决」UI（`resolve` 已留给后续接）。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { accountDirs } from './account.js';
import { mergeRecords, resolveConflict, scoreRecords } from './records.js';

const QQ_RE = /^\d{5,12}$/;
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
/** [ACCOUNT-V2] 待裁决冲突有上限：不裁决的玩家不会让载荷无限增长（TTL / 超量丢最旧，云端版仍在 records 里）。 */
const CONFLICT_TTL_MS = 14 * 24 * 3600_000;
const CONFLICT_MAX = 50;

/**
 * @param {{ dir?: string, accountsDir?: string, log?: object, now?: () => number }} [opts]
 *   dir: 成就库目录（测试传临时目录）；缺省取 ACCOUNT_RECORDS_DIR 或 ACCOUNT_DIR/records（server/account.js）。
 */
export function createRecordStore({ dir, accountsDir, log = noopLog, now = Date.now } = {}) {
  const dirs = accountDirs();
  const accDir = path.resolve(accountsDir || dirs.accountsDir);
  const root = path.resolve(dir || process.env.ACCOUNT_RECORDS_DIR || dirs.recordsDir);
  /** @type {Map<string, any>} */ const byQQ = new Map();
  /** @type {Map<string, number>} qq → 缓存分数（记录一变即失效） */
  const scoreCache = new Map();
  /** @type {Map<string, NodeJS.Timeout>} 合并写：qq → 待写定时器 */
  const writeTimers = new Map();
  let ready = false;

  const fileOf = (qq) => path.join(root, `${qq}.json`);

  function writeNow(rec) {
    if (!rec || typeof rec.qq !== 'string') return;
    const tmp = `${fileOf(rec.qq)}.tmp-${randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, fileOf(rec.qq));
    const t = writeTimers.get(rec.qq);
    if (t) { clearTimeout(t); writeTimers.delete(rec.qq); }
  }
  function persist(rec) {
    if (!rec || typeof rec.qq !== 'string') return;
    if (writeTimers.has(rec.qq)) return;
    const t = setTimeout(() => { writeTimers.delete(rec.qq); try { writeNow(rec); } catch (e) { log.error('[records] persist failed', e); } }, 50);
    if (t.unref) t.unref();
    writeTimers.set(rec.qq, t);
  }
  function flush() {
    for (const qq of [...writeTimers.keys()]) { try { writeNow(byQQ.get(qq)); } catch (e) { log.error('[records] flush failed', e); } }
  }
  process.on('exit', () => { try { flush(); } catch { /* ignore */ } });

  /** 第一次用到成就库时：建目录、读已有记录文件。 */
  function ensure() {
    if (ready) return;
    ready = true;
    try { fs.mkdirSync(root, { recursive: true }); } catch (e) { log.error('[records] mkdir failed', e); }
    try {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.json')) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
          if (rec && typeof rec.qq === 'string' && QQ_RE.test(rec.qq)) {
            if (!Array.isArray(rec.records)) rec.records = [];
            if (!rec.conflicts || typeof rec.conflicts !== 'object' || Array.isArray(rec.conflicts)) rec.conflicts = {};
            byQQ.set(rec.qq, rec);
          }
        } catch { /* 跳过损坏文件 */ }
      }
    } catch (e) { log.error('[records] load failed', e); }
  }

  /** [ACCOUNT-V2] 单调水位：每次改动至少 +1，同毫秒的两次改动也不会撞（客户端 recSynced 水位依赖它）。 */
  function touch(rec) {
    const t = now();
    rec.updatedAt = t > (rec.updatedAt || 0) ? t : (rec.updatedAt || 0) + 1;
  }

  /** 清掉过期 / 超量的待裁决冲突（云端版留在 records）。返回是否有改动。 */
  function pruneConflicts(rec) {
    if (!rec || !rec.conflicts || typeof rec.conflicts !== 'object') return false;
    const at = now();
    let changed = false;
    for (const id of Object.keys(rec.conflicts)) {
      const c = rec.conflicts[id];
      if (c && Number.isFinite(c.at) && at - c.at > CONFLICT_TTL_MS) { delete rec.conflicts[id]; changed = true; }
    }
    const left = Object.keys(rec.conflicts);
    if (left.length > CONFLICT_MAX) {
      left.sort((a, b) => ((rec.conflicts[b] && rec.conflicts[b].at) || 0) - ((rec.conflicts[a] && rec.conflicts[a].at) || 0));
      for (const id of left.slice(CONFLICT_MAX)) { delete rec.conflicts[id]; changed = true; }
    }
    return changed;
  }

  function getOrCreate(qq) {
    let rec = byQQ.get(qq);
    if (!rec) {
      const t = now();
      rec = { qq, v: 1, created: t, updatedAt: t, records: [], conflicts: {} };
      byQQ.set(qq, rec);
      writeNow(rec);
    }
    if (!Array.isArray(rec.records)) rec.records = [];
    if (!rec.conflicts || typeof rec.conflicts !== 'object' || Array.isArray(rec.conflicts)) rec.conflicts = {};
    return rec;
  }

  const api = {
    get size() { ensure(); return byQQ.size; },
    dir: root,
    accountsDir: accDir,
    /** 该 qq 在成就库里已经有记录（服务端权威可用的判据；false = 客户端上报分回退）。 */
    has(qq) { ensure(); return typeof qq === 'string' && QQ_RE.test(qq) && byQQ.has(qq); },
    /** 规范化后的记录（新到旧）；未知账号返回 []。 */
    recordsOf(qq) { ensure(); const r = byQQ.get(qq); return r ? [...r.records] : []; },
    /** 有界版本号 + 条数（分阶段同步握手用；`updatedAt` 单调，见 touch）。 */
    metaOf(qq) { ensure(); const r = byQQ.get(qq); return r ? { count: r.records.length, updatedAt: r.updatedAt || 0 } : { count: 0, updatedAt: 0 }; },
    /** 待玩家裁决的冲突（id → { cloud, local }）；读取时顺带清理过期 / 超量。 */
    conflictsOf(qq) {
      ensure();
      const r = byQQ.get(qq);
      if (!r) return {};
      if (pruneConflicts(r)) { try { persist(r); } catch { /* ignore */ } }
      return { ...r.conflicts };
    },
    /** 成就评分（服务端权威）：按记录求和，惰性缓存。 */
    scoreOf(qq) {
      ensure();
      if (scoreCache.has(qq)) return scoreCache.get(qq);
      const r = byQQ.get(qq);
      let score;
      try { score = r ? scoreRecords(r.records) : 0; } catch { score = 0; }
      scoreCache.set(qq, score);
      return score;
    },
    /** 归并一批客户端上报的记录；返回 { accepted, rejected, duplicated }。 */
    merge(qq, incoming) {
      ensure();
      if (!QQ_RE.test(String(qq || ''))) return { error: 'BAD_QQ' };
      const r = getOrCreate(qq);
      const out = mergeRecords(r.records, incoming, { conflicts: r.conflicts, now: now() });
      r.records = out.records;
      touch(r);
      pruneConflicts(r);
      scoreCache.delete(qq);
      try { persist(r); } catch (e) { log.error('[records] persist failed', e); return { error: 'IO' }; }
      return { ok: true, accepted: out.added, rejected: out.rejected, duplicated: out.duplicated };
    },
    /** 裁决一条冲突：keep = 'cloud' | 'local'。 */
    resolve(qq, id, keep) {
      ensure();
      const r = byQQ.get(qq);
      if (!r) return { error: 'NOT_FOUND' };
      if (!id || !r.conflicts || !r.conflicts[id]) return { error: 'NO_CONFLICT' };
      r.records = resolveConflict(r.records, r.conflicts, id, keep === 'local' ? 'local' : 'cloud');
      touch(r);
      scoreCache.delete(qq);
      try { persist(r); } catch (e) { log.error('[records] persist failed', e); return { error: 'IO' }; }
      return { ok: true };
    },
    flush,
  };
  return api;
}
