// server/match/match/confront.js — Match methods: the 2V2 对抗期 (PHASE.CONFRONT). From the drawn contest round on, after
// each side's prep, each TEAM submits ONE intervention against the OPPONENT team's next normal battle.
//
// It picks one of VERSUS_CONFRONT.groups monster groups and places monsters from it (enemy type + gate/route, in spawn
// order). What limits the placement is NOT a count but the round's VALUE BUDGET (confrontBudget): the round's own wave
// value × the 10→50 % share × VERSUS_CONFRONT.budgetMul. Both teams face the same (synced) wave, so both get the same
// budget, and the 6 groups are built to hold the SAME TOTAL VALUE (`equalValueGroups`) — whichever group a team takes and
// whichever monsters it picks, spending the budget costs the same. A monster's cost and the wave's value are the same
// unit: the value formula carries the round's hp/atk scaling (confrontValue), which is what the client shows on a card.
// The placed monsters REPLACE originals of the opponent's wave worth `ratio × the wave value` (dropped from the tail) —
// the wave ends up harder by that share. The two teams submit independently and hide their picks from each other (the
// m.public isolation of step 3b-3 masks the opponent's `confront` entry). Installed on Match.prototype like the other
// method containers.
import { PHASE, ERR, VERSUS_CONFRONT } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

/**
 * value(enemy, scale) — the 对抗期 scoring formula: HP-primary, attack ×2, defence ×2, resistance ×15, the leader
 * (lpr > 1) HP bonus and 60 per block. FLYING enemies count as 2 blocks (the user's rule): a ground blocker cannot stop
 * them, so they are worth an extra block. `scale` is the round's hp/atk multiplier (gd.enemyScale), which makes a card's
 * value and the round's wave value comparable.
 * @param {any} e data/enemies.json record
 * @param {{ hpMul?: number, atkMul?: number }|null} scale
 */
