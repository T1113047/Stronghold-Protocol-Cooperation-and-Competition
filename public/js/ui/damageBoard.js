// [DAMAGEBOARD] In-match damage/healing statistics (local feature). Under the bond strip (「盟约」) it draws a
// left-aligned horizontal row of the player-on-screen's operators: each as its avatar, with the damage it has dealt
// **this battle** in gold and the healing it has done in blue (ui/gameLogic/format.js fmtNum → 万 / 亿). Rows come from
// battle/runner.js damageBoard (the shared sim's per-unit `stats.dmg` / `stats.heal`, summed per operator — the regen a
// provider granted is credited to it, server/sim/battle/status.js attributeRegen). Pure display — the container is
// pointer-events: none (game.css) so it never swallows taps on the board underneath.
// No rows (no battle on screen, or nothing deployed) → render nothing.

import { html } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { fmtNum } from './gameLogic.js';
import { useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

/**
 * @param {{ rows: Array<{ defId: string, dmg: number, kills?: number, heal?: number, count?: number }> | null }} props
 */
export function DamageBoard({ rows }) {
  useData('assets', 'chess'); // operator avatars resolve from the assets / chess manifests
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return html`<div class="dmgboard" role="list" aria-label=${t('伤害 / 治疗统计')} title=${t('伤害（黄）/ 治疗（蓝）：本场战斗累计')}>
    ${rows.map((r) => html`<div class="dmgboard__cell" role="listitem" key=${r.defId}
        title=${t('伤害 {dmg} · 治疗 {heal}（本场）', { dmg: fmtNum(r.dmg), heal: fmtNum(r.heal || 0) })}>
      <${UnitThumb} kind="chess" id=${r.defId} size="xs" showTier=${false} />
      <b class="dmgboard__num num">${fmtNum(r.dmg)}</b>
      ${r.heal > 0 ? html`<b class="dmgboard__heal num">${fmtNum(r.heal)}</b>` : null}
      ${r.count > 1 ? html`<span class="dmgboard__x num">×${r.count}</span>` : null}
    </div>`)}
  </div>`;
}
