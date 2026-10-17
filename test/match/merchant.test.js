// test/match/merchant.test.js — 商人「坎诺特」 (2V2, user 2026-10-17). 赏金 ≠ 金币:
//   * the bounties of the monsters the OPPONENT PLACED are banked (PlayerState.bountyBank), never funds — the settle
//     path adds the battle report's `bank` to the bank and only its `coins` to the next prep's funds;
//   * the ONLY way from 赏金 to 金币 is `g.confront.withdraw` in prep (withdrawBounty): cost = gold / rate, the round's
//     first withdrawal ceil and the later ones floor, at most VERSUS_CONFRONT.merchantRoundCap gold a round (R15
//     uncapped), the rate by ABSOLUTE round (VERSUS_CONFRONT.merchantRates);
//   * the bank survives rounds and reconnects (it lives on the server-side PlayerState); only matches end it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, DATA } from './harness.js';
import { PHASE, ERR, merchantRateFor, merchantCapFor } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { validateClientResult, specBounds } from '../../server/match/fields.js';
import { GameData } from '../../server/match/gamedata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);
const prep = (seed, script = null) => {
  const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true, ...(script ? { script } : {}) }).start();
  assert.ok(h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1, { maxSteps: 3e6 }), 'reached the first prep');
  return h;
};

