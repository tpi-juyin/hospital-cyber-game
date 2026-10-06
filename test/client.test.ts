import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window, type HTMLInputElement, type HTMLButtonElement, type HTMLElement as HappyHTMLElement } from 'happy-dom';
import { hospital, updateHospital } from '../src/client/art';
import { randomName } from '../src/client/names';
import { effectMarkup, BattleEffects } from '../src/client/effects';
import { Engine } from '../src/server/engine';
import { GAME_VERSION } from '../src/shared/version';
import { STRATEGIES, type Action } from '../src/shared/protocol';
import type { AudioState } from '../src/client/audio';

test('nickname suggestions stay within server limits and rerolls always change the name', () => {
  const all = new Set<string>();
  for (let i = 0; i < 144; i++) {
    const name = randomName('', () => i / 144);
    assert.ok(name.length > 0 && name.length <= 16); assert.doesNotMatch(name, /[<>\u0000-\u001f]/);
    assert.notEqual(randomName(name, () => i / 144), name); all.add(name);
  }
  assert.equal(all.size, 144);
});

test('eight wordless effects including ultimates finish during rapid taps with bounded particles and cleanup', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = new Window(); t.after(() => window.happyDOM.close());
  window.document.body.innerHTML = '<section><div class="attacker-art"></div><div class="defender-art"></div><div data-effects="attack"></div><div data-effects="defense"></div></section>';
  const stage = window.document.querySelector('section')! as unknown as HTMLElement;
  const effects = new BattleEffects(); t.after(() => effects.clear());
  const templates = new Set<string>();
  for (const role of ['attack', 'defense'] as const) for (const strategy of [0, 1, 2, 3] as const) {
    templates.add(effectMarkup(role, strategy));
    effects.play(stage, role, strategy);
    assert.ok(stage.querySelector(`[data-effects="${role}"]`)!.children.length <= 4);
    assert.ok(stage.querySelector(`.fx-${role}-${strategy}`));
    assert.equal(stage.querySelector(`.fx-${role}-${strategy}`)!.textContent, '', 'no captions or numeric text in effects');
  }
  assert.equal(templates.size, 8);
  assert.equal(stage.querySelectorAll('.battle-effect').length, 8);
  for (let i = 0; i < 20; i++) { effects.play(stage, 'attack', 0); effects.play(stage, 'defense', 0); }
  assert.equal(stage.querySelectorAll('.battle-effect').length, 8);
  assert.equal(stage.querySelectorAll('.casting').length, 2);
  t.mock.timers.tick(681); assert.equal(stage.querySelectorAll('.battle-effect').length, 0);
  assert.equal(stage.querySelectorAll('.casting').length, 0);
  effects.play(stage, 'attack', 0); effects.clear();
  assert.equal(stage.querySelectorAll('.battle-effect').length, 0, 'clear static effects when leaving/backgrounding');
});

// Execute the real player entry with transport/audio adapters mocked; test audio scheduling separately.
const compiled = build({
  entryPoints: ['src/client/player.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
  plugins: [{ name: 'offline-socket', setup(b) {
    b.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'qr-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'qr-fixture' }, () => ({ contents: 'export default { toCanvas: () => Promise.resolve() };' }));
    b.onResolve({ filter: /^\.\/audio$/ }, () => ({ path: 'audio', namespace: 'audio-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'audio-fixture' }, () => ({ contents: `export class BattleAudio {
      constructor(){ this.states=[]; this.actions=[]; this.outcomes=[]; this.countdowns=[]; this.unlocks=0; window.testAudio=this; }
      configure(s){this.states.push(s);} unlock(){this.unlocks++;return Promise.resolve();} action(...args){this.actions.push(args);} outcome(won){this.outcomes.push(won);} countdown(second){this.countdowns.push(second);}
    }` }));
    b.onResolve({ filter: /^socket.io-client$/ }, () => ({ path: 'socket', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export function io() {
      const callbacks = {}, sent = []; const socket = { auth:{}, volatile:{emit(){}}, on(event, cb) { callbacks[event]=cb; return socket; },
      connect(){}, disconnect(){callbacks.disconnect?.();}, timeout(){return socket;}, emit(event, action, callback){sent.push(action); callback(null, {ok:true});} };
      window.testSocket = {socket, callbacks, sent}; return socket;
    }` }));
  } }],
});

