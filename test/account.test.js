// test/account.test.js — [ACCOUNT] / [ACCOUNT-V2] 账号体系（server/account.js + shared/accountCrypto.js，本 fork 自有功能）。
//
// 覆盖：账号文件格式（version 2，与盟约同一套字段）/ 旧文件迁移 / 原子写 + 每账号文件锁 / 传输加密往返
// （node:crypto ↔ WebCrypto ↔ 纯 JS 回退）/ token 90 天有效期与活动续期 / confirm 防暴力 / 回环 confirm 与 salt 路由 /
// WS 全链路（requestBind → 群里确认 → 云端 prefs 上行 → 重连自动登录）。
//
// 全部用临时目录，绝不碰真实账号数据。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { startServer } from '../server/index.js';
import {
  createAccountStore, accountDirs, ACCOUNT_PREF_KEYS, PREF_MAX_CHARS, ACCOUNT_MAX_CHARS,
  TOKEN_TTL_MS, CODE_TTL_MS, CONFIRM_MAX_FAILS, CONFIRM_WINDOW_MS, LOCK_STALE_MS,
} from '../server/account.js';
import {
  ACCOUNT_CRYPTO, keyMaterial, deriveKeyNode, deriveKeyBytes, encryptPayload, decryptPayload, hasWebCrypto,
} from '../shared/accountCrypto.js';
import { C2S, S2C, validateC2S, MSG_STR_MAX } from '../shared/protocol.js';
import { WS_MAX_PAYLOAD } from '../server/http/websocket.js';
import { attachWebSocket } from '../server/http/websocket.js';
import { Network, SessionRegistry } from '../server/net.js';
import { TestClient } from './helpers/wsClient.js';

const tmpDirs = [];
/** A fresh account root (`<tmp>/accounts` lives under it) — never the repo's own store. */
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-account-'));
  tmpDirs.push(dir);
  return dir;
}
const accountFile = (dir, qq) => path.join(dir, 'accounts', `${qq}.json`);
const readAcc = (dir, qq) => JSON.parse(fs.readFileSync(accountFile(dir, qq), 'utf8'));
/** Poll until `fn()` is truthy (落盘有 50ms 合并去抖) — returns the value or null on timeout. */
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 20));
  }
}
/** Bind a QQ in a fresh store and hand back { store, token }. */
function boundStore(dir, qq = '123456', nickname = 'Doctor') {
  const store = createAccountStore({ dir });
  const { code } = store.newCode(() => {});
  assert.equal(store.confirm(code, qq, nickname).ok, true);
  store.flush();
  return { store, token: readAcc(dir, qq).token };
}

after(() => {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

// ---------------------------------------------------------------------------------------------------
// 目录与路径：一律走环境变量，仓库里不出现服务端路径
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 目录（ACCOUNT_DIR / ACCOUNT_KEY_DIR）', () => {
  test('默认在 <app>/.account 下，accounts/ avatars/ records/ 与密钥目录同级', () => {
    const d = accountDirs({});
    assert.equal(path.basename(d.root), '.account');
    assert.equal(d.accountsDir, path.join(d.root, 'accounts'));
    assert.equal(d.avatarsDir, path.join(d.root, 'avatars'));
    assert.equal(d.recordsDir, path.join(d.root, 'records'));
    assert.equal(d.keyDir, path.join(d.root, 'account-secrets'));
    assert.equal(d.prefsDir, undefined, '不再有独立的 prefs 目录（全共享）');
    assert.ok(!d.root.includes('node_modules'));
  });

  test('ACCOUNT_DIR / ACCOUNT_KEY_DIR 覆盖默认值（用环境变量指向共享目录）', () => {
    const d = accountDirs({ ACCOUNT_DIR: path.join('X:', 'shared', 'account'), ACCOUNT_KEY_DIR: path.join('X:', 'secrets') });
    assert.equal(d.root, path.resolve('X:/shared/account'));
    assert.equal(d.accountsDir, path.resolve('X:/shared/account/accounts'));
    assert.equal(d.keyDir, path.resolve('X:/secrets'));
  });

  test('store 在 ACCOUNT_DIR 里建 accounts/，密钥落在 ACCOUNT_KEY_DIR（不进 accounts/）', () => {
    const dir = tmpRoot();
    const keyDir = path.join(dir, 'keys');
    const store = createAccountStore({ dir, keyDir });
    const { code } = store.newCode(() => {});
    store.confirm(code, '10030', 'K');
    store.flush();
    assert.equal(store.dir, path.join(dir, 'accounts'));
    assert.ok(fs.existsSync(path.join(dir, 'accounts')), 'accounts/ 建好了');
    assert.ok(fs.existsSync(path.join(dir, 'avatars')) && fs.existsSync(path.join(dir, 'records')), '同级的 avatars/ records/ 也建好了');
    assert.ok(fs.existsSync(path.join(keyDir, 'server.key')), 'server.key 在 ACCOUNT_KEY_DIR');
    assert.ok(!fs.existsSync(path.join(dir, 'accounts', 'server.key')), '密钥不在账号目录里');
    assert.match(store.salt(), /^[0-9a-f]{64}$/);
    // 0600（Windows 上 mode 语义有限，只在 POSIX 上断言）
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(keyDir, 'server.key')).mode & 0o777, 0o600);
  });

  test('ACCOUNT_KEY_DIR 未设置时沿用账号目录里盟约那份 server.key（两端共享同一公开盐）', () => {
    const dir = tmpRoot();
    const keyPath = path.join(dir, 'accounts', 'server.key');
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const store = createAccountStore({ dir });
    const salt = store.salt();
    const pem = fs.readFileSync(keyPath, 'utf8');
    const expect = crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex');
    assert.equal(salt, expect, '沿用了共享密钥 → 公开盐一致');
    assert.ok(!fs.existsSync(path.join(dir, 'account-secrets', 'server.key')), '没有再生成一份新密钥');
  });
});

