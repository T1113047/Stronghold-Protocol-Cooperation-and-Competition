// test/match/confront-roster.test.js — 狩猎期 悬赏名单公示 (CONFRONT_ROSTER_MS, user 2026-10-17 addendum): once every
// submission is in (or the window ran out and the AI seats were filled in), the confrontation stays on screen for 5 s
// before the battles start. The hold is server-timed through setDeadline → later → scaled, so virtual time (this suite,
// goldens) and real time agree; m.public.confront.roster = { until, ms } tells the client what it is waiting for.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE, ERR, CONFRONT_ROSTER_MS, VERSUS_CONFRONT, COOP_HUNT } from '../../shared/constants.js';

const vsSeats = () => ([
  { seat: 0, playerId: 'ai_0', name: 'A0', isBot: true, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

const toRoster = (o = {}) => {
  const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 7, fake: true, ...o }).start();
  const m = h.m;
  assert.ok(h.run(() => m.confrontStage === 'roster', { maxSteps: 3e6 }), `reached the roster (phase ${m.phase} R${m.round}, stage ${m.confrontStage})`);
  return h;
};

/** A 4-player co-op match (one human + three bots) driven to its hunt round's PREP. */
const coopToPrep = (seed = 3, o = {}) => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed, fake: true, ...o }).start();
  h.autoHumans();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === m.contestStartRound, { maxSteps: 3e6 }),
    `reached the coop hunt prep (phase ${m.phase} R${m.round})`);
  return h;
};

describe('狩猎期 悬赏名单公示 (5 s)', () => {
  test('the constant lives on VERSUS_CONFRONT and COOP_HUNT and is 5 s', () => {
    assert.equal(CONFRONT_ROSTER_MS, 5000);
    assert.equal(VERSUS_CONFRONT.rosterMs, CONFRONT_ROSTER_MS);
    assert.equal(COOP_HUNT.rosterMs, CONFRONT_ROSTER_MS, '同盟狩猎 reuses the same constant');
  });

  test('submissions are final, the phase stays CONFRONT, and the public view carries the roster countdown', () => {
    const h = toRoster();
    const m = h.m;
    const pv = m.publicView();
    assert.equal(m.phase, PHASE.CONFRONT, 'no battle has started');
    assert.equal(m.confrontStage, 'roster');
    assert.equal(m.fields.length, 0, 'no field exists during the hold');
    assert.equal(pv.confront.active, true);
    assert.equal(pv.confront.stage, 'roster');
    assert.ok(pv.confront.roster, 'm.public.confront.roster is present');
    assert.equal(pv.confront.roster.ms, CONFRONT_ROSTER_MS);
    assert.equal(pv.confront.roster.until, m.deadline, 'until = the server deadline');
    assert.equal(m.deadline - m.sched.now(), CONFRONT_ROSTER_MS, 'the deadline is exactly the hold');
    assert.equal(Object.keys(pv.confront.subs).length, 4, 'every seat has a final submission');
    assert.ok(pv.confront.budget > 0);
    // the roster IS the reveal: the per-team view must keep both teams (it used to hide the opponent because the phase
    // is still CONFRONT during the 5 s)
    const team0 = m._teamPublicView(pv, 0);
    assert.equal(Object.keys(team0.confront.subs).length, 4, 'team 0 sees both teams during the roster');
    assert.equal(Object.keys(team0.confront.targets).length, 4, 'and both teams\' targets');
    assert.ok(team0.confront.subs.ai_2 && Number.isInteger(team0.confront.subs.ai_2.coins), 'the opponent\'s bounty is visible');
    const team1 = m._teamPublicView(pv, 1);
    assert.equal(Object.keys(team1.confront.subs).length, 4, 'team 1 sees both teams too');
    m.dispose();
  });

  test('server-timed: nothing advances before 5 s; the 5000th ms starts COMBAT', () => {
    const h = toRoster();
    const m = h.m;
    const t0 = m.sched.now();
    h.sched.advance(CONFRONT_ROSTER_MS - 1);
    assert.equal(m.sched.now() - t0, CONFRONT_ROSTER_MS - 1);
    assert.equal(m.phase, PHASE.CONFRONT, 'still announcing');
    assert.equal(m.confrontStage, 'roster');
    assert.equal(m.fields.length, 0);
    h.sched.advance(1);
    assert.equal(m.sched.now() - t0, CONFRONT_ROSTER_MS, 'the hold lasts exactly 5 s');
    assert.notEqual(m.phase, PHASE.CONFRONT, 'the battles begin after the hold');
    assert.equal(m.confrontStage, null);
    m.dispose();
  });

  test('the hold follows the scheduler scale and never reaches R14 / R15 (boss rounds have no 狩猎期)', () => {
    const scaled = toRoster({ timerScale: 0.001 }); // 5 ms in virtual time, as a golden / fake-battle run would see
    const sm = scaled.m;
    const t0 = sm.sched.now();
    scaled.sched.advance(CONFRONT_ROSTER_MS * 0.001 - 1);
    assert.equal(sm.phase, PHASE.CONFRONT, 'scaled hold still runs its full length');
    scaled.sched.advance(1);
    assert.equal(sm.sched.now() - t0, CONFRONT_ROSTER_MS * 0.001);
    assert.notEqual(sm.phase, PHASE.CONFRONT);
    scaled.m.dispose();

    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 7, fake: true }).start();
    const m = h.m;
    m.contestStartRound = 4;
    m.round = m.gd.bossRound;
    assert.equal(m.confrontActive(), false, 'R14 最终攻势');
    m.round = m.gd.bossRound + 1;
    assert.equal(m.confrontActive(), false, 'R15 隐秘核心');
    h.run(() => m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 3e6 });
    assert.notEqual(m.confrontStage, 'roster', 'a boss round never opens the roster hold');
    m.dispose();
  });
});