test('battle UI plays own and opponent strategy effects, and music follows room/visibility state', async t => {
  const bundle = (await compiled).outputFiles[0].text;
  for (const role of ['attack', 'defense'] as const) {
    let now = 0;
    const game = new Engine(() => now), player = game.connect();
    game.action(player.id, { kind: 'create', mode: 'solo', role, duration: 60 });
    const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
    window.eval(bundle);
    const fixture = window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> }; testAudio: { states: AudioState[]; actions: unknown[][] } };
    const { callbacks } = fixture.testSocket, audio = fixture.testAudio;
    callbacks.session(player); callbacks.connect(); callbacks.room(game.playerView(player.id));
    assert.equal(audio.states.at(-1)!.battle, false);
    game.action(player.id, { kind: 'ready', ready: true }); callbacks.room(game.playerView(player.id));
    assert.equal(audio.states.at(-1)!.battle, false, 'no music during countdown');
    now = 3000; game.advance(); callbacks.room(game.playerView(player.id));
    assert.equal(audio.states.at(-1)!.battle, true);
    for (const strategy of [0, 1, 2] as const) {
      const state = game.playerView(player.id)!;
      state.members.find(m => m.id === player.id)!.strategy = strategy;
      callbacks.room(state);
      const matched = state.members[0].strategy === state.members[1].strategy;
      assert.ok(window.document.querySelector(`#match-hint.${matched ? 'is-matched' : 'is-mismatched'}`));
      if (!matched) assert.match(window.document.querySelector('#match-hint')!.textContent, /⚠ 防護未對應/);
      window.document.querySelector<HTMLButtonElement>('#tap')!.click();
      assert.deepEqual([...audio.actions.at(-1)!], [role, strategy]);
      assert.ok(window.document.querySelector(`.fx-${role}-${strategy}`));
      const other = role === 'attack' ? 'defense' : 'attack';
      const opponent = state.members.find(m => m.role === other)!;
      opponent.strategy = strategy; opponent.stats.taps = strategy + 1;
      if (other === 'attack') state.attacks = strategy + 1;
      callbacks.room(state);
      assert.deepEqual([...audio.actions.at(-1)!], [other, strategy, true]);
      assert.ok(window.document.querySelector(`.fx-${other}-${strategy}`));
    }
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: true });
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(audio.states.at(-1)!.visible, false);
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(audio.states.at(-1)!.visible, true);
    const state = game.playerView(player.id)!; state.phase = 'paused'; callbacks.room(state);
    assert.equal(audio.states.at(-1)!.battle, false);
    state.phase = 'playing'; callbacks.room(state); callbacks.disconnect();
    assert.equal(audio.states.at(-1)!.battle, false);
    callbacks.connect(); state.phase = 'ended'; callbacks.room(state);
    assert.equal(audio.states.at(-1)!.battle, false);
    assert.ok(window.document.querySelector('#rematch'));
    window.dispatchEvent(new window.Event('pagehide'));
    assert.equal(window.happyDOM.virtualConsolePrinter.readAsString(), '');
  }
});

test('player starts with a saved/default name, dice persists a new name, and audio preferences persist', async t => {
  const bundle = (await compiled).outputFiles[0].text;
  for (const saved of ['', '自訂守護者']) {
    const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    t.after(() => window.happyDOM.close());
    window.document.body.innerHTML = '<div id="app"></div>';
    if (saved) window.localStorage.setItem('hospital-name', saved);
    window.eval(bundle);
    window.document.querySelector<HTMLButtonElement>('#menu-solo')!.click();
    const input = window.document.querySelector<HTMLInputElement>('#nickname')!;
    assert.ok(input.value.length > 0);
    if (saved) assert.equal(input.value, saved);
    const before = input.value;
    window.document.querySelector<HTMLButtonElement>('#random-name')!.click();
    assert.notEqual(input.value, before); assert.equal(window.localStorage.getItem('hospital-name'), input.value);
    input.value = '我自己取名字'; input.dispatchEvent(new window.Event('input'));
    window.document.querySelector<HTMLButtonElement>('#duo')!.click();
    assert.equal(window.document.querySelector<HTMLInputElement>('#nickname')!.value, '我自己取名字');
    window.document.querySelector<HTMLButtonElement>('#music')!.click();
    assert.equal(window.localStorage.getItem('hospital-music'), 'false');
    window.document.querySelector<HTMLButtonElement>('#sound')!.click();
    assert.equal(window.localStorage.getItem('hospital-muted'), 'true');
    window.document.querySelector<HTMLButtonElement>('#motion')!.click();
    assert.ok(window.document.body.classList.contains('reduced-motion'));
    assert.equal(window.happyDOM.virtualConsolePrinter.readAsString(), '');
  }
});

test('enabling music must not change a disabled effects preference', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.localStorage.setItem('hospital-muted', 'true'); window.localStorage.setItem('hospital-music', 'false');
  window.eval((await compiled).outputFiles[0].text);
  window.document.querySelector<HTMLButtonElement>('#music')!.click();
  assert.equal(window.localStorage.getItem('hospital-muted'), 'true', 'music must leave effects disabled');
  assert.equal(window.document.querySelector('#sound')!.getAttribute('aria-pressed'), 'false');
  assert.equal(window.document.querySelector('#music')!.getAttribute('aria-pressed'), 'true');
});

