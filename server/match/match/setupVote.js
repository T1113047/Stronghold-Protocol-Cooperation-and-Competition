// INFO_CHECK full setup reroll: unanimous human consent, keeping the room and player settings.
// [ASSUMED] Remake convenience: unanimous human vote, pause/resume timer, independent reroll stream and
// a 300 ms request guard. These are not official mode rules; DESIGN §28.21.
// 2V2 ('versus', design 2026-10-17): the reroll is PER TEAM — a team rerolls only its OWN disabled core bonds (the
// stage / boss / 特训敌人 stay shared), with that team's humans' consent, and the two teams' rerolls are independent.
// Installed on Match.prototype like the other method containers. The lobby authorizes host-only actions.
import { PHASE, ERR } from '../../../shared/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { setupMatchWaves } from '../waves.js';
import { drawDisabledBonds, SharedPool } from '../pool.js';
import { OK, fail } from './common.js';

export class MatchSetupVote {
  /** The pending setup-reroll vote of a team (solo/coop: team 0). null when none. */
  _setupVoteOf(team) { return this.setupVotes ? (this.setupVotes.get(team) || null) : this.setupVote; }

  /** Any pending setup-reroll vote (the INFO_CHECK advance pauses while one is open). */
  _anySetupVote() { return this.setupVotes ? ([...this.setupVotes.values()][0] || null) : this.setupVote; }

  _setSetupVote(team, vote) {
    const prev = this._setupVoteOf(team);
    if (prev && prev !== vote && prev.timer) { this.cancel(prev.timer); prev.timer = null; }
    if (this.setupVotes) { if (vote) this.setupVotes.set(team, vote); else this.setupVotes.delete(team); }
    else this.setupVote = vote;
  }

  /** The window a reroll vote runs in when INFO_CHECK itself has no countdown left (never leave the phase unstoppable). */
  _setupVoteWindowMs() { return Math.max(5000, (Number(this.gd.timer('infoCheck')) || 25) * 1000); }

  /**
   * A human left: drop them from every pending reroll vote. A voter who cannot answer must never freeze INFO_CHECK — the
   * vote completes when everyone still in has agreed, is cancelled when nobody is left, and keeps its own timer otherwise.
   */
  _dropFromSetupVotes(playerId) {
    const teams = this.setupVotes ? [...this.setupVotes.keys()] : (this.setupVote ? [0] : []);
    for (const team of teams) {
      const vote = this._setupVoteOf(team);
      if (!vote || !vote.voters.includes(playerId)) continue;
      vote.voters = vote.voters.filter((id) => id !== playerId);
      vote.agreed.delete(playerId);
      if (!vote.voters.length) { this.cancelSetupVote(team); continue; }
      if (vote.voters.every((id) => vote.agreed.has(id))) this.completeSetupReroll(team);
    }
  }

  /** The humans whose consent a team's reroll needs (2V2: that team; solo/coop: every human). A seat with nobody at the
   *  keyboard (disconnected, or left and AI-run) does not vote. */
  _rerollHumans(team) {
    const humans = this.humans().filter((p) => p.connected !== false);
    return this.setupVotes ? humans.filter((p) => this.teamIdOf(p) === team) : humans;
  }

