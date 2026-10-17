// [DAMAGEBOARD] the in-match damage / healing board (ui/damageBoard.js) and its wiring in the game screen: under the
// 「盟约」 strip it lists the operators of the player on screen with this battle's damage (gold) and healing (blue),
// ×N for copies — rows from battle/runner.js damageBoard (test/match/runner.test.js). Pure display: the container takes
// no pointer events (a tap goes through to the board underneath) and no rows render nothing at all.
//
// The component reads useData(...) (it re-renders when the asset / chess manifests arrive), so it cannot be called
// outside a preact render in Node — like every other hook-using component it is checked at the source level here
// (test/ui/playtest3.test.js, loadout-stats.test.js), on screen in test/ui/*.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('[DAMAGEBOARD] the board renders one cell per operator: avatar, damage, healing only when there is any, ×N for copies', () => {
  const src = read('public/js/ui/damageBoard.js');
  assert.match(src, /import \{ html \} from '\.\/components\.js';/);
  assert.match(src, /import \{ UnitThumb \} from '\.\/gameComponents\.js';/);
  assert.match(src, /import \{ fmtNum \} from '\.\/gameLogic\.js';/);
  assert.match(src, /import \{ useData \} from '\.\.\/data\.js';/);
  assert.match(src, /import \{ t \} from '\.\.\/\.\.\/\.\.\/shared\/i18n\.js';/);
  assert.ok(src.includes("useData('assets', 'chess')"), 're-renders when the avatar manifests arrive');
  assert.ok(src.includes('if (!Array.isArray(rows) || rows.length === 0) return null;'), 'no rows → nothing at all');
  // the container: a display-only list under the strip
  assert.ok(src.includes(`<div class="dmgboard" role="list" aria-label=\${t('伤害 / 治疗统计')} title=\${t('伤害（黄）/ 治疗（蓝）：本场战斗累计')}>`));
  // one cell per row, keyed by the operator, its own title with both numbers
  assert.ok(src.includes('<div class="dmgboard__cell" role="listitem" key=${r.defId}'));
  assert.ok(src.includes(`title=\${t('伤害 {dmg} · 治疗 {heal}（本场）', { dmg: fmtNum(r.dmg), heal: fmtNum(r.heal || 0) })}`));
  // the avatar (small, no tier chip) and the numbers: damage always, healing only when > 0, ×N only for copies
  assert.ok(src.includes('<${UnitThumb} kind="chess" id=${r.defId} size="xs" showTier=${false} />'));
  assert.ok(src.includes('<b class="dmgboard__num num">${fmtNum(r.dmg)}</b>'));
  assert.ok(src.includes('${r.heal > 0 ? html`<b class="dmgboard__heal num">${fmtNum(r.heal)}</b>` : null}'));
  assert.ok(src.includes('${r.count > 1 ? html`<span class="dmgboard__x num">×${r.count}</span>` : null}'));
});

test('[DAMAGEBOARD] wiring: the game screen polls the runner for the strip owner\'s operators on the battle on screen', () => {
  const src = read('public/js/screens/game.js');
  assert.match(src, /import \{ DamageBoard \} from '\.\.\/ui\/damageBoard\.js'; \/\/ \[DAMAGEBOARD\]/);
  assert.match(src, /useTicker\(cc && combat \? 700 : 0\); \/\/ \[DAMAGEBOARD\]/, 'polled while a battle is on screen');
  assert.match(src, /const dmgRows = cc && combat && battleRunner && battleState\?\.fieldId && strip\.ownerId\s*\n\s*\? battleRunner\.damageBoard\(strip\.ownerId, battleState\.fieldId\)/,
    'the player the strip shows, in the battle on screen');
  const at = src.indexOf('<${DamageBoard} rows=${dmgRows} />');
  assert.ok(at > 0, 'the board is mounted');
  assert.ok(at > src.indexOf('<div class="gm__bonds">'), 'under the bond strip');
  assert.ok(at < src.indexOf('<${TeamPanel}'), 'above the team panel');
  // display-only: the container takes no pointer events, so a tap goes through to the board underneath
  const css = read('public/css/screens/game.css');
  assert.match(css, /\/\* ---- \[DAMAGEBOARD\][^]*?\.dmgboard \{[^}]*pointer-events: none;/, 'the row never swallows taps');
  assert.match(css, /\.dmgboard \{\s*position: absolute; left: 1\.56rem; top: 2\.06rem;/, 'right below the strip (the same left/top column)');
  assert.match(css, /\.dmgboard__num \{[^}]*color: var\(--gold\)/, 'damage in gold');
  assert.match(css, /\.dmgboard__heal \{[^}]*color: var\(--ice\)/, 'healing in blue');
});
