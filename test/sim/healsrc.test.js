// server/sim/battle/status.js attributeRegen ([HEALSRC]): the natural-regeneration tick heals a unit with itself as the
// source, so the whole amount lands on the receiver's stats.heal. An ally aura that grants `hpRegen` / `hpRegenRatio`
// through a buff whose `source` is the provider (吟游者 / 调香师 / 源 …) must count for the provider: each such buff's
// share — proportional to its rate out of the unit's total regen — moves to the provider's stats.heal (and its owner's
// healingDone) and comes back off the receiver. Base `hpRecoveryPerSec` and self-sourced buffs stay with the unit.
// The regen mechanic itself is untouched and `resultDigest` carries no healing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const PROVIDER = 'test_provider_a';
const TANK = 'test_tank_a';

/** Two ally players on one field: p1's provider (no regen of its own) and p2's tank. */
function build(stats = {}) {
  return makeBattle({
    defs: {
      chess: {
        [PROVIDER]: chessRec({ id: PROVIDER, name: 'provider', profession: 'SUPPORT' }),
        [TANK]: chessRec({ id: TANK, name: 'tank', stats: { maxHp: 2000, ...stats } }),
      },
    },
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: PROVIDER, row: 10, col: 5, dir: 'RIGHT' }] },
      { playerId: 'p2', seat: 1, side: 'L', colOffset: 0, units: [{ uid: 2, chessId: TANK, row: 10, col: 6, dir: 'RIGHT' }] },
    ],
    content: 'none', autoFinish: false, timeLimit: 300, seed: 5,
  });
}

/** Bring both on the field, wound the tank to half HP (room to regen), return the pair. */
function ready(h) {
  h.run(1);
  const p = h.unit(PROVIDER);
  const b = h.unit(TANK);
  assert.ok(p && p.deployed, 'the provider is on the field');
  assert.ok(b && b.deployed, 'the tank is on the field');
  b.hp = b.s.maxHp * 0.5;
  return { p, b };
}

test('[HEALSRC] an ally hpRegen buff credits its provider; the receiver keeps only its base hpRecoveryPerSec share', () => {
  const h = build({ hpRecoveryPerSec: 10 });
  const { p, b } = ready(h);
  // the provider's aura: an hpRegen buff whose source is the provider
  h.b.addBuff(b, { key: 'test:aura', mods: { hpRegen: 10 }, source: p });
  assert.equal(Math.round(b.s.hpRegen), 20, 'the unit regen rate is base 10 + the aura 10');

  h.run(4);
  // 4 s × 20 HP/s = 80 HP restored: half of it is the aura's (the provider's), half the tank's own base regen
  assert.ok(Math.abs(b.stats.heal - 40) < 2, `the receiver keeps its base share only, got ${b.stats.heal.toFixed(1)}`);
  assert.ok(Math.abs(p.stats.heal - 40) < 2, `the aura's share is credited to the provider, got ${p.stats.heal.toFixed(1)}`);
  assert.ok(Math.abs(h.b._pp('p2').healingDone - 40) < 2, 'the receiver\'s player keeps the base share');
  assert.ok(Math.abs(h.b._pp('p1').healingDone - 40) < 2, 'the provider\'s player gets the moved share');
});

test('[HEALSRC] hpRegenRatio auras are split by their rate too and several sources share it', () => {
  const h = build({ hpRecoveryPerSec: 10, maxHp: 2000 });
  const { p, b } = ready(h);
  h.b.addBuff(b, { key: 'test:aura', mods: { hpRegenRatio: 0.005 }, source: p }); // 0.005 × 2000 = 10 HP/s
  assert.equal(Math.round(b.s.hpRegen), 20);

  h.run(4);
  assert.ok(Math.abs(b.stats.heal - 40) < 2, `base share only, got ${b.stats.heal.toFixed(1)}`);
  assert.ok(Math.abs(p.stats.heal - 40) < 2, `the ratio aura's share, got ${p.stats.heal.toFixed(1)}`);
});

test('[HEALSRC] a self-sourced regen buff stays on the unit (nothing moves to another provider)', () => {
  const h = build({ hpRecoveryPerSec: 10 });
  const { p, b } = ready(h);
  h.b.addBuff(b, { key: 'test:self', mods: { hpRegen: 10 }, source: b });
  h.b.addBuff(b, { key: 'test:anon', mods: { hpRegen: 10 } });

  h.run(4); // 30 HP/s × 4 s = 120 HP, all the tank's
  assert.ok(Math.abs(b.stats.heal - 120) < 3, `all of it stays on the receiver, got ${b.stats.heal.toFixed(1)}`);
  assert.equal(p.stats.heal, 0, 'nothing is credited to the other unit');
  assert.equal(h.b._pp('p1').healingDone, 0, 'nor to its player');
  assert.ok(Math.abs(h.b._pp('p2').healingDone - 120) < 3);
});

test('[HEALSRC] the base hpRecoveryPerSec alone is never moved: no external buff, no change of ownership', () => {
  const h = build({ hpRecoveryPerSec: 25 });
  const { p, b } = ready(h);
  h.run(4);
  assert.ok(Math.abs(b.stats.heal - 100) < 2, `the whole base regen, got ${b.stats.heal.toFixed(1)}`);
  assert.equal(p.stats.heal, 0);
  assert.equal(h.b._pp('p1').healingDone, 0);
  assert.ok(Math.abs(h.b._pp('p2').healingDone - 100) < 2);
});
