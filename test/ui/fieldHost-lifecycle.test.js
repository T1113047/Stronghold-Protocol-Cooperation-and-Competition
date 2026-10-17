// Field-host ownership under cancellation and timeout. Browser tests cover the actual renderer; this fixture runs
// the production orchestration with controlled imports and timers, without a DOM or GPU dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';
import { boardSetting } from '../../public/js/render/app/view.js'; // [BOARDMODE] the fixture runs the production one

const sourcePath = new URL('../../public/js/ui/fieldHost.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
  .replace("import('../assets.js')", 'importAssets()')
  .replace("import('../render/app.js')", 'importApp()');
const METHODS = ['setStage', 'setCamera', 'setPrep', 'enterBattle', 'pushSnapshot', 'pushEvents', 'highlightTiles', 'on', 'resize'];
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture(extra = {}) {
  const timers = new Map(), requests = [], fallbacks = [], warnings = [];
  let timerId = 0;
  const unrelated = { name: 'unrelated' };
  const host = {
    children: [unrelated],
    get firstChild() { return this.children[0] || null; },
    appendChild(node) { this.children.push(node); },
    removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); },
  };
  function view(name, valid = true) {
    const node = { name };
    host.appendChild(node);
    return {
      ...(valid ? Object.fromEntries(METHODS.map((k) => [k, () => {}])) : {}),
      node, destroyCalls: 0,
      destroy() { this.destroyCalls++; host.removeChild(node); },
    };
  }
  const context = vm.createContext({
    AbortController, DOMException, URLSearchParams, Promise,
    console: { warn: (...args) => warnings.push(args), info: () => {} },
    gpuTier: () => 'ok',
    audio: {}, data: { get() { return null; } }, settingsStore: { get() { return {}; } },
    // [PREFETCH]: fieldHost installs the operator-asset prefetch at module load; the real module needs the store / data
    installOpPrefetch: () => {},
    // [BOARDMODE]: the settings→board-style mapping (render/app/view.js, pure) and the toast fieldHost raises for a
    // forced 3D board the engine cannot start (the engine itself is stubbed here)
    boardSetting,
    toast: () => {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    importAssets: async () => null,
    importApp: async () => ({
      createFieldView(_host, opts) {
        // Deliberately ignore cancellation: the host must still dispose a factory's late return value.
        return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: opts.signal, opts }));
      },
    }),
    createFallbackView() {
      const fallback = view('fallback');
      fallbacks.push({ view: fallback, rendererAborted: requests.at(-1)?.signal?.aborted });
      return fallback;
    },
    ...extra,
  });
  vm.runInContext(source + '\nglobalThis.mount = mountFieldView;', context, { filename: sourcePath.pathname });
  return {
    host, unrelated, timers, requests, fallbacks, warnings, view,
    mount: (signal) => context.mount(host, { signal }),
    timeout() { const fn = [...timers.values()].at(-1); assert.ok(fn, 'initialization has a deadline'); fn(); },
  };
}

function settled(promise) {
  const result = { state: 'pending', value: null };
  promise.then((value) => { result.state = 'fulfilled'; result.value = value; }, (error) => { result.state = 'rejected'; result.value = error; });
  return result;
}

test('a weak GPU starts the field on the 2D board instead of the official 3D one', async () => {
  const f = fixture({ gpuTier: () => 'weak' });
  const pending = f.mount();
  await flush();
  assert.equal(f.requests[0].opts.board, '2d', 'the 2D atlas board is the default without a real GPU');
  assert.equal(f.requests[0].opts.settings && typeof f.requests[0].opts.settings, 'object');
  f.requests[0].resolve(f.view('engine'));
  (await pending).destroy();
});

test('successful initialization releases deadlines and cancellation listeners', async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.mount(controller.signal);
  await flush();
  const raw = f.view('engine');
  f.requests[0].resolve(raw);
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(f.requests[0].signal, 'abort').length, 0);
  mounted.destroy();
  assert.equal(raw.destroyCalls, 1);
});

