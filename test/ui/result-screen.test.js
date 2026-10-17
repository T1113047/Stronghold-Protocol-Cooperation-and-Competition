// 终局结算画面 (user 2026-10-17): the settlement AFTER R15 — the verdict, the highest round passed (up to the R15
// 隐秘核心), each squad's final shared LP and leaders, the 赏金 / 金币 table of 坎诺特 (2V2: one row per member plus a
// total per squad) and the two layouts (solo / co-op vs 2V2). The pure view model of screens/result.js is unit-tested
// here (no DOM); the markup / stylesheet are checked statically, and every new string in the four packs.
//
// Terms: 狩猎期 / 最终狩猎 are the 2V2 names; R16, 终焉核心, 第三关, 追猎 and 悬赏期 are gone (versus-text.test.js R13
// guards the packs; this file guards the settlement). 赏金 ≠ 金币 (en: bounty ≠ gold).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the module reads game data at render time; every fetch resolves to the repository's own JSON files
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { normalizeResult, fmtNum } = await import('../../public/js/ui/gameLogic.js');
const {
  resultFrame, resultMilestones, resultBosses, resultTeams, resultBounty, resultRanking, resultVerdict,
} = await import('../../public/js/screens/result.js');

const MODES = JSON.parse(read('data/config.json')).modes;
const frameOf = (res) => resultFrame(normalizeResult(res, null), res, MODES);
const playersOf = (res) => normalizeResult(res, null).players.map((p) => {
  const row = (res.players || []).find((x) => x.playerId === p.playerId) || {};
  return { ...p, team: Number.isInteger(row.team) ? row.team : null, bounty: row.bounty ?? null };
});

// ---- the payloads ------------------------------------------------------------------------------------------------

const VERSUS = {
  victory: true, roundsPassed: 14, hiddenReached: true, hiddenCleared: false, reason: 'versus',
  modeId: 'mode_multi_hard', difficulty: 'HARD', bossId: 'boss_a', hiddenBossId: 'boss_b', durationMs: 60000,
  versus: {
    winnerTeam: 1, doubleLoss: false, timeTie: false, timeWeights: { r14: 4, r15: 5 },
    teams: {
      0: {
        bossPct: 0.6, score: 40, lp: 6, remainingTime: 10, timeScore: 4.5, timeMax: 9, timePct: 50,
        time: { r14: { remain: 60, limit: 120, reached: true }, r15: { remain: 60, limit: 120, reached: true } },
      },
      1: {
        bossPct: 0.8, score: 60, lp: 22, remainingTime: 20, timeScore: 8, timeMax: 9, timePct: 88.88888888888889,
        time: { r14: { remain: 120, limit: 120, reached: true }, r15: { remain: 96, limit: 120, reached: true } },
      },
    },
  },
  players: [
    { playerId: 'p_0', seat: 0, name: 'A0', alive: true, lp: 3, team: 0, roundsPassed: 14, bounty: { earned: 12, withdrawn: 4, bank: 7 }, stats: { gold: 30, dmgDealt: 100 }, title: 'comment_2', lineup: [] },
    { playerId: 'ai_1', seat: 1, name: 'A1', isBot: true, alive: true, lp: 3, team: 0, roundsPassed: 13, bounty: { earned: 0, withdrawn: 0, bank: 0 }, stats: { gold: 10, dmgDealt: 50 }, title: null, lineup: [] },
    { playerId: 'ai_2', seat: 2, name: 'B0', isBot: true, alive: true, lp: 11, team: 1, roundsPassed: 15, bounty: { earned: 5, withdrawn: 1, bank: 4 }, stats: { gold: 20, dmgDealt: 200 }, title: null, lineup: [] },
    { playerId: 'ai_3', seat: 3, name: 'B1', isBot: true, alive: false, lp: 0, team: 1, roundsPassed: 14, bounty: { earned: 9, withdrawn: 9, bank: 0 }, stats: { gold: 5, dmgDealt: 10 }, title: null, lineup: [] },
  ],
};
// the same match, both squads' leaders broken (the settlement medals show ✓)
const VERSUS_CLEARED = {
  ...VERSUS, roundsPassed: 15, hiddenCleared: true,
  versus: {
    ...VERSUS.versus,
    teams: {
      0: { ...VERSUS.versus.teams[0], bossPct: 1, timeScore: 9, timePct: 100, time: { r14: { remain: 120, limit: 120, reached: true }, r15: { remain: 120, limit: 120, reached: true } } },
      1: { ...VERSUS.versus.teams[1], bossPct: 1, timeScore: 7, timePct: 77.77777777777779, time: { r14: { remain: 120, limit: 120, reached: true }, r15: { remain: 60, limit: 120, reached: true } } },
    },
  },
};
const SOLO = {
  victory: false, roundsPassed: 5, modeId: 'mode_single_funny', difficulty: 'FUNNY', reason: 'eliminated',
  players: [{ playerId: 'p_0', seat: 0, name: 'S', alive: false, lp: 0, roundsPassed: 5, stats: { gold: 4 }, lineup: [] }],
};
const COOP = {
  victory: true, roundsPassed: 15, hiddenReached: true, hiddenCleared: true, modeId: 'mode_multi_normal', difficulty: 'NORMAL',
  teamLp: 30, players: [
    { playerId: 'p_0', seat: 0, name: 'A', alive: true, lp: 15, roundsPassed: 15, bounty: { earned: 3, withdrawn: 1, bank: 2 }, stats: { gold: 1, dmgDealt: 9 }, lineup: [] },
    { playerId: 'ai_1', seat: 1, name: 'B', isBot: true, alive: false, lp: 0, roundsPassed: 9, bounty: { earned: 1, withdrawn: 0, bank: 1 }, stats: { gold: 2, dmgDealt: 3 }, lineup: [] },
  ],
};