// ---------------------------------------------------------------------------------------------------
// 账号文件格式（与盟约同一套 version 2 字段）
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 共享身份文件格式 v2', () => {
  test('新建账号的字段与盟约一致：身份/token/friends/online（prefs 是盟约那份，保持空）', () => {
    const dir = tmpRoot();
    boundStore(dir, '10001', 'Nick');
    const acc = readAcc(dir, '10001');
    assert.deepEqual(Object.keys(acc).sort(), [
      'created', 'friends', 'invites', 'nickname', 'online', 'prefs', 'prefsMeta', 'qq', 'reqIn', 'reqOut', 'token', 'tokenIssuedAt', 'updatedAt', 'version',
    ]);
    assert.equal(acc.version, 2);
    assert.equal(acc.qq, '10001');
    assert.equal(acc.nickname, 'Nick');
    assert.match(acc.token, /^[0-9a-f]{48}$/);
    assert.equal(typeof acc.created, 'number');
    assert.equal(acc.updatedAt, acc.created);
    assert.ok(acc.tokenIssuedAt >= acc.created, '绑定成功会轮换 token（tokenIssuedAt 刷新）');
    assert.deepEqual(acc.prefs, {}, '新建账号的云端存档从空开始');
    assert.deepEqual(acc.prefsMeta, {});
    assert.deepEqual(acc.online, { totalSec: 0, lastSeenAt: 0, games: {} }, '在线时长：两服兼容的最小结构');
    // 白名单：只有盟约那 9 个 sp.pref.* 键
    assert.deepEqual(ACCOUNT_PREF_KEYS, ['loadout', 'ownership', 'diy', 'settings', 'lang', 'emoteTheme', 'recentRooms', 'lobby.mode', 'lobby.difficulty']);
  });

  test('旧文件（无 version）自动迁移到 v2：补 version/updatedAt/prefsMeta/tokenIssuedAt/online，不动已有数据', () => {
    const dir = tmpRoot();
    const file = accountFile(dir, '10002');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = { qq: '10002', nickname: 'Old', token: 'a'.repeat(48), created: 1000, prefs: { loadout: '{"v":1,"entries":[]}' } };
    fs.writeFileSync(file, JSON.stringify(raw));
    const store = createAccountStore({ dir });
    assert.deepEqual(store.prefsOf('10002'), { loadout: '{"v":1,"entries":[]}' }, '老存档照样读得到（同一份）');
    const acc = readAcc(dir, '10002');
    assert.equal(acc.version, 2);
    assert.equal(acc.updatedAt, 1000);
    assert.equal(acc.tokenIssuedAt, 1000);
    assert.deepEqual(acc.prefsMeta, { loadout: 1000 }, '迁移补的 prefsMeta 用的是文件里的 updatedAt');
    assert.deepEqual(acc.prefs, { loadout: '{"v":1,"entries":[]}' }, '已有存档没被改动');
    assert.deepEqual(acc.online, { totalSec: 0, lastSeenAt: 0, games: {} }, '补上 online 空结构');
    assert.deepEqual(acc.friends, []);
  });

  test('prefs 白名单 + 大小上限', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10003');
    assert.equal(store.setPref('10003', 'stats', '{}').error, 'BAD_KEY', 'stats 不在账号白名单（归成就库）');
    assert.equal(store.setPref('10003', 'nope', '{}').error, 'BAD_KEY');
    assert.equal(store.setPref('10003', 'loadout', 'x'.repeat(PREF_MAX_CHARS + 1)).error, 'TOO_BIG');
    assert.equal(store.setPref('10003', 'loadout', 'x'.repeat(PREF_MAX_CHARS)).ok, true, '单键上限内可以存');
    assert.equal(store.setPref('10003', 'ownership', 'y'.repeat(ACCOUNT_MAX_CHARS - PREF_MAX_CHARS + 1)).error, 'TOO_BIG', '整账号总量也有限制');
    assert.equal(store.setPref('99999', 'loadout', '{}').error, 'NOT_BOUND');
  });
});

// ---------------------------------------------------------------------------------------------------
// 原子写 + 每账号文件锁 + 共目录合并
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 原子写与每账号文件锁', () => {
  test('写盘只留下 <qq>.json：没有 .tmp-* 残留，锁写完全部释放', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10004');
    for (let i = 0; i < 20; i++) store.setPref('10004', 'lang', JSON.stringify(`zh-${i}`));
    store.flush();
    const files = fs.readdirSync(path.join(dir, 'accounts')).sort();
    assert.deepEqual(files, ['10004.json'], '账号目录里只有账号文件（无 .tmp / .lock 残留）');
    assert.equal(readAcc(dir, '10004').prefs.lang, JSON.stringify('zh-19'), '存档就写在账号文件里（全共享）');
  });

  test('并发读写：读到的文件永远是一份完整 JSON（临时文件 + rename）', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10005');
    const file = accountFile(dir, '10005');
    for (let i = 0; i < 40; i++) {
      store.setPref('10005', 'loadout', JSON.stringify({ v: 1, i, pad: 'x'.repeat(2000) }));
      store.flush();
      const acc = JSON.parse(fs.readFileSync(file, 'utf8')); // 撕不开就是原子性没做到
      assert.equal(acc.prefs.loadout, JSON.stringify({ v: 1, i, pad: 'x'.repeat(2000) }));
    }
  });

  test('陈旧的锁（持有者崩了）会被接管，写不被卡死', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10006');
    const lock = path.join(dir, 'accounts', '.lock-10006');
    fs.writeFileSync(lock, '999999');
    const old = new Date(Date.now() - LOCK_STALE_MS - 5000);
    fs.utimesSync(lock, old, old);
    const t0 = Date.now();
    assert.equal(store.setPref('10006', 'lang', '"zh"').ok, true);
    store.flush();
    assert.ok(Date.now() - t0 < 2000, '没有把事件循环卡住');
    assert.ok(!fs.existsSync(lock), '写完把锁释放了');
  });

  test('两个进程共写一个账号：各自的存档键都保留（写前合并）', () => {
    const dir = tmpRoot();
    const a = createAccountStore({ dir });
    const b = createAccountStore({ dir });
    const ca = a.newCode(() => {}); const cb = b.newCode(() => {});
    a.confirm(ca.code, '10007', 'A');
    b.confirm(cb.code, '10007', 'A');
    // 两边的“游戏”各自改自己的存档键，然后各自落盘
    a.setPref('10007', 'loadout', JSON.stringify({ v: 1, entries: [['a']] }));
    a.flush();
    b.setPref('10007', 'diy', JSON.stringify({ v: 1, picks: { s1: 'x' } }));
    b.flush();
    a.setPref('10007', 'lang', '"zh"');
    a.flush();
    const prefs = readAcc(dir, '10007').prefs;
    assert.equal(prefs.loadout, JSON.stringify({ v: 1, entries: [['a']] }), 'A 的存档还在');
    assert.equal(prefs.diy, JSON.stringify({ v: 1, picks: { s1: 'x' } }), 'B 的存档也在（没有被 A 的整文件写覆盖）');
    assert.equal(prefs.lang, '"zh"');
    // 同一 key 时以 prefsMeta 更新的那份为准
    a.setPref('10007', 'lang', '"zh-TW"');
    a.flush();
    b.setPref('10007', 'lang', '"en"');
    b.flush();
    assert.equal(readAcc(dir, '10007').prefs.lang, '"en"', '后写（时间戳更新）的一份胜出');
    assert.ok(readAcc(dir, '10007').prefsMeta.lang > 0);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'accounts')).sort(), ['10007.json'], '两个进程都在锁里写，没有临时文件残留');
  });
});

