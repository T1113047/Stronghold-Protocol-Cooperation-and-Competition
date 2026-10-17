// 玩法说明 (How to play): viewer for the 19 official tutorial pages of the mode: guide/autochess_{home 1–9, shop 1–6,
// handbook 1–4} from the local-client art (DESIGN §13: data/local-assets.json) when it is there, else the copies setup
// downloads from the public mirror (data/assets.json → ui['guide/<key>']; GitHub issue #42) — data.js artUrls; a page
// whose picture fails to load tries its next URL. The pages are stored squashed to 1024² (both copies) and are
// displayed stretched back to 16:9. Three chapters (基础规则 / 调度手册 / 进阶图鉴), ‹ › buttons, ←/→ (A/D) keys, page
// dots, thumbnails; Esc or the backdrop closes. Only the next page is preloaded (a page is 0.9–1.5 MB; the one before
// has usually just been seen, so preloading it too doubled the download — host bandwidth, layer 0).
// With no page listed the viewer shows the official loading-screen tips (config.tips) instead, and so does a page none
// of whose copies loads (`guideStage`: data/assets.json lists the downloaded pages but the files are not on disk — a
// `git pull` and restart without setup, an older asset folder, a failed download the shrink guard kept); the chapter
// tabs, the page dots and the keys still reach the other pages.
//
// Global & imperative so every screen can open it: `openGuide(page?)`; <GuideHost/> is mounted once by main.js
// (and by the dev mock harness); <GuideButton/> is the standard trigger (title, lobby, room, in-match menu).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, Spinner } from './components.js';
import { createStore, useStore } from '../store.js';
import { data, useData, artUrls, nextArtUrl } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Page catalogue in reading order (titles transcribed from the pages). */
export const GUIDE_CHAPTERS = [
  { id: 'home', name: N_('基础规则'), micro: 'BASICS', pages: [
    ['autochess_home_1', N_('卫戍协议已运行')], ['autochess_home_2', N_('攻防战')], ['autochess_home_3', N_('休整期 · 区域')],
    ['autochess_home_4', N_('休整期 · 资金与调度')], ['autochess_home_5', N_('机变阶段')], ['autochess_home_6', N_('限时战斗')],
    ['autochess_home_7', N_('作战期')], ['autochess_home_8', N_('协同战斗')], ['autochess_home_9', N_('盟约')],
  ] },
  { id: 'shop', name: N_('调度手册'), micro: 'HANDBOOK', pages: [
    ['autochess_shop_1', N_('调度手册')], ['autochess_shop_2', N_('干员晋级')], ['autochess_shop_3', N_('加成情况')],
    ['autochess_shop_4', N_('卫戍能力')], ['autochess_shop_5', N_('盟约')], ['autochess_shop_6', N_('助战及自选编队')],
  ] },
  { id: 'handbook', name: N_('进阶图鉴'), micro: 'ADVANCED', pages: [
    ['autochess_handbook_1', N_('敌人类型')], ['autochess_handbook_2', N_('盟约激活与叠加')], ['autochess_handbook_3', N_('追加盟约')],
    ['autochess_handbook_4', N_('策略与轮选')],
  ] },
];

/**
 * The 2V2 chapter of 玩法说明: this fork's own mode (docs/PLAYING.md §14). Kept OUT of GUIDE_CHAPTERS — those keys are
 * the 19 official co-op tutorial pages (tools/assets/plan.mjs GUIDE_PAGES, test/ui/localArt.test.js) and the chapter is
 * TEXT, not art. Each entry is a msgid, translated where it is shown.
 */
export const VERSUS_HELP = [
  N_('两支双人小队各有一条共享目标生命值；对手在最终攻势前不可见。'),
  N_('休整期结束时进入狩猎期：先锁定一名对手，再用价值预算给对面派去猎物。'),
  N_('投放的怪从官方 7 类「特训敌人」里选，可以跨类型混搭，只限总价值。'),
  N_('点一下已放置的怪换门，长按拖动调整出怪顺序。'),
  N_('替换比例从 5% 起每回合 +2%、上限 15%；第 13 回合是最终狩猎，固定 50%。'),
  N_('猎物漏过不扣目标生命'),
  N_('击杀对面派来的猎物，赏金归己方'),
];

