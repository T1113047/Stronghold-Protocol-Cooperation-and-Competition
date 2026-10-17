// test/lobby-matchmake.test.js — 快速匹配（移植自服务服 server_patches/matchmake）：房主开关本房是否对外开放
// （room.matchmake，room.state 回显），以及 room.quickmatch 把玩家放进「同难度、已开放、未开局、有空座、房主在线」
// 的最佳房间（人多优先 → 已占座优先 → 等最久优先）；没有房间就 ROOM_NOT_FOUND，绝不自动建房。
// 独立 describe + 独立 server：房间会跨测试残留，隔离才不会有假命中。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, MAX_SEATS } from '../shared/constants.js';

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

const captureLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};

/** Create a room of `mode`/`difficulty` and return { client, state }. */
const makeRoom = async (pool, name, mode, difficulty) => {
  const c = await pool.player(name);
  assert.equal((await c.request({ t: 'room.create', mode, difficulty })).t, 'ok');
  const state = await c.waitFor('room.state', (s) => s.mode === mode && s.hostId === c.id);
  return { c, state };
};

describe('lobby: 快速匹配 (matchmake)', () => {
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

  test('a room is open by default and only its HOST may close it', async () => {
    const { c: host, state } = await makeRoom(pool, 'Host', 'versus', 'NORMAL');
    assert.equal(state.matchmake, true, 'open by default');
    // a guest cannot toggle it
    const guest = await pool.player('Guest');
    assert.equal((await guest.request({ t: 'room.join', code: state.code })).t, 'ok');
    const denied = await guest.request({ t: 'room.matchmake', on: false });
    assert.equal(denied.t, 'error');
    assert.equal(denied.code, ERR.NOT_HOST);
    // the host can, and every member's room.state mirrors it
    assert.equal((await host.request({ t: 'room.matchmake', on: false })).t, 'ok');
    assert.equal((await host.waitFor('room.state', (s) => s.matchmake === false)).matchmake, false);
    assert.equal((await guest.waitFor('room.state', (s) => s.matchmake === false)).matchmake, false);
  });

  test('a solo room cannot be opened to matchmaking', async () => {
    const c = await pool.player('Solo');
    await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    await c.waitFor('room.state', (s) => s.mode === 'solo');
    const r = await c.request({ t: 'room.matchmake', on: true });
    assert.equal(r.t, 'error');
  });

  test('quickmatch joins the best open room: more humans first, a closed room is ignored', async () => {
    // one CLOSED room of the same difficulty must never be picked
    const { c: closedHost, state: closedState } = await makeRoom(pool, 'ClosedHost', 'versus', 'NORMAL');
    await closedHost.request({ t: 'room.matchmake', on: false });
    await closedHost.waitFor('room.state', (s) => s.matchmake === false);

    // two open rooms: the one with more humans wins
    const { c: h1, state: s1 } = await makeRoom(pool, 'H1', 'versus', 'NORMAL');
    const g1 = await pool.player('G1');
    assert.equal((await g1.request({ t: 'room.join', code: s1.code })).t, 'ok');
    await h1.waitFor('room.state', (s) => s.seats.filter((x) => x && !x.isBot).length === 2);
    await makeRoom(pool, 'H2', 'versus', 'NORMAL'); // one human only

    const seeker = await pool.player('Seeker');
    assert.equal((await seeker.request({ t: 'room.quickmatch', difficulty: 'NORMAL' })).t, 'ok');
    const joined = await seeker.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === seeker.id));
    assert.equal(joined.code, s1.code, 'the room with more humans won');
    assert.notEqual(joined.code, closedState.code, 'the closed room was skipped');
    assert.ok(joined.seats.length === MAX_SEATS);
  });

  test('quickmatch with nothing open answers ROOM_NOT_FOUND and creates no room', async () => {
    const seeker = await pool.player('Alone');
    const r = await seeker.request({ t: 'room.quickmatch', difficulty: 'ABYSS' });
    assert.equal(r.t, 'error');
    assert.equal(r.code, ERR.ROOM_NOT_FOUND);
    // still in no room: the lobby never auto-creates (room.state has no room)
    assert.equal(seeker.room, undefined);
  });
});
