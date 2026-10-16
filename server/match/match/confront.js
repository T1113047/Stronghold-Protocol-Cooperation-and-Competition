// server/match/match/confront.js — Match methods: the 2V2 对抗期 (PHASE.CONFRONT). From the drawn contest round on, after
// each side's prep, every ALIVE player intervenes once, against ONE opposing player:
//
//   step 1 (targets, VERSUS_CONFRONT.targetSeconds): each player names the opponent they attack. Inside a team it is
//     first come, first served — whoever submits first picks, and the teammate is given the opponent that is left (A
//     takes C, B gets D), so the two teams are paired one-to-one and every player both attacks and is attacked. The step
//     ends once every alive player holds a target (both sides — a side that finished early waits) or its window runs out.
//   step 2 (monsters, VERSUS_CONFRONT.monsterSeconds): each player fills their own VALUE BUDGET with monsters of ONE of
//     the 6 groups, each on a gate (上路 'upper' / 下路 'lower') and all inserted at one place in the wave (position:
//     front / mid / back = 25 / 50 / 75 % of the round's monster count). Submitting early is fine; the phase NEVER ends
//     before the window is up (the sides stay in step).
//
// The budget (confrontBudget) = the round's own wave value × the 10→50 % share × VERSUS_CONFRONT.budgetMul, per PLAYER
// (each counts on its own) — both teams face the same (synced) wave, so both get the same number, and the 6 groups hold
// the same total value (equalValueGroups), so the choice is never about raw strength. A monster's cost and the wave's
// value are one unit: the formula carries the round's hp/atk scaling (confrontValue).
//
// Applying: the placed monsters of an intervention land on ITS TARGET's wave only (confrontFor), replacing originals
// worth `share × the wave value` picked at random (within 2 % of that value), inserted at the chosen position. The
// opponent never sees who is aiming at whom (m.public isolation) — the panel shows the opponents as '?'.
// Installed on Match.prototype like the other method containers.
import { PHASE, ERR, VERSUS_CONFRONT } from '../../../shared/constants.js';
import { gateOf, roundMods } from '../waves.js';
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

  /** The round's original wave spawns (every team faces the same synced one). */
  _confrontWaveSpawns() { return (this.wave && this.wave.spawns) || []; }

  /** The value of the round's original wave, at this round's scaling. */
  confrontWaveValue() {
    const scale = this.confrontScale();
    const en = (this.data && this.data.enemies) || {};
    let v = 0;
    for (const s of this._confrontWaveSpawns()) {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      v += confrontValue(en[s.enemyKey], s.mods || scale) * cnt;
    }
    return v;
  }

  /** The round's monster count (Σ counts) — the base of the insertion positions (25 / 50 / 75 %). */
  confrontWaveCount() {
    return this._confrontWaveSpawns().reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
  }

  /** This round's placement budget: the wave value × the share × VERSUS_CONFRONT.budgetMul — PER PLAYER (个算个的). */
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

  /**
   * The kill bounty one placed monster pays (`VERSUS_CONFRONT.killIncomeShare`): its value as a share of the round's
   * whole wave, times the round's income — so the total of a team's placements pays at most `killIncomeShare` rounds of
   * income, i.e. the compensation tracks how much value they actually threw. Read live from the value table every round.
   * @param {string} enemyKey
   */
  confrontBounty(enemyKey) {
    const en = (this.data && this.data.enemies) || {};
    const scale = this.confrontScale();
    const wave = Math.max(1, this.confrontWaveValue());
    const income = Number(this.gd.income(this.round)) || 0;
    const share = Number(VERSUS_CONFRONT.killIncomeShare) > 0 ? Number(VERSUS_CONFRONT.killIncomeShare) : 1;
    return Math.max(1, Math.round((confrontValue(en[enemyKey], scale) / wave) * income * share));
  }

  /** The alive, seated members of a team. */
  _aliveOf(team) { return this.order.filter((p) => p.alive && !p.left && this.teamIdOf(p) === team); }

  /** Every alive member of a team is a bot / under 托管 (its target is decided at once). */
  _allBots(team) {
    const members = this._aliveOf(team);
    return members.length > 0 && members.every((p) => p.botControlled);
  }

  /** Enter the 对抗期: step 1 (targets) opens. A team of BOTS decides at once; a team holding a human waits for it — the
   *  human picks first and the bot teammate is filled in only then (or when the window closes). */
  enterConfront() {
    this.phase = PHASE.CONFRONT;
    this.confrontStage = 'target';
    this.confrontTargets = new Map(); // attacker playerId → target playerId
    this.confrontSubs = new Map();    // attacker playerId → { target, group, position, picks, ratio, budget }
    this.setDeadline(this.soloUntimed ? null : VERSUS_CONFRONT.targetSeconds, () => this.finishConfrontTargets());
    for (const t of this.matchTeamIds()) {
      if (!this._allBots(t)) continue;
      for (const ps of this._aliveOf(t)) this.assignConfrontTarget(ps, null, true);
    }
    for (const ps of this.alivePlayers()) ps.ready = false;
    this.markPublic();
    this.maybeFinishConfrontTargets();
  }

  /** `g.confrontTarget { targetPlayerId }`: the player names the OPPONENT they attack this round. */
  submitConfrontTarget(ps, { targetPlayerId }) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.confrontTargets.has(ps.playerId)) return fail(ERR.ALREADY);
    const target = this.players.get(targetPlayerId);
    if (!target || !target.alive || target.left || this.teamIdOf(target) === this.teamIdOf(ps)) return fail(ERR.BAD_TARGET);
    this.assignConfrontTarget(ps, target.playerId, true);
    this.markPublic();
    this.maybeFinishConfrontTargets();
    return OK;
  }

  /**
   * Give `ps` a target: the named one when it is still free, else the opponent that is left. `fillMates` also hands the
   * teammate whatever remains (first come, first served: A picks C and B is given D) — never the other team.
   */
  assignConfrontTarget(ps, want = null, fillMates = false) {
    const team = this.teamIdOf(ps);
    const opp = this.matchTeamIds().find((t) => t !== team);
    const oppIds = opp == null ? [] : this._aliveOf(opp).map((p) => p.playerId);
    const takenBy = (t) => [...this.confrontTargets.entries()]
      .filter(([pid]) => this.teamIdOf(this.players.get(pid)) === t).map(([, v]) => v);
    if (!this.confrontTargets.has(ps.playerId)) {
      const free = oppIds.filter((pid) => !takenBy(team).includes(pid));
      const chosen = typeof want === 'string' && free.includes(want) ? want : free[0];
      if (chosen) this.confrontTargets.set(ps.playerId, chosen);
    }
    if (!fillMates) return;
    for (const mate of this._aliveOf(team)) {
      if (this.confrontTargets.has(mate.playerId)) continue;
      const left = oppIds.filter((pid) => !takenBy(team).includes(pid));
      if (left.length) this.confrontTargets.set(mate.playerId, left[0]);
    }
  }

  /** Step 1 ends once EVERY alive player (both sides) holds a target, or its window runs out. */
  maybeFinishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    const alive = this.alivePlayers();
    if (alive.length && alive.every((p) => this.confrontTargets.has(p.playerId))) this.finishConfrontTargets();
  }

  /** Close step 1 (anyone the window caught out gets what is left) and open the FIXED step 2 window. */
  finishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    for (const ps of this.alivePlayers()) this.assignConfrontTarget(ps, null, true);
    this.setDeadline(0);
    this.confrontStage = 'monster';
    // step 2 never ends early: submitting only marks the player done, the sides stay in step until the window is up.
    // The window matches THIS round's prep (dynamic) — the same time the players had to prepare — and is always set
    // (it IS the step's only way to end, even in a single-human match).
    this.setDeadline(this.gd.prepTime(this.round) ?? VERSUS_CONFRONT.monsterSeconds, () => this.finishConfront());
    for (const ps of this.alivePlayers()) if (ps.botControlled) this.botConfront(ps);
    this.markPublic();
  }

  /** `g.confront { group, position, picks }` in step 2: the monsters a player throws at their target. */
  submitConfront(ps, { group, position, picks }) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'monster') return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.confrontSubs.has(ps.playerId)) return fail(ERR.ALREADY);
    const member = this._confrontMember(ps, group, position, picks);
    if (!member) return fail(ERR.BAD_TARGET, 'illegal 对抗期 pick');
    this.confrontSubs.set(ps.playerId, member);
    this.markPublic();
    return OK;
  }

  /**
   * Check a submission against the chosen group: every enemyKey in the group, a legal gate, a legal position, and — the
   * only cap — the combined VALUE within the round's budget (no count limit; the group's own size bounds the count).
   */
  _confrontMember(ps, group, position, picks) {
    const list = this.confrontGroups()[group - 1] || [];
    const allowed = new Set(list.map((r) => r.key));
    const arr = Array.isArray(picks) ? picks : [];
    const pos = VERSUS_CONFRONT.positions.includes(position) ? position : null;
    if (!pos) return null;
    const out = [];
    for (const p of arr) {
      if (!p || typeof p.enemyKey !== 'string' || !allowed.has(p.enemyKey)) return null;
      out.push({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' });
    }
    if (this.confrontSpent(out) > this.confrontBudget()) return null;
    return { target: this.confrontTargets.get(ps.playerId) ?? null, group, position: pos, picks: out, ratio: this.confrontRatio(), budget: this.confrontBudget(), seat: ps.seat };
  }

  /** An AI player's submission, and the one a player who never submits gets at the window's end: fill the budget from
   *  its group, most expensive fitting monster first (the client's 自动选择 button does exactly this). */
  botConfront(ps) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'monster' || this.confrontSubs.has(ps.playerId)) return;
    const groups = this.confrontGroups();
    const budget = this.confrontBudget();
    const g = (groups[groups.length - 1] || []).slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    const picks = [];
    let left = budget;
    for (const r of g) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: picks.length % 2 ? 'upper' : 'lower' });
    }
    this.confrontSubs.set(ps.playerId, { target: this.confrontTargets.get(ps.playerId) ?? null, group: groups.length, position: 'mid', picks, ratio: this.confrontRatio(), budget, seat: ps.seat });
    this.markPublic();
  }

  /** Step 2 is over (its window ran out): anyone missing a submission gets a bot one, then the battles start. */
  finishConfront() {
    if (this.phase !== PHASE.CONFRONT) return;
    this.setDeadline(0);
    for (const ps of this.alivePlayers()) if (!this.confrontSubs.has(ps.playerId)) this.botConfront(ps);
    this.confront = new Map(this.confrontSubs);
    this.confrontStage = null;
    this.startCombat();
  }

  /**
   * The interventions aimed at a player's wave (each attacker hits exactly one target, so 0 or 1 here — a list keeps it
   * safe whatever the pairing did). `null` when nothing was submitted.
   * @param {object} ps
   * @returns {object[]}
   */
  confrontFor(ps) {
    if (!this.isVersus || !this.confront || !this.confront.size) return [];
    return [...this.confront.values()].filter((s) => s && s.target === ps.playerId);
  }

  /** The template routes of the round's wave (the gates live here, not on the stage). */
  _confrontRoutes() {
    const tplId = this.wave && this.wave.templateId;
    const tpl = tplId ? this.gd.wave(tplId) : null;
    const routes = tpl && Array.isArray(tpl.routes) ? tpl.routes : [];
    const leader = !!(tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden'));
    return { routes, leader };
  }

  /** The route index a placed monster uses: the template route matching its gate AND movement, else any of its class. */
  confrontRouteFor(enemyKey, gate) {
    const en = (this.data && this.data.enemies) || {};
    const fly = !!(en[enemyKey] && en[enemyKey].isFlyEnemy);
    const { routes, leader } = this._confrontRoutes();
    if (!routes.length) return 0;
    const motionOk = (r) => (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
    const j = routes.findIndex((r) => motionOk(r) && gateOf(r.start, leader) === gate);
    if (j >= 0) return j;
    const i = routes.findIndex(motionOk);
    return i >= 0 ? i : 0;
  }

  /**
   * Replace a share of a player's original wave with one attacker's monsters:
   *   * originals worth `share × the wave value` are dropped at random (within 2 % of that value);
   *   * the placed monsters are inserted together at the chosen position (25 / 50 / 75 % of the round's monster count),
   *     each on the route matching its gate and movement.
   * @param {object[]} spawns the player's original SpawnSpecs
   * @param {{ picks: object[], position: string, ratio: number }} sub
   * @param {object} ps the TARGET player
   * @returns {object[]} the modified spawn list
   */
  applyConfront(spawns, sub, ps) {
    if (!sub || !Array.isArray(sub.picks) || !sub.picks.length || !Array.isArray(spawns) || !spawns.length) return spawns;
    const scale = this.confrontScale();
    const en = (this.data && this.data.enemies) || {};
    const valueOf = (key) => confrontValue(en[key], scale);
    const out = spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    // 1) drop originals at random until the target value is (nearly) reached
    const target = this.confrontWaveValue() * sub.ratio;
    const units = [];
    out.forEach((s, i) => {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      for (let k = 0; k < cnt; k++) units.push({ i, v: Math.max(1, valueOf(s.enemyKey)) });
    });
    // shuffle (seeded) then take what fits; the last unit is the one that closes the gap best
    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(this.rngConfront() * (i + 1));
      [units[i], units[j]] = [units[j], units[i]];
    }
    let left = target;
    const take = new Map();
    for (const u of units) {
      if (u.v > left) continue;
      left -= u.v;
      take.set(u.i, (take.get(u.i) || 0) + 1);
      if (left <= 0) break;
    }
    // 2) apply the drops by REBUILDING the list (splicing while iterating would shift the indexes under us);
    //    a spawn that loses every unit goes away
    const kept = [];
    out.forEach((s, i) => {
      const c = Math.max(1, Math.floor(Number(s.count) || 1));
      const rest = c - (take.get(i) || 0);
      if (rest > 0) kept.push(rest === c ? s : { ...s, count: rest });
    });
    // 3) the placed monsters, together at the chosen position. `confrontSeat` is DISPLAY only (the target's client
    //    outlines them and prints P<n> under them) — `sourcePlayerId` stays untouched, it drives the 联防 leak billing.
    const mods = roundMods(scale);
    const start = this._confrontInsertTime(spawns, sub.position);
    const sentBy = Number.isInteger(sub.seat) ? sub.seat : null;
    sub.picks.forEach((p, i) => {
      kept.push({
        time: start + i * 1, enemyKey: p.enemyKey, count: 1, interval: 0, routeIndex: this.confrontRouteFor(p.enemyKey, p.gate),
        mods: { ...mods }, ownerPlayerId: ps.playerId, confrontSeat: sentBy,
        // 经济补助: killing a monster the opponent placed pays its killer (the sim's bounty mechanic — the killer's
        // player, a 联防 helper included); anyone the death cannot be credited to pays the wave's owner instead.
        bounty: { coins: this.confrontBounty(p.enemyKey), ownerPlayerId: ps.playerId },
      });
    });
    return kept;
  }

  /** The insertion time of a position: walk the ORIGINAL wave by count to the 25 / 50 / 75 % mark. */
  _confrontInsertTime(spawns, position) {
    const frac = position === 'front' ? 0.25 : position === 'back' ? 0.75 : 0.5;
    const total = spawns.reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
    const mark = Math.max(1, Math.round(total * frac));
    const ordered = spawns.slice().sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    let seen = 0;
    for (const s of ordered) {
      seen += Math.max(1, Math.floor(Number(s.count) || 1));
      if (seen >= mark) return Number(s.time) || 0;
    }
    return Number(ordered.length ? ordered[ordered.length - 1].time : 0) || 0;
  }
}