// ---- resultFrame -------------------------------------------------------------------------------------------------

test('resultFrame: the mode\'s boss rounds (R14 / R15), the highest round passed and the 2V2 detection', () => {
  const f = frameOf(VERSUS);
  assert.equal(f.bossRound, 14);
  assert.equal(f.hiddenRound, 15);
  assert.equal(f.maxRound, 15);
  assert.equal(f.highest, 14, 'the passed rounds, capped at the mode\'s last round');
  assert.equal(f.reached, 15, 'the Hidden Core was fought even though it was not cleared');
  assert.equal(f.isVersus, true);
  assert.equal(f.huntMode, true, '2V2 runs the hunt economy (坎诺特 / 赏金)');

  const solo = frameOf(SOLO);
  assert.equal(solo.bossRound, 9, '标准/独立 has its own boss round');
  assert.equal(solo.hiddenRound, null, 'and no Hidden Core');
  assert.equal(solo.maxRound, 9);
  assert.equal(solo.highest, 5);
  assert.equal(solo.reached, 5);
  assert.equal(solo.isVersus, false);
  assert.equal(solo.huntMode, false, 'solo has no 坎诺特 / 赏金');

  assert.equal(frameOf(COOP).maxRound, 15, '险境/绝境/终极 end at the R15 隐秘核心');
  assert.equal(frameOf(COOP).huntMode, true, '同盟狩猎 ALSO runs 坎诺特 / 赏金 (server huntMode = isVersus || coopHuntOn)');
  // a backend flag wins over the mode table (a newer payload can settle an old record correctly)
  assert.equal(resultFrame({ modeId: 'mode_multi_normal', players: [] }, { huntMode: false }, MODES).huntMode, false);
  assert.equal(resultFrame({ modeId: 'mode_single_funny', players: [] }, { huntMode: true }, MODES).huntMode, true);
  // a payload without modes falls back to the payload's own lastRound (14) — a tolerant read
  assert.equal(resultFrame({ modeId: null, roundsPassed: 30, lastRound: 14, players: [] }, null, null).maxRound, 14);
  assert.equal(resultFrame({ modeId: null, roundsPassed: 30, players: [] }, null, null).highest, 14, 'never above the last round');
});

