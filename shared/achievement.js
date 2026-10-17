// shared/achievement.js — [ACH] 成就评分：按对局结果与难度求和，再做棋子分档（纯函数，服务端与客户端共用）。
//
// 房间玩家名旁的「棋子徽章 + 分数」由这里算：客户端从本机对局记录（`sp.pref.stats`，一个 `{ v, records: [...] }`
// 信封）求和后经 `player.ach` 上报（游客）；已绑定账号的分数由服务端对成就库 `records/<qq>.json` 求和（权威）。
//
// 评分规则（由号主给定）：
//   未通关（按撑到的结算回合数）：
//     06–09 回合后失败 → +1
//     10–11 回合后失败 → +2
//     12+ 回合后失败 → +3（≥12 一律 +3；不足 6 回合 → 0）
//   通关（按难度）：
//     简单/标准（FUNNY）通关 → +3
//     险境（NORMAL）通关 → +4
//     绝境（HARD）通关 → +5
//   通关且触发隐藏：
//     险境 + 隐藏 → +5
//     绝境 + 隐藏 → +7
//
// 难度 id 见 shared/constants.js DIFFICULTIES = ['FUNNY','NORMAL','HARD','ABYSS']；本 fork 的 ABYSS 等同绝境。

/** @typedef {'FUNNY'|'NORMAL'|'HARD'|'ABYSS'|string} DifficultyId */

/** 通关按难度的基础分；隐藏另算。键为难度 id（见 DIFFICULTIES）。 */
export const CLEAR_POINTS = Object.freeze({ FUNNY: 3, NORMAL: 4, HARD: 5, ABYSS: 5 });
/** 通关且触发隐藏时的分；未列出的难度用 CLEAR_POINTS（无隐藏加成）。 */
export const CLEAR_HIDDEN_POINTS = Object.freeze({ NORMAL: 5, HARD: 7, ABYSS: 7 });

/** 未通关：按结算回合数分档 [最低回合数, 分]，从高到低匹配。 */
export const FAIL_BRACKETS = Object.freeze([[12, 3], [10, 2], [6, 1]]);

/** 单局评分：一条对局记录里的结果字段 → 分数。@param {{difficulty?:string, victory?:boolean, hidden?:boolean, rounds?:number}} m */
export function scoreMatch(m) {
  const rounds = Number.isFinite(m?.rounds) ? m.rounds : 0;
  if (m?.victory) {
    const d = m.difficulty;
    if (m.hidden && CLEAR_HIDDEN_POINTS[d] != null) return CLEAR_HIDDEN_POINTS[d];
    if (CLEAR_POINTS[d] != null) return CLEAR_POINTS[d];
    return 0; // 未知难度：不给分（避免误判）
  }
  for (const [min, pts] of FAIL_BRACKETS) if (rounds >= min) return pts;
  return 0;
}

/** 记录里的「自己」那一行（结算表里属于本玩家的行）。 */
function selfRow(rec) {
  const ps = Array.isArray(rec?.players) ? rec.players : [];
  return ps.find((p) => p && p.playerId && p.playerId === rec.selfId)
    || ps.find((p) => p && !p.isBot)
    || ps[0]
    || null;
}

/** 一条记录里玩家自己撑到的回合数（自身行优先，其次全队）。 */
function roundsOf(rec) {
  const self = selfRow(rec);
  const v = self && Number.isFinite(self.roundsPassed) ? self.roundsPassed : rec?.roundsPassed;
  return Number.isFinite(v) ? v : 0;
}

/** 一条规范化记录 → 分数。@param {any} rec */
export function scoreRecord(rec) {
  if (!rec || typeof rec !== 'object') return 0;
  const self = selfRow(rec);
  const victory = self ? !!self.victory : !!rec.victory;
  return scoreMatch({
    difficulty: rec.difficulty,
    victory,
    hidden: !!(rec.hiddenReached || rec.hiddenCleared),
    rounds: roundsOf(rec),
  });
}

/**
 * 统计信封（`sp.pref.stats` 的 JSON 字符串，`{ v, records:[...] }`）→ 全部记录求和。
 * @param {unknown} json
 * @returns {number}
 */
export function scoreStats(json) {
  if (typeof json !== 'string' || !json) return 0;
  let env;
  try { env = JSON.parse(json); } catch { return 0; }
  const records = Array.isArray(env?.records) ? env.records : [];
  let sum = 0;
  for (const rec of records) sum += scoreRecord(rec);
  return sum;
}

/**
 * 成就评分 → 棋子称号（号主给定，从高到低匹配）：
 *   0–9 车 / 10–29 马 / 30–59 象 / 60–99 后 / 100+ 王
 * 返回该档的 `{ id, name, min, glyph, color, ink }`；`name` 为中文棋子字（标题提示/无障碍文本用），
 * 徽章本身只画字形与分数（i18n-ignore: chess piece glyphs）。
 */
export const PIECE_TIERS = Object.freeze([
  { min: 100, id: 'king', name: '王', glyph: '\u265A', color: '#cf6c28', ink: '#ffffff' }, // i18n-ignore
  { min: 60, id: 'queen', name: '后', glyph: '\u265B', color: '#f1b357', ink: '#1a1205' }, // i18n-ignore
  { min: 30, id: 'bishop', name: '象', glyph: '\u265D', color: '#b6a87f', ink: '#1a1205' }, // i18n-ignore
  { min: 10, id: 'knight', name: '马', glyph: '\u265E', color: '#607d72', ink: '#ffffff' }, // i18n-ignore
  { min: 0, id: 'rook', name: '车', glyph: '\u265C', color: '#727171', ink: '#ffffff' }, // i18n-ignore
]);

/** @param {number} score @returns {{ id: string, name: string, glyph: string, min: number, color: string, ink: string }} */
export function pieceOf(score) {
  const s = Number.isFinite(score) ? score : 0;
  for (const tier of PIECE_TIERS) if (s >= tier.min) return tier;
  return PIECE_TIERS[PIECE_TIERS.length - 1];
}
