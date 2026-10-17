// test/ui/achievement-badge.test.js — [ACH] 房间座位的棋子徽章：分数 → 档位，无分数不渲染。
// 纯函数 `seatAchBadge` 与 shared/achievement.js 的 pieceOf 同源；房间只画字形 + 分数（不需要 i18n 文案）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);

test('[ACH] seatAchBadge：0/9 车 · 10/29 马 · 30/59 象 · 60/99 后 · 100+ 王', async () => {
  const { seatAchBadge } = await load();
  const id = (n) => seatAchBadge(n).id;
  assert.equal(id(0), 'rook');
  assert.equal(id(9), 'rook');
  assert.equal(id(10), 'knight');
  assert.equal(id(29), 'knight');
  assert.equal(id(30), 'bishop');
  assert.equal(id(59), 'bishop');
  assert.equal(id(60), 'queen');
  assert.equal(id(99), 'queen');
  assert.equal(id(100), 'king');
  assert.equal(id(12345), 'king');
});

test('[ACH] seatAchBadge：null / undefined / NaN 不渲染徽章', async () => {
  const { seatAchBadge } = await load();
  assert.equal(seatAchBadge(null), null);
  assert.equal(seatAchBadge(undefined), null);
  assert.equal(seatAchBadge(NaN), null);
  assert.equal(seatAchBadge('12'), null, '字符串分数不算数（服务端只发 number|null）');
});

test('[ACH] 徽章带分档配色与字形', async () => {
  const { seatAchBadge } = await load();
  assert.deepEqual(
    { glyph: seatAchBadge(9).glyph, color: seatAchBadge(9).color, ink: seatAchBadge(9).ink },
    { glyph: '\u265C', color: '#727171', ink: '#ffffff' },
  );
  assert.deepEqual(
    { glyph: seatAchBadge(100).glyph, color: seatAchBadge(100).color, ink: seatAchBadge(100).ink },
    { glyph: '\u265A', color: '#cf6c28', ink: '#ffffff' },
  );
});
