// test/achievement.test.js — [ACH] 成就评分 / 棋子分档 / [ACH-STORE] 服务端权威。
//
// 覆盖：
//   * 评分边界：未通关 5/6/9/10/11/12 回合；各难度通关；通关 + 隐藏；未知难度。
//   * pieceOf 分档：0/9 车 · 10/29 马 · 30/59 象 · 60/99 后 · 100+ 王。
//   * 记录解析：scoreRecord 读自己那一行 / 隐藏标记；scoreStats 容错。
//   * 成就库：sanitizeRecord 校验、同 id 去重 / 冲突、scoreOf 缓存失效。
//   * 服务端权威：绑定账号忽略 player.ach 上报；游客上报生效；绑定但库里没记录时回退上报（标注的降级）。
//   * 回环 GET /api/records?qq=：只读、仅回环（带转发头 → 404）、POST → 405。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  scoreMatch, scoreRecord, scoreStats, pieceOf, PIECE_TIERS,
  CLEAR_POINTS, CLEAR_HIDDEN_POINTS, FAIL_BRACKETS,
} from '../shared/achievement.js';
import { sanitizeRecord, scoreRecords } from '../server/records.js';
import { createRecordStore } from '../server/recordStore.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { deriveKeyBytes, encryptPayload } from '../shared/accountCrypto.js';

// ---------------------------------------------------------------------------------------------------
// pure scoring
// ---------------------------------------------------------------------------------------------------

describe('[ACH] 评分规则', () => {
  test('未通关：按回合数 6–9 → +1 / 10–11 → +2 / ≥12 → +3，不足 6 → 0', () => {
    const fail = (rounds) => scoreMatch({ difficulty: 'NORMAL', victory: false, hidden: false, rounds });
    assert.equal(fail(0), 0);
    assert.equal(fail(5), 0, '5 回合失败不给分');
    assert.equal(fail(6), 1, '6 回合是 +1 的下界');
    assert.equal(fail(9), 1, '9 回合仍是 +1');
    assert.equal(fail(10), 2, '10 回合进 +2');
    assert.equal(fail(11), 2, '11 回合仍是 +2');
    assert.equal(fail(12), 3, '12 回合进 +3');
    assert.equal(fail(30), 3, '≥12 一律 +3');
  });

  test('未通关的分档与难度无关（ABYSS 失败同样按回合数）', () => {
    for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
      assert.equal(scoreMatch({ difficulty, victory: false, rounds: 10 }), 2, difficulty);
    }
  });

  test('通关：FUNNY +3 / NORMAL +4 / HARD +5 / ABYSS 同绝境 +5；未知难度 0', () => {
    assert.equal(scoreMatch({ difficulty: 'FUNNY', victory: true }), 3);
    assert.equal(scoreMatch({ difficulty: 'NORMAL', victory: true }), 4);
    assert.equal(scoreMatch({ difficulty: 'HARD', victory: true }), 5);
    assert.equal(scoreMatch({ difficulty: 'ABYSS', victory: true }), 5);
    assert.equal(scoreMatch({ difficulty: 'UNKNOWN', victory: true }), 0);
    assert.equal(scoreMatch({ victory: true }), 0, '没有难度不给分');
  });

  test('通关且隐藏：NORMAL +5 / HARD +7 / ABYSS +7；FUNNY 无隐藏加成', () => {
    assert.equal(scoreMatch({ difficulty: 'NORMAL', victory: true, hidden: true }), 5);
    assert.equal(scoreMatch({ difficulty: 'HARD', victory: true, hidden: true }), 7);
    assert.equal(scoreMatch({ difficulty: 'ABYSS', victory: true, hidden: true }), 7);
    assert.equal(scoreMatch({ difficulty: 'FUNNY', victory: true, hidden: true }), 3);
    // 隐藏 + 没通关：仍按回合数
    assert.equal(scoreMatch({ difficulty: 'HARD', victory: false, hidden: true, rounds: 12 }), 3);
  });

  test('导出的表就是规则本身（评分表与分档可核对）', () => {
    assert.deepEqual({ ...CLEAR_POINTS }, { FUNNY: 3, NORMAL: 4, HARD: 5, ABYSS: 5 });
    assert.deepEqual({ ...CLEAR_HIDDEN_POINTS }, { NORMAL: 5, HARD: 7, ABYSS: 7 });
    assert.deepEqual(FAIL_BRACKETS.map(([min, pts]) => [min, pts]), [[12, 3], [10, 2], [6, 1]]);
  });

  test('scoreRecord：读自己那一行（selfId），隐藏任一标记都算隐藏', () => {
    const rec = (over = {}) => ({
      id: 'r1.x', difficulty: 'HARD', victory: true, roundsPassed: 12, selfId: 'p2',
      players: [
        { playerId: 'p1', victory: false, roundsPassed: 3 },
        { playerId: 'p2', victory: true, roundsPassed: 1 },
      ], ...over,
    });
    assert.equal(scoreRecord(rec()), 5, 'HARD 通关 +5（自己那一行赢）');
    assert.equal(scoreRecord(rec({ hiddenReached: true })), 7);
    assert.equal(scoreRecord(rec({ hiddenCleared: true })), 7);
    assert.equal(scoreRecord(rec({ players: [{ playerId: 'p2', victory: false, roundsPassed: 11 }] })), 2, '自己输了：按自己的回合数');
    assert.equal(scoreRecord(rec({ players: [{ playerId: 'p1', isBot: true, victory: false, roundsPassed: 4 }, { playerId: 'p9', victory: false, roundsPassed: 12 }] })), 3, 'selfId 不在时取真人行');
    assert.equal(scoreRecord(null), 0);
  });

  test('scoreStats：坏 JSON / 空值 → 0，否则逐条求和', () => {
    assert.equal(scoreStats(null), 0);
    assert.equal(scoreStats(''), 0);
    assert.equal(scoreStats('not json'), 0);
    assert.equal(scoreStats('{"v":1}'), 0);
    const rec = { id: 'a', difficulty: 'NORMAL', victory: true, selfId: 'p', players: [{ playerId: 'p', victory: true, roundsPassed: 1 }] };
    assert.equal(scoreStats(JSON.stringify({ v: 1, records: [rec] })), 4);
    assert.equal(scoreStats(JSON.stringify({ v: 1, records: [rec, rec] })), 8);
  });

  test('pieceOf：♜0–9 / ♞10–29 / ♝30–59 / ♛60–99 / ♚100+', () => {
    const at = (n) => pieceOf(n).id;
    assert.equal(at(0), 'rook');
    assert.equal(at(9), 'rook');
    assert.equal(at(10), 'knight');
    assert.equal(at(29), 'knight');
    assert.equal(at(30), 'bishop');
    assert.equal(at(59), 'bishop');
    assert.equal(at(60), 'queen');
    assert.equal(at(99), 'queen');
    assert.equal(at(100), 'king');
    assert.equal(at(1e6), 'king');
    assert.equal(at(-5), 'rook', '负数按 0 处理');
    assert.equal(pieceOf(NaN).id, 'rook', '非数值按 0 处理');
    assert.deepEqual(PIECE_TIERS.map((p) => p.glyph), ['\u265A', '\u265B', '\u265D', '\u265E', '\u265C']);
    assert.equal(pieceOf(42).color, '#b6a87f');
  });
});

