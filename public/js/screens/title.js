// Title screen: season-style backdrop, big title 卫戍协议：狩猎模拟, remembered nickname, 开始, the language menu
// (中文 | English | every pack in public/i18n/, ui/lang.js; a title in an alphabetic script — English — is the big one and
// the small wordmark above it hides).
//
// Pressing 开始 validates the nickname (1..NAME_MAX_LEN chars, no control characters), stores it,
// marks this tab as "entered" (so reloads skip the title) and hands the name to net.js, which
// sends `hello` (now, or as soon as the socket is open). The router then shows the lobby.
//
// Backdrop art: if data/assets.json lists a UI backdrop (`ui.titleBackdrop`, or one of the
// entry/loading illustration names) it is layered under the CSS art; otherwise the screen is
// pure CSS/SVG (radar, ridgelines, glow), so it never issues a request that can 404.

import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useMemo, useState, useEffect } from '../../vendor/hooks.module.js';
import { NAME_MAX_LEN, APP_VERSION, DEV_BUILD, FORK_LABEL, FORK_NAME } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, TextField, PingPill } from '../ui/components.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { toast } from '../ui/toasts.js';
import { net, identity, setAccountToken, getAccountToken } from '../net.js';
import { uploadAllAccountPrefs } from '../ui/accountSync.js'; // [ACCOUNT] 退出登录前整包上传
import { store, useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { FullscreenButton, PwaInstallButton, detectFeatures } from '../ui/device.js';
import { LangToggle, useLang } from '../ui/lang.js';
import { t, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { copyText } from '../ui/clipboard.js'; // [ACCOUNT] auto-copy the /绑定 command

// Same character classes as server/net.js sanitizeName (control, zero-width, bidi, BOM), so a name
// the client accepts is never rejected by the server's hello validation.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
// Lone surrogates are removed by a scan, not a regex: the lookbehind such a regex needs is a *syntax error* in Safari
// < 16.4, which would stop the whole client from loading there.
export function stripLoneSurrogates(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) { out += str[i] + str[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += str[i];
  }
  return out;
}

/**
 * Normalise a nickname like the server does (NFC, strip lone surrogates / control / invisible /
 * bidi characters, collapse whitespace, trim), then clamp to NAME_MAX_LEN UTF-16 code units — the
 * protocol's `hello.name` limit — without splitting a surrogate pair.
 * @param {any} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  let s = String(raw ?? '');
  try { s = s.normalize('NFC'); } catch { /* keep as is */ }
  s = stripLoneSurrogates(s).replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').replace(/ {2,}/g, ' ').trim();
  if (s.length > NAME_MAX_LEN) {
    s = s.slice(0, NAME_MAX_LEN);
    // Don't leave half a surrogate pair at the end.
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s;
}

/** @param {any} raw @returns {boolean} */
export const isValidName = (raw) => sanitizeName(raw).length > 0;

/**
 * Enter the game shell with a nickname (title → lobby).
 * @param {string} rawName
 * @returns {boolean} false when the name is invalid
 */
export function enterSession(rawName) {
  const name = sanitizeName(rawName);
  if (!name) return false;
  identity.saveName(name);
  identity.setEntered(true);
  store.set((s) => ({ me: { ...s.me, name }, session: { ...s.session, entered: true } }));
  net.setName(name);
  return true;
}

// data/assets.json `ui` keys are 'group/key' (docs/ASSETS.md).
const BACKDROP_KEYS = ['titleBackdrop', 'entry/bkg_01', 'entry/bkg_02'];
const RIDGE_KEYS = ['titleRidges', 'entry/bg_mountains_tiled'];

/**
 * Find a UI image URL in data/assets.json (tolerant of a few plausible shapes).
 * @param {any} assets
 * @param {string[]} names
 * @returns {string|null}
 */
export function findUiAsset(assets, names) {
  if (!assets || typeof assets !== 'object') return null;
  const asUrl = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.url || v.path || v.src || null;
    return null;
  };
  const ui = assets.ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    for (const n of names) {
      const u = asUrl(ui[n]);
      if (u) return u;
    }
  }
  const lists = [Array.isArray(ui) ? ui : null, Array.isArray(assets.files) ? assets.files : null].filter(Boolean);
  for (const list of lists) {
    for (const n of names) {
      const hit = list.map(asUrl).find((u) => typeof u === 'string' && u.includes('/ui/') && u.toLowerCase().split('/').pop().startsWith(n.toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

// Dot-matrix watchtower emblem (13×14 bitmap; dots grow toward the base for depth).
const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

function Emblem() {
  const dots = useMemo(() => {
    const out = [];
    EMBLEM.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== 'X') return;
        const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
        const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
        out.push({ cx: c + 0.5, cy: r + 0.5, r: rad, accent, d: (r * 13 + c) % 7 });
      });
    });
    return out;
  }, []);
  return html`<div class="emblem" aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">
      ${dots.map((d, i) => html`<circle key=${i} cx=${d.cx} cy=${d.cy} r=${d.r} class=${d.accent ? 'is-accent' : `d${d.d}`} />`)}
    </svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
}

function Ridges() {
  return html`<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#16231f" /><stop offset="1" stop-color="#0a0e0d" />
      </linearGradient>
      <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1714" /><stop offset=".6" stop-color="#080b0a" />
      </linearGradient>
      <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#17f9b7" stop-opacity="0" />
        <stop offset=".3" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset=".7" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset="1" stop-color="#17f9b7" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)"
      d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z" />
    <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)"
      d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z" />
  </svg>`;
}

const STATUS_TEXT = {
  idle: N_('准备连接'), connecting: N_('正在连接服务器'), connected: N_('已连接服务器'), handshaking: N_('正在验证身份'),
  online: N_('已连接服务器'), reconnecting: N_('连接中断，正在重连'), closed: N_('连接已关闭'),
};

/**
 * [ACCOUNT] the QQ group players send `/绑定 <code>` in. The number is **not** part of this repository: a deployment
 * injects it at page load (`window.__SP_QQ_GROUP__`, the same way a CDN node injects `window.__SH_WS__`). Empty here,
 * the group hints are hidden — binding itself still works from the code alone.
 */
const QQ_GROUP = (typeof window !== 'undefined' && window.__SP_QQ_GROUP__) || '';

/** [ACCOUNT] the command the player pastes into the group — a literal protocol string, never translated. */
const bindCommand = (code) => `/绑定 ${code}`; // i18n-ignore: the QQ bot's command is fixed Chinese

/**
 * The big name plate: this fork's own name (`FORK_NAME`), split around the colon so the two-line look survives in every
 * language (a name without a colon falls back to one run instead of inventing a break).
 */
function TitlePlate({ alphabetic }) {
  const name = String(t(FORK_NAME));
  const i = name.search(/[：:]/);
  const a = i < 0 ? name : name.slice(0, i);
  const b = i < 0 ? '' : name.slice(i + 1).trim();
  return html`<h1 class=${`title-cn${alphabetic ? ' title-cn--latin' : ''}`}>${a}<span class="title-cn__colon">${alphabetic ? ': ' : '：'}</span><em>${b}</em></h1>`;
}

/** Title screen component. */
export function TitleScreen() {
  const conn = useStore((s) => s.connection, shallowEqual);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  const me = useStore((s) => s.me, shallowEqual);
  useLang(); // re-render on a language switch
  const [name, setName] = useState(() => store.get().me.name || identity.loadName() || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bind, setBind] = useState(null);          // [ACCOUNT] { code } while waiting for the group to bind
  const [wantBind, setWantBind] = useState(false); // [ACCOUNT] request the code once the session is online
  const [bindBusy, setBindBusy] = useState(false); // [ACCOUNT] 1 s after the click, while the login session is being opened
  const account = me.account;                      // [ACCOUNT] { qq, nickname } | null
  const assetsSettled = useData('assets');
  const assets = data.get('assets');
  const backdrop = findUiAsset(assets, BACKDROP_KEYS);
  const ridges = findUiAsset(assets, RIDGE_KEYS);
  // Track load/fail per URL (not as booleans reset in effects: an image can load before an effect runs).
  const [bgLoadedUrl, setBgLoadedUrl] = useState(null);
  const [ridgesLoadedUrl, setRidgesLoadedUrl] = useState(null);
  const [ridgesFailedUrl, setRidgesFailedUrl] = useState(null);
  const bgLoaded = !!backdrop && bgLoadedUrl === backdrop;
  const ridgesLoaded = !!ridges && ridgesLoadedUrl === ridges;
  const ridgesFailed = !!ridges && ridgesFailedUrl === ridges;
  // CSS ridgelines only when there is no ridge art (avoids a swap flash when the art arrives).
  const cssRidges = assetsSettled && (!ridges || ridgesFailed);

  const valid = isValidName(name);
  const start = () => {
    if (!valid) { toast(t('请输入博士代号'), 'warn'); return; }
    enterSession(name);
  };

  // [ACCOUNT] QQ bind: the code comes from the server (`account.bindCode`), the group confirms it
  useEffect(() => {
    const offCode = net.on('account.bindCode', (m) => {
      const code = String(m?.code || '');
      setBind({ code });
      if (!code) return;
      // auto-copy the command to paste in the group; a 复制 button stays for browsers that block it
      copyText(bindCommand(code)).then((ok) => {
        if (ok) toast(QQ_GROUP ? t('已复制「{cmd}」，请到 QQ 群 {group} 粘贴发送', { cmd: bindCommand(code), group: QQ_GROUP }) : t('已复制'), 'success');
      });
    });
    const offBound = net.on('account.bound', () => setBind(null));
    return () => { try { offCode(); offBound(); } catch { /* ignore */ } };
  }, []);
  useEffect(() => {
    if (wantBind && conn.status === 'online') { net.requestBind(); setWantBind(false); }
  }, [wantBind, conn.status]);
  // [ACCOUNT] keep the callsign field in step with the account nickname (bind, auto-login, or a rename)
  useEffect(() => { if (account?.nickname) setName(account.nickname); }, [account?.nickname]);
  const doBind = () => {
    identity.saveName(name);
    setBindBusy(true);
    // 点击后延迟 1s 再触发登录（给页面/会话一点时间，避免误触或过早请求）
    setTimeout(() => {
      setBindBusy(false);
      net.setName(name); // opens a session (hello) the login can attach to; the router stays on the title until 开始
      // 从缓存进入（本地已有账号 token）：直接走自动登录，不再让后台发验证码
      if (getAccountToken()) setWantBind(false);
      else setWantBind(true);
    }, 1000);
  };
  const startBind = () => {
    if (!valid) { toast(t('请输入博士代号'), 'warn'); return; }
    if (bindBusy) return;
    doBind();
  };
  const saveNick = () => { if (account && valid) net.accountSetName(sanitizeName(name)); };
  const logout = () => {
    // [ACCOUNT] 退出前先把完整本地数据再上传一次，避免任何未同步的改动只留在本机
    uploadAllAccountPrefs(net);
    net.logoutAccount();
    setAccountToken(null);
    store.set((s) => ({ me: { ...s.me, account: null } }));
    setBind(null);
    toast(t('已退出登录（本地数据保留）'), 'info');
  };

  const online = conn.status === 'online' || conn.status === 'connected';
  const dotClass = online ? 'is-on' : conn.status === 'reconnecting' || conn.status === 'connecting' || conn.status === 'handshaking' ? 'is-warn' : 'is-bad';

  // touch screens: no autofocus (it would pop the on-screen keyboard over a landscape phone's whole view)
  const touchUi = useMemo(() => detectFeatures().coarse, []);
  // a title in an alphabetic script (English, French …) is the big one in the display face and the wordmark above it
  // hides; a CJK / kana / Hangul title keeps the Chinese layout (shared/i18nPacks.js scriptOf — a pack needs no flag)
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  return html`<div class="screen title-screen">
    <div class=${`title-bg${bgLoaded ? ' has-art' : ''}${ridgesLoaded ? ' has-ridges' : ''}`} aria-hidden="true">
      ${backdrop ? html`<img class="title-bg__art" src=${backdrop} alt="" draggable=${false}
        onLoad=${() => setBgLoadedUrl(backdrop)} />` : null}
      <div class="title-bg__glow"></div>
      <div class="title-bg__radar"><div class="title-bg__sweep"></div></div>
      <div class="title-bg__target"></div>
      ${cssRidges ? html`<${Ridges} />` : null}
      ${ridges && !ridgesFailed ? html`<div class="title-bg__ridge-art" style=${`background-image:url("${ridges}")`}>
        <img src=${ridges} alt="" hidden onLoad=${() => setRidgesLoadedUrl(ridges)} onError=${() => setRidgesFailedUrl(ridges)} />
      </div>` : null}
      <div class="title-bg__haze"></div>
      <span class="cross" style="left:7%;top:22%"></span>
      <span class="cross" style="left:93%;top:30%"></span>
      <span class="cross" style="left:14%;top:70%"></span>
      <span class="cross" style="left:88%;top:62%"></span>
      <span class="cross" style="left:60%;top:12%"></span>
    </div>

    <div class="title-corner title-corner--tl">
      <span class="title-corner__mark"></span>
      <div><${MicroLabel} tone="mint">RHODES ISLAND // SIMULATION SERVICE<//><br /><${MicroLabel}>HUNT SIMULATION NODE · 02<//></div>
    </div>
    <div class="title-corner title-corner--tr">
      <div>
        <div class="title-corner__tools">
          <${Button} variant="ghost" size="sm" icon="chart" class="title-stats" onClick=${openStats} title=${t('统计数据')}>${t('统计')}<//>
          <${LangToggle} class="title-lang" />
        </div>
        <${MicroLabel} tone="hi">TARGET POINT<//><br /><${MicroLabel}>STRONGHOLD PROTOCOL<//>
      </div>
    </div>

    <main class="title-main">
      <${Emblem} />
      ${alphabetic ? null : html`<div class="title-en">
        <span class="title-en__a">STRONGHOLD PROTOCOL</span>
        <span class="title-en__b">HUNT SIMULATION</span>
      </div>`}
      <${TitlePlate} alphabetic=${alphabetic} />
      <p class="title-tag">${t('调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。')}</p>

      <div class="title-login">
        ${pendingJoin ? html`<div class="title-invite">
          <${Icon} name="key" />
          <span>${t('收到同盟邀请')}</span><b class="num">${pendingJoin}</b><span class="t-lo">${t('· 输入代号后将自动加入')}</span>
        </div>` : null}
        <${TextField} label=${t('博士代号')} micro="CALLSIGN" size="lg" icon="user" value=${name} maxLength=${NAME_MAX_LEN}
          placeholder=${t('输入你的代号（最多 {NAME_MAX_LEN} 字）', { NAME_MAX_LEN })} autoFocus=${!touchUi}
          onInput=${setName} onEnter=${start} />
        <${Button} variant="primary" size="xl" block=${true} iconRight="chevrons" disabled=${!valid} onClick=${start}>${t('开始')}<//>
        <div class="title-account">
          ${account
            ? html`<span class="title-account__who"><${GIcon} name="user" />${t('已登录：{name}（QQ {qq}）', { name: account.nickname || name, qq: account.qq })}</span>
                ${valid && sanitizeName(name) !== (account.nickname || '') ? html`<${Button} variant="secondary" size="sm" onClick=${saveNick}>${t('保存昵称')}<//>` : null}
                <${Button} variant="ghost" size="sm" onClick=${logout}>${t('退出登录')}<//>`
            : html`<${Button} variant="secondary" size="sm" icon="user" disabled=${!valid || bindBusy} onClick=${startBind}>${bindBusy ? t('登录中…') : t('QQ 同步数据')}<//>`}
          ${!account && bind ? html`<div class="title-account__code">
            ${QQ_GROUP ? html`<span>${t('请到 QQ 群 {group}', { group: QQ_GROUP })}</span>` : null}
            <b class="num">${bindCommand(bind.code)}</b>
            <${Button} variant="ghost" size="sm" icon="copy"
              onClick=${() => copyText(bindCommand(bind.code)).then((ok) => toast(ok ? t('已复制') : t('复制失败，请手动发送 {cmd}', { cmd: bindCommand(bind.code) }), ok ? 'info' : 'warn'))}>${t('复制')}<//>
            <span class="t-lo">${t('（3 分钟内有效）')}</span>
          </div>` : null}
        </div>
        <p class="title-account__note">${t('仅通过此保存游戏配置和游戏内数据，其他概不收集。')}</p>
        <div class="title-conn">
          <span class=${`status-dot ${dotClass}`}></span>
          <span>${STATUS_TEXT[conn.status] ? t(STATUS_TEXT[conn.status]) : conn.status}</span>
          ${conn.status === 'online' ? html`<${PingPill} ms=${conn.ping} />` : null}
          <${GuideButton} class="title-guide" label=${t('玩法说明')} />
          <button type="button" class="title-settings fsbtn tapx" aria-label=${t('设置')} title=${t('设置')}
            onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
          <${FullscreenButton} class="title-fs" />
        </div>
      </div>
    </main>

    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />

    <footer class="title-foot">
      <${ResumeMatchButton} />
      <${PwaInstallButton} />
      <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
      <span class="title-foot__meta">
        <a class="title-repo" href="https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation" target="_blank" rel="noopener noreferrer">${t('项目仓库')}</a>
        <${MicroLabel}>v${APP_VERSION} · ${FORK_LABEL} ${t(FORK_NAME)} · WEB SIMULATION<//>
        ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
      </span>
    </footer>
  </div>`;
}