test('resultMilestones: 狩猎期 → 最终攻势 → 隐秘核心, each done / now / off', () => {
  const v = resultMilestones(frameOf(VERSUS)).map((m) => [m.key, m.label, m.state]);
  assert.deepEqual(v, [['regular', '狩猎期', 'done'], ['boss', '最终攻势', 'done'], ['hidden', '隐秘核心', 'now']]);
  const solo = resultMilestones(frameOf(SOLO)).map((m) => [m.key, m.label, m.state]);
  assert.deepEqual(solo, [['regular', '常规回合', 'now'], ['boss', '最终攻势', 'off']], 'no Hidden Core chip without the round');
  const cleared = resultMilestones(frameOf(VERSUS_CLEARED)).map((m) => [m.key, m.state]);
  assert.deepEqual(cleared, [['regular', 'done'], ['boss', 'done'], ['hidden', 'done']], 'a cleared Hidden Core');
});

test('resultBosses: solo / co-op read the outcome, 2V2 the per-squad leader scoring', () => {
  const solo = resultBosses(frameOf(SOLO), normalizeResult(SOLO, null));
  assert.deepEqual(solo.map((b) => [b.key, b.label, b.round, b.cleared, b.reached]), [['boss', '最终攻势', 9, false, true]]);
  const coop = resultBosses(frameOf(COOP), normalizeResult(COOP, null));
  assert.deepEqual(coop.map((b) => [b.key, b.cleared, b.reached]), [['boss', true, true], ['hidden', true, true]]);
  // 2V2: the last leader fight was the 隐秘核心 (reached), no squad dealt 100 % → not cleared at the match level
  const vs = resultBosses(frameOf(VERSUS), normalizeResult(VERSUS, null));
  assert.deepEqual(vs.map((b) => [b.key, b.round, b.cleared, b.reached]), [['boss', 14, true, true], ['hidden', 15, false, true]]);
  const vsClear = resultBosses(frameOf(VERSUS_CLEARED), normalizeResult(VERSUS_CLEARED, null));
  assert.deepEqual(vsClear.map((b) => [b.key, b.cleared]), [['boss', true], ['hidden', true]]);
});

// ---- resultTeams / resultBounty ---------------------------------------------------------------------------------

test('resultTeams: 2V2 → the two squads compared (final shared LP, verdict, leader damage, 4:5 time)', () => {
  const res = VERSUS;
  const teams = resultTeams(frameOf(res), normalizeResult(res, null), playersOf(res));
  assert.deepEqual(teams.map((t) => [t.id, t.name, t.lp, t.win, t.alive]), [
    [1, '第 2 小队', 22, true, 1], [0, '第 1 小队', 6, false, 2],
  ], 'the higher-time squad first; the shared pool per squad and its winner (player B1 was eliminated)');
  assert.deepEqual(teams.map((t) => t.bossPct), [0.8, 0.6], 'the last leader fight damage share');
  assert.deepEqual(teams.map((t) => [t.timeScore, Math.round(t.timePct)]), [[8, 89], [4.5, 50]]);
  assert.deepEqual(teams.map((t) => [t.time.r14.remain, t.time.r15.remain]), [[120, 96], [60, 60]]);
  // a draw has no winner
  const draw = { ...res, versus: { ...res.versus, winnerTeam: null } };
  assert.deepEqual(resultTeams(frameOf(draw), normalizeResult(draw, null), playersOf(draw)).map((t) => t.win), [null, null]);
  // solo / co-op: one squad
  const coop = resultTeams(frameOf(COOP), normalizeResult(COOP, null), playersOf(COOP));
  assert.deepEqual(coop.map((t) => [t.id, t.name, t.lp, t.win, t.alive, t.time]), [[null, '同盟', 30, true, 1, null]]);
  const solo = resultTeams(frameOf(SOLO), normalizeResult(SOLO, null), playersOf(SOLO));
  assert.deepEqual(solo.map((t) => [t.name, t.lp, t.win]), [['独立狩猎', 0, false]]);
});

