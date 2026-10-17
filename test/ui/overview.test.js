// [OVERVIEW] 查看队友概览 — the 生命 / 等级 / 上场 numbers of the player the bottom bar (and the prep scouting pill)
// shows, read from `m.public players[]` (ui/gameLogic/watch.js watchedOverview; screens/game.js + ui/combatHud.js
// render them). No new message: the fields are the ones the server already sends (server/match/match/views.js
// publicView → lp / shopLevel / boardCount).
// Pure / unit: no DOM, no server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchedOverview } from '../../public/js/ui/gameLogic.js';

const row = (over = {}) => ({ playerId: 'p1', seat: 0, name: '阿米娅', alive: true, lp: 12, shopLevel: 4, boardCount: 7, ...over });

test('[OVERVIEW] watchedOverview: 生命 / 等级 / 上场 of the player on screen', () => {
  assert.deepEqual(watchedOverview({ players: [row()] }, 'p1'), { lp: 12, level: 4, board: 7 });
  // the row order in m.public is the seat order: the id, not the position, picks it
  const pub = { players: [row({ playerId: 'a', seat: 0, lp: 3, shopLevel: 1, boardCount: 0 }), row({ playerId: 'b', seat: 1, lp: 30, shopLevel: 6, boardCount: 12 })] };
  assert.deepEqual(watchedOverview(pub, 'b'), { lp: 30, level: 6, board: 12 });
  assert.deepEqual(watchedOverview(pub, 'a'), { lp: 3, level: 1, board: 0 });
  // 0 is a number, not a missing value ('--' is only for what the server does not send)
  assert.equal(watchedOverview(pub, 'a').board, 0);
  // the numbers are independent: a field the server left out shows as null (the client prints '--')
  assert.deepEqual(watchedOverview({ players: [row({ lp: undefined, shopLevel: 'x' })] }, 'p1'), { lp: null, level: null, board: 7 });
});

test('[OVERVIEW] watchedOverview: nothing to show for your own row-less target, a 2V2 hidden opponent stub or junk input', () => {
  const pub = { players: [row()] };
  assert.equal(watchedOverview(pub, 'nobody'), null, 'no such player');
  assert.equal(watchedOverview(pub, null), null);
  assert.equal(watchedOverview(pub, ''), null);
  assert.equal(watchedOverview(pub, 42), null);
  assert.equal(watchedOverview(null, 'p1'), null);
  assert.equal(watchedOverview({}, 'p1'), null);
  assert.equal(watchedOverview({ players: [] }, 'p1'), null);
  assert.equal(watchedOverview({ players: 'junk' }, 'p1'), null);
  // 2V2 before the reveal the opponent's row is a stub (server/match/match/messaging.js _teamPublicView): it carries the
  // TEAM's shared LP but no 等级 / 上场. Never hand a viewer more than the server published.
  const stub = { playerId: 'p2', seat: 2, name: '对手', team: 1, alive: true, lp: 20, hidden: true };
  assert.equal(watchedOverview({ players: [row(), stub] }, 'p2'), null);
  // after the reveal (R14+) the row is the full one again and may be shown like any other
  assert.deepEqual(watchedOverview({ players: [row(), { ...stub, hidden: false, shopLevel: 5, boardCount: 9 }] }, 'p2'), { lp: 20, level: 5, board: 9 });
});
