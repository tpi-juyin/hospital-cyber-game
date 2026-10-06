import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window, type HTMLButtonElement, type HTMLAnchorElement, type HTMLElement } from 'happy-dom';
import { Engine } from '../src/server/engine';
import { GAME_VERSION } from '../src/shared/version';

test('host displays version, controls surrender and identifies a server that still needs restarting', async t => {
  const compiled = await build({ entryPoints: ['src/client/host.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' } });
  const window = new Window({ url: 'http://127.0.0.1', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  const game = new Engine(), player = game.connect(); game.setUltimateMode(false); game.action(player.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  const state = { lobby: game.lobby(), rooms: [game.playerView(player.id)!], uptimeSeconds: 0, tunnelStatus: '測試' };
  const sent: unknown[] = [], polls: (() => void)[] = [];
  let disconnected = false;
  window.setTimeout = ((callback: () => void, delay?: number) => { if (delay === 500) polls.push(callback); return 1; }) as unknown as typeof window.setTimeout;
  window.fetch = (async (_url: unknown, options?: { body?: string }) => {
    if (disconnected) throw new TypeError('Connection lost');
    if (options?.body) {
      const action = JSON.parse(options.body); sent.push(action);
      if (action.kind === 'ultimate-mode') state.lobby.ultimateMode = action.value;
      else state.lobby.allowSurrender = action.value;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
  }) as unknown as typeof window.fetch;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  window.eval(compiled.outputFiles[0].text); await settle();
  assert.equal(window.document.querySelector('.version-label')!.textContent, `v${GAME_VERSION}`);
  const toggle = window.document.querySelector<HTMLButtonElement>('#allow-surrender')!;
  assert.equal(toggle.disabled, false); assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  toggle.click(); await settle(); polls.shift()!(); await settle();
  assert.deepEqual(sent[0], { kind: 'allow-surrender', value: true });
  assert.equal(toggle.getAttribute('aria-pressed'), 'true'); assert.equal(toggle.textContent, '顯示');
  toggle.click(); await settle(); polls.shift()!(); await settle();
  assert.deepEqual(sent[1], { kind: 'allow-surrender', value: false });
  assert.equal(toggle.textContent, '隱藏');
  const ultimate = window.document.querySelector<HTMLButtonElement>('#ultimate-mode')!;
  assert.equal(ultimate.getAttribute('aria-pressed'), 'false');
  ultimate.click(); await settle(); polls.shift()!(); await settle();
  assert.deepEqual(sent[2], { kind: 'ultimate-mode', value: true });
  assert.equal(ultimate.textContent, '開啟'); assert.equal(ultimate.getAttribute('aria-pressed'), 'true');
  ultimate.click(); await settle(); polls.shift()!(); await settle();
  assert.deepEqual(sent[3], { kind: 'ultimate-mode', value: false }); assert.equal(ultimate.textContent, '關閉');
  window.document.querySelector<HTMLButtonElement>('[data-project]')!.click();
  assert.equal(window.document.querySelector('.projection-version')!.textContent, `v${GAME_VERSION}`);
  const projection = window.document.querySelector<HTMLElement>('#projection')!;
  const exit = projection.querySelector<HTMLButtonElement>('[data-exit]')!;
  assert.equal(projection.hidden, false); assert.equal(window.document.querySelector<HTMLElement>('.host-shell')!.inert, true);
  state.rooms[0].hp = 50; polls.shift()!(); await settle();
  assert.ok(projection.querySelector('[data-node="primary"].node-down')); assert.equal(projection.querySelector('[data-exit]'), exit);
  disconnected = true; polls.shift()!(); await settle();
  assert.equal(projection.querySelector<HTMLElement>('#monitor-stale')!.hidden, false);
  disconnected = false; polls.shift()!(); await settle();
  assert.equal(projection.querySelector<HTMLElement>('#monitor-stale')!.hidden, true);
  exit.click(); assert.equal(projection.hidden, true); assert.equal(window.document.querySelector<HTMLElement>('.host-shell')!.inert, false);
  window.document.querySelector<HTMLButtonElement>('[data-project]')!.click();
  state.rooms = []; polls.shift()!(); await settle();
  assert.equal(projection.hidden, true, 'closed room returns host to overview');
  assert.equal(window.document.body.classList.contains('monitor-open'), false);
  state.lobby.version = 'older'; polls.shift()!(); await settle();
  assert.equal(toggle.disabled, true); assert.equal(window.document.querySelector<HTMLElement>('#version-warning')!.hidden, false);
  assert.equal(ultimate.disabled, true);
  Object.defineProperty(window, 'confirm', { value: () => { throw new Error('Native confirmation must not be used'); } });
  state.rooms = [game.playerView(player.id)!]; polls.shift()!(); await settle();
  const cancel = () => window.document.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
  const confirm = () => window.document.querySelector<HTMLButtonElement>('[data-confirm]')!.click();
  window.document.querySelector<HTMLButtonElement>('[data-close]')!.click();
  assert.ok(window.document.querySelector('[role="dialog"]')); cancel(); await settle(); assert.equal(sent.length, 4);
  window.document.querySelector<HTMLButtonElement>('[data-close]')!.click(); confirm(); await settle();
  assert.deepEqual(sent[4], { kind: 'close', roomId: state.rooms[0].id });
  window.document.querySelector<HTMLButtonElement>('#stop')!.click(); cancel(); await settle(); assert.equal(sent.length, 5);
  window.document.querySelector<HTMLButtonElement>('#stop')!.click(); confirm(); await settle();
  assert.deepEqual(sent[5], { kind: 'stop' }); assert.ok(window.document.querySelector('.stopped-card'));
  assert.equal(window.happyDOM.virtualConsolePrinter.readAsString(), '');
});

test('host rebuild uses the game confirmation and guards cancellation, duplicate clicks, failure and unavailable launchers', async t => {
  const compiled = await build({ entryPoints: ['src/client/host.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' } });
  const window = new Window({ url: 'http://127.0.0.1', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  const state = { lobby: new Engine().lobby(), rooms: [], uptimeSeconds: 0, tunnelStatus: 'ready', tunnelControl: { available: true, busy: false, failed: false } };
  const sent: any[] = [], polls: (() => void)[] = []; let finishPost!: () => void;
  window.setTimeout = ((fn: () => void, ms?: number) => { if (ms === 500) polls.push(fn); return 1; }) as unknown as typeof window.setTimeout;
  window.fetch = (async (_url: unknown, options?: { body?: string }) => {
    if (options?.body) { sent.push(JSON.parse(options.body)); await new Promise<void>(r => finishPost = r); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
  }) as unknown as typeof window.fetch;
  Object.defineProperty(window, 'confirm', { value: () => { throw new Error('Do not use browser confirm'); } });
  const settle = () => new Promise(r => setImmediate(r));
  window.eval(compiled.outputFiles[0].text); await settle();
  const button = window.document.querySelector<HTMLButtonElement>('#rebuild-tunnel')!;
  button.click(); assert.match(window.document.querySelector('[role="dialog"]')!.textContent, /不計勝負.*重新掃描/);
  window.document.querySelector<HTMLButtonElement>('[data-cancel]')!.click(); await settle(); assert.equal(sent.length, 0);
  button.click(); window.document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  button.click(); assert.equal(button.disabled, true); assert.deepEqual(sent, [{ kind: 'rebuild-tunnel' }]);
  state.tunnelControl.busy = true; finishPost(); await settle(); polls.shift()!(); await settle();
  assert.equal(button.disabled, true); assert.match(button.textContent!, /重建中/);
  assert.equal(window.document.querySelector<HTMLButtonElement>('#accepting')!.disabled, true);
  state.tunnelControl.busy = false; state.tunnelControl.failed = true; state.tunnelStatus = '重建失敗'; polls.shift()!(); await settle();
  assert.equal(button.disabled, false); assert.equal(button.textContent, '重試公開連線');
  assert.equal(window.document.querySelector('#tunnel-status')!.textContent, '重建失敗');
  state.tunnelControl.failed = false; state.tunnelControl.available = false; polls.shift()!(); await settle(); assert.equal(button.disabled, true);
  state.tunnelControl.available = true; state.lobby.version = 'old'; polls.shift()!(); await settle(); assert.equal(button.disabled, true);
});

test('host QR zoom traps focus, closes by button/backdrop/Escape and withdraws stale public codes', async t => {
  const compiled = await build({ entryPoints: ['src/client/host.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' }, plugins: [{ name: 'qr-fixture', setup(b) {
    b.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'qr' }));
    b.onLoad({ filter: /.*/, namespace: 'qr' }, () => ({ contents: `export default { toCanvas(canvas,url,options) { canvas.dataset.url=url; canvas.dataset.size=String(options.width); return Promise.resolve(); } };` }));
  } }] });
  const window = new Window({ url: 'http://127.0.0.1', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  const state = { lobby: new Engine().lobby(), rooms: [], uptimeSeconds: 0, tunnelStatus: 'ready', tunnelControl: { available: true, busy: false, failed: false } };
  const polls: (() => void)[] = []; let offline = false;
  window.setTimeout = ((fn: () => void, ms?: number) => { if (ms === 500) polls.push(fn); return 1; }) as unknown as typeof window.setTimeout;
  window.fetch = (async () => { if (offline) throw new TypeError('offline'); return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) }; }) as unknown as typeof window.fetch;
  const settle = () => new Promise(r => setImmediate(r));
  const poll = async () => { polls.shift()!(); await settle(); };
  window.eval(compiled.outputFiles[0].text); await settle();
  const zoom = window.document.querySelector<HTMLButtonElement>('#zoom-qr')!;
  const app = window.document.querySelector<HTMLElement>('#app')!;
  const dialog = () => window.document.querySelector('.qr-dialog');
  assert.equal(zoom.disabled, true); zoom.click(); assert.equal(dialog(), null);
  state.lobby.joinUrl = 'https://first-game.trycloudflare.com'; await poll();
  const joinLink = window.document.querySelector<HTMLAnchorElement>('#join-url')!;
  assert.equal(joinLink.getAttribute('href'), state.lobby.joinUrl); assert.equal(joinLink.target, '_blank');
  assert.equal(joinLink.getAttribute('rel'), 'noopener noreferrer');
  zoom.focus(); zoom.click();
  assert.equal(app.inert, true);
  assert.equal(dialog()!.querySelector('canvas')!.getAttribute('data-url'), state.lobby.joinUrl);
  assert.equal(dialog()!.querySelector('canvas')!.getAttribute('data-size'), '800');
  const close = dialog()!.querySelector<HTMLButtonElement>('[data-close-qr]')!;
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(window.document.activeElement, close);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog(), null); assert.equal(app.inert, false); assert.equal(window.document.activeElement, zoom);
  zoom.click(); dialog()!.querySelector<HTMLButtonElement>('[data-close-qr]')!.click(); assert.equal(dialog(), null);
  zoom.click(); window.document.querySelector<HTMLElement>('.qr-dialog-backdrop')!.click(); assert.equal(dialog(), null);
  zoom.click(); state.lobby.joinUrl = 'https://second-game.trycloudflare.com'; await poll(); assert.equal(dialog(), null);
  zoom.click(); assert.equal(dialog()!.querySelector('canvas')!.getAttribute('data-url'), state.lobby.joinUrl);
  state.lobby.joinUrl = ''; await poll(); assert.equal(dialog(), null); assert.equal(zoom.disabled, true); assert.equal(joinLink.hasAttribute('href'), false);
  state.lobby.joinUrl = 'https://second-game.trycloudflare.com'; await poll(); zoom.click(); offline = true; await poll();
  assert.equal(dialog(), null); assert.equal(zoom.disabled, true); assert.equal(app.inert, false);
});

test('cloud host hides tunnel controls and keeps dashboard usable after ending activity', async t => {
  const compiled = await build({ entryPoints: ['src/client/host.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' } });
  const window = new Window({ url: 'https://hospital.example/host', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  const state = { hostingMode: 'cloud', lobby: new Engine().lobby(), rooms: [], uptimeSeconds: 0, tunnelStatus: '雲端', tunnelControl: { available: false, busy: false, failed: false } };
  const sent: unknown[] = [];
  window.setTimeout = (() => 1) as unknown as typeof window.setTimeout;
  window.fetch = (async (_url: unknown, options?: { body?: string }) => {
    if (options?.body) { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => state };
  }) as unknown as typeof window.fetch;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  window.eval(compiled.outputFiles[0].text); await settle();
  assert.equal(window.document.querySelector<HTMLElement>('#rebuild-tunnel')!.hidden, true);
  assert.equal(window.document.querySelector<HTMLElement>('#cloud-logout')!.hidden, false);
  assert.equal(window.document.querySelector<HTMLElement>('#tunnel-status')!.hidden, true);
  window.document.querySelector<HTMLButtonElement>('#stop')!.click();
  assert.match(window.document.querySelector('.game-dialog')!.textContent!, /網址保留/);
  window.document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  assert.deepEqual(sent, [{ kind: 'stop' }]); assert.ok(window.document.querySelector('#accepting'));
  assert.equal(window.document.querySelector('.stopped-card'), null);
});