test('both audio buttons share on/off styling and independently persist all four combinations', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const audio = (window as unknown as { testAudio: { states: AudioState[] } }).testAudio;
  const check = (effects: boolean, music: boolean) => {
    for (const [id, on] of [['sound', effects], ['music', music]] as const) {
      const button = window.document.querySelector(`#${id}`)!;
      assert.equal(button.getAttribute('aria-pressed'), String(on));
      assert.equal(button.classList.contains('audio-on'), on);
      assert.equal(!!button.querySelector('.audio-off-line'), !on);
    }
    assert.equal(audio.states.at(-1)!.effects, effects); assert.equal(audio.states.at(-1)!.music, music);
  };
  const click = (id: string) => window.document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  check(true, true);
  click('sound'); check(false, true);
  click('music'); check(false, false);
  click('sound'); check(true, false);
  click('music'); check(true, true);
  assert.equal(window.localStorage.getItem('hospital-muted'), 'false');
  assert.equal(window.localStorage.getItem('hospital-music'), 'true');
  assert.match(window.document.querySelector('#sound')!.getAttribute('aria-label')!, /音效/);
});

test('hospital has two wordless machines, with failure states at half and zero HP', t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  const root = window.document.body;
  root.innerHTML = hospital();
  for (const [hp, failed] of [[100, 0], [50.1, 0], [50, 1], [.1, 1], [0, 2], [100, 0]]) {
    const previous = root.querySelector('svg');
    const previousCount = root.querySelectorAll('.is-down').length;
    updateHospital(root as unknown as ParentNode, hp);
    assert.equal(root.querySelectorAll('.server-machine').length, 2);
    assert.equal(root.querySelectorAll('.is-down').length, failed);
    assert.equal(root.textContent.trim(), '', 'do not label the machines');
    if (failed === previousCount) assert.equal(root.querySelector('svg'), previous, 'do not rebuild SVG every server tick');
    if (failed === 1) assert.ok(root.querySelector('[data-machine="primary"].is-down'));
  }
});

test('battle and result screens keep damage visible, and each completed round signals the player outcome once', async t => {
  for (const role of ['attack', 'defense'] as const) {
    const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
    window.eval((await compiled).outputFiles[0].text);
    const fixture = window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> }; testAudio: { outcomes: boolean[] } };
    const { callbacks } = fixture.testSocket;
    const game = new Engine(), player = game.connect();
    game.action(player.id, { kind: 'create', mode: 'solo', role, duration: 60 });
    callbacks.session(player); callbacks.connect();
    const state = game.playerView(player.id)!; state.phase = 'playing'; state.roundId = 'first';
    callbacks.room(state); assert.equal(window.document.querySelectorAll('.server-machine.is-down').length, 0);
    state.hp = 50; callbacks.room(state);
    assert.equal(window.document.querySelectorAll('.server-machine.is-down').length, 1);
    state.hp = 0; state.phase = 'ended'; state.winner = 'attack';
    state.lessons = [STRATEGIES[2].attackTip, STRATEGIES[1].defenseTip]; callbacks.room(state);
    const learning = window.document.querySelector('details.learning')!;
    assert.ok(learning.hasAttribute('open'), 'result knowledge is expanded by default for either role');
    assert.equal(learning.querySelectorAll('p').length, 2);
    assert.ok(learning.textContent.includes(STRATEGIES[2].attackTip));
    assert.ok(learning.textContent.includes(STRATEGIES[1].defenseTip));
    assert.equal(window.document.querySelectorAll('.result-character .server-machine.is-down').length, role === 'defense' ? 2 : 0);
    assert.deepEqual([...fixture.testAudio.outcomes], [role === 'attack']);
    callbacks.room(state);
    window.document.querySelector<HTMLButtonElement>('#music')!.click();
    callbacks.disconnect(); callbacks.connect();
    assert.equal(fixture.testAudio.outcomes.length, 1, 'snapshots, preferences and reconnect must not replay the result');
    state.roundId = 'second'; state.winner = null; callbacks.room(state);
    assert.equal(fixture.testAudio.outcomes.length, 1, 'no-contest has no win/loss cue');
    state.phase = 'playing'; state.hp = 100; callbacks.room(state);
    assert.equal(window.document.querySelectorAll('.server-machine.is-down').length, 0, 'rematch restores both machines');
    state.phase = 'ended'; state.winner = 'defense'; callbacks.room(state);
    assert.deepEqual([...fixture.testAudio.outcomes], [role === 'attack', role === 'defense']);
    assert.equal(window.happyDOM.virtualConsolePrinter.readAsString(), '');
  }
});