/**
 * Flat page list with URLs (only pages the local-art manifest or the asset manifest lists): `urls` best first (the
 * local file, then the mirror copy), `url` the first of them.
 * @returns {Array<{ key: string, title: string, chapter: number, url: string, urls: string[] }>}
 */
export function guidePages() {
  const out = [];
  GUIDE_CHAPTERS.forEach((ch, ci) => {
    for (const [key, title] of ch.pages) {
      const urls = artUrls('guide', key);
      if (urls.length) out.push({ key, title, chapter: ci, url: urls[0], urls });
    }
  });
  return out;
}

/**
 * What the viewer's stage shows for a page: `{ kind: 'image', src }` — the first of its URLs that has not failed to
 * load (the local file, then the downloaded copy) — or `{ kind: 'tips' }`, the official tips text, when none is left
 * (no page, or every copy failed to load).
 * @param {{ urls?: string[] }|null|undefined} page an entry of guidePages()
 * @param {Set<string>} [failed] URLs whose image fired an error
 * @returns {{ kind: 'image', src: string } | { kind: 'tips' }}
 */
export function guideStage(page, failed) {
  const src = page ? nextArtUrl(page.urls, failed) : null;
  return src ? { kind: 'image', src } : { kind: 'tips' };
}

/**
 * The one page the viewer preloads while page `i` is shown: the next one (wrapping around), its first URL that has not
 * failed — null without pages. The previous page is not preloaded (see the header).
 * @param {Array<{ urls?: string[] }>} pages guidePages()
 * @param {number} i
 * @param {Set<string>} [failed]
 */
export function guidePreloadUrl(pages, i, failed) {
  const n = Array.isArray(pages) ? pages.length : 0;
  if (!n || n < 2) return null;
  return nextArtUrl(pages[(((i + 1) % n) + n) % n]?.urls, failed);
}

/** Open/closed + current page. */
export const guideStore = createStore({ open: false, page: 0 });

/** Open the viewer (optionally at a page index). */
export function openGuide(page = 0) {
  data.load('local');
  data.load('assets');
  data.load('config');
  guideStore.set({ open: true, page: Math.max(0, page | 0) });
}
export const closeGuide = () => guideStore.set({ open: false });

/** Standard 玩法说明 trigger button. */
export function GuideButton({ class: cls, size = 'sm', variant = 'ghost', label = t('玩法说明'), square = false }) {
  return html`<${Button} variant=${variant} size=${size} icon="book" square=${square} class=${cx('guide-btn', cls)}
    onClick=${() => openGuide(0)} title=${t('玩法说明')} aria-label=${t('玩法说明')}>${square ? null : label}<//>`;
}

function preload(url) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = url;
}

/** Fallback body when no tutorial page can be shown: the official tips as a numbered list. */
function TipsFallback() {
  const tips = (Array.isArray(data.get('config')?.tips) ? data.get('config').tips : []).map((t) => t?.tip).filter(Boolean);
  return html`<div class="guide__tips">
    <${MicroLabel} tone="mint">${t('TIPS // 模拟要点')}</${MicroLabel}>
    <ol>${tips.map((t, i) => html`<li key=${i}>${t}</li>`)}</ol>
    ${!tips.length ? html`<p class="t-lo">${t('暂无说明内容')}</p>` : null}
  </div>`;
}

/** The 2V2 body: this fork's own mode, as a numbered rule list (no art — the official pages are co-op tutorials). */
function VersusHelp() {
  return html`<div class="guide__tips">
    <${MicroLabel} tone="mint">HUNT SIMULATION 2V2</${MicroLabel}>
    <ol>${VERSUS_HELP.map((k, i) => html`<li key=${i}>${t(k)}</li>`)}</ol>
  </div>`;
}

