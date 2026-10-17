// server/account.js — [ACCOUNT] (the same file format and crypto as the 盟约 deployment).
//
// QQ-bound accounts + cloud persistence of the browser's local data. Everything lives on this machine:
// one JSON file per account under `<ACCOUNT_DIR>/accounts` — deliberately OUTSIDE the static dirs
// public/ data/ shared/ packs/, so a file is never served over HTTP. No database, no dependency.
//
// [ACCOUNT] 目录/密钥一律走环境变量（仓库里不出现任何服务端路径）：
//   ACCOUNT_DIR     账号库根目录 —— `accounts/<qq>.json`、`avatars/`、`records/` 都在它下面。
//                   默认 `<app>/.account`（**不是** `<app>/data/...`：那个目录由 static.js 挂在 /data/ 上，
//                   账号文件会被公网读到）。与盟约共用同一份数据时，两边把 ACCOUNT_DIR 指向同一个目录。
//   ACCOUNT_KEY_DIR 私钥目录 —— 里面放 `server.key`（RSA-2048，0600，**绝不进 git**）。
//                   默认 `<ACCOUNT_DIR>/account-secrets`；若该文件不存在、而账号目录里已有盟约那份
//                   `server.key`，则**直接沿用**它，这样两端的公开盐（salt = sha256(spki)）就是同一个
//                   （客户端按 qq 缓存派生密钥，两端盐不同会解不开对方的载荷）。
//
// 写盘：每账号一个**跨进程文件锁**（`accounts/.lock-<qq>`，带超时与陈旧锁回收）+ 临时文件 rename 原子替换。
//
// [ACCOUNT] **与盟约完全共享同一份账号数据**（用户 2026-10-17 口径，改回全共享）：同一份
// `accounts/<qq>.json`，同一套字段、同一套白名单、同一套写前合并——干员配装 / 持有 / 自选 / 设置 / 语言 /
// 表情主题 / 最近房间 / 大厅偏好全部共用，两边谁改另一边都能看到。
//   * 共享字段：qq / nickname / token / created / updatedAt / tokenIssuedAt / version / terms(+termsAt) /
//     friends / reqIn / reqOut / invites（[FRIEND] 用）/ **prefs + prefsMeta** / online。
//   * 在线时长（额外加的、两服兼容的最小字段，只增不改别人的键）：
//       online = { totalSec, lastSeenAt, games: { hunt: { sec, lastSeenAt }, covenant?: {...} } }
//     狩猎只累加 `totalSec` 与 `games.hunt`，`games.covenant`（以及其它未知键）原样保留；
//     下线写一次、在线时每 5 分钟一次（net.js 的心跳，见 NET_DEFAULTS.onlineFlushMs）。
//
// Identity = the QQ number. A player proves it by sending the 6-digit code the GAME shows into the QQ group
// (`/绑定 <code>`, the local bot's bind flow); the bot calls the loopback endpoint
// `POST /api/account/confirm { code, qq, nickname }`, which runs the closure the requesting WebSocket registered.
// A successful bind mints a long-lived account token the browser stores and replays in `hello.account`.
//
// Stored per account: { qq, nickname, token, created, prefs: { <key>: <json string> } }. `prefs` values are the
// exact JSON strings the client sent (so we never double-encode); keys are a fixed whitelist (the sp.pref.* keys).
// Writes are atomic (tmp + rename). Sizes are capped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto, { randomBytes, randomInt } from 'node:crypto';
import { NAME_MAX_LEN } from '../shared/constants.js';
import { deriveKeyNode, encryptNode, decryptNode } from '../shared/accountCrypto.js';

/** Repository root (this file is `<app>/server/account.js`). */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * [ACCOUNT] The account store's directories, from the environment (never a hard-coded server path):
 *   ACCOUNT_DIR      the shared root — `accounts/<qq>.json` (the account itself, shared with 盟约), `avatars/`,
 *                    `records/` live under it.
 *   ACCOUNT_KEY_DIR  where `server.key` lives (the RSA key whose SPKI hash is the public salt).
 * @param {Record<string, string | undefined>} [env]
 */
export function accountDirs(env = process.env) {
  const root = path.resolve(env.ACCOUNT_DIR || path.join(APP_ROOT, '.account'));
  return {
    root,
    accountsDir: path.join(root, 'accounts'),
    avatarsDir: path.join(root, 'avatars'),
    recordsDir: path.join(root, 'records'),
    keyDir: path.resolve(env.ACCOUNT_KEY_DIR || path.join(root, 'account-secrets')),
  };
}