// ---------------------------------------------------------------------------------------------------
// record store (pure, temp dir)
// ---------------------------------------------------------------------------------------------------

const record = (over = {}) => ({
  id: 'r1.abc', v: 1, t: Date.now() - 60_000, end: 'settled', victory: true, roundsPassed: 5,
  lastRound: 5, hiddenReached: false, hiddenCleared: false, reason: 'cleared',
  modeId: 'hunt_single_normal', difficulty: 'NORMAL', roomMode: 'solo', durationMs: 600_000,
  selfId: 'p1', players: [{ playerId: 'p1', seat: 0, alive: true, victory: true, roundsPassed: 5 }],
  ...over,
});

describe('[ACH-STORE] 成就库', () => {
  let tmp;
  let store;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ach-'));
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

  const fresh = () => createRecordStore({ dir: path.join(tmp, `s${Math.random().toString(16).slice(2)}`), log: { info() {}, warn() {}, error() {}, debug() {} } });

  test('sanitizeRecord：必须有 id / 合法时间 / 玩家行 / modeId，越界回合被拒', () => {
    assert.ok(sanitizeRecord(record()), '合法记录通过');
    assert.equal(sanitizeRecord({ ...record(), id: '' }), null, '无 id');
    assert.equal(sanitizeRecord({ ...record(), t: 0 }), null, 't 太早');
    assert.equal(sanitizeRecord({ ...record(), t: Date.now() + 3_600_000 }), null, 't 在未来');
    assert.equal(sanitizeRecord({ ...record(), players: [] }), null, '没有玩家行');
    assert.equal(sanitizeRecord({ ...record(), modeId: '' }), null, '无 modeId');
    assert.equal(sanitizeRecord({ ...record(), players: [{ playerId: 'p1', victory: true, roundsPassed: 500 }] }), null, '自己那一行回合数越界');
    assert.equal(sanitizeRecord('nope'), null);
    const rec = sanitizeRecord(record({ difficulty: 'WHATEVER' }));
    assert.equal(rec.difficulty, null, '未知难度保留为 null（0 分）');
    assert.equal(rec.compact, true);
    assert.equal(rec.players.length, 1, '只留自己那一行');
  });

  test('merge：按 id 去重、同 id 不同结果进冲突、分数缓存失效', () => {
    store = fresh();
    const qq = '123456';
    assert.equal(store.has(qq), false);
    assert.equal(store.scoreOf(qq), 0);

    assert.equal(store.merge(qq, [record()]).accepted, 1);
    assert.equal(store.has(qq), true);
    assert.equal(store.scoreOf(qq), 4, 'NORMAL 通关 +4');

    const dup = store.merge(qq, [record()]);
    assert.deepEqual([dup.accepted, dup.duplicated, dup.rejected], [0, 1, 0], '同 id 同投影 = 重复');

    const changed = store.merge(qq, [record({ victory: false, roundsPassed: 12, players: [{ playerId: 'p1', seat: 0, alive: false, victory: false, roundsPassed: 12 }] })]);
    assert.equal(changed.accepted, 0);
    assert.equal(store.recordsOf(qq).length, 1, '冲突不改云端版');
    assert.equal(store.scoreOf(qq), 4, '冲突未裁决前分数不变');
    assert.ok(store.conflictsOf(qq)['r1.abc'], '冲突被暂存');

    assert.equal(store.resolve(qq, 'r1.abc', 'local').ok, true);
    assert.equal(store.scoreOf(qq), 3, '保留本地版后按其评分（12 回合失败 +3）');

    assert.equal(store.merge(qq, [record({ id: 'r1.def', difficulty: 'HARD', hiddenCleared: true })]).accepted, 1);
    assert.equal(store.scoreOf(qq), 10, '3 + HARD 隐藏 7');
    assert.equal(scoreRecords(store.recordsOf(qq)), 10);
    store.flush();
  });

  test('落盘后重新打开能读到同一份分数（records/<qq>.json）', () => {
    const dir = path.join(tmp, 'reload');
    const a = createRecordStore({ dir, log: { info() {}, warn() {}, error() {}, debug() {} } });
    a.merge('654321', [record({ id: 'r1.reload', difficulty: 'ABYSS', hiddenCleared: true })]);
    a.flush();
    const b = createRecordStore({ dir, log: { info() {}, warn() {}, error() {}, debug() {} } });
    assert.equal(b.scoreOf('654321'), 7, 'ABYSS 通关 + 隐藏 +7');
    assert.equal(b.metaOf('654321').count, 1);
  });
});