// ---------------------------------------------------------------------------------------------------
// 全共享：盟约与狩猎读写同一份账号数据（含 prefs）
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] prefs 全共享（同一份 accounts/<qq>.json）', () => {
  test('狩猎写 prefs → 直接进账号文件的 prefs/prefsMeta（与盟约同一套字段）', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10040');
    const loadout = JSON.stringify({ v: 1, entries: [['chess_char_1_01', 'skill1']] });
    const stamp = Date.now();
    assert.equal(store.setPref('10040', 'loadout', loadout).ok, true);
    store.flush();
    const acc = readAcc(dir, '10040');
    assert.equal(acc.prefs.loadout, loadout, '存的就是客户端那条 JSON 字符串（不双重编码）');
    assert.ok(acc.prefsMeta.loadout >= stamp, 'prefsMeta 记下更新时间');
    assert.ok(acc.updatedAt >= stamp, 'updatedAt 也推进（盟约据此判断新鲜度）');
    assert.deepEqual(store.prefsOf('10040'), { loadout });
    assert.deepEqual(store.prefsMetaOf('10040'), { loadout: acc.prefsMeta.loadout });
  });

  test('一边写、另一边立即可见：同一个账号目录的另一个进程读到的就是新值', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10041');
    store.setPref('10041', 'settings', JSON.stringify({ bgm: 0.3 }));
    store.flush();
    const other = createAccountStore({ dir }); // 另一个进程（= 盟约/另一台游戏）启动时加载
    assert.deepEqual(other.prefsOf('10041'), { settings: JSON.stringify({ bgm: 0.3 }) }, '另一边读到同一份');
    // 反过来：另一边写，这一边重新加载后也能看到
    other.setPref('10041', 'lang', '"zh-TW"');
    other.flush();
    const third = createAccountStore({ dir });
    assert.deepEqual(third.prefsOf('10041'), { settings: JSON.stringify({ bgm: 0.3 }), lang: '"zh-TW"' });
  });

  test('另一边直接改账号文件的 prefs（模拟盟约进程）→ 我们写在线/身份时合并进去，不丢它的键', () => {
    const dir = tmpRoot();
    const { store } = boundStore(dir, '10042');
    store.setPref('10042', 'loadout', '"HUNT-1"');
    store.flush();
    // 盟约进程改了另一个键（直接落盘）
    const main = readAcc(dir, '10042');
    main.prefs.loadout = '"COVENANT-2"';
    main.prefsMeta.loadout = Date.now() + 1000; // 比我们的新
    main.prefs.ownership = '["a"]';
    fs.writeFileSync(accountFile(dir, '10042'), JSON.stringify(main));
    // 我们只加在线时长（走同一条写前合并路径）
    assert.equal(store.addOnlineSec('10042', 3000).ok, true);
    const acc = readAcc(dir, '10042');
    assert.equal(acc.prefs.loadout, '"COVENANT-2"', '更新的那份胜出（盟约的）');
    assert.equal(acc.prefs.ownership, '["a"]', '盟约新加的键也保留');
    assert.ok(acc.online.games.hunt.sec >= 3, '在线时长同时写入');
    assert.equal(store.prefsOf('10042').loadout, '"COVENANT-2"', '内存里也合并了');
  });

  test('两进程并发写：不同键都保留，同键以 prefsMeta 更新的为准', () => {
    const dir = tmpRoot();
    const a = createAccountStore({ dir });
    const b = createAccountStore({ dir });
    const ca = a.newCode(() => {}); const cb = b.newCode(() => {});
    a.confirm(ca.code, '10043', 'A');
    b.confirm(cb.code, '10043', 'A');
    a.setPref('10043', 'loadout', '"A"');
    a.flush();
    b.setPref('10043', 'diy', '"B"');
    b.flush();
    a.setPref('10043', 'lang', '"A"');
    a.flush();
    b.setPref('10043', 'lang', '"B"');
    b.flush();
    const acc = readAcc(dir, '10043');
    assert.equal(acc.prefs.loadout, '"A"');
    assert.equal(acc.prefs.diy, '"B"');
    assert.equal(acc.prefs.lang, '"B"', '后写（prefsMeta 更新）的一份胜出');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'accounts')).sort(), ['10043.json'], '只有一份账号文件，没有旁路目录');
  });
});

// ---------------------------------------------------------------------------------------------------
// 在线时长（共享 online 块）
// ---------------------------------------------------------------------------------------------------

/**
 * A bare ws server around a Network (no lobby): enough for hello / account frames, and it lets a test drive
 * `onlineHeartbeat()` on a fake clock. Returns the url, the network, the registry and a close().
 */
async function miniServer(accounts, { now, ...options } = {}) {
  const log = { info() {}, warn() {}, debug() {}, error() {} };
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const registry = new SessionRegistry({});
  const network = new Network({ registry, handler: { onMessage: () => ({ ok: true }) }, log, now, options, accounts });
  const wss = attachWebSocket(server, { network, log });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  return {
    url, network, registry,
    close: async () => {
      network.close();
      await new Promise((r) => { wss.close(); server.close(() => r()); });
    },
  };
}

