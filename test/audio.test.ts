import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BattleAudio, type AudioState } from '../src/client/audio';
import type { Role, Strategy } from '../src/shared/protocol';

class Param {
  values: number[] = [];
  setValueAtTime(value: number) { this.values.push(value); }
  linearRampToValueAtTime(value: number) { this.values.push(value); }
  exponentialRampToValueAtTime(value: number) { this.values.push(value); }
}
class Gain { gain = new Param(); disconnected = false; connect(node: unknown) { return node; } disconnect() { this.disconnected = true; } }
class Filter extends Gain { frequency = new Param(); Q = { value: 0 }; type = 'highpass'; }
class Oscillator {
  frequency = new Param(); type = 'sine'; starts: number[] = []; stopped = false; disconnected = false;
  onended?: () => void;
  connect(node: unknown) { return node as Gain; }
  start(time: number) { this.starts.push(time); }
  stop(time?: number) { if (time === undefined) { this.stopped = true; this.onended?.(); } }
  disconnect() { this.disconnected = true; }
}
class BufferSource extends Oscillator { buffer: unknown; }
class Context {
  currentTime = 0; state = 'suspended'; destination = {}; resumeCalls = 0; sampleRate = 48000; bufferCount = 0;
  oscillators: Oscillator[] = []; gains: Gain[] = []; onstatechange?: (() => void) | null;
  sources: BufferSource[] = []; filters: Filter[] = [];
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createOscillator() { const osc = new Oscillator(); this.oscillators.push(osc); return osc; }
  createBuffer(_channels: number, length: number) { this.bufferCount++; const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { const source = new BufferSource(); this.sources.push(source); return source; }
  createBiquadFilter() { const filter = new Filter(); this.filters.push(filter); return filter; }
  async resume() { this.resumeCalls++; this.state = 'running'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; }
}
const active: AudioState = { effects: true, music: true, battle: true, visible: true };

test('audio requires a gesture; music stops on pause, disconnect, end, hidden tab and mute', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = new Context(); let created = 0;
  const audio = new BattleAudio(() => { created++; return ctx as unknown as AudioContext; }); t.after(() => audio.dispose());
  audio.configure(active); audio.action('attack', 0);
  assert.equal(created, 0, 'no AudioContext/autoplay before user interaction');
  await audio.unlock(); assert.equal(created, 1); assert.ok(ctx.oscillators.length > 0);
  await audio.unlock(); assert.equal(created, 1, 'reuse a single context');
  for (const state of [{ ...active, battle: false }, { ...active, visible: false }, { ...active, effects: false, music: false }]) {
    audio.configure(state);
    assert.ok(ctx.oscillators.every(o => o.stopped));
    assert.ok(ctx.sources.every(s => s.stopped && s.disconnected));
    assert.ok(ctx.filters.every(f => f.disconnected));
    const count = ctx.oscillators.length;
    ctx.currentTime += 10; t.mock.timers.tick(10_000); audio.action('attack', 0);
    assert.equal(ctx.oscillators.length, count, 'no background music or effects while stopped');
    audio.configure(active); assert.ok(ctx.oscillators.length > count);
  }
  const before = ctx.oscillators.length;
  ctx.currentTime += 50; t.mock.timers.tick(50);
  assert.ok(ctx.oscillators.length - before <= 24, 'do not replay a backlog after timer throttling');
  assert.ok(ctx.oscillators.slice(before).every(o => o.starts[0] >= ctx.currentTime));
});

test('the battle arrangement includes reusable percussion and bounded scheduling across an eight-bar loop', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  audio.configure(active); await audio.unlock();
  for (let i = 1; i <= 240; i++) { ctx.currentTime = i * .05; t.mock.timers.tick(50); }
  assert.equal(ctx.bufferCount, 1, 'reuse one noise buffer for all drum hits');
  assert.ok(ctx.sources.length > 60, 'snare, hi-hat and crash are part of the arrangement');
  assert.ok(ctx.filters.some(f => f.frequency.values[0] === 6500));
  assert.ok(ctx.filters.some(f => f.frequency.values[0] === 1300));
  assert.ok(ctx.filters.some(f => f.frequency.values[0] === 2800));
  assert.ok(ctx.oscillators.some(o => o.starts[0] > 11.4), 'music continues past the loop boundary');
  assert.ok(ctx.oscillators.length + ctx.sources.length < 1400, 'keep synthesis bounded for mobile devices');
  audio.configure({ ...active, music: false });
  assert.ok([...ctx.oscillators, ...ctx.sources].every(o => o.stopped && o.disconnected));
});

