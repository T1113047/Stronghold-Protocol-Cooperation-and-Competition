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

describe('[ACCOUNT] 账号文件格式 v2', () => {
  test('新建账号的字段与盟约一致：qq/nickname/token/created/updatedAt/tokenIssuedAt/version/prefs/prefsMeta/friends/reqIn/reqOut/invites', () => {
    const dir = tmpRoot();
    boundStore(dir, '10001', 'Nick');
    const acc = readAcc(dir, '10001');
    assert.deepEqual(Object.keys(acc).sort(), [
      'created', 'friends', 'invites', 'nickname', 'prefs', 'prefsMeta', 'qq', 'reqIn', 'reqOut', 'token', 'tokenIssuedAt', 'updatedAt', 'version',
    ]);
    assert.equal(acc.version, 2);
    assert.equal(acc.qq, '10001');
    assert.equal(acc.nickname, 'Nick');
    assert.match(acc.token, /^[0-9a-f]{48}$/);
    assert.equal(typeof acc.created, 'number');
    assert.equal(acc.updatedAt, acc.created);
    assert.equal(acc.tokenIssuedAt, acc.created);
    assert.deepEqual(acc.prefs, {});
    assert.deepEqual(acc.prefsMeta, {});
    // 白名单：只有盟约那 9 个 sp.pref.* 键
    assert.deepEqual(ACCOUNT_PREF_KEYS, ['loadout', 'ownership', 'diy', 'settings', 'lang', 'emoteTheme', 'recentRooms', 'lobby.mode', 'lobby.difficulty']);
  });

  test('旧文件（无 version）自动迁移到 v2：补 version/updatedAt/prefsMeta/tokenIssuedAt，不动已有数据', () => {
    const dir = tmpRoot();
    const file = accountFile(dir, '10002');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = { qq: '10002', nickname: 'Old', token: 'a'.repeat(48), created: 1000, prefs: { loadout: '{"v":1,"entries":[]}' } };
    fs.writeFileSync(file, JSON.stringify(raw));
    const store = createAccountStore({ dir });
    assert.deepEqual(store.prefsOf('10002'), { loadout: '{"v":1,"entries":[]}' });
    const acc = readAcc(dir, '10002');
    assert.equal(acc.version, 2);
    assert.equal(acc.updatedAt, 1000);
    assert.equal(acc.tokenIssuedAt, 1000);
    assert.deepEqual(acc.prefsMeta, { loadout: 1000 });
    assert.equal(acc.prefs.loadout, '{"v":1,"entries":[]}', '已有存档没被改动');
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
    assert.equal(readAcc(dir, '10004').prefs.lang, JSON.stringify('zh-19'));
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

  test('两个进程共写一个账号目录：密钥不互相覆盖（写前合并）', () => {
    const dir = tmpRoot();
    const a = createAccountStore({ dir });
    const b = createAccountStore({ dir });
    const ca = a.newCode(() => {}); const cb = b.newCode(() => {});
    a.confirm(ca.code, '10007', 'A');
    b.confirm(cb.code, '10007', 'A');
    // 两台“游戏”各自改自己的存档键，然后各自落盘
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
    const acc = readAcc(dir, '10007');
    a.setPref('10007', 'lang', '"zh-TW"');
    a.flush();
    b.setPref('10007', 'lang', '"en"');
    b.flush();
    assert.equal(readAcc(dir, '10007').prefs.lang, '"en"', '后写（时间戳更新）的一份胜出');
    assert.ok(acc.prefsMeta.lang > 0);
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

  test('重新绑定 / rotateToken 立刻吊销旧 token', async () => {
    const dir = tmpRoot();
    const store = createAccountStore({ dir });
    const c1 = store.newCode(() => {}); const c2 = store.newCode(() => {});
    store.confirm(c1.code, '10014', 'T');
    const old = readAcc(dir, '10014').token; // 新账号第一次绑定是同步落盘的
    assert.equal(store.byToken(old).qq, '10014');
    store.confirm(c2.code, '10014', 'T2');
    const fresh = await until(() => { const t = readAcc(dir, '10014').token; return t !== old ? t : null; });
    assert.ok(fresh, '重新绑定后 token 变了（已落盘）');
    assert.notEqual(fresh, old);
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

    // 重连（新 socket + 长期 token）：自动登录，云端 prefs 原样下行
    const token = await until(() => readAcc(dir, QQ).token);
    const { c: c2 } = await connect('Someone');
    c2.send({ t: 'hello', name: 'Someone', version: 1, account: token });
    const bound2 = await c2.waitFor('account.bound');
    assert.equal(bound2.qq, QQ);
    assert.equal(bound2.token, token);
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