export function confrontValue(e, scale = null) {
  const s = (e && e.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hp = num(s.maxHp) * (Number.isFinite(scale && scale.hpMul) ? scale.hpMul : 1);
  const atk = num(s.atk) * (Number.isFinite(scale && scale.atkMul) ? scale.atkMul : 1);
  const blocks = e && e.isFlyEnemy ? 2 : num(s.blockCnt);
  return Math.round(hp + atk * 2 + num(s.def) * 2 + num(s.res) * 15 + Math.max(0, num(s.lpr) - 1) * hp * 0.6 + blocks * 60);
}

/** The enemies normal waves really spawn: factions.json `templateSlots` + every type's `pool` / `entries`. */
export function confrontPool(factions) {
  const pool = new Set();
  for (const v of Object.values((factions && factions.templateSlots) || {})) if (typeof v === 'string') pool.add(v);
  for (const t of Object.values((factions && factions.types) || {})) {
    for (const k of t.pool || []) pool.add(k);
    for (const k of t.entries || []) pool.add(k);
  }
  return [...pool];
}

/**
 * Split `rows` ({ key, value }) into `G` groups of EQUAL TOTAL VALUE: strongest first, each row into the currently
 * cheapest group (LPT greedy). The groups come out equal in value (and, at this pool size, in count) — so the choice
 * between them is about WHICH monsters to throw, never about raw strength. Deterministic.
 */
export function equalValueGroups(rows, G) {
  const desc = rows.slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
  const buckets = Array.from({ length: G }, () => ({ rows: [], sum: 0 }));
  for (const r of desc) {
    buckets.sort((x, y) => x.sum - y.sum || x.rows.length - y.rows.length);
    buckets[0].rows.push(r);
    buckets[0].sum += r.value;
  }
  // display order: the cheapest bucket first (ties by the first key), so G1..G6 stay stable across rounds
  buckets.sort((x, y) => x.sum - y.sum || String(x.rows[0].key).localeCompare(String(y.rows[0].key)));
  return buckets.map((b) => b.rows);
}

export class MatchConfront {
  /** The 对抗期 is active in the versus mode from the drawn contest round on, on normal (non-boss) rounds. */
  confrontActive() {
    return this.isVersus && this.contestStartRound != null
      && this.round >= this.contestStartRound && this.round < this.gd.bossRound;
  }

  /** The share of the opponent's original wave a team may replace this round (10% at R_contest, +10 %/round, cap 50 %). */
  confrontRatio() {
    const r = this.round - this.contestStartRound + 1;
    return Math.min(0.5, Math.max(0.1, 0.1 * r));
  }

  /** The round's hp/atk scaling: card costs and the wave value are both in its unit. */
  confrontScale() { return this.gd.enemyScale(this.round); }

  /**
   * The 6 groups offered in the 对抗期: the pool (confrontPool) valued with THIS round's scaling and split into equal
   * total value (equalValueGroups). Recomputed when the round changes (the scaling moves values between rounds).
   * @returns {Array<Array<{ key: string, name: string, value: number }>>}
   */
  confrontGroups() {
    const scale = this.confrontScale();
    const sig = `${this.round}|${scale.hpMul}|${scale.atkMul}`;
    if (this._confrontGroups && this._confrontSig === sig) return this._confrontGroups;
    const en = (this.data && this.data.enemies) || {};
    const rows = confrontPool(this.data && this.data.factions)
      .filter((k) => en[k])
      .map((k) => ({ key: k, name: en[k].name || k, value: confrontValue(en[k], scale) }));
    this._confrontGroups = equalValueGroups(rows, VERSUS_CONFRONT.groups);
    this._confrontSig = sig;
    return this._confrontGroups;
  }

  /**
   * The value of the round's original wave — every team faces the same (synced) wave, so this is one number for the
   * whole match. Spawns carrying their own `mods` keep them (a later round's own overrides).
   */
  confrontWaveValue() {
    const spawns = (this.wave && this.wave.spawns) || [];
    const scale = this.confrontScale();
    const en = (this.data && this.data.enemies) || {};
    let v = 0;
    for (const s of spawns) {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      v += confrontValue(en[s.enemyKey], s.mods || scale) * cnt;
    }
    return v;
  }

  /** This round's placement budget: the wave value × the share × VERSUS_CONFRONT.budgetMul (one number for both teams). */
  confrontBudget() {
    return Math.round(this.confrontWaveValue() * this.confrontRatio() * VERSUS_CONFRONT.budgetMul);
  }

  /** Σ value of a set of picks, at this round's scaling. */
  confrontSpent(picks) {
    const scale = this.confrontScale();
    const en = (this.data && this.data.enemies) || {};
    let v = 0;
    for (const p of picks || []) v += confrontValue(en[p && p.enemyKey], scale);
    return v;
  }

  /** Every alive player of a team is a bot / under 托管 (the team's decision is made at once). */
  _teamAllBots(team) {
    const members = this.order.filter((p) => this.teamIdOf(p) === team && p.alive && !p.left);
    return members.length > 0 && members.every((p) => p.botControlled);
  }

  /** Enter the 对抗期: each team gets the decision window to submit one intervention (bots submit at once). */
  enterConfront() {
    this.phase = PHASE.CONFRONT;
    if (!this.confrontSubs) this.confrontSubs = new Map();
    this.confrontSubs.clear();
    const secs = this.soloUntimed ? null : VERSUS_CONFRONT.turnSeconds;
    this.setDeadline(secs, () => this.finishConfront());
    for (const t of this.matchTeamIds()) if (this._teamAllBots(t)) this._botConfront(t);
    for (const ps of this.alivePlayers()) ps.ready = false;
    this.markPublic();
    this.maybeFinishConfront();
  }

  /** `g.confront { group, picks }`: a team's submission — the group index (1..N) and the monsters in spawn order. */
  submitConfront(ps, { group, picks }) {
    if (this.phase !== PHASE.CONFRONT) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const team = this.teamIdOf(ps);
    if (this.confrontSubs.has(team)) return fail(ERR.ALREADY);
    const groups = this.confrontGroups();
    if (!Number.isInteger(group) || group < 1 || group > groups.length) return fail(ERR.BAD_TARGET);
    const member = this._confrontMember(group, picks);
    if (!member) return fail(ERR.BAD_TARGET, 'illegal 对抗期 pick');
    this.confrontSubs.set(team, member);
    this.markPublic();
    this.maybeFinishConfront();
    return OK;
  }

  /**
   * Check a submission against the chosen group: every enemyKey in the group, a legal route, and — the only cap — the
   * combined VALUE within the round's budget (there is no count limit; the group's own size bounds the count).
   */
  _confrontMember(group, picks) {
    const list = this.confrontGroups()[group - 1] || [];
    const allowed = new Set(list.map((r) => r.key));
    const arr = Array.isArray(picks) ? picks : [];
    const routeN = Array.isArray(this.stage && this.stage.routes) ? this.stage.routes.length : 3;
    const out = [];
    for (const p of arr) {
      if (!p || typeof p.enemyKey !== 'string' || !allowed.has(p.enemyKey)) return null;
      const routeIndex = Number.isInteger(p.routeIndex) ? p.routeIndex : 0;
      if (routeIndex < 0 || routeIndex >= Math.max(1, routeN)) return null;
      out.push({ enemyKey: p.enemyKey, routeIndex });
    }
    if (this.confrontSpent(out) > this.confrontBudget()) return null;
    return { group, picks: out, ratio: this.confrontRatio(), budget: this.confrontBudget() };
  }

  /** An AI team's submission: fill the budget from its group, most expensive fitting monster first (any group does). */
  _botConfront(team) {
    if (this.phase !== PHASE.CONFRONT || this.confrontSubs.has(team)) return;
    const groups = this.confrontGroups();
    const budget = this.confrontBudget();
    const routeN = Array.isArray(this.stage && this.stage.routes) ? this.stage.routes.length : 3;
    const g = groups[groups.length - 1] || [];
    const picks = [];
    let left = budget;
    for (const r of g.slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, routeIndex: picks.length % Math.max(1, routeN) });
    }
    this.confrontSubs.set(team, { group: groups.length, picks, ratio: this.confrontRatio(), budget });
    this.markPublic();
    this.maybeFinishConfront();
  }

  /** End the 对抗期 once every team submitted (or the window runs out): apply and start the round's battles. */
  maybeFinishConfront() {
    if (this.phase !== PHASE.CONFRONT) return;
    const teams = this.matchTeamIds().filter((t) => this.order.some((p) => this.teamIdOf(p) === t && p.alive && !p.left));
    if (teams.every((t) => this.confrontSubs.has(t))) this.finishConfront();
  }

  finishConfront() {
    if (this.phase !== PHASE.CONFRONT) return;
    this.setDeadline(0);
    this.confront = new Map(this.confrontSubs);
    this.startCombat();
  }

  /** The applied intervention targeting a player's wave: the OPPONENT team's submission (or null). */
  confrontFor(ps) {
    if (!this.isVersus || !this.confront || this.confront.size === 0) return null;
    const opp = this.matchTeamIds().find((t) => t !== this.teamIdOf(ps));
    return (opp != null && this.confront.get(opp)) || null;
  }

  /**
   * Replace a share of a player's original wave with the opponent team's placed monsters: originals are dropped from the
   * tail until their VALUE covers `ratio × the wave value`, then the placed monsters are appended, in order, on their
   * routes, spread over the wave's window. Both sides of the swap are in the same unit (see confrontValue).
   * @param {object[]} spawns the player's original SpawnSpecs (each with enemyKey / count / routeIndex / time)
   * @param {{ picks: object[], ratio: number, budget?: number }} sub
   * @param {object} ps
   * @returns {object[]} the modified spawn list
   */
  applyConfront(spawns, sub, ps) {
    if (!sub || !Array.isArray(sub.picks) || !sub.picks.length || !Array.isArray(spawns) || !spawns.length) return spawns;
    const scale = this.confrontScale();
    const en = (this.data && this.data.enemies) || {};
    const valueOf = (key) => confrontValue(en[key], scale);
    const target = this.confrontWaveValue() * sub.ratio;
    const out = spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    let dropped = 0;
    for (let i = out.length - 1; i >= 0 && dropped < target; i--) {
      const c = Math.max(1, Math.floor(Number(out[i].count) || 1));
      const unit = Math.max(1, valueOf(out[i].enemyKey));
      const take = Math.min(c, Math.max(1, Math.ceil((target - dropped) / unit)));
      dropped += take * unit;
      const left = c - take;
      if (left <= 0) out.splice(i, 1);
      else out[i].count = left;
    }
    const mods = { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul };
    const t0 = out.reduce((m, s) => Math.min(m, Number(s.time) || 0), Number.POSITIVE_INFINITY);
    const start = Number.isFinite(t0) ? t0 : 0;
    const gap = 2;
    sub.picks.forEach((p, i) => {
      out.push({ time: start + i * gap, enemyKey: p.enemyKey, count: 1, interval: 0, routeIndex: p.routeIndex, mods: { ...mods }, ownerPlayerId: ps.playerId });
    });
    return out;
  }
}