test('eight actions including ultimates have distinct audible motifs; music can be off while effects stay on', async t => {
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  audio.configure({ ...active, music: false }); await audio.unlock();
  assert.equal(ctx.oscillators.length, 0);
  const signatures = new Set<string>();
  for (const role of ['attack', 'defense'] as Role[]) for (const strategy of [0, 1, 2, 3] as const) {
    ctx.currentTime += 1;
    const before: number = ctx.oscillators.length;
    audio.action(role, strategy);
    const voices = ctx.oscillators.slice(before);
    assert.ok(voices.length >= 2, `${role}/${strategy} should produce sound`);
    assert.ok(voices.every(v => v.starts[0] >= ctx.currentTime && v.frequency.values[0] >= 280));
    signatures.add(JSON.stringify(voices.map(v => [v.type, v.frequency.values])));
    audio.action(role, strategy);
    assert.equal(ctx.oscillators.length, before + voices.length, 'limit duplicate sound bursts');
  }
  assert.equal(signatures.size, 8);
  audio.configure({ ...active, effects: false, music: false });
  assert.ok(ctx.oscillators.every(o => o.stopped && o.disconnected));
  assert.ok(ctx.gains.slice(2).every(g => g.disconnected), 'release per-note audio nodes');
});

test('failed audio activation does not prevent play, and can be retried after a gesture', async t => {
  const ctx = new Context(); let attempts = 0;
  ctx.resume = async () => { if (++attempts === 1) throw new Error('Autoplay blocked'); ctx.state = 'running'; };
  const audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  audio.configure({ ...active, music: false });
  await audio.unlock(); audio.action('attack', 0); assert.equal(ctx.oscillators.length, 0);
  await audio.unlock(); audio.action('attack', 0); assert.ok(ctx.oscillators.length > 0);
  const unavailable = new BattleAudio(() => { throw new Error('Unavailable'); });
  await assert.doesNotReject(() => unavailable.unlock()); unavailable.dispose();
});

test('effects and music remain independent through all four toggle combinations', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  audio.configure({ ...active, effects: false }); await audio.unlock();
  assert.equal(ctx.gains[1].gain.values.at(-1), 0);
  assert.ok(ctx.gains[0].gain.values.at(-1)! > 0);
  const music = [...ctx.oscillators, ...ctx.sources];
  assert.ok(music.length > 0);
  audio.action('attack', 0); assert.equal(ctx.oscillators.length + ctx.sources.length, music.length);
  audio.configure(active); audio.action('attack', 0);
  const effects = ctx.oscillators.filter(o => !music.includes(o));
  assert.ok(effects.length > 0); assert.ok(music.every(o => !o.stopped));
  audio.configure({ ...active, music: false });
  assert.ok(music.every(o => o.stopped)); assert.ok(effects.every(o => !o.stopped), 'turning music off preserves effects');
  assert.equal(ctx.gains[0].gain.values.at(-1), 0); assert.ok(ctx.gains[1].gain.values.at(-1)! > 0);
  audio.configure({ ...active, effects: false, music: false });
  assert.ok(effects.every(o => o.stopped)); assert.equal(ctx.gains[1].gain.values.at(-1), 0);
  const before = ctx.oscillators.length;
  ctx.currentTime += 1; t.mock.timers.tick(1000); audio.action('defense', 0);
  assert.equal(ctx.oscillators.length, before, 'both off produces no new audio');
});