/** The viewer (mounted once near the root). */
export function GuideHost() {
  const { open, page } = useStore((s) => s, Object.is, guideStore);
  const ready = useData('local', 'assets', 'config');
  const pages = useMemo(() => (ready ? guidePages() : []), [ready]);
  const [loaded, setLoaded] = useState(() => new Set());
  const [failed, setFailed] = useState(() => new Set());
  // the 2V2 chapter (VERSUS_HELP) instead of the official pages — reset whenever the viewer closes
  const [vs, setVs] = useState(false);
  const boxRef = useRef(null);
  const n = pages.length;
  const i = n ? Math.min(Math.max(0, page), n - 1) : 0;
  const cur = pages[i] || null;
  const go = (k) => { if (!n) return; setVs(false); guideStore.set({ open: true, page: ((k % n) + n) % n }); };

  useEffect(() => {
    if (!open) { setVs(false); return undefined; }
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape') closeGuide();
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'PageDown') go(guideStore.get().page + 1);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'PageUp') go(guideStore.get().page - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(n - 1);
      else handled = (!!k && k.length === 1) || k === ' '; // swallow game shortcuts (R/F/D/Space) while open
      if (handled) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, [open, n]);

  useEffect(() => {
    if (!open || !n || vs) return;
    preload(guidePreloadUrl(pages, i, failed));
  }, [open, i, n, failed, vs]);

  if (!open) return null;
  const chapter = cur ? GUIDE_CHAPTERS[cur.chapter] : null;
  const firstOf = (ci) => pages.findIndex((p) => p.chapter === ci);
  const stage = guideStage(cur, failed); // the next copy when one fails to load; the tips when none is left
  const src = stage.kind === 'image' ? stage.src : null;
  const isLoaded = !!src && loaded.has(src);
  return html`<div class="guide" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) closeGuide(); }}>
    <div class="guide__box brackets" role="dialog" aria-modal="true" aria-label=${t('玩法说明')} tabindex="-1" ref=${boxRef}>
      <header class="guide__head">
        <div class="guide__titles">
          <${MicroLabel} tone="mint">HOW TO PLAY // STRONGHOLD PROTOCOL</${MicroLabel}>
          <h2 class="guide__title">${t('玩法说明')}</h2>
        </div>
        <nav class="guide__chapters" aria-label=${t('章节')}>
          ${GUIDE_CHAPTERS.map((ch, ci) => {
            const at = firstOf(ci);
            if (at < 0) return null;
            return html`<button key=${ch.id} type="button" class=${cx('guide__chapter', !vs && cur?.chapter === ci && 'is-on')} onClick=${() => go(at)}>
              <span class="guide__chname">${t(ch.name)}</span><span class="guide__chmicro">${ch.micro}</span>
            </button>`;
          })}
          <button key="versus" type="button" class=${cx('guide__chapter', vs && 'is-on')} onClick=${() => setVs(true)}>
            <span class="guide__chname">${t('狩猎模拟 2V2')}</span><span class="guide__chmicro">HUNT 2V2</span>
          </button>
        </nav>
        <button type="button" class="guide__close" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${closeGuide}><${Icon} name="close" /></button>
      </header>

      ${vs ? html`<div class="guide__stage guide__stage--text"><${VersusHelp} /></div>`
        : src ? html`<div class="guide__stage">
        <button type="button" class="guide__nav guide__prev" aria-label=${t('上一页')} onClick=${() => go(i - 1)}><${Icon} name="chevronLeft" /></button>
        <div class=${cx('guide__page', isLoaded && 'is-loaded')}>
          <img key=${src} src=${src} alt=${t(cur.title)} draggable=${false}
            onLoad=${() => setLoaded((s) => new Set(s).add(src))}
            onError=${() => setFailed((s) => new Set(s).add(src))} />
          ${!isLoaded ? html`<span class="guide__loading"><${Spinner} size="md" /></span>` : null}
        </div>
        <button type="button" class="guide__nav guide__next" aria-label=${t('下一页')} onClick=${() => go(i + 1)}><${Icon} name="chevronRight" /></button>
      </div>` : html`<div class="guide__stage guide__stage--text"><${TipsFallback} /></div>`}

      ${n && !vs ? html`<footer class="guide__foot">
        <div class="guide__label">
          <span class="guide__chtag">${t(chapter?.name || '')}</span>
          <b class="guide__ptitle">${t(cur?.title || '')}</b>
        </div>
        <div class="guide__dots" role="tablist" aria-label=${t('页码')}>
          ${pages.map((p, k) => html`<button key=${p.key} type="button" role="tab" aria-selected=${k === i ? 'true' : 'false'} title=${t(p.title)}
            class=${cx('guide__dot', k === i && 'is-on', k > 0 && pages[k - 1].chapter !== p.chapter && 'is-first')} onClick=${() => go(k)}></button>`)}
        </div>
        <span class="guide__count num">${i + 1} / ${n}</span>
      </footer>` : null}
    </div>
  </div>`;
}
