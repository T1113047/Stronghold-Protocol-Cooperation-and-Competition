// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD` (the two loopback ops paths below also take POST);
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * the ops API the local QQ bot uses (server/http/rooms.js — 仅回环，静态处理之前):
//     GET /api/rooms (a snapshot of the rooms) and POST /api/rooms/reap (dispose dead rooms; POST only — a stray GET
//     must never sweep the lobby), plus POST /api/notify
//     (broadcast an `m.notice` to every open socket, net.js Network.broadcastNotice). A non-loopback peer or a
//     request carrying any forwarding header is answered 404, exactly like an unknown path — room codes never reach
//     the internet, and the API must not reveal that it exists;
//   * [ACCOUNT] GET /api/account/salt (the public salt the client derives its per-qq key from) and
//     POST /api/account/confirm { code, qq, nickname } — the local QQ bot proves a
//     bind code from the group; loopback only, exactly like the rooms API;
//   * [ACH] GET /api/records?qq=&limit= — the achievement record store's summary (score + chess piece + the newest
//     matches) for the local bot; loopback only and read-only, guarded exactly like the rooms API;
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { pieceOf } from '../../shared/achievement.js'; // [ACH] 评分 → 棋子称号（回环记录查询）
import { scoreRecords } from '../records.js'; // [ACH-STORE] 权威记录求和
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { isReapPath, readBody, reapRooms, roomsApiAllowed, roomsPayload, REAP_BODY_MAX } from './rooms.js';
import { clientAddress, isLocalIp } from '../net.js';

