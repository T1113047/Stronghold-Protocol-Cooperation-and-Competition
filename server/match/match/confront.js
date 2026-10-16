// server/match/match/confront.js — Match methods: the 2V2 对抗期 (PHASE.CONFRONT). From the drawn contest round on, after
// each side's prep, each TEAM submits ONE intervention against the OPPONENT team's next normal battle: it picks one of
// VERSUS_CONFRONT.groups monster groups (a fixed, value-sorted pool of the enemies normal waves spawn) and places up to
// `maxPicks` of them (enemy type + gate/route, in spawn order). The placed monsters REPLACE a share of the opponent's
// original wave (confrontRatio: 10% at the contest round, +10 %/round, cap 50 %). The two teams submit independently and
// hide their picks from each other (the m.public isolation of step 3b-3 hides the opponent's `confront` entry).
// Installed on Match.prototype like the other method containers.
import { PHASE, ERR, VERSUS_CONFRONT } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

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

  /**
   * The `VERSUS_CONFRONT.groups` monster groups offered in the 对抗期: the enemies the normal waves really spawn
   * (data/factions.json `templateSlots` + each type's `pool`/`entries`), sorted by the value used in the scoring table
   * (HP-primary) and split into equal-count groups (low → high threat). Deterministic; computed once per match.
   * @returns {Array<Array<{ key: string, name: string, value: number }>>}
   */
  confrontGroups() {
    if (this._confrontGroups) return this._confrontGroups;
    const en = (this.data && this.data.enemies) || {};
    const fac = (this.data && this.data.factions) || {};
    const pool = new Set();
    for (const v of Object.values(fac.templateSlots || {})) if (typeof v === 'string') pool.add(v);
    for (const t of Object.values(fac.types || {})) {
      for (const k of t.pool || []) pool.add(k);
      for (const k of t.entries || []) pool.add(k);
    }
    const value = (e) => {
      const s = e.stats || {};
      const hp = Number(s.maxHp) || 0;
      return Math.round(hp + (Number(s.atk) || 0) + (Number(s.def) || 0) * 2 + (Number(s.res) || 0) * 15
        + Math.max(0, (Number(s.lpr) || 0) - 1) * hp * 0.6 + (Number(s.blockCnt) || 0) * 60);
    };
    const rows = [...pool].filter((k) => en[k]).map((k) => ({ key: k, name: en[k].name || k, value: value(en[k]) }))
      .sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
    const G = VERSUS_CONFRONT.groups;
    const groups = Array.from({ length: G }, () => []);
    rows.forEach((r, i) => groups[Math.min(G - 1, Math.floor((i * G) / rows.length))].push(r));
    this._confrontGroups = groups;
    return groups;
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

  /** `g.confront { group, picks }`: a team's submission — the groups index (1..N) and the placed monsters in spawn order. */
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

  /** Check a submission against the chosen group: ≤ maxPicks, every enemyKey in the group, a legal route. */
  _confrontMember(group, picks) {
    const list = this.confrontGroups()[group - 1] || [];
    const allowed = new Set(list.map((r) => r.key));
    const arr = Array.isArray(picks) ? picks : [];
    if (arr.length > VERSUS_CONFRONT.maxPicks) return null;
    const routeN = Array.isArray(this.stage && this.stage.routes) ? this.stage.routes.length : 3;
    const out = [];
    for (const p of arr) {
      if (!p || typeof p.enemyKey !== 'string' || !allowed.has(p.enemyKey)) return null;
      const routeIndex = Number.isInteger(p.routeIndex) ? p.routeIndex : 0;
      if (routeIndex < 0 || routeIndex >= Math.max(1, routeN)) return null;
      out.push({ enemyKey: p.enemyKey, routeIndex });
    }
    return { group, picks: out, ratio: this.confrontRatio() };
  }

  /** An AI team's submission: the highest-value group, placing up to the cap on the first routes. */
  _botConfront(team) {
    if (this.phase !== PHASE.CONFRONT || this.confrontSubs.has(team)) return;
    const groups = this.confrontGroups();
    const g = groups[groups.length - 1] || [];
    const routeN = Array.isArray(this.stage && this.stage.routes) ? this.stage.routes.length : 3;
    const picks = g.slice(-Math.min(VERSUS_CONFRONT.maxPicks, g.length)).reverse().map((r, i) => ({ enemyKey: r.key, routeIndex: i % Math.max(1, routeN) }));
    this.confrontSubs.set(team, { group: groups.length, picks, ratio: this.confrontRatio() });
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
   * Replace a share of a player's original wave with the opponent team's placed monsters: up to `ratio × Σ original
   * counts` (capped at the picks and VERSUS_CONFRONT.maxPicks) original monsters are dropped (from the tail) and the
   * placed monsters appended in order, on their routes, spread over the wave's window.
   * @param {object[]} spawns the player's original SpawnSpecs (each with enemyKey / count / routeIndex / time)
   * @param {{ picks: object[], ratio: number }} sub
   * @param {object} ps
   * @returns {object[]} the modified spawn list
   */
  applyConfront(spawns, sub, ps) {
    if (!sub || !Array.isArray(sub.picks) || !sub.picks.length || !Array.isArray(spawns) || !spawns.length) return spawns;
    const total = spawns.reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
    const cap = Math.max(0, Math.min(sub.picks.length, VERSUS_CONFRONT.maxPicks, Math.round(total * sub.ratio)));
    if (cap <= 0) return spawns;
    // drop `cap` original monsters from the tail (reduce counts; keep every spawn well-formed)
    const out = spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    let drop = cap;
    for (let i = out.length - 1; i >= 0 && drop > 0; i--) {
      const c = Math.max(1, Math.floor(Number(out[i].count) || 1));
      const take = Math.min(c, drop);
      const left = c - take;
      drop -= take;
      if (left <= 0) out.splice(i, 1);
      else out[i].count = left;
    }
    // append the placed monsters, in order, over the wave's window
    const scale = this.gd.enemyScale(this.round);
    const mods = { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul };
    const t0 = out.reduce((m, s) => Math.min(m, Number(s.time) || 0), Number.POSITIVE_INFINITY);
    const start = Number.isFinite(t0) ? t0 : 0;
    const gap = 2;
    sub.picks.slice(0, cap).forEach((p, i) => {
      out.push({ time: start + i * gap, enemyKey: p.enemyKey, count: 1, interval: 0, routeIndex: p.routeIndex, mods: { ...mods }, ownerPlayerId: ps.playerId });
    });
    return out;
  }
}