test('resultBounty: one row per member plus a total per squad (2V2) or one for 同盟狩猎; 消耗金币 in solo', () => {
  const res = VERSUS;
  const b = resultBounty(playersOf(res), frameOf(res));
  assert.equal(b.merchant, true);
  assert.deepEqual(b.rows.map((r) => [r.playerId, r.earned, r.withdrawn, r.bank]), [
    ['p_0', 12, 4, 7], ['ai_1', 0, 0, 0], ['ai_2', 5, 1, 4], ['ai_3', 9, 9, 0],
  ]);
  assert.deepEqual(b.totals.map((t) => [t.team, t.name, t.earned, t.withdrawn, t.bank]), [
    [0, '第 1 小队', 12, 4, 7], [1, '第 2 小队', 14, 10, 4],
  ], '本局赏金收入 / 已取出金币 / 剩余存款 per squad');
  // 同盟狩猎: the same 坎诺特 table, with ONE total row for the single squad (team: null)
  const coop = resultBounty(playersOf(COOP), frameOf(COOP));
  assert.equal(coop.merchant, true, 'co-op hunts bank 赏金 too');
  assert.deepEqual(coop.rows.map((r) => [r.playerId, r.earned, r.withdrawn, r.bank]), [['p_0', 3, 1, 2], ['ai_1', 1, 0, 1]]);
  assert.deepEqual(coop.totals.map((t) => [t.team, t.name, t.earned, t.withdrawn, t.bank]), [[null, '同盟', 4, 1, 3]]);
  // solo: no merchant, no 赏金 — the panel shows the funds spent (金币)
  const solo = resultBounty(playersOf(SOLO), frameOf(SOLO));
  assert.equal(solo.merchant, false);
  assert.deepEqual(solo.rows.map((r) => [r.playerId, r.spent, r.earned]), [['p_0', 4, null]]);
  assert.deepEqual(solo.totals, []);
  // a record that never stored the counters (an older 对局记录): absent, not zero
  const old = { ...VERSUS, players: VERSUS.players.map(({ bounty, ...p }) => p) };
  const b2 = resultBounty(playersOf(old), frameOf(old));
  assert.deepEqual(b2.rows.map((r) => r.earned), [null, null, null, null]);
  assert.deepEqual(b2.totals.map((t) => t.earned), [null, null], 'no numbers → no invented total');
});

// ---- resultRanking / resultVerdict ------------------------------------------------------------------------------

test('resultRanking: 2V2 puts the winning squad (the 4:5 time order) first, then rounds / damage; each row carries its 评语', () => {
  const titles = JSON.parse(read('data/config.json')).titles;
  const res = VERSUS;
  const teams = resultTeams(frameOf(res), normalizeResult(res, null), playersOf(res));
  const rows = resultRanking(playersOf(res), titles, teams);
  assert.deepEqual(rows.map((r) => [r.rank, r.playerId, r.rounds, r.team]), [
    [1, 'ai_2', 15, 1], [2, 'ai_3', 14, 1], [3, 'p_0', 14, 0], [4, 'ai_1', 13, 0],
  ], 'the winning squad above the other, rounds then damage inside a squad');
  assert.deepEqual(rows.map((r) => r.titleName), [null, null, '不朽盟约', null], 'the 评语 of the stored title id');
  assert.equal(rows.find((r) => r.playerId === 'ai_3').alive, false);
  // solo / co-op: no squads to order
  const soloRows = resultRanking(playersOf(COOP), titles, resultTeams(frameOf(COOP), normalizeResult(COOP, null), playersOf(COOP)));
  assert.deepEqual(soloRows.map((r) => r.playerId), ['p_0', 'ai_1'], 'rounds first');
});

