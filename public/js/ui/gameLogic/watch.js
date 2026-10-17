// ui/gameLogic/watch.js — field ids, the watch switcher, emote bubbles. Re-exported from ../gameLogic.js.

import { isObj, sortedPlayers } from './shared.js';
import { isCombatPhase } from './phases.js';
import { opponentRevealed } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


/** Own normal field id (DESIGN §8.3). */
export const ownFieldId = (playerId) => `n:${playerId}`;

/**
 * Field the player sits in right now (own normal field, or the unite/boss field that lists them).
 * @param {any} pub
 * @param {string} playerId
 */
export function homeFieldId(pub, playerId) {
  const fields = Array.isArray(pub?.fields) ? pub.fields : [];
  const special = fields.find((f) => isObj(f) && f.kind !== 'normal' && Array.isArray(f.players) && f.players.includes(playerId) && f.live !== false);
  if (special) return special.fieldId;
  const me = sortedPlayers(pub).find((p) => p.playerId === playerId);
  if (me && typeof me.fieldId === 'string' && me.fieldId) return me.fieldId;
  return ownFieldId(playerId);
}

/**
 * Next/previous watchable field for the ‹ › view switcher.
 * @param {Array<{fieldId:string, live?:boolean}>} fields
 * @param {string|null} current
 * @param {1|-1} dir
 * @returns {string|null}
 */
export function cycleField(fields, current, dir = 1) {
  const list = (Array.isArray(fields) ? fields : []).filter((f) => isObj(f) && typeof f.fieldId === 'string' && f.live !== false);
  if (list.length === 0) return null;
  const i = list.findIndex((f) => f.fieldId === current);
  if (i < 0) return list[0].fieldId;
  const n = list.length;
  return list[(((i + dir) % n) + n) % n].fieldId;
}

/**
 * What clicking a teammate row asks the server to watch, or why it can't (mirror of server Match.watch): an
 * eliminated player has no board to watch, and during 最终攻势 / 隐秘核心 a fighting player can't see the other
 * pair's boss field ("无法查看另一组队友的战场情况") — in co-op. In a 2V2 match the opponent's row stays a stub
 * (`hidden: true`) until the reveal (R14 on, shared/constants.js `opponentRevealed`); from then on it behaves like a
 * teammate's row and its boss field opens. A spectator seat (no own row) watches anyone.
 * @param {any} p m.public player row
 * @param {any} pub
 * @param {string} myId
 * @returns {{ fieldId: string } | { reason: string }}
 */
export function watchTarget(p, pub, myId) {
  if (!isObj(p)) return { reason: t('无效的目标') };
  const me0 = sortedPlayers(pub).find((x) => x.playerId === myId);
  // 2V2 ('versus'): `me.team` exists only in a versus match; before the reveal the opponent is a stub with no view
  const versus = !!me0 && me0.team != null;
  const revealed = versus && opponentRevealed(pub?.round);
  const opponent = versus && p.team != null && p.team !== me0.team;
  if (p.hidden === true || (opponent && !revealed)) {
    if (versus && !revealed) return { reason: t('R13 之后可以看到对面视角') };
    return { reason: t('非队友视角无法查看') };
  }
  if (p.alive === false) return { reason: t('该队友已被淘汰，无法查看其阵地') };
  const combat = isCombatPhase(pub?.phase);
  const fieldId = (combat && typeof p.fieldId === 'string' && p.fieldId) || ownFieldId(p.playerId);
  if (combat) {
    const fields = Array.isArray(pub?.fields) ? pub.fields.filter(isObj) : [];
    const f = fields.find((x) => x.fieldId === fieldId);
    const me = sortedPlayers(pub).find((x) => x.playerId === myId);
    const mine = fields.find((x) => Array.isArray(x.players) && x.players.includes(myId));
    // co-op keeps the other pair's boss field closed; a revealed 2V2 opponent's boss field opens
    if (f && (f.kind === 'boss' || f.kind === 'hidden') && me?.alive !== false && mine && mine.fieldId !== f.fieldId && !revealed) {
      return { reason: t('无法查看另一组队友的战场') };
    }
  }
  return { fieldId };
}

