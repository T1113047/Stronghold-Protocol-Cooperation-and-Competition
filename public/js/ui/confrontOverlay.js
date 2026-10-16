// 对抗期 overlay (2V2, PHASE.CONFRONT) — two steps, both sides in step:
//   step 1 ('target'): pick the OPPONENT this seat attacks. The panel shows the opponents as '?' with their P number and
//     their team's colour — no name, no avatar. Inside a team it is first come, first served (the server hands the
//     teammate whatever is left).
//   step 2 ('monster'): fill this seat's VALUE BUDGET (server confront.js confrontBudget — PER PLAYER, no count limit)
//     with monsters of ONE of the 6 equal-value groups, each on a gate (上路 'upper' / 下路 'lower'), all inserted
//     together at one position of the wave (靠前/靠中/靠后 = 25/50/75 % of the round's monster count). Submitting early is
//     fine; the step always runs its window out.
// Texts go through t() (docs/I18N.md).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel } from '../ui/components.js';
import { Img, GIcon, PlayerAvatar, useGameData } from '../ui/gameComponents.js';
import { enemyIconUrl } from '../ui/assetUrls.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const POSITIONS = [['front', '靠前'], ['mid', '靠中'], ['back', '靠后']];
/**
 * The squad this browser last submitted (module-level: the overlay unmounts between rounds, the page does not). The
 * 沿用上轮 button refits these kinds to the CURRENT round's budget — values and the groups' membership move per round.
 */
let lastSquad = null;

/** P1 / P2 … of a player row (the seat number) — how the panel tells hidden opponents apart. */
const pNo = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '');

/** A small enemy chip: icon + name + value (used in the group cards and the placement panel). */
function EnemyChip({ m, rec, count, onAdd, disabled }) {
  return html`<button type="button" class=${cx('cchip', disabled && 'is-disabled')} disabled=${disabled} onClick=${() => onAdd && onAdd(rec)}
      title=${`${rec.name}（${rec.value}）`}>
    <span class="cchip__icon"><${Img} src=${enemyIconUrl(m, rec.key)} fallback=${html`<${GIcon} name="target" />`} /></span>
    <span class="cchip__name">${rec.name}</span>
    <span class="cchip__val num">${rec.value}</span>
    ${count ? html`<span class="cchip__count num">×${count}</span>` : null}
  </button>`;
}

/**
 * @param {{ pub:any, busy?:boolean, onTarget:(targetPlayerId:string)=>void, onConfirm:(group:number, position:string, picks:object[])=>void }} props
 */