test('resultVerdict: 模拟完成 / 模拟失败; 2V2 the winning squad, whether it was yours and the 4:5 time outcome', () => {
  assert.deepEqual(resultVerdict(frameOf(SOLO), normalizeResult(SOLO, null), null), {
    headline: '模拟失败', sub: '防线已被突破', tone: 'lose', mine: null, timeTie: false, timeVerdict: null,
  });
  assert.deepEqual(resultVerdict(frameOf(COOP), normalizeResult(COOP, null), null), {
    headline: '模拟完成', sub: '成功卫戍 · 敌方领袖已被击败', tone: 'win', mine: null, timeTie: false, timeVerdict: null,
  });
  const f = frameOf(VERSUS);
  assert.equal(resultVerdict(f, normalizeResult(VERSUS, null), 1).headline, '第 2 小队获胜');
  assert.deepEqual(resultVerdict(f, normalizeResult(VERSUS, null), 0), {
    headline: '第 2 小队获胜', sub: '你的小队落败', tone: 'lose', mine: false, timeTie: false, timeVerdict: '第 2 小队胜（时间）',
  });
  const win1 = resultVerdict(f, normalizeResult(VERSUS, null), 1);
  assert.equal(win1.sub, '你的小队获胜');
  // a spectator (no team of its own): the rule the settlement decided by
  const spec = resultVerdict(f, normalizeResult(VERSUS, null), null);
  assert.equal(spec.sub, '两队各自迎战领袖，先比较 R14 与 R15 剩余时间（4:5），再比共享生命');
  // 标准 2V2 (FUNNY) has only R14 (hiddenRound null): the rule names R14 alone, never a 4:5 that was not played
  const funny = { ...VERSUS, modeId: 'mode_multi_funny', versus: { ...VERSUS.versus, timeWeights: { r14: 4 } } };
  const funnyV = resultVerdict(frameOf(funny), normalizeResult(funny, null), null);
  assert.equal(funnyV.sub, '两队各自迎战领袖，先比较 R14 剩余时间，再比共享生命');
  // 时间同分: named in the settlement, the winner then came from the shared LP
  const tie = { ...VERSUS, versus: { ...VERSUS.versus, winnerTeam: 0, timeTie: true } };
  const tieV = resultVerdict(frameOf(tie), normalizeResult(tie, null), null);
  assert.equal(tieV.timeTie, true);
  assert.equal(tieV.timeVerdict, '时间同分，按共享生命判定');
  assert.equal(tieV.sub, '时间同分，按共享生命判定');
  // 时间 + 共享生命 both tied: the leader damage share decides, and the settlement says so
  const tieBoth = {
    ...VERSUS,
    versus: { ...VERSUS.versus, winnerTeam: 0, timeTie: true, teams: { 0: { ...VERSUS.versus.teams[0], lp: 6 }, 1: { ...VERSUS.versus.teams[1], lp: 6 } } },
  };
  const tieBothV = resultVerdict(frameOf(tieBoth), normalizeResult(tieBoth, null), null);
  assert.equal(tieBothV.timeVerdict, '时间同分、生命持平，按领袖伤害判定');
  // a draw has no winner and no time verdict
  const draw = { ...VERSUS, versus: { ...VERSUS.versus, winnerTeam: null } };
  const drawV = resultVerdict(frameOf(draw), normalizeResult(draw, null), 0);
  assert.equal(drawV.headline, '双方战平');
  assert.equal(drawV.mine, null);
  assert.equal(drawV.timeVerdict, '时间同分');
  const dbl = { ...VERSUS, versus: { ...VERSUS.versus, winnerTeam: null, doubleLoss: true } };
  const dblV = resultVerdict(frameOf(dbl), normalizeResult(dbl, null), 0);
  assert.equal(dblV.headline, '双方失利');
  assert.equal(dblV.timeVerdict, null, 'a double loss has no time decision to name');
});