test('players see the version and a host-controlled surrender action with confirmation', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks, sent } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[] } }).testSocket;
  const game = new Engine(), player = game.connect();
  game.action(player.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  callbacks.session(player); callbacks.connect(); callbacks.lobby(game.lobby());
  const room = game.playerView(player.id)!; room.phase = 'playing'; callbacks.room(room);
  assert.equal(window.document.querySelector('.version-label')!.textContent, `v${GAME_VERSION}`);
  const button = () => window.document.querySelector<HTMLButtonElement>('#surrender')!;
  assert.equal(button().hidden, true);
  Object.defineProperty(window, 'confirm', { configurable: true, value: () => { throw new Error('Native confirmation must not be used'); } });
  const dialog = () => window.document.querySelector('[role="dialog"]');
  const cancel = () => window.document.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const confirm = () => window.document.querySelector<HTMLButtonElement>('[data-confirm]')!;
  const app = window.document.querySelector<HappyHTMLElement>('#app')!;
  button().click(); assert.equal(dialog(), null, 'hidden action cannot open confirmation');
  callbacks.lobby({ ...game.lobby(), allowSurrender: true }); assert.equal(button().hidden, false);
  button().focus(); button().click(); button().click();
  assert.equal(window.document.querySelectorAll('[role="dialog"]').length, 1, 'duplicate taps cannot stack dialogs');
  assert.equal(app.inert, true); assert.equal(window.document.activeElement, cancel());
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(window.document.activeElement, confirm());
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(window.document.activeElement, cancel());
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await Promise.resolve(); assert.equal(dialog(), null); assert.equal(app.inert, false);
  assert.equal(window.document.activeElement, button()); assert.equal(sent.length, 0);
  button().click(); cancel().click(); await Promise.resolve(); assert.equal(sent.length, 0);
  button().click(); callbacks.disconnect(); await Promise.resolve();
  assert.equal(dialog(), null); assert.equal(button().disabled, true); callbacks.connect();
  button().click(); callbacks.lobby({ ...game.lobby(), allowSurrender: false }); await Promise.resolve();
  assert.equal(dialog(), null); assert.equal(app.inert, false); assert.equal(sent.length, 0);
  callbacks.lobby({ ...game.lobby(), allowSurrender: true });
  room.phase = 'countdown'; callbacks.room(room); assert.equal(button().hidden, true);
  room.phase = 'paused'; callbacks.room(room); assert.equal(button().hidden, true);
  room.phase = 'playing'; callbacks.room(room);
  button().click(); room.phase = 'ended'; room.winner = 'defense'; callbacks.room(room); await Promise.resolve();
  assert.equal(dialog(), null); assert.equal(sent.length, 0, 'a round that ends while confirming cannot be surrendered');
  room.phase = 'playing'; room.winner = null; room.roundId = 'next'; callbacks.room(room);
  button().click(); confirm().click(); button().click(); await Promise.resolve();
  assert.equal(sent.length, 1, 'only one request while pending');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { kind: 'surrender', roundId: room.roundId, seq: 1 });
  callbacks.lobby({ ...game.lobby(), allowSurrender: false }); assert.equal(button().hidden, true);
  await Promise.resolve();
  room.phase = 'ended'; room.winner = 'defense'; callbacks.room(room);
  assert.equal(window.document.querySelector('#surrender'), null);
  assert.equal(window.document.querySelector('.version-label')!.textContent, `v${GAME_VERSION}`);
});

test('countdown sounds once per visible number, skips missed beats and starts once per round', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const fixture = window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> }; testAudio: { countdowns: number[] } };
  const { callbacks } = fixture.testSocket, game = new Engine(), player = game.connect();
  game.action(player.id, { kind: 'create', mode: 'solo', role: 'defense', duration: 60 });
  callbacks.session(player); callbacks.connect();
  const r = game.playerView(player.id)!; r.phase = 'countdown';
  for (const remaining of [3000, 2950, 2000, 1800, 1000, 100]) { r.remainingMs = remaining; callbacks.room(r); }
  assert.deepEqual([...fixture.testAudio.countdowns], [3, 2, 1]);
  r.phase = 'playing'; callbacks.room(r); callbacks.room(r);
  window.document.querySelector<HTMLButtonElement>('#music')!.click();
  assert.deepEqual([...fixture.testAudio.countdowns], [3, 2, 1, 0]);
  r.phase = 'paused'; callbacks.room(r); r.phase = 'playing'; callbacks.room(r);
  assert.equal(fixture.testAudio.countdowns.length, 4, 'reconnect does not announce a second start');
  r.roundId = 'next'; r.phase = 'countdown'; r.remainingMs = 1400; callbacks.room(r);
  r.phase = 'paused'; callbacks.room(r); r.phase = 'countdown'; callbacks.room(r);
  r.phase = 'playing'; callbacks.room(r);
  assert.deepEqual([...fixture.testAudio.countdowns], [3, 2, 1, 0, 2, 0], 'only current beat is played after joining late');
  r.roundId = 'midgame-refresh'; callbacks.room(r);
  assert.equal(fixture.testAudio.countdowns.length, 6, 'do not play start when connecting mid-game');
});

