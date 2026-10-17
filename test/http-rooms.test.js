// test/http-rooms.test.js — 运维查询接口：回环 GET /api/rooms、POST /api/rooms/reap、
// POST /api/notify 与广播帧 m.notice。非回环 peer 或带任何转发头的请求一律 404 —— 和未知道路一样，不暴露存在性。
// 独立 describe + 独立 server：房间会跨测试残留，隔离才不会有假命中。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { roomsApiAllowed, DEFAULT_REAP_IDLE_MS } from '../server/http/rooms.js';
import { MAX_SEATS } from '../shared/constants.js';

/** Raw HTTP request (the path is sent verbatim, no normalization). */
function httpReq(port, rawPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const getJson = async (port, rawPath) => JSON.parse((await httpReq(port, rawPath)).body.toString());
const postJson = (port, rawPath, obj, headers = {}) => httpReq(port, rawPath, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj),
});

/** Tracks clients per test so they are always closed. */
function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect(opts) {
      const c = await TestClient.connect(getUrl(), opts);
      open.add(c);
      return c;
    },
    /** Connect + hello; the client gets `.id` and `.token`. */
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

/**
 * A match that records its opts and does nothing else (the lobby's match interface, minimally). With `autoEnd` set,
 * start() ends it at once: the room is back in LOBBY with matchCount 1 (the reaper's `played-before` case).
 */
class RecordingMatch {
  constructor(opts) { this.opts = opts; RecordingMatch.last = this; }
  start() { if (RecordingMatch.autoEnd) this.opts.onEnd({ autoEnded: true }); }
  handle() { return { ok: true }; }
  onDisconnect() {}
  onReconnect() {}
  onLeave() {}
  dispose() {}
}
RecordingMatch.autoEnd = false;

const captureLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};

// ---------------------------------------------------------------------------------------------------
// the loopback test (pure, no server)
// ---------------------------------------------------------------------------------------------------

