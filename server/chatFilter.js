// server/chatFilter.js — 局内发言违禁词审核（本 fork 自有功能，不属上游包）。
//
// 词库来源（按优先级，第一个可读且非空的胜出）：
//   1. `CHAT_FILTER_FILE`                       显式指定单个文件
//   2. `CHAT_FILTER_SOURCES`                    路径列表（`;`/`:` 分隔）——**服务端路径只写在服务配置里**
//      例：systemctl edit <unit> → Environment=CHAT_FILTER_SOURCES=<官方词库文件的绝对路径>
//   3. `server/chat-banned.txt`                 本仓库自带的兜底词表（**只放示例占位**；完整词表留在线上部署，不进仓库）
//
// 词库文件格式：JSON `{ words: [...] }` / `[...]`，或纯文本（一行一词，`#` 注释）。
// 匹配为字面子串（ASCII 不区分大小写），命中替换为**等长** `*`，保持行内长度/位置。服务端权威，客户端只显示收到的内容。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 主词库候选路径（来自环境变量，**仓库里不写任何服务端路径**）。 */
export const CHAT_FILTER_SOURCES = Object.freeze(
  String(process.env.CHAT_FILTER_SOURCES || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean),
);

/** 本地兜底词表（始终与主词库合并）。 */
export const CHAT_FILTER_EXTRA = path.join(HERE, 'chat-banned.txt');

/** @type {string[]} */ let terms = [];
/** @type {string|null} */ let loadedFrom = null;
let initialized = false;

/** Parse a lexicon file: a JSON `{ words: [] }` / `[...]`, or a plain text list (one term per line, '#' comments). */
function parseLexicon(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (Array.isArray(data?.words) ? data.words : []);
    return list.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim());
  }
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/**
 * (Re)load the ban list. Primary: CHAT_FILTER_FILE → CHAT_FILTER_SOURCES (first readable, non-empty). The local
 * CHAT_FILTER_EXTRA word list is always merged on top. Returns the number of terms loaded.
 * @param {string} [file] explicit primary path (defaults to env then CHAT_FILTER_SOURCES)
 */
export function loadChatFilter(file = process.env.CHAT_FILTER_FILE || null) {
  const primary = file ? [file, ...CHAT_FILTER_SOURCES] : CHAT_FILTER_SOURCES;
  let list = [];
  let from = null;
  for (const cand of primary) {
    if (!cand) continue;
    try {
      const l = parseLexicon(cand);
      if (l.length) { list = l; from = cand; break; }
    } catch { /* try the next source */ }
  }
  if (CHAT_FILTER_EXTRA !== from) {
    try { list = list.concat(parseLexicon(CHAT_FILTER_EXTRA)); } catch { /* no extra list */ }
  }
  terms = [...new Set(list.filter(Boolean))].sort((a, b) => b.length - a.length);
  loadedFrom = from || (terms.length ? CHAT_FILTER_EXTRA : null);
  initialized = true;
  return terms.length;
}

/** The loaded terms (a copy) and where they came from — for diagnostics / the status page. */
export function chatFilterInfo() { return { count: terms.length, from: loadedFrom, terms: terms.slice() }; }

/**
 * Censor one line. Every term hit becomes '*' × term length.
 * @param {string} text
 * @param {string[]} [list] defaults to the loaded list
 * @returns {{ text: string, hits: string[], censored: boolean }}
 */
export function filterChat(text, list = null) {
  if (!initialized) { initialized = true; try { loadChatFilter(); } catch { /* keep empty */ } }
  const arr = Array.isArray(list) ? list : terms;
  const src = typeof text === 'string' ? text : '';
  if (!src || arr.length === 0) return { text: src, hits: [], censored: false };
  let out = src;
  const hits = [];
  for (const term of arr) {
    if (!term) continue;
    const needle = term.toLowerCase();
    let idx = out.toLowerCase().indexOf(needle);
    let found = false;
    while (idx !== -1) {
      found = true;
      out = out.slice(0, idx) + '*'.repeat(term.length) + out.slice(idx + term.length);
      idx = out.toLowerCase().indexOf(needle, idx + term.length);
    }
    if (found) hits.push(term);
  }
  return { text: out, hits, censored: hits.length > 0 };
}