test('cancelling a pending mount rejects without fallback and disposes a late result', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('cancellation between factory resolution and mount continuation disposes the resolved view', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  const raw = f.view('settling');
  f.requests[0].resolve(raw);
  await Promise.resolve();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(raw.destroyCalls, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('an invalid renderer API is disposed and aborted before fallback mounts', async () => {
  const f = fixture();
  const pending = f.mount();
  await flush();
  const invalid = f.view('invalid', false);
  f.requests[0].resolve(invalid);
  const fallback = await pending;
  assert.equal(fallback.kind, 'fallback');
  assert.equal(invalid.destroyCalls, 1);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, f.fallbacks[0].view.node]);
  fallback.destroy();
});

test('a timed-out factory returning late cannot remove a replacement view or unrelated children', async () => {
  const f = fixture();
  const first = f.mount();
  await flush();
  f.timeout();
  const fallback = await first;
  assert.equal(fallback.kind, 'fallback');
  fallback.destroy();
  const replacementPending = f.mount();
  await flush();
  const replacement = f.view('replacement');
  f.requests[1].resolve(replacement);
  const mounted = await replacementPending;
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.equal(replacement.destroyCalls, 0);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, replacement.node]);
  mounted.destroy();
});

// ---- [BOARDMODE]: which view the settings / the URL ask for (ui/fieldHost.js flatFieldPreferred) ---------------

test('[BOARDMODE] 设置「2D 棋盘（简化平面）」mounts the DOM view without asking for the engine', async () => {
  const f = fixture({ settingsStore: { get: () => ({ pictureAuto: false, boardForce: 'flat' }) } });
  const fallback = await f.mount();
  assert.equal(fallback.kind, 'fallback');
  assert.deepEqual(f.requests, [], 'the engine is never imported for a deliberate 2D board');
  assert.deepEqual(f.warnings, [], 'a deliberate choice is not a failure');
  assert.equal(f.timers.size, 0);
  fallback.destroy();
});

test('[BOARDMODE] ?render=engine keeps the engine even when the settings ask for the simplified plane', async () => {
  const f = fixture({ settingsStore: { get: () => ({ pictureAuto: false, boardForce: 'flat' }) }, location: { search: '?render=engine' } });
  const pending = f.mount();
  await flush();
  assert.equal(f.requests.length, 1, 'the engine is attempted');
  f.requests[0].resolve(f.view('engine'));
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  mounted.destroy();
});

test('[BOARDMODE] the URL board wins: ?board=2d = the simplified plane, ?board=3d = the engine', async () => {
  const flat = fixture({ location: { search: '?board=2d' } });
  const dom = await flat.mount();
  assert.equal(dom.kind, 'fallback');
  assert.deepEqual(flat.requests, []);
  dom.destroy();
  const three = fixture({ location: { search: '?board=3d' } });
  const pending = three.mount();
  await flush();
  assert.equal(three.requests.length, 1);
  three.requests[0].resolve(three.view('engine'));
  (await pending).destroy();
});

test('[BOARDMODE] a weak GPU keeps its 2D default, but the player’s explicit 3D board wins', async () => {
  const weak = fixture({ gpuTier: () => 'weak' });
  const pending = weak.mount();
  await flush();
  assert.equal(weak.requests[0].opts.board, '2d');
  assert.equal(weak.requests[0].opts.weakGpu, true);
  weak.requests[0].resolve(weak.view('engine'));
  (await pending).destroy();
  const forced = fixture({ gpuTier: () => 'weak', settingsStore: { get: () => ({ pictureAuto: false, boardForce: '3d' }) } });
  const pendingForced = forced.mount();
  await flush();
  assert.equal(forced.requests[0].opts.board, undefined, 'the weak-GPU 2D default does not override the player');
  assert.equal(forced.requests[0].opts.weakGpu, undefined);
  forced.requests[0].resolve(forced.view('engine'));
  (await pendingForced).destroy();
});

test('[BOARDMODE] the engine is handed the board notice hook (the forced-3D failure toast)', async () => {
  const f = fixture({ settingsStore: { get: () => ({ pictureAuto: false, boardForce: '3d' }) } });
  const pending = f.mount();
  await flush();
  assert.equal(typeof f.requests[0].opts.onBoardNotice, 'function', 'ui/fieldHost.js toasts it (the render layer stays ui-free)');
  f.requests[0].resolve(f.view('engine'));
  (await pending).destroy();
});