describe('运维接口：回环判定 (roomsApiAllowed)', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

  test('only a loopback peer without any forwarding header passes', () => {
    assert.equal(roomsApiAllowed(req('127.0.0.1')), true);
    assert.equal(roomsApiAllowed(req('::1')), true);
    assert.equal(roomsApiAllowed(req('::ffff:127.0.0.1')), true, 'a dual-stack listener maps the v4 peer');
    assert.equal(roomsApiAllowed(req('127.0.0.2')), false);
    assert.equal(roomsApiAllowed(req('10.0.0.5')), false, 'a LAN peer is not the bot on this host');
    assert.equal(roomsApiAllowed(req('::ffff:10.0.0.5')), false);
    assert.equal(roomsApiAllowed(req(undefined)), false);
    for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'cf-connecting-ip']) {
      assert.equal(roomsApiAllowed(req('127.0.0.1', { [h]: '1.2.3.4' })), false, `${h} refuses the request`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// the wired server
// ---------------------------------------------------------------------------------------------------

describe('运维查询接口 (GET /api/rooms · POST /api/rooms/reap · POST /api/notify)', () => {
  let srv;
  let pool;
  let chatLogTmp;
  const cap = captureLog();

  before(async () => {
    // The lobby writes one chat log per match (server/chatlog.js): keep the test artifacts out of the repo tree.
    chatLogTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rooms-'));
    process.env.CHAT_LOG_DIR = chatLogTmp;
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => {
    await pool.closeAll();
    RecordingMatch.autoEnd = false;
  });
  after(async () => {
    await srv?.close();
    delete process.env.CHAT_LOG_DIR;
    try { fs.rmSync(chatLogTmp, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('GET /api/rooms 回环返回快照：机器人要的字段都在，刚建的房间可见', async () => {
    const host = await pool.player('Host');
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.mode === 'coop' && s.hostId === host.id);

    const res = await httpReq(srv.port, '/api/rooms');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^application\/json/);
    const payload = JSON.parse(res.body.toString());
    assert.equal(payload.ok, true);
    assert.equal(payload.count, payload.rooms.length);
    const room = payload.rooms.find((r) => r.code === state.code);
    assert.ok(room, `the room ${state.code} is listed`);
    assert.equal(room.mode, 'coop');
    assert.equal(room.difficulty, 'NORMAL');
    assert.equal(room.matchmake, true, 'matchmake is reported');
    assert.equal(room.inMatch, false);
    assert.equal(room.round, 0);
    assert.equal(room.matchCount, 0);
    assert.equal(room.humans, 1);
    assert.equal(room.bots, 0);
    assert.equal(room.seats, MAX_SEATS);
    assert.deepEqual(room.players, ['Host']);
  });

  test('2V2 房：matchmake 反映房主开关，AI 席计入 bots', async () => {
    const host = await pool.player('VHost');
    assert.equal((await host.request({ t: 'room.create', mode: 'versus', difficulty: 'ABYSS' })).t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.mode === 'versus');
    assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
    assert.equal((await host.request({ t: 'room.matchmake', on: false })).t, 'ok');
    await host.waitFor('room.state', (s) => s.matchmake === false);

    const room = (await getJson(srv.port, '/api/rooms')).rooms.find((r) => r.code === state.code);
    assert.equal(room.matchmake, false, 'the host closed the room to quick-match');
    assert.equal(room.bots, 1);
    assert.equal(room.humans, 1);
    assert.equal(room.seats, MAX_SEATS);
  });

  test('带任何转发头的请求和未知道路一样 404（不暴露存在性）', async () => {
    for (const headers of [{ 'x-forwarded-for': '1.2.3.4' }, { 'x-real-ip': '1.2.3.4' }, { forwarded: 'for=1.2.3.4' }]) {
      const h = JSON.stringify(headers);
      assert.equal((await httpReq(srv.port, '/api/rooms', { headers })).status, 404, `GET /api/rooms ${h}`);
      // POST without a body: the refusal comes before any body would be read (an unread body resets the socket)
      assert.equal((await httpReq(srv.port, '/api/rooms/reap', { method: 'POST', headers })).status, 404, `reap ${h}`);
      assert.equal((await httpReq(srv.port, '/api/notify', { method: 'POST', headers })).status, 404, `notify ${h}`);
    }
    assert.equal((await httpReq(srv.port, '/api/nope')).status, 404, 'an unknown path answers the same 404');
    // the reaper is POST-only: a GET never sweeps the lobby (405, not a destructive 200)
    const getReap = await httpReq(srv.port, '/api/rooms/reap');
    assert.equal(getReap.status, 405);
    assert.equal(getReap.headers.allow, 'POST');
  });

  test('POST /api/rooms/reap 收掉待开始房，正在对局的房不回在 reaped 里', async () => {
    const idler = await pool.player('Idler');
    assert.equal((await idler.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const idle = await idler.waitFor('room.state', (s) => s.mode === 'coop');

    const fighter = await pool.player('Fighter');
    assert.equal((await fighter.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const fight = await fighter.waitFor('room.state', (s) => s.mode === 'coop');
    assert.equal((await fighter.request({ t: 'room.start' })).t, 'ok');
    await fighter.waitFor('room.state', (s) => s.inMatch === true);

    const res = await postJson(srv.port, '/api/rooms/reap', { codes: [idle.code, fight.code], minIdleMs: 0 });
    assert.equal(res.status, 200);
    const out = JSON.parse(res.body.toString());
    assert.deepEqual(out.reaped.map((r) => r.code), [idle.code], 'only the lobby room was taken');
    assert.ok(out.kept.some((k) => k.code === fight.code && k.why === 'in-match'), 'the running match was kept');

    // the reaped room told its member (the lobby's own path) and is gone from the snapshot
    assert.equal((await idler.waitFor('room.closed')).reason, 'expired');
    const after = await getJson(srv.port, '/api/rooms');
    assert.equal(after.rooms.some((r) => r.code === idle.code), false);
    assert.equal(after.rooms.some((r) => r.code === fight.code), true);
  });

  test('dryRun 只分类不动手；默认 minIdleMs 不碰新房间', async () => {
    const c = await pool.player('Dry');
    assert.equal((await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const state = await c.waitFor('room.state', (s) => s.mode === 'coop');

    const dry = JSON.parse((await postJson(srv.port, '/api/rooms/reap', { codes: [state.code], minIdleMs: 0, dryRun: true })).body.toString());
    assert.deepEqual(dry.reaped.map((r) => r.code), [state.code]);
    assert.equal((await getJson(srv.port, '/api/rooms')).rooms.some((r) => r.code === state.code), true, 'dryRun disposed nothing');
    await c.expectNone('room.closed');

    // a sweep with no codes keeps a room younger than the default; a nonsense minIdleMs falls back to it
    const sweep = JSON.parse((await postJson(srv.port, '/api/rooms/reap', {})).body.toString());
    assert.equal(sweep.minIdleMs, DEFAULT_REAP_IDLE_MS);
    assert.deepEqual(sweep.reaped, []);
    const nonsense = JSON.parse((await postJson(srv.port, '/api/rooms/reap', { minIdleMs: 0 })).body.toString());
    assert.equal(nonsense.minIdleMs, DEFAULT_REAP_IDLE_MS, 'a code-less sweep never means "no waiting"');
    assert.deepEqual(nonsense.reaped, []);
  });

  test('打过一局的房不算死房（includePlayed 才收）', async () => {
    RecordingMatch.autoEnd = true;
    const c = await pool.player('Played');
    assert.equal((await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const state = await c.waitFor('room.state', (s) => s.mode === 'coop');
    assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
    await c.waitFor('room.state', (s) => s.inMatch === false); // the match ended at once (autoEnd)
    RecordingMatch.autoEnd = false;

    const kept = JSON.parse((await postJson(srv.port, '/api/rooms/reap', { codes: [state.code], minIdleMs: 0 })).body.toString());
    assert.deepEqual(kept.reaped, []);
    assert.ok(kept.kept.some((k) => k.code === state.code && k.why === 'played-before'));

    const forced = JSON.parse((await postJson(srv.port, '/api/rooms/reap', { codes: [state.code], minIdleMs: 0, includePlayed: true })).body.toString());
    assert.deepEqual(forced.reaped.map((r) => r.code), [state.code]);
    assert.equal((await c.waitFor('room.closed')).reason, 'expired');
  });

  test('POST /api/notify 回环：所有连接都收到 m.notice（清洗 + 200 字截断）', async () => {
    const a = await pool.player('Ann1');
    const b = await pool.player('Ann2');
    assert.equal((await b.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    await b.waitFor('room.state', (s) => s.mode === 'coop');

    const res = await postJson(srv.port, '/api/notify', { text: `  \u0007服务器维护\u0008 ${'x'.repeat(260)}  ` });
    assert.equal(res.status, 200);
    const out = JSON.parse(res.body.toString());
    assert.equal(out.ok, true);
    assert.equal(out.sent, 2, 'both open sockets were written to');

    // a lobby connection and a room connection alike
    for (const c of [a, b]) {
      const notice = await c.waitFor('m.notice');
      assert.ok(notice.text.startsWith('服务器维护 '), `cleaned text: ${notice.text.slice(0, 16)}`);
      assert.equal([...notice.text].length, 200, 'truncated to 200 code points');
      assert.doesNotMatch(notice.text, /[\u0000-\u001f\u007f-\u009f]/, 'control characters stripped');
    }
  });

  test('POST /api/notify 拒绝空文本与坏 body', async () => {
    assert.equal((await postJson(srv.port, '/api/notify', { text: '   ' })).status, 400);
    assert.equal((await postJson(srv.port, '/api/notify', {})).status, 400);
    const bad = await httpReq(srv.port, '/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.body.toString()).error, 'bad-body');
  });
});