export function ConfrontOverlay({ pub, busy = false, onTarget, onConfirm }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  const [group, setGroup] = useState(null);
  const [picks, setPicks] = useState([]); // [{ enemyKey, gate }]
  const [position, setPosition] = useState('mid');
  useEffect(() => { setGroup(null); setPicks([]); setPosition('mid'); }, [conf && conf.round]);
  if (!conf || !conf.active) return null;
  const m = gd.m;
  const groups = Array.isArray(conf.groups) ? conf.groups : [];
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  const mates = players.filter((p) => p.team != null && p.team === myTeam);
  const foes = players.filter((p) => p.team != null && myTeam != null && p.team !== myTeam);
  const targets = conf.targets || {};
  const myTarget = targets[myId] || null;
  const stage = conf.stage || 'target';
  const sel = group != null ? groups[group - 1] || [] : [];
  // step 2: the placement cap is this seat's VALUE budget — no count limit, only Σ value ≤ budget
  const budget = Math.max(0, Number(conf.budget) || 0);
  const valOf = (key) => (sel.find((r) => r.key === key) || {}).value || 0;
  const spent = picks.reduce((s, p) => s + valOf(p.enemyKey), 0);
  const remaining = Math.max(0, budget - spent);
  const fits = (rec) => !busy && rec.value <= remaining;
  const add = (rec) => { if (fits(rec)) setPicks((p) => [...p, { enemyKey: rec.key, gate: 'lower' }]); };
  const remove = (i) => setPicks((p) => p.filter((_, k) => k !== i));
  // 队列交互: a placed monster defaults to 下路 — TAP it to switch the gate, PRESS AND HOLD it to drag it in the order.
  // (The up/down buttons and the per-row gate buttons are gone: both actions live on the row itself.)
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const press = useRef({ i: null, timer: null, x: 0, y: 0, armed: false });
  const toggleGate = (i) => setPicks((p) => p.map((x, k) => (k === i ? { ...x, gate: x.gate === 'lower' ? 'upper' : 'lower' } : x)));
  const moveTo = (from, to) => setPicks((p) => {
    if (from === to || from < 0 || to < 0 || from >= p.length || to >= p.length) return p;
    const c = p.slice();
    const [x] = c.splice(from, 1);
    c.splice(to, 0, x);
    return c;
  });
  const rowDown = (e, i) => {
    if (submitted) return;
    const s = press.current;
    clearTimeout(s.timer);
    s.i = i;
    s.x = e.clientX;
    s.y = e.clientY;
    s.armed = false;
    s.timer = setTimeout(() => { if (press.current.i === i) { press.current.armed = true; setDragIdx(i); setOverIdx(i); } }, 380);
  };
  const listMove = (e) => {
    const s = press.current;
    if (s.i == null) return;
    if (!s.armed) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) { clearTimeout(s.timer); s.i = null; }
      return;
    }
    if (e.cancelable) e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && typeof el.closest === 'function' ? el.closest('[data-qidx]') : null;
    if (row) setOverIdx(Number(row.getAttribute('data-qidx')));
  };
  const listUp = () => {
    const s = press.current;
    clearTimeout(s.timer);
    if (s.i != null) {
      if (s.armed) { if (overIdx != null && overIdx !== s.i) moveTo(s.i, overIdx); }
      else toggleGate(s.i);
    }
    s.i = null;
    s.armed = false;
    setDragIdx(null);
    setOverIdx(null);
  };
  const mine = conf.subs ? conf.subs[myId] : null;
  const submitted = !!mine;
  const foesPicked = mates.every((p) => targets[p.playerId]);
  /**
   * 自动选择: fill the budget the way the AI does (most expensive monster that still fits, walking the group by value),
   * on the currently chosen group (the first when none is chosen). The player tweaks from there — and a player who never
   * submits gets exactly this at the window's end (server confront.js botConfront / finishConfront).
   */
  const autoPick = () => {
    if (submitted || busy) return;
    const gi = group != null ? group : (groups.length ? 1 : 0);
    if (!gi) return;
    const list = (groups[gi - 1] || []).slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    const out = [];
    let left = budget;
    for (const r of list) {
      if (r.value > left) continue;
      left -= r.value;
      out.push({ enemyKey: r.key, gate: 'lower' });
    }
    setGroup(gi);
    setPicks(out);
    setPosition('mid');
  };
  /**
   * 沿用上轮: the kinds this browser submitted last time, in the same order, refitted to THIS round's budget — and the
   * LEFTOVER is topped up with the auto-selection's greedy walk (when nothing more fits, the leftover simply stays).
   */
  const reuse = () => {
    if (submitted || busy || !lastSquad || !lastSquad.keys.length) return;
    const gi = groups.findIndex((g) => g.some((r) => r.key === lastSquad.keys[0]));
    const idx = gi >= 0 ? gi + 1 : (group != null ? group : 1);
    if (!idx) return;
    const list = groups[idx - 1] || [];
    const out = [];
    const used = new Set();
    let left = budget;
    for (const key of lastSquad.keys) {
      const rec = list.find((r) => r.key === key);
      if (!rec || used.has(key) || rec.value > left) continue;
      left -= rec.value;
      used.add(key);
      out.push({ enemyKey: key, gate: lastSquad.gates[out.length] || (out.length % 2 ? 'upper' : 'lower') });
    }
    for (const r of list.slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)))) {
      if (used.has(r.key) || r.value > left) continue;
      left -= r.value;
      used.add(r.key);
      out.push({ enemyKey: r.key, gate: 'lower' });
    }
    if (!out.length) return;
    setGroup(idx);
    setPicks(out);
    setPosition(lastSquad.position || 'mid');
  };
  const confirm = () => {
    if (!picks.length) return;
    lastSquad = { keys: picks.map((p) => p.enemyKey), gates: picks.map((p) => p.gate), position };
    onConfirm(group, position, picks);
  };

  return html`<div class="spov confov" role="dialog" aria-label=${t('对抗期')}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="mint">CONFRONTATION // ${t('对抗期')}</${MicroLabel}>
          ${stage === 'target'
            ? html`<h2 class="spov__title">${t('选择你要针对的对手')}
                <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 对手以 ? 显示，只看编号', { r: conf.round })}</span></h2>`
            : html`<h2 class="spov__title">${t('为 {p} 定制怪物', { p: myTarget ? pNo(foes.find((f) => f.playerId === myTarget)) || '?' : '?' })}
                <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 你的怪只会出现在这个对手的波次', { r: conf.round })}</span></h2>`}
          <p class="spov__sub">${stage === 'target'
            ? (myTarget ? t('已锁定目标，等待队友与对手') : t('点击一个 ? 头像框锁定你的目标'))
            : (submitted ? t('你已提交，等待时间走完') : t('选择一组怪物 → 点怪加入（不限数量，只限总价值）'))}</p>
        </div>
        <div class="spov__turn">
          ${stage === 'monster'
            ? (submitted
              ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已提交')}</span>`
              : html`<span class="spov__turntxt">${t('已用价值 {spent}/{budget}', { spent, budget })}</span>`)
            : null}
          ${stage === 'monster' && !submitted ? html`<${Button} variant="secondary" size="md" title=${t('按价值自动挑满预算，之后可以手动调整')} onClick=${autoPick}>${t('自动选择')}<//>` : null}
          ${stage === 'monster' && !submitted && lastSquad ? html`<${Button} variant="secondary" size="md" title=${t('沿用上一轮的编队（按本轮预算重新装填）')} onClick=${reuse}>${t('沿用上轮')}<//>` : null}
          ${stage === 'monster' && !submitted && group != null ? html`<${Button} variant="primary" size="lg" icon="check" loading=${busy}
            disabled=${picks.length === 0} onClick=${confirm}>${t('提交（{n} 只 · {spent}/{budget}）', { n: picks.length, spent, budget })}<//>` : null}
        </div>
      </header>

      ${stage === 'target' ? html`<div class="confov__targets">
        <div class="confov__foes">
          ${foes.map((f) => html`<button key=${f.playerId} type="button" class=${cx('conffoe', `conffoe--${f.team === 0 ? 'blue' : 'red'}`, myTarget === f.playerId && 'is-sel')}
            disabled=${!!myTarget || busy} onClick=${() => onTarget(f.playerId)}>
            <span class="conffoe__q">?</span>
            <span class="conffoe__p num">${pNo(f)}</span>
          </button>`)}
        </div>
        <div class="confov__pairs">
          ${mates.map((p) => html`<span key=${p.playerId} class=${cx('confpair', p.playerId === myId && 'is-self')}>
            <b class="num">${pNo(p)}</b>
            <span class="confpair__state">${targets[p.playerId] ? t('已选择') : t('未选择')}</span>
          </span>`)}
        </div>
        <p class="confov__hint t-dim">${foesPicked ? t('双方都选好了，马上开始定制怪物') : t('对手被随机分配：先选的先得，队友自动拿剩下的那一个')}</p>
      </div>` : html`
      <div class="confov__groups">
        ${groups.map((g, i) => {
          const total = g.reduce((s, r) => s + r.value, 0);
          const isSel = group === i + 1;
          return html`<button key=${i} type="button" class=${cx('confgroup', isSel && 'is-sel')} disabled=${submitted} onClick=${() => { setGroup(i + 1); setPicks([]); }}>
            <span class="confgroup__head">
              <b class="confgroup__name">G${i + 1}</b>
              <span class="confgroup__meta num">${g.length} ${t('种')} · ${t('总价值 {v}', { v: total })}</span>
            </span>
            <span class="confgroup__icons">
              ${g.map((r) => html`<span key=${r.key} class="confgroup__ic" title=${`${r.name}（${r.value}）`}><${Img} src=${enemyIconUrl(m, r.key)} fallback=${html`<${GIcon} name="target" />`} /></span>`)}
            </span>
          </button>`;
        })}
      </div>

      ${group != null ? html`<div class="confov__body">
        <section class="confov__pool">
          <h3 class="confov__h">${t('G{n} 的怪物（点击加入）', { n: group })} <span class="num t-dim">${t('剩余价值 {v}', { v: remaining })}</span></h3>
          <div class="confov__chips">
            ${sel.map((r) => html`<${EnemyChip} key=${r.key} m=${m} rec=${r} disabled=${submitted || !fits(r)} onAdd=${add} />`)}
          </div>
        </section>
        <section class="confov__placed">
          <h3 class="confov__h">${t('已放置（出怪顺序）')} <span class="num">${picks.length} · ${spent}/${budget}</span></h3>
          <p class="confov__tip t-dim">${t('点一下换门 · 长按拖动排序（默认下路）')}</p>
          ${picks.length ? html`<ol class="confov__list" onPointerMove=${listMove} onPointerUp=${listUp} onPointerCancel=${listUp} onPointerLeave=${listUp}>
            ${picks.map((p, i) => {
              const rec = sel.find((r) => r.key === p.enemyKey) || { key: p.enemyKey, name: p.enemyKey, value: 0 };
              return html`<li key=${`${p.enemyKey}:${i}`} data-qidx=${i}
                  class=${cx('confrow', p.gate === 'upper' && 'is-upper', dragIdx === i && 'is-drag', overIdx === i && dragIdx != null && dragIdx !== i && 'is-over')}
                  title=${t('点击换门 · 长按拖动排序')} onPointerDown=${(e) => rowDown(e, i)}>
                <span class="confrow__idx num">${i + 1}</span>
                <span class="confrow__icon"><${Img} src=${enemyIconUrl(m, rec.key)} fallback=${html`<${GIcon} name="target" />`} /></span>
                <span class="confrow__name">${rec.name}</span>
                <span class="confrow__gate2">${t(p.gate === 'upper' ? '上路' : '下路')}</span>
                <span class="confrow__order">
                  <button type="button" disabled=${submitted} onPointerDown=${(e) => e.stopPropagation()} onClick=${() => remove(i)} aria-label=${t('移除')}><${Icon} name="close" /></button>
                </span>
              </li>`;
            })}
          </ol>` : html`<p class="confov__empty t-dim">${t('还没有放置怪物')}</p>`}
          <h3 class="confov__h">${t('出怪位置')}</h3>
          <div class="confpos">
            ${POSITIONS.map(([id, label]) => html`<button key=${id} type="button" class=${cx('confpos__opt', position === id && 'is-on')}
              disabled=${submitted} onClick=${() => setPosition(id)}>${t(label)}<span class="confpos__pct num">${id === 'front' ? '25%' : id === 'mid' ? '50%' : '75%'}</span></button>`)}
          </div>
        </section>
      </div>` : html`<p class="confov__hint t-dim">${t('先选择上面的一个怪物组')}</p>`}
      `}
    </div>
  </div>`;
}

/**
 * The clash: once both sides have locked their interventions the pairs hit each other on screen — the own team's
 * attacker (avatar + P number) against the opponent it aimed at (a '?' frame, P number only) with the monsters it
 * throws. Display only: it fades out by itself and never blocks the battle that starts behind it.
 * @param {{ pub:any }} props
 */
export function ConfrontClash({ pub }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  const [shown, setShown] = useState(true);
  const round = conf && conf.round;
  useEffect(() => {
    setShown(true);
    const h = setTimeout(() => setShown(false), 2800);
    return () => clearTimeout(h);
  }, [round]);
  if (!conf || conf.active || !conf.subs || !shown) return null;
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  const mates = players.filter((p) => p.team != null && p.team === myTeam);
  const rows = mates.map((p) => ({ attacker: p, sub: conf.subs[p.playerId] })).filter((r) => r.sub && r.sub.target && (r.sub.picks || []).length);
  if (!rows.length) return null;
  const side = (p) => (p && p.team === 1 ? 'red' : 'blue');
  const pNoOf = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '?');
  return html`<div class="confclash" aria-hidden="true">
    <div class="confclash__inner">
      ${rows.map((r) => {
        const foe = players.find((p) => p.playerId === r.sub.target) || null;
        return html`<div key=${r.attacker.playerId} class="confclash__row">
          <span class=${cx('confclash__side', `confclash__side--${side(r.attacker)}`)}>
            <${PlayerAvatar} player=${r.attacker} size="sm" />
            <span class="confclash__p num">${pNoOf(r.attacker)}</span>
          </span>
          <span class="confclash__mid">
            ${(r.sub.picks || []).slice(0, 8).map((pk, i) => html`<${Img} key=${`${pk.enemyKey}:${i}`} src=${enemyIconUrl(gd.m, pk.enemyKey)} fallback=${html`<${GIcon} name="target" />`} />`)}
            <span class="confclash__vs">✕</span>
          </span>
          <span class=${cx('confclash__side', `confclash__side--${side(foe)}`)}>
            <span class="confclash__q">?</span>
            <span class="confclash__p num">${pNoOf(foe)}</span>
          </span>
        </div>`;
      })}
    </div>
  </div>`;
}
