// 狩猎期 (PHASE.CONFRONT) UI, user 2026-10-17: three fixes so the panel cannot send a request the server would refuse,
// scrolls on a phone and keeps the seat line on one line.
//   #1 a resident "本回合还能放 {n} 只（剩余价值 {left} / {budget}）" line (remaining value ÷ the CURRENT type's cheapest
//      monster, capped by the protocol's pick count), and the monsters that do not fit greyed out (`aria-disabled`),
//      where a tap only shows a hint — no request;
//   #2 both picking columns scroll (max-height in vh, thin translucent scrollbar, touch scrolling);
//   #3 the seat / source line (P1 / P2 …) is one step below body text and never wraps into a stack.
// The bounty rule itself is covered by test/match/versus.test.js; this file keeps the CLIENT wiring and the strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSUS_CONFRONT, ERR, ERR_TEXT, PHASE_NAMES, merchantRateFor, merchantCapFor } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/** The msgid must be translated in every pack (the English one carries no Chinese). */
function inEveryPack(msgid) {
  for (const l of LANGS) {
    const v = PACK[l][msgid];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(msgid)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(msgid)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
  }
}

test('#1 the panel shows how many monsters still fit, and greys out what does not', () => {
  const overlay = src('public/js/ui/confrontOverlay.js');
  // the resident line, with the testid the e2e tests target
  assert.match(overlay, /class="confov__remain" data-testid="confront-remain"/);
  assert.match(overlay, /t\('本回合还能放 \{n\} 只', \{ n: canPlace \}\)/);
  assert.match(overlay, /t\('（剩余价值 \{left\} \/ \{budget\}）', \{ left: remaining, budget \}\)/);
  // n = remaining value ÷ the CURRENT type's cheapest monster (sel), and bounded by the server's own pick cap
  assert.match(overlay, /const poolRows = sel\.length \? sel : allRows;/);
  assert.match(overlay, /Math\.floor\(remaining \/ cheapest\)/);
  assert.match(overlay, /const canPlace = Math\.max\(0, Math\.min\(byValue, maxPicks - picks\.length\)\);/);
  assert.match(overlay, /Number\(conf\.maxPicks\) \|\| VERSUS_CONFRONT\.maxPicks/);
  // the chips: aria-disabled + the is-disabled look, and the tap only hints (the guarded add() never places)
  assert.match(overlay, /aria-disabled=\$\{off \? 'true' : 'false'\}/);
  assert.match(overlay, /if \(blocked && !disabled\) hint && hint\(rec\); else onAdd && onAdd\(rec\);/);
  assert.match(overlay, /const add = \(rec\) => \{\s*if \(overBudget\(rec\)\) return notEnough\(\);\s*if \(!fits\(rec\)\) return;\s*setPicks\(\(p\) => \[\.\.\.p, \{ enemyKey: rec\.key, gate: 'lower' \}\]\);\s*\};/);
  assert.match(overlay, /blocked=\$\{overBudget\(r\)\}/);
  // and the strings exist in all four packs
  for (const k of ['本回合还能放 {n} 只', '（剩余价值 {left} / {budget}）', '剩余价值不足，放不下这只怪物']) inEveryPack(k);
});

test('#2 both picking columns scroll on their own (max-height in vh, thin translucent bar, touch scrolling)', () => {
  const css = src('public/css/screens/game-panels.css');
  const rule = css.slice(css.indexOf('.confov__chips, .confov__list {'), css.indexOf('.confov__chips, .confov__list {') + 500);
  assert.match(rule, /max-height: min\(46vh, calc\(4\.4 \* var\(--t\)\)\)/, 'a vh / --t max-height');
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /-webkit-overflow-scrolling: touch/, 'momentum scrolling on touch devices');
  assert.match(rule, /scrollbar-width: thin/);
  assert.match(css, /\.confov__chips::-webkit-scrollbar, \.confov__list::-webkit-scrollbar \{ width: \.08rem; height: \.08rem; \}/);
  assert.match(css, /\.confov__chips::-webkit-scrollbar-thumb, \.confov__list::-webkit-scrollbar-thumb \{\s*background: rgba\(234, 255, 248, \.26\)/);
  // landscape phone (very small height): the columns keep room without pushing the panel past the screen
  const small = css.slice(css.indexOf('@media (max-height: 431.98px) {', css.indexOf('.confseat')));
  assert.match(small, /\.confov__chips, \.confov__list \{ min-height: 0; max-height: 38vh; \}/);
});

