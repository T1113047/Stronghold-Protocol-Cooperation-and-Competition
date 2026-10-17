// server/sim/content/event.js — 2V2 事件期 (类肉鸽词条) battle side. The match injects one `event:` EffectRef per entry a
// player RECEIVED (PlayerState.battleInput → eventBattleRefs): `{ key: 'event:<card>#<n>', params }`.
//
// 环境buff乘区 / environment buff bucket (user 2026-10-17):
//   ① every source multiplies once: `stat = base × Π(1 + p_i)`; two +20 % entries are 1.20 × 1.20 = 1.44;
//   ② flat values (ASPD / SP recovery / SP cost) are the highest priority: added to the panel first and never scaled
//      by the bucket;
//   ③ the bucket is event-only: it never mixes with the additive pool of bonds / equipment / skills / 机变.
// Each ref therefore becomes its OWN passive buff with a unique key, so the engine's aggregateMods multiplies its
// `atkMul` / `hpMul` / `defMul` / `dmgTakenMul` / `moveMul` / `spRecoveryMul` across refs. No `atkPct` / `hpPct` /
// `defPct` is written, so the existing additive systems keep their exact numbers (event-only isolation).
//
// ENEMIES: `enemySpeed` is applied at enemySpawn as its own moveMul buff per ref (the spawn's own scale is already in
// `mods.speedMul`). Ref params carry the target's magnitude already applied (self ×2); this module does no scaling.
// `regenPct` and `defIgnorePct` are derived additive rates (hpRegenRatio / ignore fraction), not stat multipliers.

import { passiveBuff } from './support/index.js';

const EVENT_PREFIX = 'event:';

/** Battle-relevant numeric params of one ref (missing = 0). */
function paramsOf(ref) {
  const p = ref && ref.params && typeof ref.params === 'object' ? ref.params : {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    atkPct: num(p.atkPct),
    hpPct: num(p.hpPct),
    defPct: num(p.defPct),
    defIgnorePct: num(p.defIgnorePct),
    aspd: num(p.aspd),
    regenPct: num(p.regenPct),
    dmgTaken: num(p.dmgTaken),
    moveMul: num(p.moveMul),
    spRecoveryMul: num(p.spRecoveryMul),
    spRecoveryFlat: num(p.spRecoveryFlat),
    spCostFlat: num(p.spCostFlat),
    enemySpeed: num(p.enemySpeed),
  };
}

export function install(battle) {
  /** One entry per event ref: { pid, key, mods } (the key is unique per received entry). */
  const refs = [];
  /** Enemy-speed entries: { pid, key, mul }. */
  const speed = [];
  for (const ps of battle.players || []) {
    for (const ref of ps.playerEffects || []) {
      if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith(EVENT_PREFIX)) continue;
      const p = paramsOf(ref);
      const mods = {};
      // percentages go into the environment buff bucket: each ref contributes ×(1 + p) in its own buff
      if (p.atkPct) mods.atkMul = 1 + p.atkPct;
      if (p.hpPct) mods.hpMul = 1 + p.hpPct;
      if (p.defPct) mods.defMul = 1 + p.defPct;
      if (p.defIgnorePct) mods.defIgnorePct = p.defIgnorePct;
      // flat panel values — highest priority, added before any bucket multiplier by the engine
      if (p.aspd) mods.aspd = p.aspd;
      if (p.spRecoveryFlat) mods.spRecoveryFlat = p.spRecoveryFlat;
      if (p.spCostFlat) mods.spCostFlat = p.spCostFlat;
      // derived rates / environment buff bucket multipliers
      if (p.regenPct) mods.hpRegenRatio = p.regenPct;
      if (p.dmgTaken) mods.dmgTakenMul = 1 + p.dmgTaken;
      if (p.moveMul) mods.moveMul = p.moveMul;
      if (p.spRecoveryMul) mods.spRecoveryMul = p.spRecoveryMul;
      if (Object.keys(mods).length) refs.push({ pid: ps.playerId, key: ref.key, mods });
      if (p.enemySpeed) speed.push({ pid: ps.playerId, key: ref.key, mul: 1 + p.enemySpeed });
    }
  }
  if (!refs.length && !speed.length) return;

  if (refs.length) {
    battle.on('battleStart', () => {
      for (const r of refs) {
        for (const u of battle.allyUnits) {
          if (u.kind !== 'op' || u.side !== 'ally' || u.ownerId !== r.pid) continue;
          passiveBuff(battle, u, r.key, { ...r.mods });
        }
      }
    }, { priority: -10 });
  }

  if (speed.length) {
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || !e.alive) return;
      const pid = e.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null);
      if (pid == null) return;
      for (const s of speed) {
        if (s.pid !== pid) continue;
        battle.addBuff(e, { key: `event:speed:${s.key}`, mods: { moveMul: s.mul }, persist: true });
      }
    });
  }
}
