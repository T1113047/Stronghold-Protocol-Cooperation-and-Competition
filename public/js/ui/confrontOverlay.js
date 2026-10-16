// 对抗期 overlay (2V2, PHASE.CONFRONT): pick one of the 6 monster groups (VERSUS_CONFRONT.groups; each enemy of the pool
// with its icon, name and value) and place up to `maxPicks` of its monsters in spawn order, each on a gate/route. The
// confirm sends `g.confront { group, picks }` (server/match/match/confront.js). Only the OWN team's submission is shown
// (the opponent's is hidden by the m.public isolation until the Final Assault).
// Texts go through t() (docs/I18N.md).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel } from '../ui/components.js';
import { Img, GIcon, useGameData } from '../ui/gameComponents.js';
import { enemyIconUrl } from '../ui/assetUrls.js';
import { useStore } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const MAX_PICKS = 12;
const ROUTE_OF = ['上路', '中路', '下路', '空路'];
const GROUP_NAMES = [N_('最小威胁'), N_('低威胁'), N_('中低威胁'), N_('中高威胁'), N_('高威胁'), N_('最大威胁')];

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
 * @param {{ pub:any, busy?:boolean, onConfirm:(group:number, picks:object[])=>void }} props
 */
export function ConfrontOverlay({ pub, busy = false, onConfirm }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  const [group, setGroup] = useState(null);
  const [picks, setPicks] = useState([]); // [{ enemyKey, routeIndex }]
  useEffect(() => { setGroup(null); setPicks([]); }, [conf && conf.round]);
  if (!conf || !conf.active) return null;
  const m = gd.m;
  const groups = Array.isArray(conf.groups) ? conf.groups : [];
  const myTeam = (pub.players || []).find((p) => p.playerId === myId)?.team ?? null;
  const mine = myTeam != null && conf.subs ? conf.subs[myTeam] : null;
  const submitted = !!mine;
  const sel = group != null ? groups[group - 1] || [] : [];
  const maxPicks = Math.min(MAX_PICKS, Math.max(1, Math.round((conf.ratio || 0.1) * 30)));
  const add = (rec) => {
    if (submitted || picks.length >= maxPicks) return;
    setPicks((p) => [...p, { enemyKey: rec.key, routeIndex: 0 }]);
  };
  const setRoute = (i, r) => setPicks((p) => p.map((x, k) => (k === i ? { ...x, routeIndex: r } : x)));
  const remove = (i) => setPicks((p) => p.filter((_, k) => k !== i));
  const move = (i, d) => setPicks((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const c = p.slice();
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  return html`<div class="spov confov" role="dialog" aria-label=${t('对抗期')}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="mint">CONFRONTATION // ${t('对抗期')}</${MicroLabel}>
          <h2 class="spov__title">${t('选择一组怪物，替换对面本回合 {p}% 的出怪', { p: Math.round((conf.ratio || 0.1) * 100) })}
            <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 队内协商（对手看不到你的选择）', { r: conf.round })}</span></h2>
          <p class="spov__sub">${submitted ? t('你已提交，等待队伍完成') : t('选择一组怪物 → 点怪加入 → 排出怪顺序与门')}</p>
        </div>
        <div class="spov__turn">
          ${submitted ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已提交')}</span>` : null}
          ${!submitted && group != null ? html`<${Button} variant="primary" size="lg" icon="check" loading=${busy}
            disabled=${picks.length === 0} onClick=${() => onConfirm(group, picks)}>${t('提交（{n}/{max}）', { n: picks.length, max: maxPicks })}<//>` : null}
        </div>
      </header>

      <div class="confov__groups">
        ${groups.map((g, i) => {
          const vs = g.map((r) => r.value);
          const isSel = group === i + 1;
          return html`<button key=${i} type="button" class=${cx('confgroup', isSel && 'is-sel')} disabled=${submitted} onClick=${() => { setGroup(i + 1); setPicks([]); }}>
            <span class="confgroup__head">
              <b class="confgroup__name">G${i + 1}·${t(GROUP_NAMES[i] || '')}</b>
              <span class="confgroup__meta num">${g.length} ${t('种')} · ${vs[0]}–${vs[vs.length - 1]}</span>
            </span>
            <span class="confgroup__icons">
              ${g.map((r) => html`<span key=${r.key} class="confgroup__ic" title=${`${r.name}（${r.value}）`}><${Img} src=${enemyIconUrl(m, r.key)} fallback=${html`<${GIcon} name="target" />`} /></span>`)}
            </span>
          </button>`;
        })}
      </div>

      ${group != null ? html`<div class="confov__body">
        <section class="confov__pool">
          <h3 class="confov__h">${t('G{n} 的怪物（点击加入）', { n: group })}</h3>
          <div class="confov__chips">
            ${sel.map((r) => html`<${EnemyChip} key=${r.key} m=${m} rec=${r} disabled=${submitted || picks.length >= maxPicks} onAdd=${add} />`)}
          </div>
        </section>
        <section class="confov__placed">
          <h3 class="confov__h">${t('已放置（出怪顺序）')} <span class="num">${picks.length}/${maxPicks}</span></h3>
          ${picks.length ? html`<ol class="confov__list">
            ${picks.map((p, i) => {
              const rec = sel.find((r) => r.key === p.enemyKey) || { key: p.enemyKey, name: p.enemyKey, value: 0 };
              return html`<li key=${`${p.enemyKey}:${i}`} class="confrow">
                <span class="confrow__idx num">${i + 1}</span>
                <span class="confrow__icon"><${Img} src=${enemyIconUrl(m, rec.key)} fallback=${html`<${GIcon} name="target" />`} /></span>
                <span class="confrow__name">${rec.name}</span>
                <span class="confrow__route">${ROUTE_OF.map((rn, r) => html`<button key=${r} type="button" class=${cx('confrow__gate', p.routeIndex === r && 'is-on')}
                  disabled=${submitted} onClick=${() => setRoute(i, r)} title=${t('从{route}出', { route: t(rn) })}>${t(rn)}</button>`)}</span>
                <span class="confrow__order">
                  <button type="button" disabled=${submitted || i === 0} onClick=${() => move(i, -1)} aria-label=${t('上移')}><${Icon} name="chevronUp" /></button>
                  <button type="button" disabled=${submitted || i === picks.length - 1} onClick=${() => move(i, 1)} aria-label=${t('下移')}><${Icon} name="chevronDown" /></button>
                  <button type="button" disabled=${submitted} onClick=${() => remove(i)} aria-label=${t('移除')}><${Icon} name="close" /></button>
                </span>
              </li>`;
            })}
          </ol>` : html`<p class="confov__empty t-dim">${t('还没有放置怪物')}</p>`}
        </section>
      </div>` : html`<p class="confov__hint t-dim">${t('先选择上面的一个怪物组')}</p>`}
    </div>
  </div>`;
}
