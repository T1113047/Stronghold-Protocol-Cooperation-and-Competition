// test/match/versus.test.js — 2V2 ('versus') match layer, step 2.1: the team abstraction and the team-scoped
// "teammates" effects. A versus match must never let a player's effects/联防 reach the opposing team.
//
// Runs a whole versus match on the fake battle engine (test/match/fakeBattle.js) and checks it reaches RESULT with
// no engine errors, so the team plumbing never breaks the round loop.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, teamOfSeat, VERSUS_LOW_LP, VERSUS_INFO_SECONDS } from '../../shared/constants.js';
import { confrontPool } from '../../server/match/match/confront.js';

/** 4 seats laid out as two teams of two (0,1 → team 0; 2,3 → team 1). */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/**
 * The cheapest monster that fits `budget`, across all 6 groups, with its 1-based group index (null when nothing fits).
 * The groups hold the same TOTAL value but not the same cheapest card, and the budget moves with the round's wave
 * value — so a test that must actually place something has to look everywhere (on a small wave the last group can hold
 * nothing affordable).
 * @returns {{ rec: { key: string, value: number }, group: number }|null}
 */
const affordablePick = (m, budget) => {
  let best = null;
  m.confrontGroups().forEach((g, i) => {
    for (const r of g.rows) if (r.value <= budget && (!best || r.value < best.rec.value)) best = { rec: r, group: i + 1 };
  });
  return best;
};