test('charge bar above three moves becomes a cast button, signals counters and restores after the burst', async t => {
  for (const role of ['attack', 'defense'] as const) {
    const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
    window.eval((await compiled).outputFiles[0].text);
    const fixture = window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[] }; testAudio: { actions: unknown[][] } };
    const { callbacks, sent } = fixture.testSocket, game = new Engine(), player = game.connect();
    game.setUltimateMode(true); game.action(player.id, { kind: 'create', mode: 'solo', role, duration: 60 });
    callbacks.session(player); callbacks.connect(); callbacks.lobby(game.lobby());
    const r = game.playerView(player.id)!, me = r.members[0], opponent = r.members[1]; r.phase = 'playing'; me.strategy = 2; callbacks.room(r);
    const button = () => window.document.querySelector<HTMLButtonElement>('#ultimate')!;
    assert.equal(window.document.querySelectorAll('.strategy-button').length, 3); assert.equal(button().hidden, true);
    const meter = () => window.document.querySelector<HappyHTMLElement>('#ultimate-meter')!;
    assert.equal(meter().hidden, false); assert.equal(meter().getAttribute('aria-valuenow'), '0');
    assert.ok(window.document.querySelector('.controls')!.firstElementChild!.classList.contains('ultimate-panel'));
    me.ultimate.charge = 37.5; callbacks.room(r);
    assert.equal(meter().getAttribute('aria-valuenow'), '37.5'); assert.match(meter().textContent!, /連點集氣 37%/);
    me.ultimate.charge = 100; me.cooldownMs = 3000; callbacks.room(r);
    assert.equal(button().hidden, false); assert.equal(meter().hidden, true);
    assert.equal(button().disabled, false); assert.ok(button().classList.contains('charged'));
    if (role === 'defense') {
      opponent.ultimate = { charge: 0, remainingMs: 5000, uses: 1 }; callbacks.room(r);
      assert.ok(button().classList.contains('counter-alert')); assert.match(window.document.querySelector('#match-hint')!.textContent!, /大招來襲/);
    }
    button().click(); button().click(); assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { kind: 'ultimate', roundId: r.roundId, seq: 1 });
    me.ultimate = { charge: 0, remainingMs: 5000, uses: 1 }; callbacks.room(r); await Promise.resolve();
    assert.equal(button().disabled, true); assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.match(window.document.querySelector('#ultimate-action-label')!.textContent!, /5.0 秒/);
    assert.ok([...window.document.querySelectorAll<HTMLButtonElement>('[data-strategy]')].every(b => b.disabled));
    assert.match(window.document.querySelector(role === 'attack' ? '#attack-type' : '#defense-type')!.textContent!, role === 'attack' ? /暗網超頻/ : /緊急應變/);
    window.document.querySelector<HTMLButtonElement>('#tap')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }));
    assert.deepEqual([...fixture.testAudio.actions.at(-1)!], [role, 3]);
    r.phase = 'paused'; callbacks.room(r); assert.equal(button().disabled, true);
    r.phase = 'playing'; me.ultimate.remainingMs = 0; me.cooldownMs = 0; callbacks.room(r);
    assert.equal(window.document.querySelector('[data-strategy="2"]')!.getAttribute('aria-pressed'), 'true');
    assert.equal(button().classList.contains('active'), false); assert.equal(meter().hidden, false); assert.equal(button().hidden, true);
    me.ultimate.uses = 2; callbacks.room(r); assert.match(meter().textContent!, /本局已用完/);
    r.ultimateMode = false; callbacks.room(r); assert.equal(window.document.querySelector('#ultimate'), null);
    assert.equal(window.document.querySelectorAll('.strategy-button').length, 3);
    assert.equal(window.happyDOM.virtualConsolePrinter.readAsString(), '');
  }
});

