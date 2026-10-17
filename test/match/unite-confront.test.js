// 2V2 regression (user's economy worry): a monster the OPPONENT placed in the 狩猎期 must cost the receiving player's
// team NOTHING after it leaks. A placed spawn carries `countInTotal: false` (match/confront.js), so fields.js records a
// leaked one with `counted: false`; server/match/unite.js deliberately treats such a leak as neither a 联防 trigger nor
// an enemy that re-enters the helpers' field (`if (!l || l.counted === false) continue;`), which also keeps it out of
// uniteSurvivors() → settle(). A normal round-wave leak (`counted: true`) does the opposite. This file pins both
// directions down on the real pipeline; it changes no behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { planUnites } from '../../server/match/unite.js';
import { buildUniteWave } from '../../server/match/waves.js';

/** 4 seats laid out as two teams of two (0,1 → team 0; 2,3 → team 1). */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/** A BattleResult.perPlayer stand-in (only the fields unite.js and settle.js read). */
const perPlayer = (leaked, extra = {}) => ({
  killed: 0, total: leaked.length, leaked, perfect: !leaked.some((l) => l.counted !== false),
  layerGains: {}, coins: 0, bank: 0, damageDealt: 0, unitsEnd: [], unitStats: [], ...extra,
});

/** A leak entry: `counted: false` is exactly what fields.js keeps for a placed (`countInTotal: false`) monster. */
const leakOf = (enemyKey, counted = true) => ({
  enemyKey, mods: counted ? null : { confrontSeat: 2 }, lpr: 1, tag: null, counted, spawned: true,
});

/** Two real enemy keys of the round's own wave (keys `gd.enemy` knows; the placed one reuses a real enemy on purpose). */
function waveKeys(m) {
  const seen = [...new Set((m.wave?.spawns || []).map((s) => s.enemyKey).filter((k) => m.gd.enemy(k)))];
  if (seen.length >= 2) return seen.slice(0, 2);
  const all = Object.keys((m.gd.raw && m.gd.raw.enemies) || {}).filter((k) => m.gd.enemy(k));
  return [...new Set([...seen, ...all])].slice(0, 2);
}

const startVersus = (seed) => makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true }).start();

test('2V2: a leaked 投放怪 (counted: false) stays out of the 联防 plan and the helper\'s wave', (t) => {
  const h = startVersus(201);
  t.after(() => h.m.dispose());
  const m = h.m;
  h.autoHumans();
  h.toPrep(1);
  const [placed, normal] = waveKeys(m);
  assert.ok(placed && normal && placed !== normal, `two real enemy keys (${placed} / ${normal})`);
  // p_0 also leaked a NORMAL wave monster, so a 联防 is genuinely planned (otherwise there would be no plan to check)
  const results = new Map([
    ['p_0', perPlayer([leakOf(placed, false), leakOf(normal, true)])],
    ['ai_1', perPlayer([])],
    ['ai_2', perPlayer([])],
    ['ai_3', perPlayer([])],
  ]);
  const plans = planUnites(m, results);
  assert.equal(plans.length, 1, 'one team plans a 联防 (a counted leak + a perfect teammate)');
  const plan = plans[0];
  assert.equal(plan.team, 0);
  assert.deepEqual(plan.helpers.map((p) => p.playerId), ['ai_1']);
  assert.deepEqual(plan.leakers.map((p) => p.playerId), ['p_0']);
  assert.deepEqual(plan.leaked.map((l) => l.enemyKey), [normal], 'only the counted leak is queued for 联防');
  assert.ok(plan.leaked.every((l) => l.counted !== false), 'no counted:false leak is queued');
  const wave = buildUniteWave(m.gd, plan.leaked, plan.helpers.length, m.wave.timeLimit);
  assert.ok(wave.spawns.length > 0, 'the helpers have enemies to fight');
  assert.ok(wave.spawns.every((s) => s.enemyKey !== placed), 'the 投放怪 is not in the helper\'s 联防 wave');
  assert.deepEqual([...new Set(wave.spawns.map((s) => s.sourcePlayerId))], ['p_0'], 'the wave bills the leaker only');
  assert.deepEqual(h.logs.error, [], 'no engine errors');
});

test('2V2: a placed monster alone costs no LP; the same player\'s normal wave leak does', (t) => {
  // direction A — the only leak is a placed (uncounted) monster: nobody is a leaker, so settle charges the team nothing
  const a = startVersus(202);
  const am = a.m;
  a.autoHumans();
  a.toPrep(1);
  const [placed] = waveKeys(am);
  const poolA = am.teamHpPool(0);
  am.lastResults = new Map([
    ['p_0', perPlayer([leakOf(placed, false)])],
    ['ai_1', perPlayer([])],
    ['ai_2', perPlayer([])],
    ['ai_3', perPlayer([])],
  ]);
  assert.deepEqual(planUnites(am, am.lastResults), [], 'a placed leak is never a 联防 leaker');
  am.settle([], null);
  assert.equal(am.teamHpPool(0), poolA, 'the team pool is untouched by a placed leak');
  assert.ok(am.players.get('p_0').alive, 'no elimination either');
  a.m.dispose();

  // direction B (control) — the same seat leaks a NORMAL wave monster: it IS a leaker, it re-enters the 联防, and the
  // survivor is charged to the team pool
  const b = startVersus(203);
  const bm = b.m;
  t.after(() => bm.dispose());
  b.autoHumans();
  b.toPrep(1);
  const [, normal] = waveKeys(bm);
  const poolB = bm.teamHpPool(0);
  const resultsB = new Map([
    ['p_0', perPlayer([leakOf(normal, true)])],
    ['ai_1', perPlayer([])],
    ['ai_2', perPlayer([])],
    ['ai_3', perPlayer([])],
  ]);
  bm.lastResults = resultsB;
  const planB = planUnites(bm, resultsB)[0];
  assert.ok(planB, 'the counted leak triggers a 联防');
  assert.deepEqual(planB.leakers.map((p) => p.playerId), ['p_0']);
  assert.deepEqual(planB.leaked.map((l) => l.enemyKey), [normal]);
  assert.deepEqual(planB.helpers.map((p) => p.playerId), ['ai_1']);
  // the 联防 battle reports that one re-entered enemy of p_0 is still standing at the end
  const uniteResult = { perPlayer: { ai_1: { leaked: [{ enemyKey: normal, sourcePlayerId: 'p_0', counted: true, lpr: 1 }] } }, unspawned: [] };
  bm.settle([planB], [uniteResult]);
  assert.equal(bm.teamHpPool(0), poolB - 1, 'the surviving normal leak costs the team 1 LP');
  assert.deepEqual(b.logs.error, [], 'no engine errors');
});