test('win and loss cues differ, use only the effects preference, and survive result snapshots', async t => {
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  const result = { ...active, music: false, battle: false, result: true };
  audio.configure(result); await audio.unlock();
  audio.outcome(true);
  const win = ctx.oscillators.slice(); assert.equal(win.length, 5);
  assert.ok(win[0].frequency.values[0] < win[3].frequency.values[0], 'victory rises into a final chord');
  audio.configure(result); assert.ok(win.every(o => !o.stopped), 'repeated snapshots must not cut off the cue');
  audio.configure({ ...result, music: true }); assert.ok(win.every(o => !o.stopped), 'music toggle does not affect results');
  audio.outcome(false);
  assert.ok(win.every(o => o.stopped));
  const loss = ctx.oscillators.slice(win.length); assert.equal(loss.length, 4);
  assert.ok(loss[0].frequency.values[0] > loss[3].frequency.values[0], 'defeat has a descending cue');
  assert.ok(loss.every(o => o.frequency.values[0] >= 400 && o.type !== 'sine'), 'defeat needs midrange harmonics instead of only quiet low pure tones');
  for (const stopped of [{ ...result, effects: false }, { ...result, visible: false }, { ...result, result: false }]) {
    audio.configure(stopped);
    assert.ok(ctx.oscillators.every(o => o.stopped));
    const before = ctx.oscillators.length; audio.outcome(true); assert.equal(ctx.oscillators.length, before);
    audio.configure(result); audio.outcome(true);
  }
});

test('countdown cues work with music disabled and obey effects, visibility and phase gates', async t => {
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  const countdown = { ...active, music: false, battle: false, countdown: true };
  audio.configure(countdown); await audio.unlock();
  for (const second of [3, 2, 1]) {
    const before = ctx.oscillators.length; audio.countdown(second); assert.equal(ctx.oscillators.length, before + 1);
    audio.configure(countdown); assert.equal(ctx.oscillators.at(-1)!.stopped, false, 'snapshots must not cut off the beep');
  }
  audio.configure({ ...active, music: false }); const before = ctx.oscillators.length; audio.countdown(0);
  assert.equal(ctx.oscillators.length, before + 2); assert.ok(ctx.oscillators.at(-1)!.frequency.values[0] > 1000);
  for (const state of [{ ...countdown, effects: false }, { ...countdown, visible: false }, { ...countdown, countdown: false }]) {
    audio.configure(state); const before = ctx.oscillators.length;
    audio.countdown(3); audio.countdown(0); assert.equal(ctx.oscillators.length, before);
    assert.ok(ctx.oscillators.every(o => o.stopped));
  }
});

test('final-ten-second music speeds up from 168 to 210 BPM without restarting, then resets for a new round', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = new Context(), audio = new BattleAudio(() => ctx as unknown as AudioContext); t.after(() => audio.dispose());
  audio.configure(active); await audio.unlock();
  const advance = (seconds: number) => { for (let i = 0; i < seconds * 40; i++) { ctx.currentTime += .025; t.mock.timers.tick(25); } };
  const hats = () => ctx.filters.flatMap((filter, i) => filter.frequency.values[0] === 6500 ? ctx.sources[i].starts : []);
  const assertSpacing = (times: number[], expected: number) => {
    assert.ok(times.length >= 4);
    for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - expected) < .00001);
  };
  advance(.8); assertSpacing(hats(), 60 / 168 / 2);
  const before = ctx.oscillators.length, alreadyScheduled = hats().length;
  audio.configure({ ...active, urgent: true });
  assert.equal(ctx.oscillators.length, before, 'tempo changes do not restart the phrase');
  assert.ok(ctx.oscillators.every(o => !o.stopped), 'allow scheduled notes to finish');
  advance(.8); assertSpacing(hats().slice(alreadyScheduled + 1), 60 / 210 / 2);
  audio.configure({ ...active, battle: false }); assert.ok(ctx.oscillators.every(o => o.stopped));
  const nextRound = hats().length; audio.configure({ ...active, urgent: false }); advance(.8);
  assertSpacing(hats().slice(nextRound), 60 / 168 / 2);
});