// ---- the screen and the stylesheet ------------------------------------------------------------------------------

test('the settlement screen has both layouts and the new panels, each with a data-testid', () => {
  const src = read('public/js/screens/result.js');
  for (const id of [
    'result-screen', 'result-hero', 'result-headline', 'result-rounds', 'result-milestones', 'result-left', 'result-right',
    'result-bounty', 'result-bounty-row', 'result-ranking', 'result-rank-row', 'result-players', 'result-player-card', 'result-gold',
    'result-time', 'result-time-verdict',
  ]) assert.ok(src.includes(`data-testid="${id}"`) || src.includes(`'${id}'`) || src.includes(id), `data-testid ${id}`);
  assert.match(src, /data-testid=\$\{`result-team-\$\{team\.isVersus \? team\.id : 'all'\}`\}/, 'one squad card per team');
  assert.match(src, /data-testid="result-team-time"/, 'each squad shows its 4:5 time record');
  assert.match(src, /data-testid="result-time-r14"/);
  assert.match(src, /data-testid="result-time-r15"/);
  assert.match(src, /data-testid=\$\{`result-bounty-team-\$\{key\}`\}/, 'a total row per squad');
  // M4: the 4:5 weight line only when R15 was played; 标准 2V2 has R14 alone
  assert.match(src, /const weightLabel = weights && Number\.isFinite\(Number\(weights\.r15\)\)/);
  assert.match(src, /data-testid=\$\{`result-milestone-\$\{m\.key\}`\}/, 'a milestone per phase');
  assert.match(src, /class="result__foot"/, 'the way back the community-layout e2e clicks');
  assert.match(src, /resultBonds\(p\.bonds/, 'the per-player cards keep the bonds');
  assert.match(src, /LineupThumb/, 'and the final lineup');
  // the four panel titles read the terms: 赏金 and 金币 apart, 狩猎期 / 最终狩猎 only
  for (const k of ['赏金与金币', '本局赏金收入', '已取出金币', '剩余存款', '小队合计', '第 {n} 小队', '最高通过回合', '时间判定', '时间占比', '剩余时间']) {
    assert.ok(src.includes(`t('${k}'`) || src.includes(`t(\`${k}\``), `renders ${k}`);
  }
  assert.ok(!/R16|终焉核心|第三关|追猎|悬赏期/.test(src), 'no obsolete term in the settlement screen');
});

test('the two-column layout scrolls inside itself and every readable size reads --t', () => {
  const css = read('public/css/screens/result.css');
  assert.match(css, /\.result__main \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) minmax\(0, 1fr\) auto/, 'header / panels / cards / back');
  assert.match(css, /\.result__cols \{ display: grid; grid-template-columns: minmax\(0, 1\.08fr\) minmax\(0, \.92fr\)/, 'left = 队伍/排名/回合, right = 赏金/金币');
  assert.match(css, /\.result__col \{[\s\S]*?overflow: auto/, 'each panel scrolls inside itself');
  assert.match(css, /\.result__players \{[\s\S]*?overflow: auto/, 'so do the player cards');
  assert.match(css, /\.result__timedec \{/, 'the 4:5 time verdict line');
  assert.ok(!/R16|终焉核心|第三关|追猎|悬赏期/.test(css), 'no obsolete term in the stylesheet');
  // every font-size is scaled (var(--t)) or an em-relative one — a plain rem would ignore 文字大小
  const bad = [];
  for (const m of css.matchAll(/font-size:([^;}]*)/g)) {
    const v = m[1].trim();
    if (/var\(--t\)/.test(v) || /em\b|%/.test(v)) continue;
    bad.push(v);
  }
  assert.deepEqual(bad, []);
  assert.ok((css.match(/var\(--t\)/g) || []).length >= 30, 'the stylesheet is on the text root');
});

test('the new strings are in all four packs; 赏金 never becomes gold in English', () => {
  const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
  const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`public/i18n/${l}.json`))]));
  const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
  const keys = [
    '战果 · 队伍与回合', '赏金与金币', '第 {n} 小队', '小队合计', '本局赏金收入', '已取出金币', '剩余存款', '已击破',
    '未击破', '未到达', '最高通过回合', '排名', '常规回合', '存活 {n}/{total}', '双方战平', '双方失利',
    '第 {n} 小队获胜', '你的小队获胜', '你的小队落败',
    '两队各自迎战领袖，先比较 R14 与 R15 剩余时间（4:5），再比共享生命',
    '两队各自迎战领袖，先比较 R14 剩余时间，再比共享生命',
    '本模式没有赏金与商人。', '最近领袖战', '最终共享生命', '平局',
    '时间判定', '时间占比', '剩余时间', '第 {n} 小队胜（时间）', '时间同分', '时间同分，按共享生命判定',
    '时间同分、生命持平，按领袖伤害判定', '消耗金币',
    '击杀狩猎期的投放怪才能获得赏金，且只能在坎诺特处换成金币。',
  ];
  for (const k of keys) {
    for (const l of LANGS) {
      const v = PACK[l][k];
      assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(k)}`);
      assert.ok(v.trim(), `${l}: empty ${JSON.stringify(k)}`);
      if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
      if (/[{]/.test(k)) {
        for (const ph of k.match(/\{[a-z]+\}/g) || []) assert.ok(v.includes(ph), `${l}: ${JSON.stringify(k)} lost ${ph}`);
      }
    }
  }
  assert.equal(PACK.en['赏金与金币'], 'Bounty & Gold');
  assert.equal(PACK.en['金币'], 'Gold');
  assert.equal(PACK.en['赏金'], 'Bounty');
  assert.ok(!/gold|coin/i.test(PACK.en['赏金与金币'].split('&')[0].trim()), '赏金 is never called gold');
  for (const l of LANGS) for (const k of keys) assert.ok(!/R16|终焉核心|第三关|追猎|悬赏期/.test(PACK[l][k]), `${l}: ${k}`);
});

test('PLAYING documents the endgame settlement in the settled terms', () => {
  const md = read('docs/PLAYING.md');
  for (const k of ['终局结算画面', '最高通过回合', '本局赏金收入', '已取出金币', '剩余存款', '小队合计', '最终共享生命', '狩猎期', '最终狩猎']) {
    assert.ok(md.includes(k), `PLAYING.md: ${k}`);
  }
  assert.ok(!/R16|终焉核心|第三关|追猎|悬赏期/.test(md), 'no obsolete term in PLAYING.md');
});

// ---- the server payload ------------------------------------------------------------------------------------------

test('results.js sends each row\'s squad and the 坎诺特 counters', () => {
  const src = read('server/match/results.js');
  assert.match(src, /team: ps\.team/);
  assert.match(src, /bounty: \{[\s\S]*?earned: Math\.max\(0, Math\.trunc\(Number\(ps\.bountyEarned\)[\s\S]*?withdrawn: Math\.max\(0, Math\.trunc\(Number\(ps\.withdrawnGold\)[\s\S]*?bank: Math\.max\(0, Math\.trunc\(Number\(ps\.bountyBank\)/);
  assert.match(read('server/match/PlayerState.js'), /this\.bountyEarned = 0/);
  assert.match(read('server/match/match/settle.js'), /ps\.bountyBank \+= bank; ps\.bountyEarned \+= bank;/);
});

test('the fmtNum the cards use exists for the bounty table', () => {
  assert.equal(typeof fmtNum, 'function');
});