describe('versus (2V2) match: team model', () => {
  test('a versus match exposes its teams and scopes allies to one team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 7, fake: true }).start();
    const m = h.m;
    assert.equal(m.mode, 'versus');
    assert.equal(m.isVersus, true);
    assert.equal(m.isSolo, false);
    // the versus room reuses the MULTI tuning (data/config.json is generated)
    assert.ok(String(m.modeId).startsWith('mode_multi_'), m.modeId);

    const [a0, a1, b0, b1] = ['p_0', 'ai_1', 'ai_2', 'ai_3'].map((id) => h.ps(id));
    assert.deepEqual([a0, a1, b0, b1].map((p) => p.team), [0, 0, 1, 1]);
    assert.deepEqual([0, 1, 2, 3].map(teamOfSeat), [0, 0, 1, 1]);

    // allies: the player's own team only, in seat order — never the opponents
    assert.deepEqual(m.alliesOf(a0).map((p) => p.playerId), ['p_0', 'ai_1']);
    assert.deepEqual(m.alliesOf(b1).map((p) => p.playerId), ['ai_2', 'ai_3']);
    assert.equal(m.teamIdOf(a0), 0);
    assert.equal(m.teamIdOf(b0), 1);
    assert.equal(m.teamIdOf(null), 0, 'a missing player falls back to team 0');

    // aliveAllies narrows to the living members of the same team
    a1.lp = 0; a1.eliminate(1);
    assert.deepEqual(m.aliveAlliesOf(a0).map((p) => p.playerId), ['p_0']);
    assert.deepEqual(m.aliveAlliesOf(b0).map((p) => p.playerId), ['ai_2', 'ai_3']);
  });

  test('co-op keeps its single-team behaviour (everyone is team 0)', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 3, fake: true }).start();
    const m = h.m;
    assert.equal(m.isVersus, false);
    for (const ps of m.order) assert.equal(ps.team, null);
    const [p0] = m.order;
    assert.equal(m.alliesOf(p0).length, m.order.length, 'coop: allies are the whole roster');
    assert.deepEqual(m.aliveAlliesOf(p0).map((p) => p.playerId), m.alivePlayers().map((p) => p.playerId));
  });

  test('a versus match runs to RESULT with no engine errors, and every 联防 group is single-team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 11, fake: true }).start();
    h.autoHumans();
    const m = h.m;
    // watch every 联防 as it opens: each plan's helpers + leakers must all be on ONE team (never a cross-team 联防)
    const groups = [];
    h.onSend.push((pid, msg) => {
      if (msg.t !== 'm.public' || msg.phase !== PHASE.UNITE || !Array.isArray(m.unitePlans)) return;
      for (const pl of m.unitePlans) groups.push([...pl.helpers, ...pl.leakers].map((p) => m.teamIdOf(p)));
    });
    const done = h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(done && h.ended, `the match ended (phase ${m.phase} R${m.round})`);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    for (const g of groups) assert.equal(new Set(g).size, 1, `a 联防 group spanned teams: ${g.join()}`);
  });

  test('versus: boss pairing stays within a team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 5, fake: true }).start();
    h.autoHumans();
    const m = h.m;
    let checked = false;
    h.onSend.push((pid, msg) => {
      if (msg.t !== 'm.public' || (m.phase !== PHASE.FINAL_ASSAULT && m.phase !== PHASE.HIDDEN_CORE)) return;
      if (checked || !Array.isArray(m.bossPairs) || !m.bossPairs.length) return;
      checked = true;
      for (const pair of m.bossPairs) {
        const teams = new Set(pair.map((id) => m.teamIdOf(m.players.get(id))));
        assert.equal(teams.size, 1, `boss pair spans teams: ${pair.join()}`);
      }
    });
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(checked, 'the match reached the Final Assault');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus (client-side combat): the per-team boss pools reach the clients intact', () => {
    // 2026-10-16 production bug: b.pool leaves the scalar hp null and sends one pool per team (b.pool.pools); the
    // client read the scalar, `Number(null)` is 0, so the local pool was zeroed and the boss field reported 'cleared'
    // the moment it started — the server logged "implausible boss result … while the pool holds 8000000" and took the
    // field over. The players never saw the boss fight.
    // 4 humans: both teams' boss fields must run client-side, which is where the bug lived
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'p_3', name: 'B1', isBot: false, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 21, fake: true, clientCombat: true }).start();
    h.autoHumans();
    const m = h.m;
    h.drive(() => h.ended != null || m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 3e6 });
    assert.equal(m.phase, PHASE.FINAL_ASSAULT, `reached the Final Assault (${m.phase} R${m.round})`);
    // b.start: a boss field names its team, so the client can pick its entry out of b.pool.pools (the round start hands
    // the fields out as it launches them)
    h.flushAll();
    for (const [id, team] of [['p_0', 0], ['p_2', 1]]) {
      const start = h.allTo(id, 'b.start').find((msg) => msg.kind === 'boss');
      assert.ok(start, `${id} received a boss b.start`);
      assert.equal(start.team, team, 'the field carries its team');
    }
    // b.pool: one entry per team, no scalars
    h.drive(() => h.bc.some((msg) => msg.t === 'b.pool' && msg.pools), { maxSteps: 2e5 });
    h.flushAll(); // the deliveries run on the scheduler, like a real socket frame
    const first = h.bc.find((msg) => msg.t === 'b.pool' && msg.pools);
    assert.ok(first, 'the boss round broadcasts one pool per team');
    assert.equal(first.hp, null, '2V2 has no scalar pool');
    assert.deepEqual(Object.keys(first.pools).sort(), ['0', '1']);
    for (const t of ['0', '1']) {
      assert.ok(first.pools[t].max > 0, `team ${t} pool has a size`);
      assert.equal(first.pools[t].hp, first.pools[t].max, `team ${t} pool starts full`);
      assert.ok(Number.isFinite(first.pools[t].teamLp), `team ${t} carries its LP`);
    }
    // the browser side (the harness's SimClient applies the same rule as public/js/battle/runner.js): the local pool
    // must keep its hp — with the bug it read 0 and the field ended as 'cleared'
    const c0 = h.clients.get('p_0');
    assert.ok(c0.pools.length, 'the client received the pool broadcast');
    const field = [...c0.battles.values()].find((e) => e.battle && e.battle.sharedBoss);
    assert.ok(field && field.battle.sharedBoss.maxHp > 0, 'the client built its team boss field');
    assert.ok(field.battle.sharedBoss.hp > 0, 'the local pool is not zeroed by the null scalar');
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.deepEqual(h.logs.warn.filter((w) => /implausible boss result/.test(w)), [], 'no boss result was rejected');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    assert.ok(h.ended, 'the match ended');
  });

  test('versus: the result carries per-team scoring and a winner', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 21, fake: true }).start();
    h.autoHumans();
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(h.ended, 'the match ended');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    assert.ok(h.ended.versus, 'the summary carries the versus scoring');
    assert.equal(h.ended.versus.doubleLoss, false, 'both teams reached R14');
    assert.equal(Object.keys(h.ended.versus.teams).length, 2, 'both teams scored');
    assert.ok(h.ended.versus.winnerTeam === 0 || h.ended.versus.winnerTeam === 1 || h.ended.versus.winnerTeam === null, 'a valid winner');
    // the players' victory flags follow their team's win
    const winner = h.ended.versus.winnerTeam;
    for (const p of h.ended.players) {
      const want = winner != null && p.alive && (h.m.players.get(p.playerId).team === winner);
      assert.equal(p.victory, want, `${p.playerId} victory ${p.victory}, want ${want}`);
    }
  });

  test('versus: the 机变 draft gives EACH TEAM its own 3 cards (the two teams take turns)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 31, fake: true }).start();
    const m = h.m;
    assert.ok([4, 5, 6].includes(m.contestStartRound), `contestStartRound ${m.contestStartRound}`);
    assert.ok(h.lastTo('p_0', 'm.public')?.contestStartRound === m.contestStartRound, 'published in m.public');
    let seen = false;
    h.onSend.push((pid, msg) => {
      if (msg.t === 'm.public' && msg.phase === PHASE.SP_DRAFT && m.sp) seen = true;
    });
    h.autoHumans();
    h.drive(() => h.ended != null || seen, { maxSteps: 3e6 });
    assert.ok(seen, 'reached an 机变 draft');
    const s = m.sp;
    const poolOf = (t) => s.cards.filter((c) => c.poolTeam === t);
    assert.equal(poolOf(0).length, 3, 'team 0 is offered its own 3 cards');
    assert.equal(poolOf(1).length, 3, 'team 1 is offered its own 3 cards');
    assert.equal(s.cards.length, 6, 'the two pools together hold 6 cards');
    // the two teams take turns: a member of each, slot by slot
    assert.deepEqual(s.order.map((pid) => m.teamIdOf(m.players.get(pid))), [0, 1, 0, 1]);
    // a seat may only pick from its OWN team's pool
    const own = m.spCardsFor(m.players.get('p_0'));
    assert.equal(own.length, 3);
    assert.ok(own.every((c) => c.poolTeam === 0), "p_0's pool holds its own team's cards only");
    const oppIdx = poolOf(1)[0].idx;
    assert.ok(m.pickCard(m.players.get('p_0'), oppIdx).error, 'taking the other team\'s card is refused');
    // the published view is per team: own cards/order/picks only, and 'waiting' while the other team decides
    const v0 = m.spViewFor(0);
    const v1 = m.spViewFor(1);
    assert.ok(v0.cards.every((c) => poolOf(0).some((x) => x.idx === c.idx)), "team 0's view never shows team 1's cards");
    assert.equal(v0.order.length, 2, "team 0's order holds its own two members");
    assert.ok((v0.turn != null) !== (v1.turn != null), 'exactly one team holds the pick');
    if (v0.turn == null) assert.equal(v0.waiting, true, 'the waiting team says so');
    if (v1.turn == null) assert.equal(v1.waiting, true, 'the waiting team says so');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: development compensation grants a 小电话 from the contest round', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 41, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(m.contestStartRound);
    const hasPhone = (ps) => [...ps.hand, ...ps.temp].some((p) => p && p.id === 'chess_item_2_06_e_a')
      || [...ps.board.values()].some((pc) => (pc.items || []).some((it) => it.id === 'chess_item_2_06_e_a'));
    assert.ok([...m.players.values()].some(hasPhone), 'a 小电话 was granted at the contest-round prep');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: each team shares ONE HP pool (Σ of its members\' 策略) and dies as a whole', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 91, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.round >= 1 && m.phase !== PHASE.BAND_DRAFT, { maxSteps: 3e6 }), `reached the match (${m.phase})`);
    const bandSum = (t) => [...m.players.values()].filter((p) => m.teamIdOf(p) === t).reduce((s, p) => s + m.gd.startLp(p.bandId), 0);
    const pool0 = m.teamHpPool(0);
    assert.equal(pool0, bandSum(0), "team 0's pool is the sum of its members' band HP");
    assert.equal(m.teamHpPool(1), bandSum(1), "team 1's pool is the sum of its members' band HP");
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub && pub.teamLps, 'm.public carries the per-team pools');
    assert.equal(pub.teamLps[0], pool0);
    const rows = pub.players.filter((r) => r.team === 0);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.lp === pool0), 'both teammates\' rows show the shared pool');
    // damage lands on the POOL, and the members' own lp stay a split of it (Σ = pool, what the invariants expect)
    m._teamLpLoss(0, 5);
    assert.equal(m.teamHpPool(0), pool0 - 5, 'the pool took the damage');
    assert.equal(m.alivePlayers().filter((p) => m.teamIdOf(p) === 0).reduce((s, p) => s + p.lp, 0), pool0 - 5, "the members' lp are a split of the pool");
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the 寻呼模块 is granted ONCE per team, when its shared pool first drops below 21', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 93, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(m.contestStartRound);
    const hasPager = (ps) => [...ps.hand, ...ps.temp].some((p) => p && p.id === 'chess_item_4_01_e_a')
      || [...ps.board.values()].some((pc) => (pc.items || []).some((it) => it.id === 'chess_item_4_01_e_a'));
    // team 0 is healthy, team 1 is in trouble: only team 1 takes one
    m.teamLps.set(0, 60);
    m.teamLps.set(1, VERSUS_LOW_LP - 1);
    m._pagerGranted = new Set();
    m._versusPrepGrant();
    const t1 = [...m.players.values()].filter((p) => m.teamIdOf(p) === 1);
    const t0 = [...m.players.values()].filter((p) => m.teamIdOf(p) === 0);
    assert.ok(t1.every(hasPager), 'the low team took a 寻呼模块');
    assert.ok(!t0.some(hasPager), 'the healthy team did not');
    // it is not granted a second time, even while still low
    m.teamLps.set(1, 1);
    m._versusPrepGrant();
    assert.ok(m._pagerGranted.has(1), 'the team is marked as served');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a strategy is unique per TEAM (both teams may run the same one)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 121, fake: true }).start();
    const m = h.m;
    m.draft = { picks: { p_0: null, ai_1: 'band_x', ai_2: 'band_x', ai_3: 'band_y' } };
    assert.equal(m.bandTaken('band_x', 'p_0'), true, "a teammate's pick blocks the strategy");
    assert.equal(m.bandTaken('band_y', 'p_0'), false, "an opponent's pick does not");
    // the same strategy may be held by one player of each team — the other team's pick never blocks
    assert.equal(m.bandTaken('band_x', 'ai_2'), false, "the opposing team's pick does not block either");
    assert.equal(m.bandTaken('band_x', 'ai_3'), true, "…but their own teammate's does");
  });

  test('versus: a setup reroll keeps the briefing countdown and never blocks the confirm', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 151, fake: true }).start();
    const m = h.m;
    assert.equal(m.phase, PHASE.INFO_CHECK);
    const before = m.deadline;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    assert.ok(m._anySetupVote(), 'the vote is open');
    assert.equal(m.deadline, before, 'the countdown stays up while the vote runs');
    assert.equal(m.handle('p_1', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true, 'a teammate may still confirm');
    const vote = m._anySetupVote();
    assert.equal(m.voteSetupReroll(m.players.get('p_1'), vote.id, true).ok, true, 'the teammate agrees');
    assert.equal(m.setupRevision, 1, 'the reroll landed');
    assert.ok(!m._anySetupVote(), 'the vote closed');
    assert.ok(m.deadline > h.sched.now(), 'a fresh window is armed for the re-confirmations');
    assert.equal(m.handle('p_0', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true);
    assert.equal(m.handle('p_1', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true);
    assert.ok(h.drive(() => m.phase !== PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'the briefing advanced');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a team reroll vote reaches its OWN team\'s view only', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 153, fake: true }).start();
    const m = h.m;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    const base = m.publicView();
    // The client reads the SOLO/coop scalar `rerollVote`; in 2V2 it must carry the VIEWER's team's vote, or the consent
    // buttons render for nobody and the 重刷本局 click looks like it did nothing.
    const mine = m._teamPublicView(base, 0);
    assert.ok(mine.rerollVote, 'team 0 sees its own open vote');
    assert.deepEqual(mine.rerollVote.voters.slice().sort(), ['p_0', 'p_1']);
    assert.deepEqual(Object.keys(mine.rerollVotes), ['0'], 'the per-team map is scoped to the own team');
    const foes = m._teamPublicView(base, 1);
    assert.equal(foes.rerollVote, null, 'team 1 does not see team 0\'s vote');
    assert.deepEqual(foes.rerollVotes, {}, 'nor its entry in the map');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a reroll vote nobody answers expires and the briefing still advances', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 152, fake: true }).start();
    const m = h.m;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    assert.ok(m._anySetupVote(), 'the vote is open');
    h.sched.advance(60_000);
    h.sched.runNext();
    assert.ok(!m._anySetupVote(), 'the window expired the vote');
    assert.equal(m.phase, PHASE.BAND_DRAFT, 'the briefing advanced instead of hanging');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the briefing window is 45 s and can still end early', () => {
    // two humans (a lone human + AI runs untimed, so the window would not be armed at all)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seed: 122, fake: true, seats: [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ] }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'reached the briefing');
    const left = (m.deadline - h.sched.now()) / 1000;
    assert.ok(Math.abs(left - VERSUS_INFO_SECONDS) < 1, `briefing window ${left}s (want ${VERSUS_INFO_SECONDS})`);
    // every human ready → it ends at once, long before the window
    for (const ps of m.players.values()) if (!ps.isBot) m.handle(ps.playerId, { t: 'g.infoReady', setupRevision: m.setupRevision });
    assert.ok(h.drive(() => m.phase !== PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'the briefing closed early');
    assert.equal(m.phase, PHASE.BAND_DRAFT);
  });

  test('versus: prep scouting is team-only (the opponent board stays hidden)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 123, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(1);
    const me = m.players.get('p_0');
    assert.equal(m.watch(me, 'n:ai_1').ok, true, 'a teammate may be scouted');
    assert.ok(m.watch(me, 'n:ai_2').error, 'an opponent may not (team 1)');
    assert.ok(m.watch(me, 'n:ai_3').error, 'an opponent may not (team 1)');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: EVERY round\'s 对抗期 is selectable again (a previous round must not lock it)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 124, fake: true }).start();
    const m = h.m;
    const me = () => m.players.get('p_0');
    const opp = () => [...m.players.values()].filter((p) => m.teamIdOf(p) === 1).map((p) => p.playerId);
    const playOne = () => {
      assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), `reached the 对抗期 (${m.phase} R${m.round})`);
      const view = m._teamPublicView(m.publicView(), 0).confront;
      assert.equal(view.stage, 'target');
      assert.ok(!view.targets['p_0'], `R${m.round}: no target locked yet`);
      assert.ok(!view.subs['p_0'], `R${m.round}: nothing submitted yet (a previous round must not lock it)`);
      assert.equal(m.submitConfrontTarget(me(), { targetPlayerId: opp()[0] }).ok, true);
      assert.equal(m.confrontStage, 'monster', `R${m.round}: step 2 opens`);
      const picks = [];
      let left = m.confrontBudget();
      const pick0 = affordablePick(m, left);
      for (const r of (pick0 ? m.confrontGroups()[pick0.group - 1].rows : []).slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
        if (r.value > left) continue;
        left -= r.value;
        picks.push({ enemyKey: r.key, gate: 'lower' });
        if (picks.length >= 2) break;
      }
      assert.equal(m.submitConfront(me(), { group: pick0.group, position: 'mid', picks }).ok, true, `R${m.round}: the monsters are accepted`);
      assert.ok(h.drive(() => m.phase !== PHASE.CONFRONT, { maxSteps: 3e6 }), 'the window closed');
      return m.round;
    };
    const r1 = playOne();
    const r2 = playOne();
    assert.ok(r2 > r1, `played two different rounds (${r1} → ${r2})`);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a player who never submits gets the auto-selection when the window ends', () => {
    // TWO humans: with a single one the step (like the prep) is untimed — soloUntimed — and only a submission ends it
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 141, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached step 1');
    const budget = m.confrontBudget();
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    // the cap is THIS round's prep — the same time the players had to prepare — not a fixed 30 s
    assert.equal(m.deadline - m.sched.now(), m.scaled(m.gd.prepTime(m.round) * 1000), "the window is the round's prep time");
    // nobody submits: let the window run out
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'the window closed');
    const sub = m.confront && m.confront.get('p_0');
    assert.ok(sub && sub.picks.length > 0, 'the silent player got an automatic set');
    assert.ok(m.confrontSpent(sub.picks) <= budget, 'it stays within the budget');
    assert.equal(sub.position, 'mid', 'the same default the 自动选择 button uses');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: with a single human the 定制 window is untimed (it matches the untimed prep)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 悬赏期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    // one human + three bots: no countdown at all (the prep is untimed too) — the all-submitted end closes it
    assert.equal(m.deadline, 0, 'untimed, never a fixed window');
    const budget = m.confrontBudget();
    const picks = [];
    let left = budget;
    const pick0 = affordablePick(m, budget);
    assert.ok(pick0, 'the budget affords at least one monster');
    for (const r of m.confrontGroups()[pick0.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
      if (picks.length >= 1) break;
    }
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: pick0.group, position: 'mid', picks }).ok, true);
    assert.equal(m.phase, PHASE.COMBAT, 'the submission closes the step at once');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: ticker lines stay inside the team they belong to', () => {
    // four HUMANS (sendTo skips AI seats, so the recipients have to be real)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seed: 131, fake: true, seats: [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'p_3', name: 'B1', isBot: false, connected: true, team: 1 },
    ] }).start();
    const m = h.m;
    h.sent.length = 0;
    h.bc.length = 0;
    m.tickerText('team-0 line', 0, 0);       // a line of team 0's own game
    m.tickerText('team-1 line', 0, 1);
    m.tickerText('team-1 line again', 0, 1);
    m.tickerText('everyone');                // no team: a match-wide notice (broadcast to both)
    const got = (pid) => h.sent.filter(([id, msg]) => id === pid && msg.t === 'm.ticker').length;
    assert.equal(got('p_0'), 1, "team 0 hears its own line only");
    assert.equal(got('p_1'), 1, '…as does its teammate');
    assert.equal(got('p_2'), 2, "team 1 hears its two lines and never team 0's");
    assert.equal(got('p_3'), 2);
    assert.equal(h.bc.filter((msg) => msg.t === 'm.ticker').length, 1, 'the team-less line is a broadcast');
  });

  test('versus: a monster the opponent places pays its killer a bounty sized from the value table', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 161, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 对抗期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const budget = m.confrontBudget();
    const pick = affordablePick(m, budget);
    assert.ok(pick, 'at least one monster fits the contest-round budget');
    const g = m.confrontGroups()[pick.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    const picks = [];
    let left = budget;
    for (const x of g) { if (x.value > left) continue; left -= x.value; picks.push({ enemyKey: x.key, gate: 'lower' }); if (picks.length >= 3) break; }
    assert.ok(picks.length > 0);
    // the bounty tracks the value table and the round's income: at least 1 gold, and the whole placement stays near it
    const income = Number(m.gd.income(m.round)) || 0;
    const each = picks.map((p) => m.confrontBounty(p.enemyKey));
    assert.ok(each.every((b) => b >= 1), `every placed monster pays at least 1: ${each.join(',')}`);
    assert.ok(each.reduce((s, n) => s + n, 0) <= 2 * income + picks.length, `the bounty stays near the round's income: ${each.join('+')} vs ${income}`);
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: pick.group, position: 'mid', picks }).ok, true);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus 狩猎: placed monsters leak for free, pay a bounty, and the lists are revealed after the phase', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 171, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 悬赏期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const budget = m.confrontBudget();
    const pick = affordablePick(m, budget);
    assert.ok(pick, "at least one monster fits the round's budget");
    const g = m.confrontGroups()[pick.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    const picks = [];
    let left = budget;
    for (const x of g) { if (x.value > left) continue; left -= x.value; picks.push({ enemyKey: x.key, gate: 'lower' }); if (picks.length >= 2) break; }
    // while the phase runs the opponent's board stays hidden (checked before the last submission closes it)
    const during = m._teamPublicView(m.publicView(), 0).confront;
    assert.ok(!during.subs['ai_2'], 'the opponent is hidden during the 悬赏期');
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: pick.group, position: 'mid', picks }).ok, true);
    assert.equal(m.phase, PHASE.COMBAT, 'everyone submitted → step 2 ends at once');
    // the applied wave: placed monsters are free (no LP, no 完美作战 break) and carry a kill bounty
    const sub = m.confrontSubs.get('p_0');
    const out = m.applyConfront([{ time: 0, enemyKey: 'enemy_1005_yokai', count: 1, routeIndex: 0, interval: 0 }], sub, m.players.get('ai_2'));
    const placed = out.filter((s) => s.confrontSeat != null);
    assert.ok(placed.length > 0, 'the placed monsters are in the wave');
    assert.ok(placed.every((s) => s.countInTotal === false), 'a leaked placed monster costs no target HP');
    assert.ok(placed.every((s) => s.bounty && s.bounty.coins >= 1), `each carries a bounty: ${placed.map((s) => s.bounty && s.bounty.coins).join(',')}`);
    assert.equal(m.confrontBountyOf(sub.picks), sub.picks.reduce((n, p) => n + m.confrontBounty(p.enemyKey), 0), 'the shown total is the sum of the kills');
    // once the phase closes, BOTH teams' boards are revealed (the 悬赏名单)
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'the window closed');
    const after = m._teamPublicView(m.publicView(), 0).confront;
    assert.ok(after.subs['ai_2'] && after.subs['ai_2'].coins >= 1, "the opponent's board and bounty are revealed");
    assert.ok(after.subs['p_0'].coins >= 1, 'and so is the own one');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: each team has its own disabled core bonds (3 available)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 51, fake: true }).start();
    const m = h.m;
    assert.ok(m.pools instanceof Map && m.pools.size === 2, 'one chess pool per team');
    const coreIds = new Set(Object.values(DATA.bonds).filter((b) => b && b.isCore && b.weight > 0).map((b) => b.bondId));
    const bansOf = (t) => m.bansOf(t).drawn.filter((b) => coreIds.has(b));
    assert.equal(bansOf(0).length, 5, `team 0 bans ${bansOf(0).length} core bonds`);
    assert.equal(bansOf(1).length, 5, `team 1 bans ${bansOf(1).length} core bonds`);
    assert.notDeepEqual([...bansOf(0)].sort(), [...bansOf(1)].sort(), 'the two teams ban different core bonds');
  });

  test('versus: a team reroll changes only its own disabled core bonds (stage/boss shared)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 61, fake: true }).start();
    const m = h.m;
    const stage0 = m.stageId;
    const boss0 = m.bossId;
    const bans0 = m.bansOf(0).drawn.slice().sort();
    const bans1 = m.bansOf(1).drawn.slice().sort();
    // team 0 has a single human (p_0): its proposal completes at once
    const r = m.requestSetupReroll('p_0', m.setupRevision);
    assert.equal(r && r.ok, true, JSON.stringify(r));
    assert.equal(m.stageId, stage0, 'stage stays shared');
    assert.equal(m.bossId, boss0, 'boss stays shared');
    assert.notDeepEqual(m.bansOf(0).drawn.slice().sort(), bans0, "team 0's bans changed");
    assert.deepEqual(m.bansOf(1).drawn.slice().sort(), bans1, "team 1's bans unchanged");
  });

  test('versus: the opponent is hidden before R14 and revealed at the Final Assault', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 71, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(1);
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub, 'p_0 got an m.public');
    const teamOf = (r) => m.teamIdOf(m.players.get(r.playerId));
    const opp = pub.players.filter((r) => teamOf(r) === 1);
    assert.ok(opp.length > 0 && opp.every((r) => r.hidden === true), 'opponent rows hidden before R14');
    // ... but they still carry their TEAM's shared HP pool, so the panel shows a bar on both sides
    assert.ok(opp.every((r) => Number.isFinite(r.lp) && r.lp > 0), `hidden rows carry their team pool: ${opp.map((r) => r.lp).join('/')}`);
    assert.ok(pub.players.filter((r) => teamOf(r) === 0).every((r) => !r.hidden), 'own rows visible');
    // reached the Final Assault: everything is revealed
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 3e6 });
    const pub2 = h.lastTo('p_0', 'm.public');
    assert.ok(pub2 && pub2.players.filter((r) => teamOf(r) === 1).every((r) => r.hidden !== true), 'opponent revealed at R14');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the 对抗期 runs from the contest round and the opponent\'s wave is sabotaged', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 81, fake: true }).start();
    const m = h.m;
    const ok = h.drive(() => m.phase === PHASE.CONFRONT, { maxSteps: 3e6 });
    assert.ok(ok && m.phase === PHASE.CONFRONT, `reached the 对抗期 (phase ${m.phase} R${m.round})`);
    assert.equal(m.round, m.contestStartRound, 'at the contest round');
    assert.equal(m.confrontStage, 'target', 'step 1 (who do I attack) comes first');
    const groups = m.confrontGroups();
    // the groups are the OFFICIAL 特训敌人 types (data/factions.json), in the data's order — NOT equal-value buckets
    const typeIds = Object.keys(DATA.factions.types);
    assert.deepEqual(groups.map((g) => g.id), typeIds, 'one group per 特训敌人 type');
    assert.equal(groups.length, typeIds.length, `${typeIds.length} type groups`);
    assert.ok(groups.every((g) => g.rows.length > 0), 'no empty type');
    assert.ok(groups.every((g) => g.name && g.icon), 'every group carries the official name and icon');
    // every pool enemy is offered by at least one type (the template-slot enemies are hand-assigned: CONFRONT_GROUP_EXTRA)
    const offered = new Set(groups.flatMap((g) => g.rows.map((r) => r.key)));
    for (const k of confrontPool(m.data.factions)) assert.ok(offered.has(k), `${k} is offered by no type`);
    // the types are NOT equal-valued any more (that rule is gone with the type grouping): 特异 is the big one
    const totals = groups.map((g) => g.rows.reduce((s, r) => s + r.value, 0));
    assert.ok(Math.max(...totals) / Math.min(...totals) - 1 > 0.2, `type sizes differ: ${totals.join('/')}`);
    // step 1: the human names one opponent; the teammate is given the other (first come, first served)
    const me = m.players.get('p_0');
    const opp = [...m.players.values()].filter((p) => m.teamIdOf(p) === 1).map((p) => p.playerId);
    assert.equal(opp.length, 2);
    assert.equal(m.submitConfrontTarget(me, { targetPlayerId: opp[0] }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'both sides paired → step 2');
    assert.equal(m.confrontTargets.get('p_0'), opp[0]);
    assert.equal(m.confrontTargets.get('ai_1'), opp[1], 'the teammate got the opponent that was left');
    // step 2: the cap is the round's per-player VALUE BUDGET (not a count): the whole group does not fit, a few monsters do
    const budget = m.confrontBudget();
    assert.ok(budget > 0, 'a positive budget');
    const pick = affordablePick(m, budget);
    assert.ok(pick, "at least one monster fits the round's budget");
    const whole = groups[pick.group - 1].rows.map((x) => ({ enemyKey: x.key, gate: 'lower' }));
    assert.ok(m.confrontSpent(whole) > budget, 'the whole group exceeds the contest round budget');
    assert.ok(m.submitConfront(me, { group: pick.group, position: 'mid', picks: whole }).error, 'an over-budget submission is refused');
    const picks = [];
    let left = budget;
    for (const r of groups[pick.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
      if (picks.length >= 3) break;
    }
    assert.ok(picks.length > 0, 'at least one monster fits the budget');
    assert.ok(m.confrontSpent(picks) <= budget, 'the picks stay within the budget');
    const r = m.submitConfront(me, { group: pick.group, position: 'mid', picks });
    assert.equal(r && r.ok, true, JSON.stringify(r));
    // the placed monsters carry the SENDER's seat for the client's marker (display only)
    assert.equal(m.confrontSubs.get('p_0').seat, me.seat, 'the submission remembers who sent it');
    // the three bots submitted when step 2 opened, so the last submission ends the step at once (no waiting out a window)
    assert.equal(m.phase, PHASE.COMBAT, 'everyone submitted → combat starts at once');
    // an intervention lands on ITS TARGET's wave only
    const hit = m.confrontFor(m.players.get(opp[0]));
    assert.ok(Array.isArray(hit) && hit.length === 1 && hit[0].picks.length === picks.length, "team 0's set lands on its own target");
    assert.ok(hit[0].picks.every((p) => p.enemyKey && (p.gate === 'upper' || p.gate === 'lower')), 'every placed monster carries a gate');
    const other = m.confrontFor(m.players.get(opp[1]));
    assert.ok(Array.isArray(other) && other.every((s) => s.target === opp[1]), "the other target only takes its own attacker's set");
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the intervention share is 5 % at R_contest, +2 %/round, 15 % cap, 50 % on the 追猎 round (R13)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 81, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT, { maxSteps: 3e6 }), 'reached the 悬赏期');
    const start = m.contestStartRound;
    const ratioAt = (round) => { const keep = m.round; m.round = round; const v = m.confrontRatio(); m.round = keep; return v; };
    assert.equal(ratioAt(start), 0.05, 'the contest round replaces 5 %');
    assert.ok(Math.abs(ratioAt(start + 1) - 0.07) < 1e-9, '+2 % the round after');
    assert.ok(Math.abs(ratioAt(start + 2) - 0.09) < 1e-9, '+2 % again');
    assert.ok(Math.abs(ratioAt(start + 10) - 0.15) < 1e-9, 'capped at 15 %');
    assert.equal(ratioAt(13), 0.5, 'R13 is the 追猎 round — a flat 50 %');
    // the share IS the budget's factor: budget = the wave value × the share × budgetMul (2), per player
    assert.equal(m.confrontBudget(), Math.round(m.confrontWaveValue() * m.confrontRatio() * 2));
    assert.equal(m.confrontHunt(), m.round === 13, 'the hunt flag follows the round');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a submission may MIX 特训敌人 types (the budget is the only cap)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 悬赏期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    const groups = m.confrontGroups();
    const budget = m.confrontBudget();
    const cheap = groups.flatMap((g, i) => g.rows.map((r) => ({ ...r, type: i })))
      .sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
    const first = cheap[0];
    const second = cheap.find((r) => r.type !== first.type && r.value + first.value <= budget);
    assert.ok(first && second, `two cheap monsters of DIFFERENT types fit ${budget}: ${first && first.value} + ${second && second.value}`);
    const picks = [{ enemyKey: first.key, gate: 'lower' }, { enemyKey: second.key, gate: 'upper' }];
    assert.ok(m.confrontSpent(picks) <= budget, 'within the budget');
    // an enemy no type offers is still refused
    assert.ok(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks: [{ enemyKey: 'enemy_not_offered', gate: 'lower' }] }).error, 'an unknown monster is refused');
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks }).ok, true, 'a cross-type submission is accepted');
    const sub = m.confrontSubs.get('p_0');
    assert.deepEqual(sub.picks.map((p) => p.enemyKey), [first.key, second.key], 'both types land');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('co-op keeps the 6-card 机变 draft and no contest round', () => {    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed: 33, fake: true }).start();
    const m = h.m;
    assert.equal(m.contestStartRound, null);
    let spCards = null;
    h.onBroadcast.push((msg) => {
      if (msg.t === 'm.public' && msg.phase === PHASE.SP_DRAFT && m.sp && Array.isArray(m.sp.cards) && spCards == null) spCards = m.sp.cards.length;
    });
    h.autoHumans();
    h.drive(() => h.ended != null || spCards != null, { maxSteps: 3e6 });
    assert.ok(spCards == null || spCards > 3, `co-op 机变 cards ${spCards} should stay > 3`);
  });
});
