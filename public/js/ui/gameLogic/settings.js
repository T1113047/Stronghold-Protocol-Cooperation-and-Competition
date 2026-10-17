// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';
export { VOICE_LANGS } from '../../voicePrefs.js';

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 语音语言): 'cn' 中文 (`audio.voice`, the default) and 'jp' 日本語 (`audio.voiceJp`,
 * falling back to the Chinese line it lacks — public/js/audio.js voiceLine). Not tied to the interface language.
 */


/**
 * The steps of 设置 →「文字大小」 (textSize): the interface text root `--t` of css/theme.css — 'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键). voiceLang: VOICE_LANGS.
 *  textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js applyTextSize). ammoCount: 设置「弹药数量」 — the
 *  rounds left / the magazine under an ammo skill's bar (render/units.js; PR #552), off by default: the official HUD has no
 *  such number (the maintainer's decision of 2026-10-13). pictureAuto: [BOARDMODE]/[UNITMODELS] 画面自动调节开关；
 *  boardForce: 强制棋盘 3d|flat；unitsForce: 强制角色模型 on|off（三者皆本机相关）。 */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, ammoCount: false, quality: 'high', textSize: 'sm', pictureAuto: true, boardForce: 'flat', unitsForce: 'off', keys: DEFAULT_HOTKEYS });
const QUALITIES = ['high', 'medium', 'low'];

/**
 * [BOARDMODE] 设置 →「画面质量」里棋盘样式的强制档（`boardForce`）：'3d' = 引擎的 3D 棋盘；'flat' = **简化平面视图**
 * （ui/fallbackField.js：平铺棋盘 + 单位用头像 + 无模型/特效，整个战场降级）。仅在「画面自动调节」（`pictureAuto`）
 * 关闭时生效；开启时按设备自动选择（引擎内部 3D 或 2D 贴图地块，render/app/view.js `boardSetting`）。默认 'flat'
 * （最省的一档）。注：URL `?board=2d` 也走简化平面、`?board=3d` 走引擎 3D（ui/fieldHost.js flatFieldPreferred）。
 */
export const BOARD_FORCES = Object.freeze(['3d', 'flat']);

/**
 * [UNITMODELS] 设置 →「画面质量」里角色模型的强制档（`unitsForce`）：加载 / 不加载（`on`/`off`；不加载退回头像 +
 * 稀有度菱形，不请求 Spine）。仅在「画面自动调节」（`pictureAuto`）关闭时生效；开启时按设备自动选择
 * （render/app/view.js `unitSetting`：弱 GPU `gpuTier()==='weak'` 默认不加载）。默认不加载（最省的一档）。
 */
export const UNIT_FORCES = Object.freeze(['on', 'off']);

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp', voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, ammoCount: boolean, quality: 'high'|'medium'|'low',
 *   textSize: 'sm'|'md'|'lg'|'xl', pictureAuto: boolean, boardForce: '3d'|'flat', unitsForce: 'on'|'off', keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    ammoCount: typeof r.ammoCount === 'boolean' ? r.ammoCount : DEFAULT_SETTINGS.ammoCount,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
    pictureAuto: typeof r.pictureAuto === 'boolean' ? r.pictureAuto : DEFAULT_SETTINGS.pictureAuto, // [BOARDMODE]/[UNITMODELS]
    boardForce: BOARD_FORCES.includes(r.boardForce) ? r.boardForce : DEFAULT_SETTINGS.boardForce, // [BOARDMODE]
    unitsForce: UNIT_FORCES.includes(r.unitsForce) ? r.unitsForce : DEFAULT_SETTINGS.unitsForce, // [UNITMODELS]
    keys: sanitizeHotkeys(r.keys),
  };
}
