// [NOTICE] 全服通知 banner — one announcement on screen for the whole server.
//
// When an admin's /服务器通知 reaches the server's loopback POST /api/notify, Network.broadcastNotice
// (server/net.js) pushes `m.notice { text }` to every open socket — lobby, room and running match alike. main.js
// hands the frame to pushNotice() and mounts <NoticeHost/> once, beside <ToastHost/>.
//
// It is deliberately NOT a toast (ui/toasts.js): one prominent top-centre strip at a time, 20 s of its own (or a
// click to dismiss), and it lives in its own tiny store rather than the app store — a notice says nothing about the
// room / match on screen, so nothing has to be unwound when the route changes. The one cleanup that does matter —
// leaving a room or a match for the lobby — is main.js `backToLobby()` (and the new-match reset in `onRoomState`),
// which call dismissNotice().
//
// The text is the admin's own, already trimmed and capped at 200 characters by the server: it is shown exactly as it
// arrived and is never translated (it is not a msgid, docs/I18N.md §1). Only the strip's own chrome uses t().

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { createStore, useStore } from '../store.js';
import { useDocClass } from './device.js';
import { t } from '../../../shared/i18n.js';

/** How long a notice stays on screen before it dismisses itself. */
export const NOTICE_MS = 20000;
/** The server's own cap on the text (server/net.js broadcastNotice) — also this banner's ceiling on a rogue frame. */
export const NOTICE_MAX = 200;

/**
 * The banner's own state: `{ text, at }` while a notice shows, null otherwise. Separate from the app store on purpose
 * (see the header); `at` is a fresh stamp, so the same announcement arriving again re-arms the timer and replays.
 */
const noticeStore = createStore({ notice: null });

/**
 * Show a server announcement, replacing whatever is on screen.
 * @param {string} text the admin's text (cleaned server-side; trimmed and capped again here)
 * @returns {boolean} whether there was anything to show
 */
export function pushNotice(text) {
  const clean = String(text ?? '').trim().slice(0, NOTICE_MAX);
  if (!clean) return false;
  noticeStore.set({ notice: { text: clean, at: Date.now() } });
  return true;
}

/** Dismiss the banner now. */
export function dismissNotice() {
  noticeStore.set({ notice: null });
}

/** Renders the strip; mount once, next to <ToastHost/>. */
export function NoticeHost() {
  const notice = useStore((s) => s.notice, Object.is, noticeStore);
  // html.sp-notice keeps the toast stack clear of the banner (css/screens/notice.css) — classes instead of :has(),
  // like ui/connBanner.js's sp-conn.
  useDocClass('sp-notice', !!notice);
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => {
      // only clear the notice this timer was armed for: a newer one re-armed its own
      if (noticeStore.get().notice === notice) noticeStore.set({ notice: null });
    }, NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);
  if (!notice) return null;
  return html`<div class="notice-host">
    <div class="notice" role="status" aria-live="polite" onClick=${dismissNotice}>
      <span class="notice__tag">${t('全服通知')}</span>
      <span class="notice__text">${notice.text}</span>
      <button type="button" class="notice__close" title=${t('关闭通知')} aria-label=${t('关闭通知')}
              onClick=${dismissNotice}>
        <${Icon} name="close" />
      </button>
    </div>
  </div>`;
}