test('attacker outcomes use the hacker portrait for victories and defeats', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> } }).testSocket;
  const game = new Engine(), player = game.connect(); game.action(player.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  callbacks.session(player); callbacks.connect(); const room = game.playerView(player.id)!; room.phase = 'ended';
  for (const winner of ['attack', 'defense'] as const) {
    room.roundId = winner; room.winner = winner; callbacks.room(room);
    assert.ok(window.document.querySelector('.result-character .hacker'), 'attacker must see their own character');
    assert.equal(window.document.querySelector('.result-character .hospital'), null);
    assert.equal(window.document.querySelector('.result-character .hacker')!.getAttribute('data-outcome'), winner === 'attack' ? 'win' : 'loss');
  }
});

test('main menu retains solo, duo creation and manual room code entry', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> } }).testSocket;
  const click = (id: string) => window.document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  assert.ok(window.document.querySelector('.screen-home .game-menu'));
  callbacks.lobby({ version: GAME_VERSION, accepting: true, allowSurrender: false, ultimateMode: false, defaultDuration: 60, online: 12, capacity: 30, joinUrl: '' });
  assert.equal(window.document.querySelector('#online')!.textContent, '12');
  click('menu-solo'); assert.ok(window.document.querySelector('.screen-loadout')); assert.match(window.document.querySelector('#create')!.textContent!, /挑戰電腦/);
  const name = window.document.querySelector<HTMLInputElement>('#nickname')!.value;
  click('menu-back'); click('menu-duo'); assert.match(window.document.querySelector('#create')!.textContent!, /雙人房間/);
  assert.equal(window.document.querySelector<HTMLInputElement>('#nickname')!.value, name);
  click('menu-back'); click('menu-join'); assert.ok(window.document.querySelector('.screen-join'));
  assert.equal(window.document.querySelector('#invite'), null);
  assert.equal(window.document.querySelector<HTMLInputElement>('#room-code')!.value, '');
  assert.equal(window.document.querySelector<HTMLInputElement>('#nickname')!.value, name);
});

test('solo starts immediately but rematch requests waiting; duo retains its creation screen', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks, sent } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[] } }).testSocket;
  const game = new Engine(), player = game.connect(); callbacks.session(player); callbacks.connect();
  const click = (id: string) => window.document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  click('menu-solo'); window.document.querySelector<HTMLButtonElement>('[data-role="attack"]')!.click(); click('create');
  await new Promise(resolve => setImmediate(resolve));
  const create = sent.find(a => a.kind === 'create')!;
  assert.deepEqual(JSON.parse(JSON.stringify(create)), { kind: 'create', mode: 'solo', role: 'attack', duration: 60, startImmediately: true });
  game.action(player.id, create); callbacks.room(game.playerView(player.id));
  assert.ok(window.document.querySelector('.battle-shell')); assert.equal(window.document.querySelector('#ready'), null);
  const ended = game.playerView(player.id)!; ended.phase = 'ended'; callbacks.room(ended); click('rematch');
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { kind: 'rematch' });
  callbacks.room(null); click('menu-duo');
  assert.equal(window.document.querySelector('[data-role]'), null, 'duo roles are selected inside the room');
  click('create'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { kind: 'create', mode: 'duo', role: 'attack', duration: 60, startImmediately: false });
});

test('duo room shows both players even on the same side, permits selection and blocks ready until different', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks, sent } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[] } }).testSocket;
  const game = new Engine(), a = game.connect(), d = game.connect();
  game.action(a.id, { kind: 'name', name: '玩家一' }); game.action(d.id, { kind: 'name', name: '玩家二' });
  game.action(a.id, { kind: 'create', mode: 'duo', role: 'attack', duration: 60 }); game.action(d.id, { kind: 'join', code: game.playerView(a.id)!.code });
  game.action(a.id, { kind: 'ready', ready: true }); game.action(d.id, { kind: 'role', role: 'attack' });
  callbacks.session(a); callbacks.connect(); callbacks.room(game.playerView(a.id));
  assert.equal(window.document.querySelectorAll('.member.attack').length, 2);
  assert.match(window.document.querySelector('.member-list')!.textContent!, /玩家一.*玩家二/s);
  assert.match(window.document.querySelector('#role-hint')!.textContent!, /請其中一位換邊/);
  assert.equal(window.document.querySelector<HTMLButtonElement>('#ready')!.disabled, true);
  window.document.querySelector<HTMLButtonElement>('[data-role="defense"]')!.click();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { kind: 'role', role: 'defense' });
  game.action(a.id, sent.at(-1)); callbacks.room(game.playerView(a.id));
  assert.equal(window.document.querySelector<HTMLButtonElement>('#ready')!.disabled, false);
  assert.ok(game.playerView(a.id)!.members.every(m => !m.ready));
});

