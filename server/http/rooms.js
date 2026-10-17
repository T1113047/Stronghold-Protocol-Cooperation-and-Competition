// server/http/rooms.js — 运维查询接口（移植自服务服 server/http/rooms.js，本地补丁，不属上游包）。
// [ROOMS-API] The room API the QQ bot plugin 「卫戍协议房间」 reads:
//
//   GET  /api/rooms        a read-only snapshot, one entry per room. **Loopback only**: a request that arrived
//                          through a tunnel or a reverse proxy (any forwarding header) is answered 404, exactly
//                          like an unknown path — a room code is an admission key, so it must stay off the
//                          internet.
//   POST /api/rooms/reap   dispose dead rooms; every judgement (idle time, in-match, played-before) lives here,
//                          not in the plugin.
//
// The wiring lives in routes.js (before the static handler); the broadcast of POST /api/notify lands in
// net.js (Network.broadcastNotice) and the frame in shared/protocol.js (`m.notice`).

import { normalizeIp } from '../net.js';

/** A room is reaped once it has been idle this long (unless the caller names it and passes minIdleMs). */
export const DEFAULT_REAP_IDLE_MS = 120_000;
/** POST body cap for the reaper. */
export const REAP_BODY_MAX = 4096;
/** Most room codes one reap call may name. */
export const REAP_MAX_CODES = 64;

/**
 * Headers that mean the request came through a proxy or a tunnel. Any one of them refuses the request: the ops API
 * is for the bot on this host, and a tunnel on the same machine would otherwise look like a loopback peer.
 */
const FORWARD_HEADERS = Object.freeze([
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip',
]);

/** True for the reaper's write path (POST /api/rooms/reap, with or without the trailing slash). */
export function isReapPath(rawPath) {
  return rawPath === '/api/rooms/reap' || rawPath === '/api/rooms/reap/';
}

/** Collect a small request body (the reaper's JSON); rejects with { code: 'E_TOO_LARGE' } past the cap. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { code: 'E_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The ops API serves the bot on this host only: a request that went through a tunnel or a reverse proxy (any
 * forwarding header) is refused, and so is a non-loopback peer. Both see an ordinary 404.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function roomsApiAllowed(req) {
  const headers = (req && req.headers) || {};
  for (const name of FORWARD_HEADERS) if (headers[name] != null) return false;
  // normalizeIp (net.js) lowercases, drops the zone id and maps ::ffff:127.0.0.1 → 127.0.0.1, so a dual-stack
  // listener ('::' by default) still recognises a local IPv4 client.
  const ip = normalizeIp(req && req.socket ? req.socket.remoteAddress : '');
  return ip === '127.0.0.1' || ip === '::1';
}

/**
 * One room in the shape the plugin expects. `matchmake` is our 2V2 (versus) fork's 「对外开放快速匹配」 flag; the
 * plugin shows it beside `mode`.
 * @param {import('../lobby.js').Room} room
 */
export function roomSummary(room) {
  const now = Date.now();
  const seats = room.seats || [];
  const humans = seats.filter((s) => s && !s.isBot && !s.left);
  const bots = seats.filter((s) => s && s.isBot && !s.left);
  // ▸ our Room has no idleSince: "idle" is how old the room is (what the A server's fallback settles on too)
  const idleSince = room.idleSince ?? room.createdAt ?? now;
  return {
    code: room.code,
    mode: room.mode,
    difficulty: room.difficulty,
    inMatch: !!room.match,
    matchmake: !!room.matchmake, // [MATCHMAKE]
    round: room.match ? (Number(room.match.round) || 0) : 0,
    matchCount: room.matchCount || 0,
    humans: humans.length,
    bots: bots.length,
    seats: seats.length,
    spectators: (room.spectators || []).length,
    players: humans.map((s) => s.name).filter(Boolean),
    idleMs: Math.max(0, now - idleSince),
    createdAt: room.createdAt ?? null,
  };
}

/**
 * GET /api/rooms — read-only snapshot; every judgement (idle time included) stays on this side.
 * @param {import('../lobby.js').Lobby} lobby
 */
export function roomsPayload(lobby) {
  const rooms = [...lobby.rooms.values()].map(roomSummary);
  rooms.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { ok: true, now: Date.now(), count: rooms.length, rooms };
}

/**
 * POST /api/rooms/reap { minIdleMs?, codes?, includePlayed?, dryRun? } — dispose dead rooms:
 *   codes given   → take exactly those (minIdleMs 0 means "no waiting"); a running match is always kept;
 *   no codes      → sweep every room idle ≥ minIdleMs (a nonsense minIdleMs falls back to the default);
 *   includePlayed → also take rooms that already finished a match (the plugin's 「强推」);
 *   dryRun        → classify only, dispose nothing.
 * A room is disposed through the lobby's own path (Lobby.disposeRoom → room.closed {reason:'expired'}), so its
 * members are detached and its match context is disposed exactly as on a shutdown.
 * @param {import('../lobby.js').Lobby} lobby
 * @param {any} body
 * @param {{ error: Function }} log
 */
export function reapRooms(lobby, body, log) {
  const dryRun = body?.dryRun === true;
  const includePlayed = body?.includePlayed === true;
  const codes = [];
  if (Array.isArray(body?.codes)) {
    for (const raw of body.codes) {
      const code = String(raw ?? '').trim().toUpperCase();
      if (code && !codes.includes(code)) codes.push(code);
      if (codes.length >= REAP_MAX_CODES) break;
    }
  }
  let minIdleMs = Number(body?.minIdleMs);
  if (!Number.isFinite(minIdleMs) || minIdleMs < 0) minIdleMs = DEFAULT_REAP_IDLE_MS;
  // a sweep that names no room must never take the whole lobby down with it
  if (!codes.length && minIdleMs <= 0) minIdleMs = DEFAULT_REAP_IDLE_MS;

  const now = Date.now();
  const targets = codes.length ? codes.map((code) => lobby.getRoom(code)) : [...lobby.rooms.values()];
  const reaped = [];
  const kept = [];
  for (const room of targets) {
    if (!room || room.disposed) continue; // already gone: the plugin reports it as "no such room"
    const code = room.code;
    if (room.match) { kept.push({ code, why: 'in-match' }); continue; }
    if ((room.matchCount || 0) > 0 && !includePlayed) { kept.push({ code, why: 'played-before' }); continue; }
    const idleMs = Math.max(0, now - (room.idleSince ?? room.createdAt ?? now));
    if (idleMs < minIdleMs) { kept.push({ code, why: 'too-young' }); continue; }
    if (!dryRun) {
      try { lobby.disposeRoom(room, 'expired'); }
      catch (e) { log.error('[http] reap failed', e); kept.push({ code, why: 'error' }); continue; }
    }
    reaped.push({ code, idleMs, matchCount: room.matchCount || 0 });
  }
  return { ok: true, dryRun, minIdleMs, includePlayed, reaped, kept };
}