test('#3 the seat / source line (P1 / P2 …) is below body text and never wraps', () => {
  const overlay = src('public/js/ui/confrontOverlay.js');
  const css = src('public/css/screens/game-panels.css');
  // the JSX: the row of teammates (P1 已选择) and the P labels of a bounty row wear the shared class
  assert.match(overlay, /<span key=\$\{p\.playerId\} data-testid="confront-seat" class=\$\{cx\('confpair', 'confseat'/);
  assert.match(overlay, /<span class="conffoe__p confseat num">\$\{pNo\(f\)\}<\/span>/);
  assert.match(overlay, /<span class="confclash__p confseat num">\$\{pNoOf\(r\.atk\)\}<\/span>/);
  assert.match(overlay, /<span class="confclash__p confseat num">\$\{pNoOf\(foe\)\}<\/span>/);
  // body text in this panel is .14 * --t; the seat line is one step down, single-line with an ellipsis
  assert.match(css, /\.confseat \{ font-size: calc\(\.10 \* var\(--t\)\); line-height: 1\.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; \}/);
  assert.match(css, /\.confclash__row \{ flex-wrap: nowrap; white-space: nowrap; min-width: 0; \}/);
  assert.ok(css.indexOf('.confseat {') > css.indexOf('.confclash__p {'), '.confseat overrides the badge size');
});

test('the server has the authoritative caps and translatable errors the UI relies on', () => {
  assert.deepEqual([...VERSUS_CONFRONT.bountyCaps], [1, 1, 2, 2]);
  assert.equal(VERSUS_CONFRONT.finalHuntBounty, 25, 'R13 最终狩猎 pays a fixed 25');
  assert.equal(VERSUS_CONFRONT.killIncomeShare, 1, 'the live formula (5th phase on) still uses the share');
  assert.equal(VERSUS_CONFRONT.maxPicks, 64);
  assert.ok(!('huntBountyCap' in VERSUS_CONFRONT) && !('bountyCap' in VERSUS_CONFRONT), 'there is no single cap');
  const confront = src('server/match/match/confront.js');
  assert.match(confront, /if \(out\.length > VERSUS_CONFRONT\.maxPicks\) return \{ error: ERR\.CONFRONT_COUNT \};/);
  assert.match(confront, /if \(this\.confrontSpent\(out\) > this\.confrontBudget\(\)\) return \{ error: ERR\.CONFRONT_BUDGET \};/);
  assert.match(confront, /if \(arr\.length > VERSUS_CONFRONT\.maxPicks\) return fail\(ERR\.CONFRONT_COUNT\);/);
  assert.equal(ERR.CONFRONT_BUDGET, 'CONFRONT_BUDGET');
  assert.equal(ERR.CONFRONT_COUNT, 'CONFRONT_COUNT');
  for (const k of [ERR_TEXT.CONFRONT_BUDGET, ERR_TEXT.CONFRONT_COUNT]) inEveryPack(k);
  // the client shows those codes through ERR_TEXT (ui/toasts.js describeError)
  assert.match(src('public/js/ui/toasts.js'), /Object\.hasOwn\(ERR_TEXT, err\.code\)/);
});

test('naming: 狩猎期 / 最终狩猎 in every pack, and the old words are gone', () => {
  assert.equal(PHASE_NAMES.CONFRONT, '狩猎期', 'the phase name is the msgid 狩猎期');
  for (const k of ['狩猎期', '最终狩猎']) inEveryPack(k);
  for (const l of LANGS) {
    assert.ok(!('悬赏期' in PACK[l]), `${l}: 悬赏期 is renamed to 狩猎期`);
    assert.ok(!('追猎模式' in PACK[l]), `${l}: 追猎模式 is renamed to 最终狩猎`);
  }
  // the renamed sentences (msgid = the Chinese source) are in every pack too
  for (const k of [
    '两支双人小队同时模拟；休整期后进入狩猎期，给对面派去猎物，击杀猎物为己方赢得赏金。',
    '每队 3 个核心盟约 · 狩猎期给对面加猎物',
    '休整期结束时进入狩猎期：先锁定一名对手，再用价值预算给对面派去猎物。',
    '替换比例从 5% 起每回合 +2%、上限 15%；第 13 回合是最终狩猎，固定 50%。',
  ]) inEveryPack(k);
  // the source literals were renamed too (no player-visible 悬赏期 / 追猎 left in the client)
  for (const f of ['public/js/ui/confrontOverlay.js', 'public/js/ui/guide.js', 'public/js/screens/lobby.js', 'shared/constants.js']) {
    const text = src(f);
    assert.ok(!/悬赏期/.test(text), `${f}: no 悬赏期 (comments included)`);
    assert.ok(!/追猎/.test(text), `${f}: no 追猎`);
  }
  // 悬赏名单 keeps its name
  assert.ok('悬赏名单' in PACK.en, 'the bounty board keeps its name');
});

test('merchant constants (the 坎诺特 round): rates by absolute round and the per-round withdrawal cap', () => {
  assert.deepEqual([...VERSUS_CONFRONT.merchantRates], [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 1]);
  assert.equal(merchantRateFor(4), 0.2, 'R4–R8: 20 %');
  assert.equal(merchantRateFor(8), 0.2, 'R8 is still 20 %');
  assert.equal(merchantRateFor(9), 0.3, 'R9: 30 %');
  assert.equal(merchantRateFor(10), 0.35, 'R10: 35 %');
  assert.equal(merchantRateFor(13), 0.5, 'R13: 50 %');
  assert.equal(merchantRateFor(14), 0.55, 'R14: 55 %');
  assert.equal(merchantRateFor(15), 1, 'R15 隐秘核心: 100 %');
  assert.equal(merchantRateFor(16), 1, 'past R15 stays 1:1');
  assert.equal(merchantCapFor(4), 4, '4 gold per normal round');
  assert.equal(merchantCapFor(13), 4, 'R13 keeps the 4-gold cap');
  assert.equal(merchantCapFor(14), 4, 'R14 keeps the 4-gold cap');
  assert.equal(merchantCapFor(15), Infinity, 'R15 is uncapped');
});