describe('[ACCOUNT] 在线时长（online：totalSec / games.hunt）', () => {

  test('累加只增 totalSec 与 games.hunt：既有的 games.covenant 与未知键原样保留', () => {
    const dir = tmpRoot();
    boundStore(dir, '10050'); // 只负责建账号（下面直接改盘上的 online）
    // 盟约早前写过的 online
    const main = readAcc(dir, '10050');
    main.online = { totalSec: 100, lastSeenAt: 111, games: { covenant: { sec: 100, lastSeenAt: 111 }, other: { sec: 5 } }, note: 'x' };
    fs.writeFileSync(accountFile(dir, '10050'), JSON.stringify(main));
    const fresh = createAccountStore({ dir });
    const r = fresh.addOnlineSec('10050', 61_500); // 61.5s → 61 整秒（余数留在内存）
    assert.equal(r.ok, true);
    assert.equal(r.sec, 61);
    assert.deepEqual(r.online, { totalSec: 161, huntSec: 61, lastSeenAt: readAcc(dir, '10050').online.lastSeenAt });
    const acc = readAcc(dir, '10050');
    assert.equal(acc.online.totalSec, 161, '总时长累加');
    assert.equal(acc.online.games.hunt.sec, 61, '狩猎时长累加');
    assert.deepEqual(acc.online.games.covenant, { sec: 100, lastSeenAt: 111 }, '盟约的 games.covenant 一个字节没动');
    assert.deepEqual(acc.online.games.other, { sec: 5 }, '未知键也保留');
    assert.equal(acc.online.note, 'x');
    assert.ok(acc.online.lastSeenAt > 111);
    assert.ok(acc.online.games.hunt.lastSeenAt > 111);
    // 不足一秒的余数不会丢：61.5s → 61 秒 + 0.5s 余数；再 +0.4s 仍不够一秒，+0.2s 才补上整秒
    fresh.addOnlineSec('10050', 400);
    assert.equal(readAcc(dir, '10050').online.games.hunt.sec, 61, '余数不够一秒就不加');
    fresh.addOnlineSec('10050', 200);
    assert.equal(readAcc(dir, '10050').online.games.hunt.sec, 62);
    assert.equal(readAcc(dir, '10050').online.totalSec, 162);
    assert.deepEqual(fresh.onlineOf('10050').huntSec, 62);
    // 白名单以外不写在线：没有这个账号就不动
    assert.equal(fresh.addOnlineSec('99999', 1000).error, 'NOT_FOUND');
  });

  test('连接开始计时；心跳与下线各写一次（假时钟驱动）', async () => {
    const dir = tmpRoot();
    const writes = [];
    const log = { info() {}, warn() {}, error() {}, debug: (...a) => { if (a[0] === '[account] write') writes.push(a[1]); } };
    const store = createAccountStore({ dir, log });
    const { code } = store.newCode(() => {});
    store.confirm(code, '10051', 'Player');
    store.flush();
    const token = readAcc(dir, '10051').token;
    const mainWrites = () => writes.filter((k) => k === 'main').length;
    const before = mainWrites();
    assert.ok(before >= 1, '绑定本身写了一次身份文件');

    let clock = 1_000_000;
    const srv = await miniServer(store, { now: () => clock, onlineFlushMs: 3_600_000 }); // 心跳由测试手动触发
    const c = await TestClient.connect(srv.url);
    try {
      const welcome = await c.hello('Player', undefined, { account: token });
      assert.equal(welcome.t, 'welcome');
      const data = await c.waitFor('account.data');
      assert.deepEqual(data.online, { totalSec: 0, huntSec: 0, lastSeenAt: 0 }, 'account.data 带在线时长快照');
      assert.equal(mainWrites(), before, '连上不写盘');

      clock += 60_000;
      srv.network.onlineHeartbeat();
      assert.equal(mainWrites(), before + 1, '心跳写一次');
      assert.equal(readAcc(dir, '10051').online.games.hunt.sec, 60);

      clock += 120_000;
      srv.network.onlineHeartbeat();
      assert.equal(mainWrites(), before + 2, '第二次心跳再写一次');
      assert.equal(readAcc(dir, '10051').online.games.hunt.sec, 180);

      clock += 30_000;
      await c.close();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(mainWrites(), before + 3, '下线写一次（且只写一次）');
      const acc = readAcc(dir, '10051');
      assert.equal(acc.online.games.hunt.sec, 210, '总时长 = 60 + 120 + 30');
      assert.equal(acc.online.totalSec, 210);
      assert.equal(srv.registry.size, 1, '会话仍在重连窗口里（不影响计时已停）');
      assert.equal(srv.network.onlineHeartbeat() === undefined, true);
      assert.equal(mainWrites(), before + 3, '会话断开后心跳不再写');
    } finally {
      await c.terminate().catch(() => {});
      await srv.close();
    }
  });

  test('account.logout 也把在线时长结清（写一次）', async () => {
    const dir = tmpRoot();
    const writes = [];
    const log = { info() {}, warn() {}, error() {}, debug: (...a) => { if (a[0] === '[account] write') writes.push(a[1]); } };
    const store = createAccountStore({ dir, log });
    const { code } = store.newCode(() => {});
    store.confirm(code, '10052', 'P');
    store.flush();
    const token = readAcc(dir, '10052').token;
    let clock = 2_000_000;
    const srv = await miniServer(store, { now: () => clock, onlineFlushMs: 3_600_000 });
    const c = await TestClient.connect(srv.url);
    try {
      await c.hello('P', undefined, { account: token });
      await c.waitFor('account.data');
      const before = writes.filter((k) => k === 'main').length;
      clock += 45_000;
      const out = await c.request({ t: 'account.logout' });
      assert.equal(out.t, 'ok');
      await c.waitFor('account.logout');
      assert.equal(writes.filter((k) => k === 'main').length, before + 1, '退出登录 = 结清一次');
      assert.equal(readAcc(dir, '10052').online.games.hunt.sec, 45);
    } finally {
      await c.terminate().catch(() => {});
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// 单账号单登录（方案 A：只做在狩猎服上，盟约旧会话延迟到下次 hello 才掉）
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 单账号单登录（踢旧会话 + 每次登录轮换 token）', () => {
  /** A bound account whose token the first login may rotate. */
  function boundTo(dir, qq, nickname = 'P') {
    const { store } = boundStore(dir, qq, nickname);
    return { store, token: readAcc(dir, qq).token };
  }

  test('同一个 qq 两次登录：旧连接收到 account.logout 并被关闭（4001），账号留在新会话上', async () => {
    const dir = tmpRoot();
    const { store, token: t0 } = boundTo(dir, '10060');
    const srv = await miniServer(store, { onlineFlushMs: 3_600_000 });
    const c1 = await TestClient.connect(srv.url);
    try {
      await c1.hello('P', undefined, { account: t0 });
      const b1 = await c1.waitFor('account.bound');
      assert.equal(b1.qq, '10060');
      const t1 = b1.token;
      assert.notEqual(t1, t0, '登录成功即轮换 token');
      assert.equal(store.byToken(t0), null, '旧 token 立即失效');

      // 第二个客户端用**当前** token 登录
      const c2 = await TestClient.connect(srv.url);
      c2.send({ t: 'hello', name: 'P2', version: 1, account: t1 });
      await c2.waitFor('welcome');
      const b2 = await c2.waitFor('account.bound');
      assert.equal(b2.qq, '10060');
      const t2 = b2.token;
      assert.notEqual(t2, t1, '再次轮换');

      // 旧连接：account.logout（reason=replaced）+ 4001 关闭
      const out = await c1.waitFor('account.logout');
      assert.equal(out.reason, 'replaced', '前端据此（+4001）提示"已在别处登录"');
      const closed = await c1.closed;
      assert.equal(closed.code, 4001, '旧连接被关闭，客户端不再自动重连');
      assert.equal(c1.isOpen, false);

      // 账号仍在新会话上登录着
      assert.equal(srv.network.kickAccountSessions('10060', null), 1, '新会话是唯一登录态');
      assert.equal(store.byToken(t2).qq, '10060');
      assert.equal(store.byToken(t1), null);
      await c2.terminate();
    } finally {
      await c1.terminate().catch(() => {});
      await srv.close();
    }
  });

  test('旧 token（被轮换掉的）再登录只拿到 account.logout，不会把新会话踢掉', async () => {
    const dir = tmpRoot();
    const { store, token: t0 } = boundTo(dir, '10061');
    const srv = await miniServer(store, { onlineFlushMs: 3_600_000 });
    const a = await TestClient.connect(srv.url);
    const b = await TestClient.connect(srv.url);
    try {
      await a.hello('A', undefined, { account: t0 });
      const bound = await a.waitFor('account.bound');
      const live = bound.token;
      b.send({ t: 'hello', name: 'B', version: 1, account: t0 }); // 老 token
      await b.waitFor('welcome');
      assert.equal((await b.waitFor('account.logout')).reason, undefined, '失效 token：普通登出帧（无 reason）');
      assert.equal((await a.waitFor('account.bound', () => false, 150).catch(() => null)), null, '新会话没有被再踢一次');
      assert.equal(a.isOpen, true);
      assert.equal(store.byToken(live).qq, '10061');
    } finally {
      await a.terminate().catch(() => {});
      await b.terminate().catch(() => {});
      await srv.close();
    }
  });

  test('同一连接重复 hello 不踢自己；不同 qq 互不影响；访客不受影响', async () => {
    const dir = tmpRoot();
    // 两个账号都绑在**同一个 store**（= 一台服务器）上
    const store = createAccountStore({ dir });
    const ca = store.newCode(() => {}); store.confirm(ca.code, '10062', 'A');
    const cb = store.newCode(() => {}); store.confirm(cb.code, '10063', 'Other');
    store.flush();
    const t0 = readAcc(dir, '10062').token;
    const tOther = readAcc(dir, '10063').token;
    const srv = await miniServer(store, { onlineFlushMs: 3_600_000 });
    const a = await TestClient.connect(srv.url);
    const o = await TestClient.connect(srv.url);
    const guest = await TestClient.connect(srv.url);
    try {
      await a.hello('A', undefined, { account: t0 });
      const b1 = await a.waitFor('account.bound');
      // 同一条连接再 hello（改名/重连同类场景）
      a.send({ t: 'hello', name: 'A2', version: 1, account: b1.token });
      await a.waitFor('welcome');
      const b2 = await a.waitFor('account.bound');
      assert.equal(b2.qq, '10062');
      assert.equal(b2.token, b1.token, '重复 hello 幂等：同一条连接上不再轮换');
      await a.expectNone('account.logout', () => true, 200);
      assert.equal(a.isOpen, true, '重复 hello 不踢自己');

      // 另一个 qq 登录：互不影响
      await o.hello('O', undefined, { account: tOther });
      const bo = await o.waitFor('account.bound');
      assert.equal(bo.qq, '10063');
      await o.expectNone('account.logout', () => true, 150);
      assert.equal(o.isOpen, true);
      assert.equal(a.isOpen, true, '第一个账号仍在');

      // 访客（未登录）一直在
      await guest.hello('Guest');
      await guest.expectNone('account.logout', () => true, 150);
      assert.equal(guest.isOpen, true);
    } finally {
      await a.terminate().catch(() => {});
      await o.terminate().catch(() => {});
      await guest.terminate().catch(() => {});
      await srv.close();
    }
  });

  test('绑定成功 = 一次新登录：踢掉该 qq 已在线的会话，token 也换了', async () => {
    const dir = tmpRoot();
    const { store, token: t0 } = boundTo(dir, '10064');
    const srv = await miniServer(store, { onlineFlushMs: 3_600_000 });
    const oldCon = await TestClient.connect(srv.url);
    const fresh = await TestClient.connect(srv.url);
    try {
      await oldCon.hello('Old', undefined, { account: t0 });
      const b1 = await oldCon.waitFor('account.bound');
      assert.equal(oldCon.isOpen, true);

      await fresh.hello('Fresh');
      fresh.send({ t: 'account.requestBind' });
      const { code } = await fresh.waitFor('account.bindCode');
      const r = store.confirm(code, '10064', 'Fresh');
      assert.equal(r.ok, true);
      const b2 = await fresh.waitFor('account.bound');
      assert.equal(b2.qq, '10064');
      assert.notEqual(b2.token, b1.token, '绑定成功也轮换');

      const out = await oldCon.waitFor('account.logout');
      assert.equal(out.reason, 'replaced');
      assert.equal((await oldCon.closed).code, 4001);
      assert.equal(store.byToken(b2.token).qq, '10064');
      assert.equal(srv.network.kickAccountSessions('10064', null), 1);
    } finally {
      await oldCon.terminate().catch(() => {});
      await fresh.terminate().catch(() => {});
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// 传输加密（与盟约同一套派生）
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 传输加密（aes-256-gcm-sha256qq-v1）', () => {
  test('派生与载荷布局：salt = sha256(spki)，k_user = SHA-256("<salt>:<qq>")，base64(iv(12)||ct||tag(16))', () => {
    const dir = tmpRoot();
    const store = createAccountStore({ dir });
    const salt = store.salt();
    assert.equal(ACCOUNT_CRYPTO, 'aes-256-gcm-sha256qq-v1');
    assert.match(salt, /^[0-9a-f]{64}$/);
    assert.equal(keyMaterial('10008', salt), `${salt}:10008`);
    const key = deriveKeyNode('10008', salt, crypto);
    assert.equal(key.length, 32);
    assert.deepEqual(key, crypto.createHash('sha256').update(`${salt}:10008`, 'utf8').digest());
    const b64 = store.enc('10008', '{"a":1}');
    const bin = Buffer.from(b64, 'base64');
    assert.equal(bin.length, 12 + Buffer.byteLength('{"a":1}') + 16, 'iv + ct + tag');
    assert.equal(store.dec('10008', b64), '{"a":1}');
    assert.equal(store.dec('10009', b64), null, '别人的 qq 解不开');
    assert.equal(store.dec('10008', 'not-base64!!'), null);
  });

  test('服务端加密 → 客户端解密（WebCrypto 与纯 JS 回退都能解）', async () => {
    const dir = tmpRoot();
    const store = createAccountStore({ dir });
    const salt = store.salt();
    const payload = JSON.stringify({ loadout: '{"v":1,"entries":[["a","b"]]}', pad: 'x'.repeat(5000) });
    const b64 = store.enc('10010', payload);

    const key = await deriveKeyBytes('10010', salt);
    assert.equal(await decryptPayload(b64, key), payload, 'WebCrypto / 纯 JS 都能解服务端的帧');

    // 反过来：客户端加密 → 服务端解
    const up = await encryptPayload(payload, await deriveKeyBytes('10010', salt));
    assert.equal(store.dec('10010', up), payload);
  });

  test('非安全上下文（没有 crypto.subtle）走纯 JS 回退，且与 node:crypto 互通', async () => {
    const dir = tmpRoot();
    const store = createAccountStore({ dir });
    const salt = store.salt();
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const saved = globalThis.crypto;
    try {
      // 游戏是 http://<IP> 打开的：浏览器里 crypto.subtle 不存在 —— 模拟这里没有 WebCrypto
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true, writable: true, value: { getRandomValues: (u8) => saved.getRandomValues(u8) },
      });
      assert.equal(hasWebCrypto(), false, '确实没有 subtle');
      const payload = JSON.stringify({ diy: '{"v":1,"picks":{"s1":"x"}}' });
      const b64 = await encryptPayload(payload, await deriveKeyBytes('10011', salt));
      assert.equal(store.dec('10011', b64), payload, '纯 JS 加密的帧，服务端（node:crypto）能解');
      const server = store.enc('10011', payload);
      assert.equal(await decryptPayload(server, await deriveKeyBytes('10011', salt)), payload, '服务端的帧，纯 JS 能解');
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
      else delete globalThis.crypto;
    }
  });

  test('纯 JS SHA-256 与 node:crypto 一致', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const saved = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true, writable: true, value: { getRandomValues: (u8) => saved.getRandomValues(u8) },
      });
      // deriveKeyBytes 在无 subtle 时用纯 JS sha256：拿它和 node 的哈希对比
      const key = await deriveKeyBytes('abc', '0'.repeat(64));
      assert.deepEqual(Buffer.from(key), crypto.createHash('sha256').update(`${'0'.repeat(64)}:abc`, 'utf8').digest());
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
      else delete globalThis.crypto;
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// token：90 天有效期 + 活动续期 + 轮换
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT-V2] token 90 天有效期', () => {
  test('90 天内有效；过期即失效', () => {
    const dir = tmpRoot();
    let now = 1_000_000;
    const store = createAccountStore({ dir, now: () => now });
    const { code } = store.newCode(() => {});
    store.confirm(code, '10012', 'T');
    assert.equal(TOKEN_TTL_MS, 90 * 24 * 3600_000, '90 天');
    assert.equal(store.tokenValid('10012'), true);
    now += TOKEN_TTL_MS - 1;
    assert.equal(store.tokenValid('10012'), true, '差 1ms 到期仍有效');
    now += 2;
    assert.equal(store.tokenValid('10012'), false, '过期了');
    assert.equal(store.tokenValid('99999'), false, '没有这个账号');
  });

  test('活动续期（touchToken）把有效期推后，且落盘有节流', () => {
    const dir = tmpRoot();
    let now = 2_000_000;
    const store = createAccountStore({ dir, now: () => now });
    const { code } = store.newCode(() => {});
    store.confirm(code, '10013', 'T');
    store.flush();
    const issued0 = readAcc(dir, '10013').tokenIssuedAt;
    now += 10 * 24 * 3600_000;
    store.touchToken('10013');
    assert.equal(store.tokenValid('10013'), true, '续期后又满 90 天');
    store.flush();
    assert.ok(readAcc(dir, '10013').tokenIssuedAt > issued0, '落盘的 tokenIssuedAt 也更新了');
  });

  test('每次绑定都轮换 token：旧 token 立刻失效；rotateToken 也能手工吊销', async () => {
    const dir = tmpRoot();
    const store = createAccountStore({ dir });
    const c1 = store.newCode(() => {}); const c2 = store.newCode(() => {});
    store.confirm(c1.code, '10014', 'T');
    store.flush();
    const old = readAcc(dir, '10014').token;
    assert.equal(store.byToken(old).qq, '10014');
    store.confirm(c2.code, '10014', 'T2');
    store.flush();
    const fresh = readAcc(dir, '10014').token;
    assert.notEqual(fresh, old, '重新绑定后 token 变了');
    assert.equal(store.byToken(old), null, '旧 token 立即失效');
    assert.equal(store.byToken(fresh).qq, '10014');
    assert.equal(store.rotateToken('10014').ok, true);
    assert.equal(store.byToken(fresh), null);
  });

  test('绑定码 3 分钟过期；confirm 防暴力（同一 qq 5 分钟窗口 8 次）', () => {
    const dir = tmpRoot();
    let now = 5_000_000;
    const store = createAccountStore({ dir, now: () => now });
    assert.equal(CODE_TTL_MS, 180_000);
    const { code } = store.newCode(() => {});
    now += CODE_TTL_MS + 1;
    assert.equal(store.confirm(code, '10015', 'T').error, 'BAD_CODE', '过期码无效');
    // 防暴力：同一 qq 连续失败到上限后直接 TOO_MANY
    for (let i = 1; i < CONFIRM_MAX_FAILS; i++) assert.equal(store.confirm('000000', '10016', 'T').error, 'BAD_CODE', `第 ${i} 次`);
    assert.equal(store.confirm('000000', '10016', 'T').error, 'BAD_CODE', `第 ${CONFIRM_MAX_FAILS} 次`);
    assert.equal(store.confirm('000000', '10016', 'T').error, 'TOO_MANY', '超过窗口上限即拒绝');
    // 另一个 qq 不受影响；窗口过去后恢复
    assert.equal(store.confirm('000000', '10017', 'T').error, 'BAD_CODE');
    now += CONFIRM_WINDOW_MS + 1;
    assert.equal(store.confirm('000000', '10016', 'T').error, 'BAD_CODE', '窗口过后重新计数');
    assert.equal(store.confirm('000000', '123', 'T').error, 'BAD_QQ', 'qq 必须是 5..12 位数字');
  });
});

// ---------------------------------------------------------------------------------------------------
// 协议
// ---------------------------------------------------------------------------------------------------

describe('[ACCOUNT] 协议（shared/protocol.js）', () => {
  test('c2s 账号消息在案且字段受限', () => {
    for (const t of ['account.requestBind', 'account.save', 'account.saveBatch', 'account.load', 'account.setName', 'account.logout']) {
      assert.ok(Object.hasOwn(C2S, t), `C2S.${t}`);
    }
    for (const t of ['account.bindCode', 'account.bound', 'account.data', 'account.pref', 'account.logout']) assert.ok(S2C.includes(t), `S2C has ${t}`);
    assert.equal(validateC2S({ t: 'hello', name: 'x', account: 'a'.repeat(64) }), null);
    assert.match(validateC2S({ t: 'hello', name: 'x', account: 'a'.repeat(65) }), /account/);
    assert.equal(validateC2S({ t: 'account.save', key: 'loadout', enc: 'x'.repeat(MSG_STR_MAX) }), null);
    assert.match(validateC2S({ t: 'account.save', key: 'loadout', enc: 'x'.repeat(MSG_STR_MAX + 1) }), /enc/);
    assert.equal(validateC2S({ t: 'account.save', key: 'loadout', enc: 'AAAA', plainOk: true }), null, 'plainOk 仍是容许字段');
    assert.equal(validateC2S({ t: 'account.saveBatch', items: [{ key: 'lang', enc: 'AAAA' }] }), null);
    assert.match(validateC2S({ t: 'account.saveBatch', items: Array.from({ length: 33 }, () => ({ key: 'lang', enc: 'A' })) }), /items/);
    assert.match(validateC2S({ t: 'account.save', key: 'loadout', json: { o: 1 } }), /json/, 'json 只能是字符串');
    // 载荷缺失时 schema 放行，由服务端回 'bad payload'（e2e 里断言）
    assert.equal(validateC2S({ t: 'account.save', key: 'loadout' }), null);
  });

  test('单帧上限与 WebSocket 上限同步（不然一次上传会把连接撑爆，客户端重连成环）', () => {
    assert.ok(MSG_STR_MAX < WS_MAX_PAYLOAD, `${MSG_STR_MAX} < ${WS_MAX_PAYLOAD}`);
    assert.ok(MSG_STR_MAX > 500_000, '够放一份大存档');
  });
});

// ---------------------------------------------------------------------------------------------------
// 回环接口 + WS 全链路
// ---------------------------------------------------------------------------------------------------

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
const postJson = (port, rawPath, obj, headers = {}) => httpReq(port, rawPath, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj),
});
const jsonOf = (res) => JSON.parse(res.body.toString());

