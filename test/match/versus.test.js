// test/match/versus.test.js — 2V2 ('versus') match layer, step 2.1: the team abstraction and the team-scoped
// "teammates" effects. A versus match must never let a player's effects/联防 reach the opposing team.
//
// Runs a whole versus match on the fake battle engine (test/match/fakeBattle.js) and checks it reaches RESULT with
// no engine errors, so the team plumbing never breaks the round loop.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, teamOfSeat, VERSUS_LOW_LP, VERSUS_INFO_SECONDS } from '../../shared/constants.js';

/** 4 seats laid out as two teams of two (0,1 → team 0; 2,3 → team 1). */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

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
      for (const r of m.confrontGroups()[5].slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
        if (r.value > left) continue;
        left -= r.value;
        picks.push({ enemyKey: r.key, gate: 'lower' });
        if (picks.length >= 2) break;
      }
      assert.equal(m.submitConfront(me(), { group: 6, position: 'mid', picks }).ok, true, `R${m.round}: the monsters are accepted`);
      assert.ok(h.drive(() => m.phase !== PHASE.CONFRONT, { maxSteps: 3e6 }), 'the window closed');
      return m.round;
    };
    const r1 = playOne();
    const r2 = playOne();
    assert.ok(r2 > r1, `played two different rounds (${r1} → ${r2})`);
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
    assert.equal(groups.length, 6, '6 monster groups');
    assert.equal(groups.flat().length, 120, '120 enemies across the groups');
    // the whole point of the split: the 6 groups hold the SAME total value, so the choice is never about strength
    const totals = groups.map((g) => g.reduce((s, r) => s + r.value, 0));
    assert.ok(Math.max(...totals) / Math.min(...totals) - 1 < 0.01, `group values equal within 1%: ${totals.join('/')}`);
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
    const whole = groups[5].map((x) => ({ enemyKey: x.key, gate: 'lower' }));
    assert.ok(m.confrontSpent(whole) > budget, 'the whole group exceeds the contest round budget');
    assert.ok(m.submitConfront(me, { group: 6, position: 'mid', picks: whole }).error, 'an over-budget submission is refused');
    const picks = [];
    let left = budget;
    for (const r of groups[5].slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
      if (picks.length >= 3) break;
    }
    assert.ok(picks.length > 0, 'at least one monster fits the budget');
    assert.ok(m.confrontSpent(picks) <= budget, 'the picks stay within the budget');
    const r = m.submitConfront(me, { group: 6, position: 'mid', picks });
    assert.equal(r && r.ok, true, JSON.stringify(r));
    // the window is FIXED: submitting early does not end step 2
    assert.equal(m.phase, PHASE.CONFRONT, 'the sides stay in step until step 2 runs out');
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'combat starts once the window is up');
    // an intervention lands on ITS TARGET's wave only
    const hit = m.confrontFor(m.players.get(opp[0]));
    assert.ok(Array.isArray(hit) && hit.length === 1 && hit[0].picks.length === picks.length, "team 0's set lands on its own target");
    assert.ok(hit[0].picks.every((p) => p.enemyKey && (p.gate === 'upper' || p.gate === 'lower')), 'every placed monster carries a gate');
    const other = m.confrontFor(m.players.get(opp[1]));
    assert.ok(Array.isArray(other) && other.every((s) => s.target === opp[1]), "the other target only takes its own attacker's set");
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