// ---------------------------------------------------------------------------------------------------
// wired server: authoritative score + loopback records API
// ---------------------------------------------------------------------------------------------------

/** A match that does nothing (the lobby's minimal match interface). */
class RecordingMatch {
  constructor(opts) { this.opts = opts; }
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

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() {
      const c = await TestClient.connect(getUrl());
      open.add(c);
      return c;
    },
    async hello(name, extra = {}) {
      const c = await this.connect();
      const w = await c.hello(name, undefined, extra);
      c.id = w.playerId;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}

function httpReq(port, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('[ACH] 房间徽章：服务端权威 / 游客上报 / 回环记录查询', () => {
  let srv;
  let pool;
  let tmp;
  const cap = captureLog();

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ach-srv-'));
    srv = await startServer({
      port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch,
      accounts: { dir: path.join(tmp, 'account'), keyDir: path.join(tmp, 'key') },
      records: { dir: path.join(tmp, 'records') },
    });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  /** Bind a QQ through the account store (the group bot's loopback path in production). */
  const bind = (qq, nickname) => {
    const { code } = srv.accounts.newCode(() => {});
    const r = srv.accounts.confirm(code, qq, nickname);
    assert.equal(r.ok, true);
    return srv.accounts.accountOf(qq);
  };

  /** Create a room and return my seat from the first room.state. */
  const roomSeatOf = async (client, mode = 'coop') => {
    assert.equal((await client.request({ t: 'room.create', mode, difficulty: 'NORMAL' })).t, 'ok');
    const state = await client.waitFor('room.state', (s) => s.hostId === client.id);
    return state.seats.find((s) => s && s.playerId === client.id);
  };

  test('已绑定账号：服务端按成就库求和，忽略 player.ach 上报分', async () => {
    const qq = '100001';
    const acc = bind(qq, 'Bound');
    srv.records.merge(qq, [
      record({ id: 'r1.bound1', difficulty: 'NORMAL', victory: true, hiddenCleared: false, selfId: 'p1' }),
      record({ id: 'r1.bound2', difficulty: 'HARD', victory: true, hiddenCleared: true, selfId: 'p1' }),
    ]);
    assert.equal(srv.records.scoreOf(qq), 11, 'NORMAL 4 + HARD 隐藏 7');

    const c = await pool.hello('Bound', { account: acc.token });
    assert.equal((await c.request({ t: 'player.ach', score: 999 })).t, 'ok');
    const seat = await roomSeatOf(c);
    assert.equal(seat.ach, 11, '上报的 999 被忽略，取服务端权威 11');
  });

  test('游客：客户端上报分生效（含 0 与徽章分档）', async () => {
    const guest = await pool.hello('Guest');
    assert.equal((await guest.request({ t: 'player.ach', score: 42 })).t, 'ok');
    const seat = await roomSeatOf(guest);
    assert.equal(seat.ach, 42);
    assert.equal(pieceOf(seat.ach).id, 'bishop', '42 → 象');

    const zero = await pool.hello('Zero');
    await zero.request({ t: 'player.ach', score: 0 });
    const zeroSeat = await roomSeatOf(zero);
    assert.equal(zeroSeat.ach, 0, '0 分也显示（♜）');
    assert.equal(pieceOf(0).id, 'rook');
  });

  test('绑定账号但成就库还没有记录：回退客户端上报（缺数据时的降级，代码里已标注）', async () => {
    const acc = bind('100002', 'Empty');
    const c = await pool.hello('Empty', { account: acc.token });
    await c.request({ t: 'player.ach', score: 5 });
    const seat = await roomSeatOf(c);
    assert.equal(seat.ach, 5, '没有权威记录时用上报分，不显示 0');
  });

  test('account.records（密文）上报 → 成就库写入 → 房间徽章改按权威分并广播', async () => {
    const qq = '100003';
    const acc = bind(qq, 'Uploader');
    const c = await pool.hello('Uploader', { account: acc.token });
    assert.equal((await c.request({ t: 'player.ach', score: 99 })).t, 'ok');
    const seat = await roomSeatOf(c);
    assert.equal(seat.ach, 99, '上传前：回退上报分');

    const key = await deriveKeyBytes(qq, srv.accounts.salt());
    const enc = await encryptPayload(JSON.stringify({ records: [record({ id: 'r1.upload', difficulty: 'ABYSS', victory: true, hiddenCleared: true })] }), key);
    const ack = await c.request({ t: 'account.records', enc });
    assert.equal(ack.t, 'ok');
    assert.equal(ack.accepted, 1);

    // notifyAch re-broadcasts the room state; the badge now reads the server score
    const updated = await c.waitFor('room.state', (s) => (s.seats.find((x) => x && x.playerId === c.id) || {}).ach === 7);
    assert.equal(updated.seats.find((x) => x && x.playerId === c.id).ach, 7, 'ABYSS 隐藏 +7 覆盖上报的 99');
    assert.equal(srv.records.has(qq), true);
  });

  test('account.records：未绑定的会话被拒；AI 座位没有徽章', async () => {
    const guest = await pool.hello('NoBind');
    const r = await guest.request({ t: 'account.records', records: [record({ id: 'r1.nobind' })] });
    assert.equal(r.t, 'error');
    assert.equal(r.detail, 'not bound'); // 未绑定先于明文检查

    const host = await pool.hello('Bots');
    await host.request({ t: 'player.ach', score: 3 });
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    const bot = state.seats.find((x) => x && x.isBot);
    assert.equal(bot.ach, null, 'AI 不参与成就徽章');
  });

  test('回环 GET /api/records?qq= 返回汇总与棋子档；只读、仅回环', async () => {
    const qq = '100004';
    srv.records.merge(qq, [record({ id: 'r1.api1', difficulty: 'NORMAL', victory: true }), record({ id: 'r1.api2', difficulty: 'NORMAL', victory: false, roundsPassed: 12, players: [{ playerId: 'p1', seat: 0, alive: false, victory: false, roundsPassed: 12 }] })]);

    const res = await httpReq(srv.port, `/api/records?qq=${qq}&limit=1`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body.toString());
    assert.equal(body.ok, true);
    assert.equal(body.qq, qq);
    assert.equal(body.count, 2);
    assert.equal(body.score, 7, '4 + 3');
    assert.equal(body.piece.id, 'rook');
    assert.equal(body.piece.glyph, '\u265C');
    assert.equal(body.records.length, 1, 'limit honoured');

    assert.equal((await httpReq(srv.port, '/api/records?qq=abc')).status, 400);
    assert.equal((await httpReq(srv.port, `/api/records?qq=${qq}`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 404,
      'a forwarded request sees the ordinary 404');
    assert.equal((await httpReq(srv.port, `/api/records?qq=${qq}`, { method: 'POST' })).status, 405, 'read-only');
  });
});
