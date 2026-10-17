// test/sim/merchant-bank.test.js — 2V2 赏金 ≠ 金币 (user 2026-10-17). The bounty of a monster the OPPONENT PLACED
// (`bounty.bank`) is banked at 坎诺特 (`perPlayer.bank`), never added to gold (`perPlayer.coins`); the official 悬赏 card
// bounties keep paying gold. The bank only becomes funds through Match.withdrawBounty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const sumOf = (h, type) => h.eventsOf(type).reduce((n, e) => n + (Number(e[2]) || 0), 0);
const finished = (h) => {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
};

test('a placed monster pays the bank, never gold; an official bounty still pays gold', () => {
  const h = makeBattle({
    stageId: 'act1autochess_m01', content: 'none', autoFinish: false, timeLimit: 60,
    defs: { enemies: { enemy_p: enemyRec({ key: 'enemy_p', hp: 100, speed: 0 }), enemy_o: enemyRec({ key: 'enemy_o', hp: 100, speed: 0 }) } },
    enemies: [
      // the opponent placed this one: its bounty is banked
      { key: 'enemy_p', pos: [10, 6], ownerPlayerId: 'p1', bounty: { coins: 3, ownerPlayerId: 'p1', bank: true }, tag: 'bounty' },
      // the player's own official 悬赏 card: its bounty is gold, as before
      { key: 'enemy_o', pos: [10, 7], ownerPlayerId: 'p1', mods: { bountyId: 'card1' }, bounty: { coins: 2, ownerPlayerId: 'p1' }, tag: 'bounty' },
    ],
  });
  h.step();
  for (const e of h.b.enemies.filter((x) => x.alive)) h.b.kill(e, null);
  const p = h.result().perPlayer.p1;
  assert.equal(p.coins, 2, 'only the official bounty became gold');
  assert.equal(p.bank, 3, 'the placed monster\'s bounty was banked');
  assert.equal(sumOf(h, 'bounty'), 2, 'one gold payout event');
  assert.equal(sumOf(h, 'bank'), 3, 'one bank payout event');
  finished(h);
});

test('a placed monster alone pays ONLY the bank (gold untouched), an official bounty alone pays ONLY gold', () => {
  const placed = makeBattle({
    stageId: 'act1autochess_m01', content: 'none', autoFinish: false, timeLimit: 60,
    defs: { enemies: { enemy_p: enemyRec({ key: 'enemy_p', hp: 100, speed: 0 }) } },
    enemies: [{ key: 'enemy_p', pos: [10, 6], ownerPlayerId: 'p1', bounty: { coins: 5, ownerPlayerId: 'p1', bank: true }, tag: 'bounty' }],
  });
  placed.step();
  for (const e of placed.b.enemies.filter((x) => x.alive)) placed.b.kill(e, null);
  const a = placed.result().perPlayer.p1;
  assert.equal(a.coins, 0, 'no gold at all from an opponent-placed monster');
  assert.equal(a.bank, 5, 'the whole bounty is banked');
  assert.equal(sumOf(placed, 'bounty'), 0, 'and no gold payout event');
  assert.equal(sumOf(placed, 'bank'), 5, 'one bank payout event');
  finished(placed);

  const official = makeBattle({
    stageId: 'act1autochess_m01', content: 'none', autoFinish: false, timeLimit: 60,
    defs: { enemies: { enemy_o: enemyRec({ key: 'enemy_o', hp: 100, speed: 0 }) } },
    enemies: [{ key: 'enemy_o', pos: [10, 6], ownerPlayerId: 'p1', mods: { bountyId: 'card1' }, bounty: { coins: 4, ownerPlayerId: 'p1' }, tag: 'bounty' }],
  });
  official.step();
  for (const e of official.b.enemies.filter((x) => x.alive)) official.b.kill(e, null);
  const b = official.result().perPlayer.p1;
  assert.equal(b.coins, 4, 'the official 悬赏 still pays gold');
  assert.equal(b.bank, 0, 'and never touches the bank');
  assert.equal(sumOf(official, 'bank'), 0, 'no bank event');
  finished(official);
});

test('a banked bounty pays its killer\'s bank even when the killer is a 联防 helper; gold stays untouched', () => {
  const h = makeBattle({
    kind: 'unite', content: 'none', autoFinish: false, timeLimit: 60,
    players: [
      { playerId: 'A', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {}, layers: {} },
      { playerId: 'B', seat: 1, side: 'R', colOffset: 8, units: [], bonds: {}, layers: {} },
    ],
    defs: { enemies: { enemy_p: enemyRec({ key: 'enemy_p', hp: 100, speed: 0 }) } },
    enemies: [{ key: 'enemy_p', pos: [10, 15], sourcePlayerId: 'L', mods: { bountyId: 'card1' }, bounty: { coins: 4, ownerPlayerId: 'L', bank: true }, tag: 'bounty' }],
  });
  h.step();
  const e = h.b.enemies.find((x) => x.defId === 'enemy_p');
  h.b.kill(e, null);
  const r = h.result().perPlayer;
  assert.equal(r.B.bank, 4, 'the helper whose half it fell on banks it');
  assert.equal(r.B.coins, 0, 'and receives no gold');
  assert.equal(r.A.bank || 0, 0, 'the leaker gets nothing');
  finished(h);
});