  requestSetupReroll(playerId, revision) {
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (revision !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup revision changed');
    const team = this.setupVotes ? this.teamIdOf(ps) : 0;
    if (this._setupVoteOf(team)) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
    const voters = this._rerollHumans(team);
    if (voters.some((p) => !p.connected)) return fail(ERR.NOT_READY, 'all humans must be connected to vote');
    const now = this.sched.now();
    if (now - this._lastSetupVoteAt < 300) return fail(ERR.RATE);
    this._lastSetupVoteAt = now;
    const ms = this.deadline > 0 ? Math.max(1, this.deadline - now) : this._setupVoteWindowMs();
    const vote = {
      id: ++this._setupVoteSeq,
      team,
      proposerId: playerId,
      voters: voters.map((p) => p.playerId),
      agreed: new Set([playerId]),
      remainingMs: ms,
    };
    this._setSetupVote(team, vote);
    this.cancel(this._infoAdvanceTimer);
    this._infoAdvanceTimer = null;
    this.setDeadline(0);
    // The vote runs in its OWN window: a voter who never answers (or disconnects) must not freeze INFO_CHECK, which is
    // left without a countdown while a vote is open.
    vote.timer = this.later(ms, () => { if (this._setupVoteOf(team) === vote) this.cancelSetupVote(team); });
    if (voters.length <= 1) return this.completeSetupReroll(team);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  voteSetupReroll(ps, voteId, agree) {
    if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const team = this.setupVotes ? this.teamIdOf(ps) : 0;
    const vote = this._setupVoteOf(team);
    if (!vote) return fail(ERR.WRONG_PHASE);
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    if (!ps.connected || !vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (!agree) { this.cancelSetupVote(team); return OK; }
    vote.agreed.add(ps.playerId);
    if (vote.voters.every((id) => vote.agreed.has(id))) return this.completeSetupReroll(team);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  cancelSetupReroll(playerId, voteId) {
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    const team = this.setupVotes ? this.teamIdOf(ps) : 0;
    const vote = this._setupVoteOf(team);
    if (!vote || vote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    this.cancelSetupVote(team);
    return OK;
  }

  cancelSetupVote(team) {
    // `team` omitted (a player left / the match is winding down): every pending vote goes
    const teams = team == null
      ? (this.setupVotes ? [...this.setupVotes.keys()] : (this.setupVote ? [0] : []))
      : [team];
    for (const t of teams) this._cancelSetupVoteOf(t);
  }

  _cancelSetupVoteOf(team) {
    const vote = this._setupVoteOf(team);
    if (!vote) return;
    this._setSetupVote(team, null);
    if (this.phase === PHASE.INFO_CHECK && !this.disposed && !this.ended && !this._anySetupVote()) {
      // A vote must never strand the briefing — and it already consumed its own window — so this goes straight in on the
      // next tick (no countdown to re-arm, no waiting for the players to re-confirm).
      this.setDeadline(0);
      this.cancel(this._infoAdvanceTimer);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this._anySetupVote()) this.enterBandDraft();
      });
      this.markPublic();
      this.flush(true);
    }
  }

  completeSetupReroll(team) {
    const versus = !!this.setupVotes;
    let prepared;
    try {
      if (versus) {
        // 2V2: reroll ONLY this team's disabled core bonds; the stage / boss / factions stay SHARED (design 2026-10-17)
        const n = (this.teamRerolls.get(team) || 0) + 1;
        const rng = createRng(deriveSeed(this.seed, `reroll-bans:${team}:${n}`));
        const bans = drawDisabledBonds(this.gd, rng, { core: 5, addon: this.gd.bans(this.gd.difficulty).addon });
        const pool = new SharedPool(this.gd, { banned: bans.banned });
        if (!pool.entries.size) throw new Error('rerolled chess pool is empty');
        const off = new Set([...bans.drawn, ...bans.staticOff]);
        const stocks = new Map();
        for (const ps of this.order) if (this.teamIdOf(ps) === team) stocks.set(ps.playerId, ps.buildDiyStock(off));
        prepared = { n, bans, pool, stocks };
      } else {
        const rng = createRng(deriveSeed(this.seed, `reroll-setup:${this.setupRevision + 1}`));
        const setup = setupMatchWaves(this.gd, rng);
        const stage = setup.stageId ? this.gd.stage(setup.stageId) : null;
        const bans = drawDisabledBonds(this.gd, rng);
        const pool = new SharedPool(this.gd, { banned: bans.banned });
        if (!pool.entries.size) throw new Error('rerolled chess pool is empty');
        const off = new Set([...bans.drawn, ...bans.staticOff]);
        const stocks = this.order.map((ps) => ps.buildDiyStock(off));
        prepared = { setup, stage, bans, pool, stocks };
      }
    } catch (e) {
      this.reportError('reroll setup', e);
      this.cancelSetupVote(team);
      return fail(ERR.INTERNAL);
    }
    // All data-dependent work succeeds before any opening or player state changes.
    if (versus) {
      const { n, bans, pool, stocks } = prepared;
      this.teamRerolls.set(team, n);
      this.teamBans.set(team, bans);
      this.pools.set(team, pool);
      for (const [pid, s] of stocks) {
        const ps = this.players.get(pid);
        if (!ps) continue;
        ps.diyStock = s.stock;
        ps.diyBanned = s.banned;
        ps.invalidateDeployMap();
        ps.infoReady = ps.botControlled;
      }
      this.setupRevision++;
      this._setSetupVote(team, null);
      this.markPublic();
      for (const ps of this.order) this.markPrivate(ps);
      this.flush(true);
      this.maybeEndInfo();
      return OK;
    }
    const { setup, stage, bans, pool, stocks } = prepared;
    this.stageId = setup.stageId;
    this.stage = stage;
    this.factions = setup.factions;
    this.bossId = setup.bossId;
    this.hiddenBossId = setup.hiddenBossId;
    this.disabledBonds = bans.drawn;
    this.staticInactiveBonds = bans.staticOff;
    this.bannedChess = bans.banned;
    this.pool = pool;
    this._botPath = null;
    for (const [i, ps] of this.order.entries()) {
      ps.diyStock = stocks[i].stock;
      ps.diyBanned = stocks[i].banned;
      ps.invalidateDeployMap();
      ps.infoReady = ps.botControlled;
    }
    this.setupRevision++;
    this.setupVote = null;
    this.enterInfoCheck();
    return OK;
  }
}
