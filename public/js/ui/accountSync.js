// [ACCOUNT] Apply the account's cloud prefs (server/account.js) to the browser's local state — the counterpart of the
// existing 导出/导入 (ui/loadoutSync.js, screens/stats.js): loadout / ownership / diy reuse their normal apply paths,
// settings go through settingsStore, stats are merged by record id, and the small keys are written to localStorage.
// `main.js` calls applyAccountPrefs() when the account logs in (account.data), with its debounced uploader paused so
// applying does not echo straight back to the server.

import { setEntries, setOpsMap, setNotOwned, setDiyPicks } from './loadoutSync.js';
import { parseStoredDiy } from './diyModel.js';
import { settingsStore } from './settings.js';
import { sanitizeSettings } from './gameLogic.js';

const SIMPLE_KEYS = ['lang', 'emoteTheme', 'recentRooms', 'lobby.mode', 'lobby.difficulty'];
const STATS_KEY = 'sp.pref.stats';

/** Every `sp.pref.*` key the account mirrors (same set as the server whitelist, server/account.js).
 *  对局记录（stats）已移出账号库，归成就系统（account.records + account/records/<qq>.json），不在此列。 */
export const ALL_PREF_KEYS = Object.freeze(['loadout', 'ownership', 'diy', 'settings', ...SIMPLE_KEYS]);

/**
 * [BOARDMODE]/[UNITMODELS] The JSON to upload for one pref key. 画面自动调节 / 棋盘样式 / 角色模型（`pictureAuto` /
 * `boardForce` / `unitsForce`）是**本机（设备）相关**设置，不随账号同步：上传前从 settings 里剥掉这三个字段
 * （其余 key 原样返回；解析失败的 settings 也原样返回）。
 * @param {string} key
 * @param {string|null} json
 * @returns {string|null}
 */
export function syncPrefJson(key, json) {
  if (key !== 'settings' || typeof json !== 'string' || !json) return json;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== 'object') return json;
    delete o.pictureAuto;
    delete o.boardForce;
    delete o.unitsForce;
    return JSON.stringify(o);
  } catch { return json; }
}

/**
 * [CACHEREFRESH] Push the WHOLE local pref set to the account, once — used right before 「退出登录」 so nothing the
 * player changed lingers only locally. Fire-and-forget (the socket is ordered, so these land before `account.logout`).
 * @param {{ saveAccount?: (key: string, json: string) => any }} net
 */
export function uploadAllAccountPrefs(net) {
  if (!net || typeof net.saveAccount !== 'function') return;
  for (const key of ALL_PREF_KEYS) {
    let json = null;
    try { json = globalThis.localStorage?.getItem(`sp.pref.${key}`) || null; } catch { /* ignore */ }
    if (json == null) continue;
    try { net.saveAccount(key, syncPrefJson(key, json)); } catch { /* ignore */ }
  }
}

