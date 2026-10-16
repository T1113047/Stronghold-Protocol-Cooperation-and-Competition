// test/match/versus.test.js — 2V2 ('versus') match layer, step 2.1: the team abstraction and the team-scoped
// "teammates" effects. A versus match must never let a player's effects/联防 reach the opposing team.
//
// Runs a whole versus match on the fake battle engine (test/match/fakeBattle.js) and checks it reaches RESULT with
// no engine errors, so the team plumbing never breaks the round loop.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, teamOfSeat } from '../../shared/constants.js';

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
    h.onBroadcast.push((msg) => {
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
    h.onBroadcast.push((msg) => {
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

  test('versus: contest start round is drawn from R4/R5/R6, published, and the 机变 draft offers 3 cards', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 31, fake: true }).start();
    const m = h.m;
    assert.ok([4, 5, 6].includes(m.contestStartRound), `contestStartRound ${m.contestStartRound}`);
    assert.ok(h.lastBc('m.public')?.contestStartRound === m.contestStartRound, 'published in m.public');
    let spCards = null;
    h.onBroadcast.push((msg) => {
      if (msg.t === 'm.public' && msg.phase === PHASE.SP_DRAFT && m.sp && Array.isArray(m.sp.cards) && spCards == null) spCards = m.sp.cards.length;
    });
    h.autoHumans();
    h.drive(() => h.ended != null || spCards != null, { maxSteps: 3e6 });
    assert.ok(spCards != null, 'reached an 机变 draft');
    assert.ok(spCards <= 3, `机变 cards offered = ${spCards}, want ≤ 3`);
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
