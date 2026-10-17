// server/chatlog.js — 对局对话记录：每局封存一份，供服务器查询与运维（本 fork 自有功能，不属上游包）。
// i18n-ignore-file: 本文件写的是**对局记录文件**的内容（标题/字段名/角色标记），不是界面文案。
//
// One file per match, named `<YYYYMMDD-HHmmss>-<roomCode>.log`, under CHAT_LOG_DIR — by default `<app>/对话记录`, i.e.
// OUTSIDE public/ and data/ so it is never served over HTTP.
//
// The whole match is collected in memory and written once on seal (对局结束后封存), so a spectator that joins mid-match
// still lands in the top 参与者 block sorted by join time, above the chronological 对话 transcript:
//
//   # 卫戍协议：狩猎模拟 · 对局对话记录
//   游戏：狩猎                                   ← 本部署的标识（可用 CHAT_LOG_GAME 覆盖）
//   房间号 / 模式 / 对局序号 / 开局时间 / 封存时间 / 消息数
//   ===== 参与者（按加入时间排序）=====           ← [加入时间] [玩家/观众] 名称=… | IP=…
//   ===== 对话（时间轴）=====                     ← [时间] 名称：说了啥（已过滤，但记原文便于审计）
//
// Records older than CHAT_LOG_RETAIN_DAYS (default 7) are deleted on load and after every seal.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 默认落盘目录 = <应用根>/对话记录（可用 CHAT_LOG_DIR 覆盖；**不走 HTTP**）。 */
export const DEFAULT_CHAT_LOG_DIR = path.join(HERE, '..', '对话记录');
/**
 * 本部署「游戏」标识（默认 狩猎，可用 CHAT_LOG_GAME 覆盖）—— 同一份代码可以在多个部署共用。
 * 记录文件里写两处：标题行 `# 卫戍协议：<全名> · 对局对话记录` 与独立的 `游戏：<标识>` 行。
 */
export const CHAT_LOG_GAME = process.env.CHAT_LOG_GAME || '狩猎';
/** 标题里的全名（可用 CHAT_LOG_TITLE 覆盖）。 */
export const CHAT_LOG_TITLE = process.env.CHAT_LOG_TITLE || '卫戍协议：狩猎模拟';
const RETAIN_DAYS = 7;

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

const p2 = (n) => String(n).padStart(2, '0');
/** `2026-10-12 14:33:22` */
const fmtTime = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
/** `20261012-143322` */
const fmtFile = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

/** Resolve the log dir (env CHAT_LOG_DIR → default) and make sure it exists. */
export function chatLogDir() {
  const dir = process.env.CHAT_LOG_DIR || DEFAULT_CHAT_LOG_DIR;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* leave it to the caller */ }
  return dir;
}

/** Delete `*.log` files older than RETAIN_DAYS (by mtime). Returns how many were removed. */
export function pruneChatLogs(dir = chatLogDir(), now = Date.now(), log = noopLog) {
  let removed = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const cutoff = now - RETAIN_DAYS * 86_400_000;
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    const abs = path.join(dir, name);
    try {
      if (fs.statSync(abs).mtimeMs < cutoff) { fs.unlinkSync(abs); removed++; }
    } catch { /* skip */ }
  }
  if (removed) log.info(`[chatlog] 清理 ${removed} 个超过 ${RETAIN_DAYS} 天的对话记录`);
  return removed;
}

/**
 * @param {{ roomCode?: string, matchNo?: number, mode?: string, difficulty?: string,
 *   game?: string, title?: string, now?: () => number, log?: object, dir?: string }} [opts]
 */
export function createChatLog({ roomCode = '----', matchNo = 0, mode = '', difficulty = '', game = CHAT_LOG_GAME, title = CHAT_LOG_TITLE, now = Date.now, log = noopLog, dir } = {}) {
  const startedAt = now();
  const root = dir || chatLogDir();
  try { fs.mkdirSync(root, { recursive: true }); } catch { /* seal will report */ }
  const file = path.join(root, `${fmtFile(new Date(startedAt))}-${roomCode}.log`);
  /** @type {Map<string, { playerId: string, name: string, ip: string, role: string, joinedAt: number }>} */
  const members = new Map();
  /** @type {Array<{ at: number, playerId: string, text: string, censored: boolean }>} */
  const events = [];
  let sealed = false;

  return {
    file,
    get messageCount() { return events.length; },

    /**
     * Record a participant / spectator (called at match start for every seat + spectator, and again when a spectator
     * joins a running match). Re-registering the same playerId updates its fields but keeps the first join time.
     * @param {{ playerId: string, name?: string, ip?: string, role?: string }} info
     */
    addMember({ playerId, name = '', ip = '?', role = '玩家' } = {}) {
      if (!playerId || sealed) return;
      const prev = members.get(playerId);
      members.set(playerId, {
        playerId,
        name: name || prev?.name || '',
        ip: ip || prev?.ip || '?',
        role: role || prev?.role || '玩家',
        joinedAt: prev?.joinedAt ?? now(),
      });
    },

    /** Record one chat line (the original text; `censored` marks whether it was filtered before broadcast). */
    addMessage({ playerId, text, censored = false } = {}) {
      if (!playerId || typeof text !== 'string' || !text || sealed) return;
      events.push({ at: now(), playerId, text, censored: !!censored });
    },

    /** Write the record once (封存). Idempotent. Returns the file path. */
    seal() {
      if (sealed) return file;
      sealed = true;
      const endedAt = now();
      const m = [...members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
      const nameOf = (id) => members.get(id)?.name || '未知';
      const lines = [];
      lines.push(`# ${title} · 对局对话记录`);
      lines.push('');
      lines.push(`游戏：${game}`);
      lines.push(`房间号：${roomCode}`);
      lines.push(`模式：${mode}${difficulty ? `（${difficulty}）` : ''}`);
      if (Number.isInteger(matchNo) && matchNo > 0) lines.push(`对局序号：#${matchNo}`);
      lines.push(`开局时间：${fmtTime(new Date(startedAt))}`);
      lines.push(`封存时间：${fmtTime(new Date(endedAt))}`);
      lines.push(`消息数：${events.length}`);
      lines.push('');
      lines.push('===== 参与者（按加入时间排序）=====');
      if (m.length) {
        for (const mem of m) {
          lines.push(`[${fmtTime(new Date(mem.joinedAt))}] [${mem.role}] 名称=${mem.name || '未知'} | IP=${mem.ip}`);
        }
      } else {
        lines.push('（无）');
      }
      lines.push('');
      lines.push('===== 对话（时间轴）=====');
      if (events.length) {
        for (const ev of events) {
          const who = nameOf(ev.playerId);
          lines.push(`[${fmtTime(new Date(ev.at))}] ${who}：${ev.text}${ev.censored ? '（已过滤）' : ''}`);
        }
      } else {
        lines.push('（本局无发言）');
      }
      lines.push('');
      try {
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        log.info(`[chatlog] 已封存 ${roomCode} 对局记录：${file}（${events.length} 条）`);
      } catch (e) {
        log.error(`[chatlog] 写记录失败 ${file}`, e);
      }
      try { pruneChatLogs(root, endedAt, log); } catch { /* ignore */ }
      return file;
    },
  };
}

// 进程启动时先清一次过期记录
try { pruneChatLogs(); } catch { /* ignore */ }