test('solo rematch returns to selectable loadout, preserves settings on reconnect and only starts on departure', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks, sent, socket } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[]; socket: { emit: (event: string, action: Action, callback: (err: null, reply: { ok: boolean }) => void) => void } } }).testSocket;
  let now = 0; const game = new Engine(() => now), player = game.connect();
  socket.emit = (_event, action, callback) => { sent.push(action); game.action(player.id, action); callbacks.room(game.playerView(player.id)); callback(null, { ok: true }); };
  callbacks.session(player); callbacks.connect();
  const click = (id: string) => window.document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  const settle = () => new Promise(resolve => setImmediate(resolve));
  click('menu-solo'); click('create'); await settle(); now = 3000; game.advance();
  game.allowSurrender = true; game.action(player.id, { kind: 'surrender', roundId: game.playerView(player.id)!.roundId, seq: 1 }); callbacks.room(game.playerView(player.id));
  const oldId = game.playerView(player.id)!.id;
  click('rematch'); await settle();
  assert.equal(game.playerView(player.id)!.phase, 'waiting'); assert.ok(window.document.querySelector('.screen-loadout'));
  assert.equal(window.document.querySelector('#ready'), null); assert.equal(window.document.querySelector('.mode-tabs'), null);
  assert.equal(window.document.querySelector<HTMLInputElement>('#duration')!.value, '60');
  assert.equal(window.document.querySelector('[data-role="defense"]')!.getAttribute('aria-pressed'), 'true');
  window.document.querySelector<HTMLButtonElement>('[data-role="attack"]')!.click();
  const slider = window.document.querySelector<HTMLInputElement>('#duration')!; slider.value = '90'; slider.dispatchEvent(new window.Event('input')); slider.dispatchEvent(new window.Event('change'));
  assert.equal(game.playerView(player.id)!.members[0].role, 'attack'); assert.equal(game.playerView(player.id)!.members[1].role, 'defense');
  callbacks.disconnect(); callbacks.session(game.session(player.id)); callbacks.connect(); callbacks.room(game.playerView(player.id));
  assert.ok(window.document.querySelector('.screen-loadout')); assert.equal(window.document.querySelector<HTMLInputElement>('#duration')!.value, '90');
  callbacks.lobby({ ...game.lobby(), accepting: false }); assert.equal(window.document.querySelector<HTMLButtonElement>('#create')!.disabled, false, 'existing solo rematch remains available when new rooms are closed');
  click('create'); click('create'); await settle();
  assert.equal(game.playerView(player.id)!.phase, 'countdown'); assert.equal(game.playerView(player.id)!.id, oldId);
  assert.equal(game.playerView(player.id)!.duration, 90); assert.equal(game.rooms.size, 1);
  assert.equal(sent.filter(a => a.kind === 'ready').length, 1, 'repeat taps cannot start twice');
  assert.ok(window.document.querySelector('.battle-shell'));
});

test('invitations open the nickname page directly without a code field and send the room ID only after clicking', async t => {
  const window = new Window({ url: 'https://game.example/?room=private-room-id', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks, sent } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; sent: Action[] } }).testSocket;
  assert.ok(window.document.querySelector('.screen-join')); assert.equal(window.document.querySelector('.game-menu'), null);
  assert.equal(window.document.querySelector('#room-code'), null); assert.equal(window.document.querySelector('#join-form'), null);
  assert.equal(window.document.querySelector<HTMLButtonElement>('#invite')!.disabled, true);
  const game = new Engine(), player = game.connect(); callbacks.session(player); callbacks.connect();
  assert.equal(sent.length, 0, 'players can choose a name before joining');
  const name = window.document.querySelector<HTMLInputElement>('#nickname')!; name.value = '好友代號'; name.dispatchEvent(new window.Event('input'));
  const invite = window.document.querySelector<HTMLButtonElement>('#invite')!; assert.ok(invite.classList.contains('primary-button')); assert.match(invite.textContent!, /點此加入/);
  invite.click(); invite.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ kind: 'name', name: '好友代號' }, { kind: 'join', roomId: 'private-room-id' }]);
  assert.equal(window.location.search, '', 'accepted invitation is removed so leaving does not join again');
});