describe('商人「坎诺特」 (2V2 赏金 → 存款 → 取钱)', () => {
  test('the battle bank reaches PlayerState.bountyBank, the coins reach the funds — the bank never becomes gold', () => {
    const h = prep(31, () => ({ coins: { p_0: 5 }, bank: { p_0: 7 } }));
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.SETTLE && m.round === 1, { maxSteps: 3e6 }), 'settled R1');
    const ps = h.ps('p_0');
    assert.equal(ps.bountyBank, 7, 'the report\'s bank is banked');
    assert.equal(ps.bountyEarned, 7, 'and counted as this match\'s 赏金 income (the settlement\'s 本局赏金收入)');
    assert.ok(ps.pendingFunds >= 5, 'the report\'s coins are funds (the next prep), not bank');
  });

  test('withdraw: cost = gold / rate, first of a round ceil, later floor, cap 4 a round, R15 uncapped', () => {
    const h = prep(33);
    const m = h.m;
    const ps = h.ps('p_0');
    const w = (gold) => m.handle('p_0', { t: 'g.confront.withdraw', gold });
    m.round = 9; // rate 0.3, cap 4
    ps.bountyBank = 100;
    const funds0 = ps.funds;
    assert.deepEqual(w(1), { ok: true }, 'the first withdrawal of the round');
    assert.equal(ps.bountyBank, 96, 'ceil(1 / 0.3) = 4');
    assert.equal(ps.funds, funds0 + 1, 'one gold into the purse');
    assert.equal(ps.withdrawnThisRound, 1);
    assert.equal(ps.withdrawnGold, 1, 'the match-long counter grows');
    assert.deepEqual(w(1), { ok: true }, 'the second withdrawal of the round');
    assert.equal(ps.bountyBank, 93, 'floor(1 / 0.3) = 3');
    assert.deepEqual(w(2), { ok: true });
    assert.equal(ps.bountyBank, 87, 'floor(2 / 0.3) = 6');
    assert.equal(ps.withdrawnThisRound, 4, '4 gold this round');
    assert.equal(ps.withdrawnGold, 4, 'the match-long counter keeps every withdrawal');
    assert.equal(ps.funds, funds0 + 4, 'the purse holds exactly what was withdrawn');
    assert.equal(w(1).error, ERR.MERCHANT_CAP, 'the round\'s cap is a hard stop');
    assert.equal(ps.bountyBank, 87, 'a refused withdrawal moves nothing');
    // not enough 赏金: at 35 % the round's first withdrawal of 1 gold costs ceil(1 / 0.35) = 3
    m.round = 10;
    ps.withdrawnThisRound = 0; // a fresh round would do this (startRound); keep the bank
    ps.bountyBank = 3;
    const funds1 = ps.funds;
    assert.deepEqual(w(1), { ok: true }, '3 赏金 buy exactly 1 gold at 35 %');
    assert.equal(ps.bountyBank, 0, 'the ceil cost the whole 3');
    assert.equal(ps.funds, funds1 + 1);
    ps.withdrawnThisRound = 0;
    ps.bountyBank = 2;
    assert.equal(w(1).error, ERR.MERCHANT_BANK, '2 赏金 cannot buy 1 gold at 35 %');
    assert.equal(ps.bountyBank, 2, 'the refusal moved nothing');
    assert.equal(ps.funds, funds1 + 1, 'and paid nothing');
    // R15 隐秘核心: 1:1, no cap
    m.round = 15;
    ps.withdrawnThisRound = 0;
    ps.bountyBank = 12;
    assert.deepEqual(w(12), { ok: true });
    assert.equal(ps.bountyBank, 0, 'the whole bank at 100 %');
    assert.equal(ps.funds, funds1 + 13, '12 gold more');
    assert.equal(ps.withdrawnGold, 17, 'the match-long counter has every withdrawal (4 + 1 + 12)');
    assert.equal(ps.bountyEarned, 0, 'a withdrawal is not income: 本局赏金收入 only grows when 赏金 is banked');
    assert.equal(w(1).error, ERR.MERCHANT_BANK, 'an empty bank');
  });

  test('the bank survives rounds (startRound only resets the per-round counter) and reconnects', () => {
    const h = prep(35);
    const m = h.m;
    const ps = h.ps('p_0');
    ps.bountyBank = 9;
    ps.withdrawnThisRound = 3;
    ps.withdrawnGold = 7;
    ps.startRound(m.round + 1);
    assert.equal(ps.bountyBank, 9, 'the bank carries over');
    assert.equal(ps.withdrawnThisRound, 0, 'a new round = a new ceil/floor cycle and cap');
    assert.equal(ps.withdrawnGold, 7, 'the match-long counter is NOT reset');
    // reconnect: nothing of the match state is rebuilt — the bank is on the server-side PlayerState
    ps.connected = false;
    ps.connected = true;
    assert.equal(ps.bountyBank, 9, 'reconnect keeps the bank');
    assert.equal(ps.privateView().merchant.bank, 9, 'and the reconnect push carries it');
  });

  test('m.private.merchant / m.public.merchant show the rate, the cap and the priced options', () => {
    const h = prep(37);
    const m = h.m;
    const ps = h.ps('p_0');
    m.round = 9;
    ps.bountyBank = 100;
    const v = ps.privateView().merchant;
    assert.equal(v.bank, 100);
    assert.equal(v.rate, merchantRateFor(9));
    assert.equal(v.cap, merchantCapFor(9));
    assert.equal(v.withdrawn, 0);
    assert.equal(v.left, 4);
    assert.equal(v.max, 4, 'the cap bounds the gold');
    assert.deepEqual(v.options.map((o) => [o.gold, o.cost, o.enabled]), [[1, 4, true], [2, 7, true], [4, 14, true], [4, 14, true]], 'costs at 30 % with the first-withdrawal ceil');
    assert.equal(m.publicView().merchant.rate, merchantRateFor(9), 'the public view carries the rate');
    // each player's own row carries the bank and the round's rate too (the merchant panel rides on m.private)
    const own = m.publicView().players.find((p) => p.playerId === 'p_0');
    assert.equal(own.bank, 100, 'the public row carries the bank');
    assert.equal(own.rate, merchantRateFor(9), 'and the round\'s rate');
    // the option a player can actually take is priced by the same function the server validates with
    assert.equal(m.merchantCost(ps, 3), Math.ceil(3 / v.rate - 1e-9));
    // outside the hunt modes (solo) there is no merchant at all (co-op hunt has one: 同盟狩猎)
    const solo = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 9, fake: true }).start();
    solo.drive(() => solo.m.phase === PHASE.PREP && solo.m.round === 1, { maxSteps: 3e6 });
    assert.equal(solo.ps('p_0').privateView().merchant, null, 'no bank in solo');
    assert.equal(solo.m.publicView().merchant, undefined, 'no merchant in the public view either');
    assert.equal(solo.m.handle('p_0', { t: 'g.confront.withdraw', gold: 1 }).error, ERR.WRONG_PHASE, 'and no withdrawals');
  });

  test('the withdrawal is server-authoritative: malformed amounts and a ready player are refused', () => {
    const h = prep(39);
    const m = h.m;
    const ps = h.ps('p_0');
    ps.bountyBank = 50;
    for (const gold of [0, -1, 1.5, '2', null, undefined, 2 ** 40]) {
      assert.notEqual(validateC2S({ t: 'g.confront.withdraw', gold }), null, `the protocol rejects ${String(gold)}`);
    }
    assert.equal(validateC2S({ t: 'g.confront.withdraw', gold: 4 }), null, 'a legal intent passes the schema');
    ps.ready = true; // the prep is over for this seat
    assert.equal(m.handle('p_0', { t: 'g.confront.withdraw', gold: 1 }).error, ERR.ALREADY, 'no withdrawals after 准备就绪');
    assert.equal(ps.bountyBank, 50, 'nothing moved');
  });

  test('赏金 only ever becomes gold through withdrawBounty (static scan of the server)', () => {
    const files = readdirSync(path.join(ROOT, 'server'), { recursive: true })
      .filter((f) => String(f).endsWith('.js')).map((f) => path.join(ROOT, 'server', String(f)));
    const hits = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => { if (/bountyBank/.test(line)) hits.push({ f: path.relative(ROOT, f), i: i + 1, line: line.trim() }); });
    }
    const rel = (h) => h.f.replace(/\\/g, '/');
    const minus = hits.filter((h) => /bountyBank\s*-=/.test(h.line));
    const plus = hits.filter((h) => /bountyBank\s*\+=/.test(h.line));
    assert.equal(minus.length, 1, 'exactly one place takes 赏金 out of the bank');
    assert.match(rel(minus[0]), /server\/match\/match\/confront\.js$/, 'it is the merchant withdrawal');
    assert.equal(plus.length, 1, 'exactly one place adds 赏金 to the bank');
    assert.match(rel(plus[0]), /server\/match\/match\/settle\.js$/, 'it is the battle settle');
    // and the bank only reaches the purse where the withdrawal pays it: only confront.js both banks and pays funds
    const withBank = [...new Set(hits.map((h) => rel(h)))];
    for (const f of withBank) {
      if (/addFunds\(/.test(readFileSync(path.join(ROOT, f), 'utf8'))) {
        assert.equal(f, 'server/match/match/confront.js', `${f} pays funds from the bank`);
      }
    }
    assert.match(readFileSync(path.join(ROOT, 'server/match/match/confront.js'), 'utf8'), /ps\.addFunds\(g, \{ reason: 'merchant' \}\)/, 'withdrawBounty is the one payer');
    // the sim knows nothing about PlayerState.bountyBank — it only carries the battle's own `bank`
    assert.ok(!hits.some((h) => /server\/sim\//.test(rel(h))), 'no sim file touches bountyBank');
  });

  test('b.result: `bank` is bounded by the placed bounties and coins + bank by all bounties (anti-cheat)', () => {
    const gd = new GameData(DATA, 'mode_multi_hard');
    const key = Object.keys(DATA.enemies).find((k) => gd.enemy(k) && !gd.enemy(k).notCountInTotal) || 'enemy_1000_gopro_2';
    const spec = buildBattleSpec({ battleId: 'bank-bounds', fieldId: 'n:p', kind: 'normal', seed: 1, round: 5, timeLimit: 60,
      players: [{ playerId: 'p', units: [], bonds: {} }],
      spawns: [
        { enemyKey: key, count: 2, time: 1, bounty: { coins: 3, ownerPlayerId: 'p', bank: true } },
        { enemyKey: key, count: 1, time: 2, bounty: { coins: 2, ownerPlayerId: 'p' } },
      ] });
    const raw = (coins, bank) => ({ reason: 'cleared', time: 30, killed: 3, total: 3, errors: 0,
      perPlayer: { p: { killed: 3, total: 3, leaked: [], perfect: true, layerGains: {}, coins, bank, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] } } });
    const v = validateClientResult(spec, raw(2, 6), { gd });
    assert.ok(v.ok, v.reason);
    assert.equal(v.result.perPlayer.p.bank, 6, 'the whole placed bounty is banked');
    assert.equal(v.result.perPlayer.p.coins, 2, 'the official bounty stays gold');
    const B = specBounds(spec, gd);
    assert.equal(B.bankCoins, 6, 'banked placement coins');
    assert.equal(B.goldCoins, 2, 'only the non-bank bounty may become gold');
    assert.equal(B.bountyCoins, 8, 'the two add up');
    assert.deepEqual(validateClientResult(spec, raw(0, 7), { gd }), { ok: false, reason: 'bank' }, 'more bank than was placed');
    // `coins` may only come from the non-bank bounty (2): 8 / 9 / 3 all exceed it, so the bank cannot be laundered as gold
    assert.deepEqual(validateClientResult(spec, raw(8, 6), { gd }), { ok: false, reason: 'coins' }, 'the whole 8 cannot be gold');
    assert.deepEqual(validateClientResult(spec, raw(9, 0), { gd }), { ok: false, reason: 'coins' }, 'more gold than was placed');
    assert.deepEqual(validateClientResult(spec, raw(8, 0), { gd }), { ok: false, reason: 'coins' }, 'bank cannot become gold');
    assert.deepEqual(validateClientResult(spec, raw(3, 0), { gd }), { ok: false, reason: 'coins' }, 'one coin over the non-bank bounty');
  });

  test('a real placement carries `bounty.bank` into the target\'s wave — the sim banks it, never gold', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const picks = [];
    let left = m.confrontBudget();
    for (const r of m.confrontGroups()[0].rows.slice().sort((a, b) => a.value - b.value || String(a.key).localeCompare(String(b.key)))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: picks.length % 2 ? 'upper' : 'lower' });
      if (picks.length >= 3) break;
    }
    assert.ok(picks.length > 0, 'the budget affords at least one monster');
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks }).ok, true);
    assert.ok(h.drive(() => m.phase !== PHASE.CONFRONT, { maxSteps: 3e6 }), 'the window closed');
    const sub = m.confront.get('p_0');
    const target = m.players.get('ai_2');
    const wave = m.applyConfront(m._confrontWaveSpawns(), sub, target);
    const placed = wave.filter((s) => s.bounty && s.bounty.bank === true);
    assert.equal(placed.length, picks.length, 'every placed monster is banked');
    assert.deepEqual(placed.map((s) => s.bounty.coins), m.confrontBountyPlan(picks), 'the per-kill plan rides on the spawn');
    // the report bound the server checks (bank ≤ Σ placed bounties) sees the same total
    assert.equal(specBounds({ spawns: wave }, m.gd).bankCoins, placed.reduce((n, s) => n + s.bounty.coins, 0));
    // the round's own monsters (an official 悬赏 among them) are never banked
    const banked = new Set(placed);
    for (const s of wave) if (s.bounty && !banked.has(s)) assert.notEqual(s.bounty.bank, true, 'only the placed monsters are banked');
  });

  test('a bot never withdraws by itself (the bank just sits there until a human spends it)', () => {
    const h = prep(41);
    for (const p of h.m.players.values()) if (p.isBot) assert.equal(p.withdrawnThisRound, 0, `${p.playerId} did not withdraw`);
  });
});