/**
 * Label of the ‹ › view switcher: the watched field (also one whose battle already ended), else the own field —
 * or, for an eliminated spectator (no own field), the watched player / 观战.
 * @param {any} pub
 * @param {string|null} watching fieldId on screen
 * @param {string} myId
 * @param {boolean} [spectating]
 */
export function switcherLabel(pub, watching, myId, spectating = false) {
  const fields = (Array.isArray(pub?.fields) ? pub.fields : []).filter(isObj);
  const cur = fields.find((f) => f.fieldId === watching);
  if (cur) return fieldLabel(cur, pub, myId);
  if (typeof watching === 'string' && watching.startsWith('n:') && watching !== ownFieldId(myId)) {
    return sortedPlayers(pub).find((p) => p.playerId === watching.slice(2))?.name || t('队友');
  }
  return spectating ? t('观战') : t('自己');
}

/**
 * Human label of a field for the view switcher.
 * @param {any} field { fieldId, kind, players }
 * @param {any} pub
 * @param {string} myId
 */
export function fieldLabel(field, pub, myId) {
  if (!isObj(field)) return '—';
  const names = new Map(sortedPlayers(pub).map((p) => [p.playerId, p.name || t('博士')]));
  const ps = Array.isArray(field.players) ? field.players : [];
  if (field.kind === 'unite') return ps.includes(myId) ? t('联防（自己）') : t('联防阵地');
  if (field.kind === 'boss' || field.kind === 'hidden') {
    if (ps.includes(myId)) return ps.length > 1 ? t('全景') : t('自己');
    return ps.map((id) => names.get(id) || t('博士')).join(' · ') || t('领袖战场');
  }
  if (ps.includes(myId) || field.fieldId === ownFieldId(myId)) return t('自己');
  const id = ps[0] ?? String(field.fieldId || '').replace(/^n:/, '');
  return names.get(id) || t('队友');
}

/**
 * [OVERVIEW] 查看队友时底部条上的概览：`m.public.players[]` 里那一行的 生命 / 等级 / 上场
 * （`lp` / `shopLevel` / `boardCount`）。1V1/人机里 `lp` 是这个人的目标生命值；2V2 里 `m.public` 给的是**队伍共享**
 * 的那条（面板两侧显示同一个数，服务端 views.js 就是这么发的）。
 * null = 看的是自己、没有这一行，或这是一条**不可见的对手 stub 行**（2V2 决赛前服务端把 `hidden: true` 的行抹成
 * 只有名字/队伍/共享生命，见 match/messaging.js _teamPublicView）——那时不该给观战者额外情报。
 * 三个数字各自判：服务端没发（老版本 / stub 行）就是 null，界面显示 '--'。
 * @param {any} pub m.public
 * @param {string|null} playerId 屏幕上的玩家（羁绊条 / 伤害统计的 ownerId）
 * @returns {{ lp: number|null, level: number|null, board: number|null }|null}
 */
export function watchedOverview(pub, playerId) {
  if (typeof playerId !== 'string' || !playerId) return null;
  const p = sortedPlayers(pub).find((x) => x.playerId === playerId) || null;
  if (!p || p.hidden === true) return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return { lp: num(p.lp), level: num(p.shopLevel), board: num(p.boardCount) };
}

/**
 * Active emote bubbles: playerId → { id, seq, at } for emotes younger than ttl.
 * @param {Array<{seq:number, playerId:string, id:string, at:number}>} emotes
 * @param {number} now
 * @param {number} [ttl]
 */
export function activeBubbles(emotes, now, ttl = 3000) {
  const out = new Map();
  for (const e of Array.isArray(emotes) ? emotes : []) {
    if (!isObj(e) || !(now - e.at < ttl) || e.at > now + 1000) continue;
    const cur = out.get(e.playerId);
    if (!cur || cur.seq < e.seq) out.set(e.playerId, { id: e.id, seq: e.seq, at: e.at });
  }
  return out;
}