/** How long a `writeNow` waits for another process's per-account lock, and when a lock is considered abandoned. */
export const LOCK_WAIT_MS = 600;
export const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 20;

/** [ACCOUNT] 账号库只存身份 + prefs（配装/设置/…）。对局记录已拆到独立的成就库（`records/<qq>.json`），
 *  不在 account.js 里，也不在 ACCOUNT_PREF_KEYS 白名单里。 */
/** The sp.pref.* keys an account may hold (client sends them as-is). */
export const ACCOUNT_PREF_KEYS = Object.freeze([
  'loadout', 'ownership', 'diy', 'settings', 'lang', 'emoteTheme', 'recentRooms', 'lobby.mode', 'lobby.difficulty',
]);
/** Largest single pref value (characters of its JSON) we accept. */
export const PREF_MAX_CHARS = 2_000_000;
/** Largest total prefs size per account. */
export const ACCOUNT_MAX_CHARS = 8_000_000;
/** Bind-code length / lifetime. */
export const CODE_LEN = 6;
export const CODE_TTL_MS = 180_000;
// [ACCOUNT-V2] account token lifetime (activity renews it) + confirm brute-force limits.
export const TOKEN_TTL_MS = 90 * 24 * 3600_000;
/** [ACCOUNT-V2] `touchToken` only rewrites the account file when the last persisted renewal is older than this
 *  (the in-memory `tokenIssuedAt` is always refreshed) — a reconnect storm must not hammer the disk. */
export const TOKEN_TOUCH_PERSIST_MS = 6 * 3600_000;
export const CONFIRM_MAX_FAILS = 8;         // per qq window
export const CONFIRM_WINDOW_MS = 5 * 60_000;
/** Friends: max per account, max queued invites, invite lifetime. */
export const FRIEND_MAX = 100;
export const FRIEND_INVITE_MAX = 10;
export const FRIEND_INVITE_TTL_MS = 60 * 60_000;

const QQ_RE = /^\d{5,12}$/;
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** A plain object (not an array / null). */
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A finite, non-negative number of seconds (missing → 0). */
const secOf = (o) => (isPlain(o) && Number.isFinite(o.sec) && o.sec > 0 ? Math.round(o.sec) : 0);
/** The same for an `online` block's `totalSec`. */
const totalSecOf = (o) => (isPlain(o) && Number.isFinite(o.totalSec) && o.totalSec > 0 ? Math.round(o.totalSec) : 0);
/** The empty `online` block a shared account file gets when it has none yet (see the header). */
const emptyOnline = () => ({ totalSec: 0, lastSeenAt: 0, games: {} });

/** Every store's `flush`, for the single process `exit` hook (`createAccountStore` adds itself). */
const flushers = new Set();
let exitHookInstalled = false;
/** Write every pending (debounced) account file before the process goes away. */
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => { for (const f of flushers) { try { f(); } catch { /* ignore */ } } });
}

/** Clamp a nickname like the server's hello name does (control / invisible chars out, length capped). */
function cleanNickname(name) {
  if (typeof name !== 'string') return '';
  // strip control chars, zero-width, bidi marks, BOM
  const s = name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').trim();
  return s.slice(0, NAME_MAX_LEN);
}