/** Parse one pref value (the stored JSON string) or undefined. */
function parse(json) {
  if (typeof json !== 'string' || !json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

/** Whether a parsed pref value carries any content (空 = 不该覆盖本地). */
function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** The local stats envelope string (localStorage `sp.pref.stats`) or null. */
export function localStatsJson() {
  try { return globalThis.localStorage?.getItem(STATS_KEY) || null; } catch { return null; }
}

/** Set of record ids in a stats envelope string (empty when unreadable). */
export function statsIdsOf(json) {
  const p = parse(json);
  const recs = p && Array.isArray(p.records) ? p.records : [];
  return new Set(recs.map((r) => r && r.id).filter((x) => typeof x === 'string'));
}

/** Overwrite the local stats envelope with the given string (cloud copy). */
export function writeLocalStats(json) {
  if (typeof json !== 'string' || !json) return;
  try { globalThis.localStorage?.setItem(STATS_KEY, json); } catch { /* ignore */ }
}

/** Union two stats envelopes by record id; on a same id the fuller (non-compact) copy wins. */
function mergeStats(incoming) {
  let cur = { v: incoming.v ?? 1, records: [] };
  try {
    const raw = globalThis.localStorage?.getItem(STATS_KEY);
    if (raw) { const p = JSON.parse(raw); if (p && Array.isArray(p.records)) cur = p; }
  } catch { /* ignore */ }
  const byId = new Map();
  for (const r of [...(cur.records || []), ...incoming.records]) {
    if (!r || typeof r.id !== 'string') continue;
    const old = byId.get(r.id);
    // 同 id：优先保留未压缩（信息更全）的一版；服务端权威记录多为 compact，本地那版通常更全
    if (!old || (old.compact && !r.compact)) byId.set(r.id, r);
  }
  try { globalThis.localStorage?.setItem(STATS_KEY, JSON.stringify({ v: cur.v ?? incoming.v ?? 1, records: [...byId.values()] })); } catch { /* ignore */ }
}

/** [ACCOUNT] Merge the server's canonical match records into the local stats (prefer the fuller copy on an id). */
export function mergeCanonicalRecords(records) {
  if (!Array.isArray(records) || !records.length) return;
  mergeStats({ v: 1, records });
}

/** [ACCOUNT] The local match records (newest first), or [] when unreadable. */
export function localRecords() {
  const json = localStatsJson();
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return p && Array.isArray(p.records) ? p.records : [];
  } catch { return []; }
}

/**
 * Apply a server `account.data.prefs` map ({ key: jsonString }) to local state.
 *
 * Empty-handling (owner's rule): a cloud copy that is **empty** never overwrites the local one — "云端为空保留本地"，
 * 两边都空自然跳过。So each key is applied only when it carries content; a reset done on another device (a cleared
 * loadout / 自选 / 持有) does NOT propagate as a wipe. `stats` is the exception (its own merge/replace/skip conflict rule).
 * @param {Record<string, string>|null|undefined} prefs
 * @param {{ stats?: 'merge'|'replace'|'skip' }} [opts] how to handle the stats key:
 *   'merge' (default) union cloud into local, 'replace' overwrite local with cloud, 'skip' leave local untouched.
 */
export function applyAccountPrefs(prefs, opts = {}) {
  if (!prefs || typeof prefs !== 'object') return;

  const lo = parse(prefs.loadout);
  if (lo && typeof lo === 'object') {
    if (nonEmpty(lo.entries)) setEntries(lo.entries);
    if (nonEmpty(lo.ops)) setOpsMap(lo.ops);
  }

  if (prefs.ownership != null) {
    const ow = parse(prefs.ownership);
    const list = Array.isArray(ow) ? ow : (ow && Array.isArray(ow.notOwned) ? ow.notOwned : []);
    if (list.length) setNotOwned(list); // 云端为空（= 全部持有）→ 保留本地
  }

  if (prefs.diy != null) {
    const env = parse(prefs.diy); // the cloud value is the stored JSON STRING `{ v, picks }` — parse it first
    const picks = env && typeof env === 'object' ? parseStoredDiy(env) : {};
    if (nonEmpty(picks)) setDiyPicks(picks); // 云端为空 → 保留本地
  }

  const st = parse(prefs.settings);
  if (st && typeof st === 'object' && nonEmpty(st)) {
    try {
      // [BOARDMODE]/[UNITMODELS] 画面自动调节 / 棋盘样式 / 角色模型 是本机（设备）设置，不随账号同步：保留本地值
      const cur = settingsStore.get();
      settingsStore.set(sanitizeSettings({ ...st, pictureAuto: cur.pictureAuto, boardForce: cur.boardForce, unitsForce: cur.unitsForce }));
    } catch { /* ignore */ }
  }

  const statsMode = opts.stats || 'merge';
  if (statsMode === 'replace') {
    if (typeof prefs.stats === 'string' && prefs.stats) writeLocalStats(prefs.stats);
  } else if (statsMode === 'merge') {
    const sv = parse(prefs.stats);
    if (sv && Array.isArray(sv.records) && sv.records.length) mergeStats(sv);
  } // 'skip': leave the local copy as it is

  for (const key of SIMPLE_KEYS) {
    if (prefs[key] == null) continue;
    if (!nonEmpty(parse(prefs[key]))) continue; // 云端为空 → 保留本地
    try { globalThis.localStorage?.setItem(`sp.pref.${key}`, prefs[key]); } catch { /* ignore */ }
  }
}