describe('[ACCOUNT] 回环 confirm 与 salt + WS 全链路', () => {
  let dir; let srv; const clients = new Set(); const extra = [];
  const QQ = '10020';
  const url = () => `ws://127.0.0.1:${srv.port}/ws`;
  const errors = [];
  const log = { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) };

  before(async () => {
    dir = tmpRoot();
    srv = await startServer({ port: 0, host: '127.0.0.1', log, accounts: { dir } });
  });
  afterEach(async () => {
    await Promise.all([...clients].map((c) => c.terminate().catch(() => {})));
    clients.clear();
    for (const s of extra.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
  });
  after(async () => {
    await srv?.close();
    assert.deepEqual(errors, [], 'no server errors logged');
  });

  const connect = async (name) => { const c = await TestClient.connect(url()); clients.add(c); const w = await c.hello(name); return { c, w }; };

  test('GET /api/account/salt 下发公开盐（客户端据此派生密钥）', async () => {
    const res = await httpReq(srv.port, '/api/account/salt');
    assert.equal(res.status, 200);
    const body = jsonOf(res);
    assert.equal(body.ok, true);
    assert.match(body.salt, /^[0-9a-f]{64}$/);
    assert.equal(body.salt, srv.accounts.salt());
  });

  test('POST /api/account/confirm 只认回环：带转发头 → 404（和未知道路一样，不暴露存在性）', async () => {
    // 不带 body：拒绝发生在读 body 之前（未读 body 会把 socket 重置，见 rooms 的同类测试）
    for (const headers of [{ 'x-forwarded-for': '1.2.3.4' }, { 'x-real-ip': '1.2.3.4' }, { forwarded: 'for=1.2.3.4' }]) {
      const res = await httpReq(srv.port, '/api/account/confirm', { method: 'POST', headers });
      assert.equal(res.status, 404, `confirm ${JSON.stringify(headers)}`);
    }
  });

  test('全链路：requestBind → 群里 /绑定 → account.bound/data（密文）→ 存档上行 → 重连自动登录', async () => {
    const { c } = await connect('Doctor');
    c.send({ t: 'account.requestBind' });
    const bindCode = await c.waitFor('account.bindCode');
    assert.match(bindCode.code, /^\d{6}$/);
    assert.equal(bindCode.ttl, CODE_TTL_MS, '3 分钟');
    assert.ok(bindCode.rid != null, '回执带回 rid（客户端 fire-and-forget 也能对上）');

    // QQ 群里的 /绑定 <code>：机器人打回环 /api/account/confirm
    const res = await postJson(srv.port, '/api/account/confirm', { code: bindCode.code, qq: QQ, nickname: 'Doctor' });
    assert.equal(res.status, 200);
    const body = jsonOf(res);
    assert.equal(body.ok, true);
    assert.equal(body.qq, QQ);

    const bound = await c.waitFor('account.bound');
    assert.equal(bound.qq, QQ);
    assert.match(bound.token, /^[0-9a-f]{48}$/, '长期 token 下发到客户端（存 localStorage）');
    const data = await c.waitFor('account.data');
    assert.equal(data.qq, QQ);
    assert.equal(data.nickname, 'Doctor');
    assert.match(data.salt, /^[0-9a-f]{64}$/, '盐随 account.data 下发');
    assert.equal(typeof data.enc, 'string', '云端 prefs 是密文');
    assert.equal(data.prefs, undefined, '明文里没有 prefs（只留 qq/nickname/meta/salt）');
    assert.deepEqual(data.meta, {});
    assert.deepEqual(data.online, { totalSec: 0, huntSec: 0, lastSeenAt: 0 }, '在线时长随 account.data 下发（共享字段）');
    const key = await deriveKeyBytes(QQ, data.salt);
    assert.deepEqual(JSON.parse(await decryptPayload(data.enc, key)), {}, '云端为空');

    // 客户端把 prefs 加密上行（account.save），再 account.load 读回
    const pref = JSON.stringify({ v: 1, entries: [['chess_char_1_01', 'skill1']] });
    const ok = await c.request({ t: 'account.save', key: 'loadout', enc: await encryptPayload(pref, key) });
    assert.equal(ok.t, 'ok');
    c.send({ t: 'account.load', key: 'loadout' });
    const loaded = await c.waitFor('account.pref');
    assert.equal(loaded.key, 'loadout');
    assert.equal(loaded.json, pref);
    assert.equal(await until(() => readAcc(dir, QQ).prefs.loadout), pref, '账号文件里就是客户端那条 JSON 字符串（不双重编码）');

    // account.saveBatch：一次帧多条
    const batch = await c.request({ t: 'account.saveBatch', items: [{ key: 'lang', enc: await encryptPayload('"zh"', key) }] });
    assert.deepEqual({ ok: batch.ok, bad: batch.bad }, { ok: 1, bad: 0 });
    await until(() => readAcc(dir, QQ).prefs.lang === '"zh"');

    // 明文载荷在没有同意（hello.plainOk）时被拒 —— 批次的敏感载荷必须加密
    const denied = await c.request({ t: 'account.save', key: 'lang', json: '"en"' });
    assert.equal(denied.t, 'error');
    assert.equal(denied.code, 'BAD_MSG');

    // 白名单外的 key 被拒；没有载荷也拒
    const badKey = await c.request({ t: 'account.save', key: 'nope', enc: await encryptPayload('{}', key) });
    assert.match(badKey.detail, /BAD_KEY/);
    const noPayload = await c.request({ t: 'account.save', key: 'lang' });
    assert.match(noPayload.detail, /bad payload/);

    // 改名落到账号文件
    c.send({ t: 'account.setName', name: '凯尔希' });
    const named = await c.waitFor('account.bound');
    assert.equal(named.nickname, '凯尔希');
    await until(() => readAcc(dir, QQ).nickname === '凯尔希');

    // 重连（新 socket + 长期 token）：自动登录（每次登录轮换 token），云端 prefs 原样下行；旧会话被踢
    const token = await until(() => readAcc(dir, QQ).token);
    const { c: c2 } = await connect('Someone');
    c2.send({ t: 'hello', name: 'Someone', version: 1, account: token });
    const bound2 = await c2.waitFor('account.bound');
    assert.equal(bound2.qq, QQ);
    assert.match(bound2.token, /^[0-9a-f]{48}$/);
    assert.notEqual(bound2.token, token, '每次登录成功都轮换 token');
    assert.equal(srv.accounts.byToken(token), null, '登录用的旧 token 已失效');
    // 单账号单登录：先前那条（c）被踢下线
    assert.equal((await c.waitFor('account.logout')).reason, 'replaced');
    assert.equal((await c.closed).code, 4001);
    const data2 = await c2.waitFor('account.data');
    assert.equal(data2.nickname, '凯尔希', '昵称跟着账号走');
    const prefs2 = JSON.parse(await decryptPayload(data2.enc, await deriveKeyBytes(QQ, data2.salt)));
    assert.equal(prefs2.loadout, pref);
    assert.equal(prefs2.lang, '"zh"');
    assert.deepEqual(Object.keys(data2.meta).sort(), ['lang', 'loadout'], 'meta 带每个 key 的更新时间（增量对账用）');
    assert.ok(data2.meta.loadout > 0);

    // 退出登录：服务端忘掉本会话的账号并回执 account.logout
    const out = await c2.request({ t: 'account.logout' });
    assert.equal(out.t, 'ok');
    assert.equal((await c2.waitFor('account.logout')).t, 'account.logout');
  });

  test('失效 / 过期 token：hello 带回 account.logout，让客户端清掉本地凭据', async () => {
    // 伪造一个未知 token → 服务端不认，回 account.logout
    const { c } = await connect('Doctor');
    c.send({ t: 'hello', name: 'Doctor', version: 1, account: 'f'.repeat(48) });
    await c.waitFor('welcome');
    assert.equal((await c.waitFor('account.logout')).t, 'account.logout');
    await c.expectNone('account.data', () => true, 200);

    // 把 tokenIssuedAt 拨到 91 天前：重新读盘（= 服务重启）后判定过期
    const token = readAcc(dir, QQ).token;
    const acc = readAcc(dir, QQ);
    acc.tokenIssuedAt = Date.now() - TOKEN_TTL_MS - 1000;
    fs.writeFileSync(accountFile(dir, QQ), JSON.stringify(acc));
    const fresh = createAccountStore({ dir });
    assert.equal(fresh.tokenValid(QQ), false, '过期判定（90 天）');
    assert.equal(fresh.byToken(token).qq, QQ, 'token 本身还在，只是过期');
    const srv2 = await startServer({ port: 0, host: '127.0.0.1', log, accounts: { dir } });
    extra.push(srv2);
    const c3 = await TestClient.connect(`ws://127.0.0.1:${srv2.port}/ws`);
    clients.add(c3);
    await c3.hello('Doctor');
    c3.send({ t: 'hello', name: 'Doctor', version: 1, account: token });
    await c3.waitFor('welcome');
    assert.equal((await c3.waitFor('account.logout')).t, 'account.logout', '过期 token 视为失效，客户端据此清凭据重绑');
    await c3.expectNone('account.data', () => true, 200);
  });
});