/** Random unique N-digit code (string). */
function newCode(digits, taken) {
  for (let i = 0; i < 50; i++) {
    let code = '';
    for (let d = 0; d < digits; d++) code += String(randomInt(0, 10));
    if (!taken.has(code)) return code;
  }
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/**
 * @param {{ dir?: string, keyDir?: string, log?: object, now?: () => number }} [opts]
 *   dir / keyDir: override ACCOUNT_DIR / ACCOUNT_KEY_DIR (tests pass a temp dir).
 */
export function createAccountStore({ dir, keyDir, log = noopLog, now = Date.now } = {}) {
  const dirs = accountDirs(dir || keyDir ? { ...process.env, ACCOUNT_DIR: dir, ACCOUNT_KEY_DIR: keyDir } : process.env);
  const root = dirs.accountsDir;
  /** @type {Map<string, any>} */ const byQQ = new Map();
  /** @type {Map<string, string>} */ const tokenToQQ = new Map();
  /** @type {Map<string, { fn: (qq: string, nickname: string) => void, at: number }>} */ const codes = new Map();
  /** [ACCOUNT-V2] per-qq failed-confirm window (brute-force guard) */
  const confirmFails = new Map();
  /** [ACCOUNT-V2] coalesced writes: qq → pending timer */
  const writeTimers = new Map();
  /** [ACCOUNT] 在线时长：还没落盘的整秒（qq → sec）与不足一秒的余数（qq → ms） */
  const onlinePendingSec = new Map();
  const onlineRemainderMs = new Map();
  /** [ACCOUNT] 本次写入要不要刷新 `online.lastSeenAt`（只有上下线/心跳才刷） */
  const onlineTouch = new Map();

  // The store is built for every server (tests included), so the expensive work is deferred to the first use:
  // creating the shared dirs, loading or generating `server.key`, and reading the account files.
  let ready = false;
  let saltHex = '0'.repeat(64);

  /**
   * [ACCOUNT] First use only — every public method below calls this. Creates the shared root's dirs
   * (`accounts/`, `avatars/`, `records/`, the key dir), loads or generates `server.key` and loads every account.
   */
  function ensure() {
    if (ready) return;
    ready = true;
    for (const d of [dirs.root, dirs.accountsDir, dirs.avatarsDir, dirs.recordsDir, dirs.keyDir]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch (e) { log.error('[account] mkdir failed', e); }
    }
    // [ACCOUNT] 自建服务器密钥（RSA-2048，私钥不出本机）→ salt = sha256(spki)。账号传输加密的 per-user key = f(qq, salt)。
    // 密钥优先取 ACCOUNT_KEY_DIR/server.key；那里没有、而账号目录里已有盟约那份（`<accounts>/server.key`）时沿用它 ——
    // 两端的公开盐因此一致，客户端按 qq 缓存的派生密钥在两边都能用。
    try {
      const candidates = [path.join(dirs.keyDir, 'server.key'), path.join(root, 'server.key')];
      const keyPath = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];
      let pem;
      if (fs.existsSync(keyPath)) pem = fs.readFileSync(keyPath, 'utf8');
      else {
        const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        pem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
        fs.writeFileSync(keyPath, pem, { mode: 0o600 });
        log.info('[account] generated server.key');
      }
      const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
      saltHex = crypto.createHash('sha256').update(spki).digest('hex');
    } catch (e) { log.error('[account] server key init failed', e); }

    // load the accounts (`accounts/<qq>.json`) — the SAME file 盟约 reads and writes
    try {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.json')) continue;
        try {
          const acc = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
          if (acc && typeof acc.qq === 'string' && QQ_RE.test(acc.qq)) {
            if (!isPlain(acc.prefs)) acc.prefs = {};
            ensureFriendFields(acc);
            if (!isPlain(acc.online)) acc.online = emptyOnline();
            // [ACCOUNT-V2] 迁移旧文件：补 version / updatedAt / prefsMeta / tokenIssuedAt / online（不动数据）
            if (!acc.version || acc.version < 2) {
              acc.version = 2;
              acc.updatedAt = acc.updatedAt || acc.created || now();
              if (!acc.tokenIssuedAt) acc.tokenIssuedAt = acc.created || now();
              if (!isPlain(acc.prefsMeta)) {
                acc.prefsMeta = {};
                for (const k of Object.keys(acc.prefs)) acc.prefsMeta[k] = acc.updatedAt;
              }
              try { writeNow(acc); } catch { /* ignore */ }
            } else if (!isPlain(acc.prefsMeta)) {
              acc.prefsMeta = {};
            }
            byQQ.set(acc.qq, acc);
            if (typeof acc.token === 'string' && acc.token) tokenToQQ.set(acc.token, acc.qq);
          }
        } catch { /* skip a corrupt file */ }
      }
    } catch (e) { log.error('[account] load failed', e); }
  }
  const keyForQQ = (qq) => deriveKeyNode(qq, saltHex, crypto);

  /** The account file (`accounts/<qq>.json`) — shared with 盟约: identity, prefs, online. */
  const fileOf = (qq) => path.join(root, `${qq}.json`);
  /** The per-account cross-process lock file (never a `.json`, so the loader skips it). */
  const lockOf = (qq) => path.join(root, `.lock-${qq}`);

  /** Block this thread for `ms` (Node has no other synchronous sleep without a dependency). */
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ } };

  /**
   * [ACCOUNT] Take the per-account file lock (best effort — the atomic rename keeps the file whole either way), run
   * `fn`, release. A lock older than LOCK_STALE_MS is stolen (the holder crashed mid-write).
   */
  function withLock(qq, fn) {
    const lock = lockOf(qq);
    const deadline = Date.now() + LOCK_WAIT_MS;
    let held = false;
    for (;;) {
      try {
        const fd = fs.openSync(lock, 'wx');
        try { fs.writeSync(fd, String(process.pid)); } catch { /* ignore */ }
        fs.closeSync(fd);
        held = true;
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') break; // no lock dir / no permission: carry on unlocked
        let st = null;
        try { st = fs.statSync(lock); } catch { /* it vanished — retry */ }
        if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) { try { fs.unlinkSync(lock); } catch { /* ignore */ } continue; }
        if (Date.now() >= deadline) { log.warn(`[account] lock busy for qq ${qq}, writing anyway`); break; }
        sleepSync(LOCK_RETRY_MS);
      }
    }
    try { return fn(); } finally { if (held) { try { fs.unlinkSync(lock); } catch { /* ignore */ } } }
  }

  /** Write one JSON file atomically (same directory → same file system, then rename). 0600. */
  function atomicWrite(file, value) {
    const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }

  /**
   * [ACCOUNT] Fold a newer on-disk copy of this account into `acc` before we overwrite it, so two processes sharing
   * the account dir (盟约 + 狩猎 on the same player) cannot lose each other's writes. Per pref key the newer
   * `prefsMeta` stamp wins (equal stamps: ours, the write in progress); queued invites are unioned by code.
   */
  function mergeDisk(acc, disk) {
    if (!disk || disk.qq !== acc.qq) return;
    const dPrefs = isPlain(disk.prefs) ? disk.prefs : {};
    const dMeta = isPlain(disk.prefsMeta) ? disk.prefsMeta : {};
    const aMeta = isPlain(acc.prefsMeta) ? acc.prefsMeta : (acc.prefsMeta = {});
    for (const [k, v] of Object.entries(dPrefs)) {
      if (typeof v !== 'string') continue;
      const ours = typeof acc.prefs[k] === 'string';
      const newer = typeof dMeta[k] === 'number' && typeof aMeta[k] === 'number' && dMeta[k] > aMeta[k];
      if (!ours || newer) { acc.prefs[k] = v; aMeta[k] = typeof dMeta[k] === 'number' ? dMeta[k] : (aMeta[k] ?? 0); }
    }
    if (typeof disk.updatedAt === 'number' && disk.updatedAt > (acc.updatedAt || 0)) acc.updatedAt = disk.updatedAt;
    // A token rotated by the other process (a re-bind) is the newest credential: adopt it instead of reviving ours.
    if (typeof disk.token === 'string' && disk.token && disk.token !== acc.token
      && typeof disk.tokenIssuedAt === 'number' && disk.tokenIssuedAt > (acc.tokenIssuedAt || 0)) {
      tokenToQQ.delete(acc.token);
      acc.token = disk.token;
      acc.tokenIssuedAt = disk.tokenIssuedAt;
      if (typeof disk.nickname === 'string' && disk.nickname) acc.nickname = disk.nickname;
      tokenToQQ.set(acc.token, acc.qq);
    }
    if (Array.isArray(disk.invites) && Array.isArray(acc.invites)) {
      const seen = new Set(acc.invites.map((i) => i && i.code));
      for (const i of disk.invites) if (i && i.code && !seen.has(i.code)) acc.invites.push(i);
      acc.invites = acc.invites.slice(-FRIEND_INVITE_MAX);
    }
  }

  /**
   * [ACCOUNT] The `online` block to persist: the DISK copy is the base (so two hunt processes, or a later covenant
   * writer, add up instead of overwriting), we add the pending seconds to `totalSec` and `games.hunt.sec` only.
   * Every other key (`games.covenant`, unknown fields) is carried over untouched.
   */
  function onlineOf(acc, base) {
    const src = isPlain(base) ? base : (isPlain(acc.online) ? acc.online : {});
    const games = isPlain(src.games) ? { ...src.games } : {};
    const delta = onlinePendingSec.get(acc.qq) || 0;
    if (delta) onlinePendingSec.delete(acc.qq);
    const prevHunt = isPlain(games.hunt) ? games.hunt : {};
    const touch = delta > 0 || onlineTouch.get(acc.qq) === true;
    if (onlineTouch.get(acc.qq)) onlineTouch.delete(acc.qq);
    const out = { ...src, totalSec: totalSecOf(src) + delta, games };
    if (touch) out.lastSeenAt = now();
    // `games.hunt` 只在真有在线时长（或本次是上下线/心跳）时出现；别的游戏的条目原样带过
    if (delta > 0 || touch) games.hunt = { ...prevHunt, sec: secOf(prevHunt) + delta, ...(touch ? { lastSeenAt: out.lastSeenAt } : null) };
    return out;
  }

  /** Write the account file: identity + token + prefs + online (atomic, under the per-account lock). */
  function writeNow(acc, { touchOnline = false } = {}) {
    if (!acc || typeof acc.qq !== 'string') return;
    if (touchOnline) onlineTouch.set(acc.qq, true);
    withLock(acc.qq, () => {
      let disk = null;
      try { disk = JSON.parse(fs.readFileSync(fileOf(acc.qq), 'utf8')); } catch { /* new account */ }
      mergeDisk(acc, disk);
      acc.online = onlineOf(acc, disk && disk.online);
      atomicWrite(fileOf(acc.qq), acc);
      log.debug?.('[account] write', 'main', acc.qq);
    });
    const t = writeTimers.get(acc.qq);
    if (t) { clearTimeout(t); writeTimers.delete(acc.qq); }
  }

  // [ACCOUNT-V2] 合并去抖：连续小改动 50ms 内只落盘一次（避免整文件反复重写）；flush()/进程退出时立即写。
  function persist(acc) {
    if (!acc || typeof acc.qq !== 'string') return;
    if (writeTimers.has(acc.qq)) return;
    const t = setTimeout(() => { writeTimers.delete(acc.qq); try { writeNow(acc); } catch (e) { log.error('[account] persist failed', e); } }, 50);
    if (t.unref) t.unref();
    writeTimers.set(acc.qq, t);
  }
  function flush() {
    for (const qq of [...writeTimers.keys()]) { try { writeNow(byQQ.get(qq)); } catch (e) { log.error('[account] flush failed', e); } }
  }
  // One process-level flush hook for every store (a store per server; tests create many).
  flushers.add(flush);
  installExitHook();

  function getOrCreate(qq, nickname = '') {
    let acc = byQQ.get(qq);
    if (!acc) {
      const t = now();
      acc = { qq, nickname: cleanNickname(nickname) || qq, token: randomBytes(24).toString('hex'), created: t, updatedAt: t, tokenIssuedAt: t, version: 2, prefs: {}, prefsMeta: {}, friends: [], reqIn: [], reqOut: [], invites: [], online: emptyOnline() };
      byQQ.set(qq, acc);
      tokenToQQ.set(acc.token, qq);
      writeNow(acc);
    } else if (nickname && cleanNickname(nickname) !== acc.nickname) {
      acc.nickname = cleanNickname(nickname);
      acc.updatedAt = now();
      persist(acc);
    }
    ensureFriendFields(acc);
    return acc;
  }

  /** [ACCOUNT-V2] Replace an account's token in place (the old token stops resolving). The new `tokenIssuedAt`
   *  marks it as the newest credential, so a merge from the other process (shared account dir) keeps it. */
  function rotateTokenOf(acc) {
    if (!acc || typeof acc.token !== 'string') return;
    tokenToQQ.delete(acc.token);
    acc.token = randomBytes(24).toString('hex');
    acc.tokenIssuedAt = now();
    tokenToQQ.set(acc.token, acc.qq);
    persist(acc);
  }

  function ensureFriendFields(acc) {
    if (!Array.isArray(acc.friends)) acc.friends = [];
    if (!Array.isArray(acc.reqIn)) acc.reqIn = [];
    if (!Array.isArray(acc.reqOut)) acc.reqOut = [];
    if (!Array.isArray(acc.invites)) acc.invites = [];
  }

  function pruneCodes(at) {
    for (const [code, e] of codes) if (at - e.at > CODE_TTL_MS) codes.delete(code);
  }

  const api = {
    get size() { ensure(); return byQQ.size; },
    dir: root,

    /** @param {unknown} token @returns {any|null} */
    byToken(token) {
      if (typeof token !== 'string' || !token) return null;
      const qq = tokenToQQ.get(token);
      return qq ? byQQ.get(qq) || null : null;
    },
    hasQQ(qq) { return typeof qq === 'string' && byQQ.has(qq); },
    /** The account's cloud prefs (`prefs` in the shared file — the SAME data 盟约 reads and writes). */
    prefsOf(qq) { const a = byQQ.get(qq); return a ? { ...a.prefs } : {}; },
    /** Per-key update stamps (used for the incremental reconcile on the client). */
    prefsMetaOf(qq) { const a = byQQ.get(qq); return a && isPlain(a.prefsMeta) ? { ...a.prefsMeta } : {}; },
    nicknameOf(qq) { const a = byQQ.get(qq); return a ? a.nickname : null; },
    /** [ACCOUNT] 在线时长（共享账号文件里的 `online` 块）：总时长 / 狩猎服时长 / 最后在线。 */
    onlineOf(qq) {
      const a = byQQ.get(qq);
      const on = a && isPlain(a.online) ? a.online : null;
      const games = on && isPlain(on.games) ? on.games : {};
      return {
        totalSec: totalSecOf(on),
        huntSec: secOf(games.hunt),
        lastSeenAt: on && Number.isFinite(on.lastSeenAt) ? on.lastSeenAt : 0,
      };
    },
    /**
     * [ACCOUNT] 累加在线时长（net.js 在**下线时一次** + 在线期间**每 5 分钟一次**调用；不频繁写盘）。
     * 只增 `online.totalSec` 与 `online.games.hunt.sec`，不碰 `games.covenant` 或其它键。
     * @param {string} qq @param {number} ms 本次要累加的毫秒
     */
    addOnlineSec(qq, ms) {
      const acc = byQQ.get(qq);
      if (!acc) return { error: 'NOT_FOUND' };
      const add = Number.isFinite(ms) && ms > 0 ? ms : 0;
      const total = (onlineRemainderMs.get(qq) || 0) + add;
      const sec = Math.floor(total / 1000);
      onlineRemainderMs.set(qq, total - sec * 1000);
      if (sec > 0) onlinePendingSec.set(qq, (onlinePendingSec.get(qq) || 0) + sec);
      writeNow(acc, { touchOnline: true }); // 下线/心跳各写一次（即使不足一秒也刷 lastSeenAt）
      return { ok: true, sec, online: this.onlineOf(qq) };
    },
    /** [BIND-RESUME] 完整账号记录（含 token）——用于把「连接已断时确认的绑定」回补给恢复的会话。 */
    accountOf(qq) { return (typeof qq === 'string' && byQQ.get(qq)) || null; },

    // ---- friends (mutual request / accept) + invites --------------------------------------------
    /** A bound account for this QQ exists. */
    exists(qq) { return typeof qq === 'string' && QQ_RE.test(qq) && byQQ.has(qq); },
    /** @param {string} qq @returns {{ friends: string[], reqIn: string[], reqOut: string[] }} */
    friendsOf(qq) {
      const a = byQQ.get(qq);
      if (!a) return { friends: [], reqIn: [], reqOut: [] };
      ensureFriendFields(a);
      return { friends: [...a.friends], reqIn: [...a.reqIn], reqOut: [...a.reqOut] };
    },
    /** `from` asks to befriend `to` (both must exist; mutual pending auto-accepts). */
    requestFriend(from, to) {
      if (!QQ_RE.test(String(to || ''))) return { error: 'BAD_QQ' };
      if (from === to) return { error: 'SELF' };
      const A = byQQ.get(from); const B = byQQ.get(to);
      if (!A) return { error: 'NOT_BOUND' };
      if (!B) return { error: 'NO_TARGET' };
      ensureFriendFields(A); ensureFriendFields(B);
      if (A.friends.includes(to)) return { error: 'ALREADY' };
      if (A.reqIn.includes(to)) return this.acceptFriend(from, to);
      if (A.friends.length >= FRIEND_MAX) return { error: 'LIMIT' };
      if (!A.reqOut.includes(to)) A.reqOut.push(to);
      if (!B.reqIn.includes(from)) B.reqIn.push(from);
      persist(A); persist(B);
      return { ok: true };
    },
    /** `qq` accepts the pending request from `from`; both become friends. */
    acceptFriend(qq, from) {
      const A = byQQ.get(qq); const B = byQQ.get(from);
      if (!A || !B) return { error: 'NOT_FOUND' };
      ensureFriendFields(A); ensureFriendFields(B);
      if (!A.reqIn.includes(from)) return { error: 'NO_REQUEST' };
      A.reqIn = A.reqIn.filter((x) => x !== from);
      A.reqOut = A.reqOut.filter((x) => x !== from);
      B.reqOut = B.reqOut.filter((x) => x !== qq);
      B.reqIn = B.reqIn.filter((x) => x !== qq);
      if (!A.friends.includes(from)) A.friends.push(from);
      if (!B.friends.includes(qq)) B.friends.push(qq);
      persist(A); persist(B);
      return { ok: true };
    },
    rejectFriend(qq, from) {
      const A = byQQ.get(qq); const B = byQQ.get(from);
      if (A) { ensureFriendFields(A); A.reqIn = A.reqIn.filter((x) => x !== from); persist(A); }
      if (B) { ensureFriendFields(B); B.reqOut = B.reqOut.filter((x) => x !== qq); persist(B); }
      return { ok: true };
    },
    removeFriend(qq, other) {
      const A = byQQ.get(qq); const B = byQQ.get(other);
      if (A) { ensureFriendFields(A); A.friends = A.friends.filter((x) => x !== other); persist(A); }
      if (B) { ensureFriendFields(B); B.friends = B.friends.filter((x) => x !== qq); persist(B); }
      return { ok: true };
    },
    /** Queue an invite for an offline friend (online delivery is done by the lobby, live). */
    addInvite(to, invite) {
      const B = byQQ.get(to);
      if (!B) return { error: 'NO_TARGET' };
      ensureFriendFields(B);
      B.invites = B.invites.filter((i) => i && i.code !== invite.code).slice(-(FRIEND_INVITE_MAX - 1));
      B.invites.push({ ...invite, at: now() });
      try { persist(B); } catch { /* ignore */ }
      return { ok: true };
    },
    invitesOf(qq) {
      const a = byQQ.get(qq);
      if (!a || !Array.isArray(a.invites)) return [];
      const fresh = a.invites.filter((i) => i && now() - (i.at || 0) <= FRIEND_INVITE_TTL_MS);
      if (fresh.length !== a.invites.length) { a.invites = fresh; try { persist(a); } catch { /* ignore */ } }
      return [...fresh];
    },
    dismissInvite(qq, code) {
      const a = byQQ.get(qq);
      if (!a || !Array.isArray(a.invites)) return { ok: true };
      a.invites = a.invites.filter((i) => !i || i.code !== code);
      try { persist(a); } catch { /* ignore */ }
      return { ok: true };
    },

    /**
     * Store one pref value (the client's JSON string) in the SHARED account file — the same `prefs` / `prefsMeta`
     * 盟约 reads and writes, so both servers see the same loadout / settings / language.
     * @param {string} qq @param {string} key @param {string} json
     */
    setPref(qq, key, json) {
      const acc = byQQ.get(qq);
      if (!acc) return { error: 'NOT_BOUND' };
      if (!ACCOUNT_PREF_KEYS.includes(key)) return { error: 'BAD_KEY' };
      if (typeof json !== 'string' || json.length > PREF_MAX_CHARS) return { error: 'TOO_BIG' };
      let total = json.length;
      for (const [k, v] of Object.entries(acc.prefs)) if (k !== key) total += (typeof v === 'string' ? v.length : 0);
      if (total > ACCOUNT_MAX_CHARS) return { error: 'TOO_BIG' };
      acc.prefs[key] = json;
      acc.prefsMeta = isPlain(acc.prefsMeta) ? acc.prefsMeta : {};
      acc.prefsMeta[key] = now();
      acc.updatedAt = now();
      try { persist(acc); } catch (e) { log.error('[account] persist failed', e); return { error: 'IO' }; }
      return { ok: true };
    },

    /** [ACCOUNT-V2] token 是否在有效期内（活动会续期）。 */
    tokenValid(qq, at = now()) { const a = byQQ.get(qq); if (!a) return false; const iat = a.tokenIssuedAt || a.created || 0; return at - iat <= TOKEN_TTL_MS; },
    /** [ACCOUNT-V2] 活动续期（在 hello 命中账号时调用）：内存始终刷新，**落盘节流**（见 TOKEN_TOUCH_PERSIST_MS）。 */
    touchToken(qq) {
      const a = byQQ.get(qq);
      if (!a) return;
      const t = now();
      const prev = a.tokenIssuedAt || 0;
      a.tokenIssuedAt = t;
      if (t - prev > TOKEN_TOUCH_PERSIST_MS) persist(a);
    },

    // [ACCOUNT] 传输加密：salt（公开）与 per-qq 加解密。
    salt() { return saltHex; },
    enc(qq, plaintext) { try { return encryptNode(plaintext, keyForQQ(qq), crypto); } catch { return null; } },
    dec(qq, b64) { try { return decryptNode(b64, keyForQQ(qq), crypto); } catch { return null; } },
    flush,

    /** @param {string} qq @param {string} nickname */
    setNickname(qq, nickname) {
      const acc = byQQ.get(qq);
      if (!acc) return { error: 'NOT_FOUND' };
      const n = cleanNickname(nickname);
      if (!n) return { error: 'BAD_NAME' };
      acc.nickname = n;
      try { persist(acc); } catch (e) { log.error('[account] persist failed', e); return { error: 'IO' }; }
      return { ok: true, nickname: n };
    },

    /** [TERMS] Record the accepted user-agreement version (and server time) on the account. */
    setTerms(qq, version, at = now()) {
      const acc = byQQ.get(qq);
      if (!acc) return { error: 'NOT_FOUND' };
      acc.terms = { version: String(version || '').slice(0, 32), at };
      acc.termsAt = new Date(at).toISOString();
      try { persist(acc); } catch (e) { log.error('[account] persist failed', e); return { error: 'IO' }; }
      return { ok: true };
    },

    /** Register a pending bind: returns the code to show in-game; `fn(qq, nickname)` runs on a successful confirm. */
    newCode(fn) {
      pruneCodes(now());
      const code = newCode(CODE_LEN, codes);
      codes.set(code, { fn, at: now() });
      return { code, ttlMs: CODE_TTL_MS };
    },

    /**
     * The group confirmed `code` for `qq`. Binds (runs the requester's closure) and mints the account if needed.
     * @param {unknown} code @param {unknown} qq @param {unknown} nickname
     */
    confirm(code, qq, nickname) {
      pruneCodes(now());
      const c = typeof code === 'string' ? code.trim() : String(code ?? '').trim();
      const q = typeof qq === 'string' ? qq.trim() : String(qq ?? '').trim();
      if (!QQ_RE.test(q)) return { error: 'BAD_QQ' };
      // [ACCOUNT-V2] 防暴力：同一 qq 在窗口内失败过多则拒绝
      const f = confirmFails.get(q);
      if (f && now() - f.at < CONFIRM_WINDOW_MS && f.n >= CONFIRM_MAX_FAILS) return { error: 'TOO_MANY' };
      const entry = codes.get(c);
      if (!entry) {
        const rec = f && now() - f.at < CONFIRM_WINDOW_MS ? f : { at: now(), n: 0 };
        rec.n++; rec.at = now();
        confirmFails.set(q, rec);
        return { error: 'BAD_CODE' };
      }
      confirmFails.delete(q);
      codes.delete(c);
      // create with the group nickname the first time; a re-bind keeps any in-game rename
      const existing = byQQ.get(q);
      const acc = existing || getOrCreate(q, nickname);
      // [ACCOUNT] **每次绑定成功都轮换 token**（单账号单登录）：盟约那边的旧 token 随之失效，
      // 它的旧会话只会在下一次 hello / 重连时拿到 account.logout（方案 A 的边界，不碰盟约代码）。
      rotateTokenOf(acc);
      try { entry.fn(acc.qq, acc.nickname, acc.token); } catch (e) { log.error('[account] bind fn failed', e); }
      return { ok: true, qq: acc.qq, nickname: acc.nickname };
    },

    /** Rotate (revoke) an account's token; the old one stops working. */
    rotateToken(qq) {
      const acc = byQQ.get(qq);
      if (!acc) return { error: 'NOT_FOUND' };
      rotateTokenOf(acc);
      return { ok: true };
    },
  };
  // Every public entry point initializes the store on first use (`this` is kept: requestFriend calls this.acceptFriend).
  // Accessors (`get size`) are left alone — they call ensure() themselves, and reading one here would initialize early.
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(api))) {
    if (desc.get || desc.set || typeof desc.value !== 'function') continue;
    const fn = desc.value;
    Object.defineProperty(api, key, { ...desc, value: function ensured(...args) { ensure(); return fn.apply(this, args); } });
  }
  return api;
}
