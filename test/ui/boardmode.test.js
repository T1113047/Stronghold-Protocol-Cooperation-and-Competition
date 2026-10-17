// [BOARDMODE] 棋盘样式 (3D 棋盘 / 2D 棋盘（简化平面）) + 画面自动调节: the settings defaults and sanitising
// (ui/gameLogic/settings.js), the settings→board-style mapping (render/app/view.js boardSetting) and the
// "simplified plane or the engine?" decision of the field host (ui/fieldHost.js flatFieldPreferred).
// Pure / unit: no DOM, no GPU, no network (the URL is the only external input, and it is faked here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, BOARD_FORCES, UNIT_FORCES, sanitizeSettings } from '../../public/js/ui/gameLogic.js';
import { boardSetting } from '../../public/js/render/app/view.js';
import { flatFieldPreferred } from '../../public/js/ui/fieldHost.js';

/** Run `fn` with `location.search` faked (the only URL input of renderPref / flatFieldPreferred). */
function withSearch(search, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'location');
  const prev = globalThis.location;
  const prevRender = globalThis.__SP_RENDER__;
  try {
    globalThis.location = { search };
    delete globalThis.__SP_RENDER__;
    return fn();
  } finally {
    if (had) globalThis.location = prev; else delete globalThis.location;
    if (prevRender === undefined) delete globalThis.__SP_RENDER__; else globalThis.__SP_RENDER__ = prevRender;
  }
}

test('[BOARDMODE] settings: 画面自动调节 on by default, 棋盘样式 defaults to the simplified plane and is sanitised', () => {
  assert.equal(DEFAULT_SETTINGS.pictureAuto, true, 'auto by default（跟随设备）');
  assert.equal(DEFAULT_SETTINGS.boardForce, 'flat', 'the forced default is the cheapest（整体降级到 2D 简化平面）');
  assert.deepEqual(BOARD_FORCES, ['3d', 'flat']);
  assert.deepEqual(UNIT_FORCES, ['on', 'off'], 'the [UNITMODELS] choices are untouched');
  assert.equal(sanitizeSettings(null).boardForce, 'flat');
  assert.equal(sanitizeSettings({ bgm: 0.4 }).boardForce, 'flat', 'a profile saved before the setting existed');
  assert.equal(sanitizeSettings({ pictureAuto: false }).boardForce, 'flat', '画面自动调节 off alone keeps the default');
  assert.equal(sanitizeSettings({ boardForce: '3d' }).boardForce, '3d');
  assert.equal(sanitizeSettings({ pictureAuto: false, boardForce: 'flat' }).boardForce, 'flat');
  for (const bad of ['auto', '2d', '2D', 1, null, {}, true]) {
    assert.equal(sanitizeSettings({ boardForce: bad }).boardForce, 'flat', String(bad));
  }
});

test('[BOARDMODE] boardSetting: auto while 画面自动调节 is on, else the player’s 棋盘样式', () => {
  assert.equal(boardSetting(undefined), 'auto');
  assert.equal(boardSetting({}), 'auto');
  assert.equal(boardSetting({ pictureAuto: true, boardForce: '3d' }), 'auto', 'auto follows the device, not the forced value');
  assert.equal(boardSetting({ pictureAuto: false, boardForce: '3d' }), '3d');
  assert.equal(boardSetting({ pictureAuto: false, boardForce: 'flat' }), 'flat');
  // a profile from before the setting existed: 画面自动调节 off with no 棋盘样式 → the cheapest (flat)
  assert.equal(boardSetting({ pictureAuto: false }), 'flat');
  assert.equal(boardSetting({ pictureAuto: false, boardForce: 'nonsense' }), 'flat');
});

test('[BOARDMODE] flatFieldPreferred: ?render wins, then ?board, then the setting, else auto (the engine)', () => {
  const flat = { pictureAuto: false, boardForce: 'flat' };
  const three = { pictureAuto: false, boardForce: '3d' };
  withSearch('', () => {
    assert.equal(flatFieldPreferred(flat), true, '设置「2D 棋盘（简化平面）」');
    assert.equal(flatFieldPreferred(three), false, '设置「3D 棋盘」');
    assert.equal(flatFieldPreferred({ pictureAuto: true }), false, '画面自动调节 on → 引擎');
    assert.equal(flatFieldPreferred(), false, 'no argument: the (default) settings store → 引擎');
  });
  withSearch('?board=2d', () => {
    assert.equal(flatFieldPreferred({ pictureAuto: true }), true, 'URL ?board=2d 覆盖设置');
    assert.equal(flatFieldPreferred(three), true);
  });
  withSearch('?board=3d', () => {
    assert.equal(flatFieldPreferred(flat), false, 'URL ?board=3d 覆盖设置');
  });
  withSearch('?board=2d', () => {
    assert.equal(flatFieldPreferred({ pictureAuto: true }), true);
  });
  // ?render outranks ?board and the setting: 'fallback' = the DOM view, 'engine' = never the DOM view
  withSearch('?render=fallback&board=3d', () => {
    assert.equal(flatFieldPreferred(three), true);
    assert.equal(flatFieldPreferred({ pictureAuto: true }), true);
  });
  withSearch('?render=engine&board=2d', () => {
    assert.equal(flatFieldPreferred(flat), false);
    assert.equal(flatFieldPreferred({ pictureAuto: true }), false);
  });
  withSearch('?render=fallback', () => {
    assert.equal(flatFieldPreferred(three), true);
  });
  // the global dev switch (no URL) behaves like ?render=fallback, and ?render=engine still outranks it
  withSearch('', () => {
    globalThis.__SP_RENDER__ = 'fallback';
    assert.equal(flatFieldPreferred(three), true);
    globalThis.location = { search: '?render=engine' };
    assert.equal(flatFieldPreferred(three), false);
  });
  // a junk value never throws and reads as auto
  withSearch('?board=2D&render=nonsense', () => {
    assert.equal(flatFieldPreferred(flat), true, 'only the setting is left');
  });
});