describe('同盟狩猎 本回合投放公示 (5 s, CONFRONT_ROSTER_MS)', () => {
  test('PREP end holds the round in PREP/roster for 5 s and publishes every alive player\'s deployment', () => {
    const h = coopToPrep(3);
    const m = h.m;
    assert.ok(h.drive(() => m.confrontStage === 'roster' && m.round === m.contestStartRound, { maxSteps: 3e6 }), 'the preview hold opened');
    assert.equal(m.phase, PHASE.PREP, 'the phase is still PREP');
    assert.equal(m.fields.length, 0, 'no battle has started');
    assert.equal(m.deadline - m.sched.now(), CONFRONT_ROSTER_MS, 'the server hold is exactly 5 s');
    const pv = m.publicView();
    assert.equal(pv.confront.active, true);
    assert.equal(pv.confront.stage, 'roster');
    assert.equal(pv.confront.roster.coop, true);
    assert.equal(pv.confront.roster.ms, CONFRONT_ROSTER_MS);
    assert.equal(pv.confront.roster.until, m.deadline);
    const plans = pv.confront.roster.plans;
    const alive = m.alivePlayers();
    assert.equal(plans.length, alive.length, 'one public row per alive player');
    assert.deepEqual(plans.map((p) => p.playerId), alive.slice().sort((a, b) => a.seat - b.seat).map((p) => p.playerId));
    assert.equal(new Set(plans.map((p) => p.value)).size, plans.length, `the public totals are pairwise different: ${plans.map((p) => p.value).join(', ')}`);
    const internal = m.coopHuntPlans();
    for (const row of plans) {
      const plan = internal.get(row.playerId);
      assert.equal(row.value, plan.value);
      assert.equal(row.count, plan.count);
      assert.equal(row.category, plan.category);
      assert.ok(row.categoryName && typeof row.categoryName === 'string');
      assert.equal(row.picks.length, plan.count);
      assert.deepEqual(row.picks.map((x) => x.value).reduce((a, b) => a + b, 0), plan.value, 'the shown picks add up to the shown total');
      for (const pick of row.picks) {
        assert.ok(pick.name && typeof pick.name === 'string', 'only the monster name is public');
        assert.deepEqual(Object.keys(pick).sort(), ['name', 'value']);
      }
      assert.deepEqual(Object.keys(row).sort(), ['category', 'categoryName', 'count', 'picks', 'playerId', 'seat', 'value'],
        'public information only (no budget / gates / coins)');
    }
    m.dispose();
  });

  test('virtual time: nothing starts before 5 s, the 5000th ms enters COMBAT', () => {
    const h = coopToPrep(3);
    const m = h.m;
    assert.ok(h.drive(() => m.confrontStage === 'roster', { maxSteps: 3e6 }));
    const t0 = m.sched.now();
    h.sched.advance(CONFRONT_ROSTER_MS - 1);
    assert.equal(m.sched.now() - t0, CONFRONT_ROSTER_MS - 1);
    assert.equal(m.phase, PHASE.PREP, 'still announcing');
    assert.equal(m.confrontStage, 'roster');
    assert.equal(m.fields.length, 0);
    h.sched.advance(1);
    assert.equal(m.sched.now() - t0, CONFRONT_ROSTER_MS);
    assert.equal(m.phase, PHASE.COMBAT, 'the battle starts after the hold');
    assert.equal(m.confrontStage, null);
    assert.ok(m.fields.length > 0, 'the fields exist now');
    m.dispose();
  });

  test('a non-hunt round never opens the coop roster; the hold is idempotent and does not stack', () => {
    // R1 is before the drawn start round: PREP end goes straight to COMBAT
    const plain = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed: 3, fake: true }).start();
    plain.autoHumans();
    const pm = plain.m;
    assert.ok(plain.drive(() => pm.phase === PHASE.PREP && pm.round === 1, { maxSteps: 3e6 }));
    assert.equal(pm.coopHuntActive(), false);
    assert.ok(plain.drive(() => pm.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'R1 starts combat directly');
    assert.notEqual(pm.confrontStage, 'roster');
    assert.equal(pm.publicView().confront, undefined);
    pm.dispose();

    // a hunt round: a repeated endPrep / enterCoopHuntRoster must not arm a second timer
    const h = coopToPrep(3);
    const m = h.m;
    assert.ok(h.drive(() => m.confrontStage === 'roster', { maxSteps: 3e6 }));
    const deadline = m.deadline;
    m.endPrep();
    assert.equal(m.deadline, deadline, 'a second endPrep keeps the single hold');
    assert.equal(m.enterCoopHuntRoster(), false, 'already in roster → no second timer');
    assert.equal(m.deadline, deadline);
    h.sched.advance(CONFRONT_ROSTER_MS);
    assert.equal(m.phase, PHASE.COMBAT);
    m.dispose();
  });

  test('the coop roster freezes the prep: ready / sell / refresh / withdraw are refused', () => {
    const h = coopToPrep(3);
    const m = h.m;
    assert.ok(h.drive(() => m.confrontStage === 'roster', { maxSteps: 3e6 }));
    const ps = h.ps('p_0');
    assert.equal(ps.ready, true, 'endPrep already marked every seat ready');
    const funds0 = ps.funds;
    ps.bountyBank = 100;
    ps.withdrawnThisRound = 0;
    // any alive player with a board piece is enough: the gate is global to the roster
    const seller = m.alivePlayers().find((p) => [...p.board.values()].some((x) => x.kind === 'chess'));
    assert.ok(seller, 'someone has a board piece to try to sell');
    const chess = [...seller.board.values()].find((p) => p.kind === 'chess');
    assert.equal(m.handle('p_0', { t: 'g.ready', ready: false }).error, ERR.WRONG_PHASE, 'no un-ready during the roster');
    assert.equal(seller.sell(chess.uid).error, ERR.WRONG_PHASE, 'no selling during the roster');
    assert.equal(m.handle('p_0', { t: 'g.refresh' }).error, ERR.WRONG_PHASE, 'no shop refresh during the roster');
    assert.equal(m.handle('p_0', { t: 'g.confront.withdraw', gold: 1 }).error, ERR.WRONG_PHASE, 'no withdrawal during the roster');
    assert.equal(ps.ready, true, 'still ready');
    assert.equal(ps.funds, funds0, 'the purse did not move');
    assert.equal(ps.bountyBank, 100, 'the bank did not move');
    h.sched.advance(CONFRONT_ROSTER_MS);
    assert.equal(m.phase, PHASE.COMBAT, 'the battle starts after the hold');
    assert.equal(ps.funds, funds0, 'and the frozen prep state went into the battle unchanged');
    assert.equal(ps.bountyBank, 100);
    m.dispose();
  });

  test('two consecutive hunt rounds each hold 5 s (no stacked timer)', () => {
    const h = coopToPrep(3);
    const m = h.m;
    const first = m.contestStartRound;
    assert.ok(h.drive(() => m.confrontStage === 'roster', { maxSteps: 3e6 }));
    assert.equal(m.deadline - m.sched.now(), CONFRONT_ROSTER_MS);
    h.sched.advance(CONFRONT_ROSTER_MS);
    assert.equal(m.phase, PHASE.COMBAT);
    // R(first + 1) is the next hunt round (the ratio ramp continues); reach its PREP and its own hold
    h.autoHumans();
    const next = first + 1;
    assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === next, { maxSteps: 3e6 }), `reached R${next} PREP`);
    assert.ok(h.drive(() => m.confrontStage === 'roster' && m.round === next, { maxSteps: 3e6 }), `R${next} hold opened`);
    assert.equal(m.deadline - m.sched.now(), CONFRONT_ROSTER_MS, `R${next} holds its own full 5 s`);
    h.sched.advance(CONFRONT_ROSTER_MS);
    assert.equal(m.phase, PHASE.COMBAT);
    m.dispose();
  });
});