const MAX_URL_LENGTH = 4096;
/** POST /api/notify body cap (one announcement text, net.js NOTICE_MAX_LEN is 200 code points). */
const NOTIFY_BODY_MAX = 4096;

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, traffic, assetIndex, views }, withTraffic = false) {
  const report = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           accounts?: import('../account.js').createAccountStore | null,
 *           records?: import('../recordStore.js').createRecordStore | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY)
 *   accounts: [ACCOUNT] the QQ account store (null in tests / when disabled)
 *   records: [ACH-STORE] the achievement record store (null in tests / when disabled)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', accounts = null, records = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    const reapPath = isReapPath(parts.rawPath);          // [ROOMS-API] POST /api/rooms/reap
    const notifyPath = parts.rawPath === '/api/notify';  // [NOTICE] POST /api/notify
    const confirmPath = parts.rawPath === '/api/account/confirm'; // [ACCOUNT] POST /api/account/confirm
    const postPath = reapPath || notifyPath || confirmPath;
    if (req.method !== 'GET' && req.method !== 'HEAD' && !(postPath && req.method === 'POST')) {
      res.setHeader('Allow', postPath ? 'GET, HEAD, POST' : 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    // [ACCOUNT] 账号传输加密的公开盐（服务器公钥指纹）：客户端据此派生 per-qq 密钥，公开无敏感。
    if (parts.rawPath === '/api/account/salt') {
      if (!accounts || typeof accounts.salt !== 'function') { sendError(req, res, 404, '未找到 · Not found'); return; }
      sendJson(req, res, 200, { ok: true, salt: accounts.salt() });
      return;
    }
    // [ACCOUNT] the QQ bot confirms a bind code: loopback only, exactly like the rooms API. The group's QQ/nickname
    // come from the bot; this side only runs the closure the requesting WebSocket registered.
    if (confirmPath) {
      if (!accounts || !roomsApiAllowed(req)) { sendError(req, res, 404, '未找到 · Not found'); return; }
      let payload = {};
      try {
        const text = await readBody(req, 8192);
        if (text.trim()) payload = JSON.parse(text);
      } catch (e) {
        if (e && e.code === 'E_TOO_LARGE') sendJson(req, res, 413, { ok: false, error: 'body-too-large' });
        else sendJson(req, res, 400, { ok: false, error: 'bad-body' });
        return;
      }
      const body = payload && typeof payload === 'object' ? payload : {};
      const r = accounts.confirm(body.code, body.qq, body.nickname);
      if (r && r.error) sendJson(req, res, r.error === 'BAD_CODE' || r.error === 'BAD_QQ' ? 400 : 500, { ok: false, error: r.error });
      else sendJson(req, res, 200, { ok: true, qq: r.qq, nickname: r.nickname });
      return;
    }
    // [ACH] 对局记录查询（插件 `/卫戍协议 对局记录`）：仅回环，按 qq 返回成就库汇总 + 最近若干局。
    if (parts.rawPath === '/api/records') {
      if (!roomsApiAllowed(req) || !records) { sendError(req, res, 404, '未找到 · Not found'); return; }
      const params = new URLSearchParams(parts.query || '');
      const qq = (params.get('qq') || '').trim();
      if (!/^\d{5,12}$/.test(qq)) { sendJson(req, res, 400, { ok: false, error: 'bad-qq' }); return; }
      let limit = Number(params.get('limit'));
      if (!Number.isFinite(limit) || limit <= 0) limit = 8;
      limit = Math.min(Math.round(limit), 50);
      const all = records.recordsOf(qq);
      const score = scoreRecords(all);
      const piece = pieceOf(score);
      sendJson(req, res, 200, {
        ok: true, qq, count: all.length, score,
        piece: { id: piece.id, name: piece.name, min: piece.min, glyph: piece.glyph },
        records: all.slice(0, limit),
      });
      return;
    }
    // [ROOMS-API] 运维查询接口（本机 QQ 机器人）：GET /api/rooms 快照 · POST /api/rooms/reap 收房。
    // 仅回环；非回环 peer 或带任何转发头 → 404（和未知道路一样，不暴露存在性）。放在静态处理之前。
    if (parts.rawPath === '/api/rooms' || reapPath) {
      if (!roomsApiAllowed(req)) { sendError(req, res, 404, '未找到 · Not found'); return; }
      // ▸ the reaper is a write path: a stray GET must never sweep the lobby (the reference answered GET like a POST).
      // The guard sits after the loopback refusal, so a forwarded request still sees the ordinary 404.
      if (reapPath && req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
        return;
      }
      if (!reapPath) { sendJson(req, res, 200, roomsPayload(health.lobby)); return; }
      let payload = {};
      try {
        const text = await readBody(req, REAP_BODY_MAX);
        if (text.trim()) payload = JSON.parse(text);
      } catch (e) {
        if (e && e.code === 'E_TOO_LARGE') sendJson(req, res, 413, { ok: false, error: 'body-too-large' });
        else sendJson(req, res, 400, { ok: false, error: 'bad-body' });
        return;
      }
      sendJson(req, res, 200, reapRooms(health.lobby, payload, log));
      return;
    }
    // [NOTICE] 服务器通知（仅回环）：text 清洗后作为 `m.notice` 广播给所有在线连接（大厅 / 房间 / 对局中）。
    if (notifyPath) {
      if (!roomsApiAllowed(req) || !health.network || typeof health.network.broadcastNotice !== 'function') {
        sendError(req, res, 404, '未找到 · Not found');
        return;
      }
      let payload = {};
      try {
        const text = await readBody(req, NOTIFY_BODY_MAX);
        if (text.trim()) payload = JSON.parse(text);
      } catch (e) {
        if (e && e.code === 'E_TOO_LARGE') sendJson(req, res, 413, { ok: false, error: 'body-too-large' });
        else sendJson(req, res, 400, { ok: false, error: 'bad-body' });
        return;
      }
      // ▸ JSON.parse may hand back null / a primitive: read `text` defensively (a bare `payload.text` would throw).
      const text = String(payload && typeof payload === 'object' ? payload.text ?? '' : '').trim();
      if (!text) { sendJson(req, res, 400, { ok: false, error: 'empty' }); return; }
      const sent = health.network.broadcastNotice(text);
      sendJson(req, res, 200, { ok: true, sent });
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