test('failed invitations retain the nickname and retry button, including closed admission and reconnect', async t => {
  for (const message of ['這個房間已滿。', '找不到這個房間，請確認房號。', '這個房間的對局已結束。']) {
    const window = new Window({ url: 'https://game.example/?room=invalid-room-id', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
    window.eval((await compiled).outputFiles[0].text);
    const { callbacks, socket } = (window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void>; socket: { emit: (event: string, action: Action, callback: (err: null, reply: { ok: boolean; message?: string }) => void) => void } } }).testSocket;
    socket.emit = (_event, action, cb) => cb(null, action.kind === 'join' ? { ok: false, message } : { ok: true });
    const game = new Engine(), player = game.connect(); callbacks.session(player); callbacks.connect();
    const nickname = window.document.querySelector<HTMLInputElement>('#nickname')!.value;
    callbacks.lobby({ ...game.lobby(), accepting: false }); assert.equal(window.document.querySelector<HTMLButtonElement>('#invite')!.disabled, true);
    callbacks.lobby(game.lobby()); window.document.querySelector<HTMLButtonElement>('#invite')!.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.document.querySelector('#toast')!.textContent, message);
    assert.equal(window.document.querySelector<HTMLButtonElement>('#invite')!.disabled, false); assert.equal(window.document.querySelector('#room-code'), null);
    assert.equal(window.document.querySelector<HTMLInputElement>('#nickname')!.value, nickname);
    callbacks.disconnect(); callbacks.connect(); callbacks.room(null);
    assert.ok(window.document.querySelector('.screen-join')); assert.equal(window.location.search, '?room=invalid-room-id');
  }
});

test('music urgency follows the server clock at ten seconds and clears on pause, disconnect, end and rematch', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const { testSocket: { callbacks }, testAudio } = window as unknown as { testSocket: { callbacks: Record<string, (data?: unknown) => void> }; testAudio: { states: AudioState[] } };
  const game = new Engine(), player = game.connect(); game.action(player.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  callbacks.session(player); callbacks.connect(); const room = game.playerView(player.id)!; room.phase = 'playing';
  for (const [ms, urgent] of [[10001, false], [10000, true], [1, true], [0, false], [60000, false]] as const) {
    room.remainingMs = ms; callbacks.room(room); assert.equal(testAudio.states.at(-1)!.urgent, urgent);
  }
  room.remainingMs = 9000; callbacks.room(room); callbacks.disconnect(); assert.equal(testAudio.states.at(-1)!.urgent, false);
  callbacks.connect(); assert.equal(testAudio.states.at(-1)!.urgent, true);
  room.phase = 'paused'; callbacks.room(room); assert.equal(testAudio.states.at(-1)!.urgent, false);
  room.phase = 'ended'; callbacks.room(room); assert.equal(testAudio.states.at(-1)!.urgent, false);
  room.phase = 'playing'; room.roundId = 'rematch'; room.remainingMs = 60000; callbacks.room(room); assert.equal(testAudio.states.at(-1)!.urgent, false);
});


test('touch audio activation waits for release instead of an unactivated pointerdown', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.eval((await compiled).outputFiles[0].text);
  const audio = (window as unknown as { testAudio: { unlocks: number } }).testAudio;
  window.document.dispatchEvent(new window.PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
  assert.equal(audio.unlocks, 0, 'touch down is too early for browser activation');
  window.document.dispatchEvent(new window.PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
  assert.equal(audio.unlocks, 1, 'touch release can unlock even if the tap action prevents click');
  window.document.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); assert.equal(audio.unlocks, 2);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(audio.unlocks, 3);
});

test('tunnel rebuild tells players to rescan, clears credentials and stops battle audio without a win cue', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.localStorage.setItem('hospital-token', 'old-private-token');
  window.eval((await compiled).outputFiles[0].text);
  const { callbacks } = (window as any).testSocket;
  const game = new Engine(), p = game.connect(); game.action(p.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  callbacks.session(p); callbacks.connect(); const room = game.playerView(p.id)!; room.phase = 'playing'; callbacks.room(room);
  callbacks['hosting-reset']();
  assert.match(window.document.querySelector('.stopped-card')!.textContent!, /不計勝負.*新的 QR Code/s);
  assert.equal(window.localStorage.getItem('hospital-token'), null); assert.equal(window.document.querySelector('#tap'), null);
  assert.equal((window as any).testAudio.states.at(-1).battle, false); assert.equal((window as any).testAudio.outcomes.length, 0);
  callbacks.disconnect(); assert.ok(window.document.querySelector('.stopped-card'), 'disconnect must not replace the rescan instruction');
});

test('cloud activity end clears player credentials and offers rejoin at the same URL', async t => {
  const window = new Window({ url: 'https://game.example', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => window.happyDOM.close()); window.document.body.innerHTML = '<div id="app"></div>';
  window.localStorage.setItem('hospital-token', 'old-token'); window.eval((await compiled).outputFiles[0].text);
  (window as any).testSocket.callbacks['hosting-reset']({ reason: 'activity-ended' });
  assert.match(window.document.querySelector('.stopped-card')!.textContent!, /活動已結束/);
  assert.doesNotMatch(window.document.querySelector('.stopped-card')!.textContent!, /新的 QR Code/);
  assert.equal(window.document.querySelector('.stopped-card a')!.getAttribute('href'), '/');
  assert.equal(window.localStorage.getItem('hospital-token'), null);
});
