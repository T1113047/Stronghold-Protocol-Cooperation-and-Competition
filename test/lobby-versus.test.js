// test/lobby-versus.test.js — 2V2 ('versus') foundation: the room mode, the seat→team mapping and the `team` field the
// lobby hands to the match. The competition mechanic itself (对抗期 / 胜负判定) is not implemented yet.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, MAX_SEATS, TEAMS, TEAM_SIZE, teamOfSeat } from '../shared/constants.js';

/** Tracks clients per test so they are always closed. */
function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect(opts) {
      const c = await TestClient.connect(getUrl(), opts);
      open.add(c);
      return c;
    },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      c.welcome = w;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}

/** A match that records its opts and does nothing else (the lobby's match interface, minimally). */
class RecordingMatch {
  constructor(opts) { this.opts = opts; RecordingMatch.last = this; }
  start() {}
  handle() { return { ok: true }; }
  onDisconnect() {}
  onReconnect() {}
  onLeave() {}
  dispose() {}
}

const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
const captureLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};

describe('teamOfSeat (pure)', () => {
  test('seats 0,1 → team 0 and seats 2,3 → team 1', () => {
    assert.equal(TEAM_SIZE, 2);
    assert.equal(TEAMS, 2);
    assert.deepEqual([0, 1, 2, 3].map(teamOfSeat), [0, 0, 1, 1]);
  });
});

describe('lobby: 2V2 (versus) rooms', () => {
  let srv;
  let pool;
  const cap = captureLog();

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('room.create accepts "versus"; room.state carries teams + per-seat team', async () => {
    const c = await pool.player('Host');
    const r = await c.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok', JSON.stringify(r));
    const state = await c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === 'versus');
    assert.equal(state.teams, TEAMS);
    assert.equal(seatOf(state, c.id).team, 0, 'the host takes seat 0 → team 0');
    assert.equal(state.seats.length, MAX_SEATS);
  });

  test('a vs room with three AI teammates fills both teams (0,0,1,1)', async () => {
    const c = await pool.player('Host');
    await c.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' });
    await c.waitFor('room.state', (s) => s.mode === 'versus');
    for (let i = 0; i < 3; i++) {
      assert.equal((await c.request({ t: 'room.addBot' })).t, 'ok');
    }
    const state = await c.waitFor('room.state', (s) => s.seats.filter(Boolean).length === MAX_SEATS);
    assert.deepEqual(state.seats.map((s) => s.team), [0, 0, 1, 1]);
    assert.deepEqual(state.seats.map((s) => s.isBot), [false, true, true, true]);
  });

  test('room.start hands the match seats with their team', async () => {
    const c = await pool.player('Host');
    await c.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' });
    await c.waitFor('room.state', (s) => s.mode === 'versus');
    for (let i = 0; i < 3; i++) await c.request({ t: 'room.addBot' });
    await c.waitFor('room.state', (s) => s.seats.filter(Boolean).length === MAX_SEATS);
    assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
    const opts = RecordingMatch.last.opts;
    assert.equal(opts.mode, 'versus');
    assert.deepEqual(opts.seats.map((s) => s.team), [0, 0, 1, 1]);
    // the versus room reuses the MULTI tuning (data/config.json is generated; the versus deltas are code-side)
    assert.ok(String(opts.modeId).startsWith('mode_multi_'), opts.modeId);
  });

  test('co-op rooms keep their exact old shape (no team / teams fields)', async () => {
    const c = await pool.player('Host');
    await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const state = await c.waitFor('room.state', (s) => s.mode === 'coop');
    assert.equal(state.teams, undefined);
    assert.equal('team' in seatOf(state, c.id), false);
  });

  test('an unknown mode is rejected', async () => {
    const c = await pool.player('Host');
    await c.hello('Host');
    const r = await c.request({ t: 'room.create', mode: 'brawl', difficulty: 'NORMAL' });
    assert.equal(r.t, 'error');
    assert.equal(r.code, ERR.BAD_MSG);
  });

  test('room.swapSeats moves a player between the teams (the host only)', async () => {
    const c = await pool.player('Host');
    await c.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' });
    await c.waitFor('room.state', (s) => s.mode === 'versus');
    await c.request({ t: 'room.addBot' }); // seat 1, team 0
    await c.waitFor('room.state', (s) => s.seats.filter(Boolean).length === 2);
    // seat 0 (host, team 0) ↔ seat 2 (empty, team 1): the host changes team
    assert.equal((await c.request({ t: 'room.swapSeats', a: 0, b: 2 })).t, 'ok');
    const state = await c.waitFor('room.state', (s) => s.seats[2]?.playerId === c.id);
    assert.equal(seatOf(state, c.id).team, 1, 'the team follows the seat index');
    assert.equal(state.seats[0], null);
    assert.deepEqual(state.seats.map((s) => (s ? s.team : null)), [null, 0, 1, null]);
  });

  test('room.swapSeats is refused for a non-host and outside a 2V2 room', async () => {
    const host = await pool.player('Host');
    await host.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.mode === 'versus');
    const guest = await pool.player('Guest');
    await guest.request({ t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.code === st.code && s.seats.some((x) => x?.playerId === guest.id));
    const notHost = await guest.request({ t: 'room.swapSeats', a: 0, b: 1 });
    assert.equal(notHost.t, 'error');
    assert.equal(notHost.code, ERR.NOT_HOST);

    const coop = await pool.player('Other');
    await coop.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await coop.waitFor('room.state', (s) => s.mode === 'coop');
    const bad = await coop.request({ t: 'room.swapSeats', a: 0, b: 1 });
    assert.equal(bad.t, 'error');
    assert.equal(bad.code, ERR.BAD_TARGET);
  });
});
