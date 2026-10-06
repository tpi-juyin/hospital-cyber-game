import type { Role, CombatStrategy } from '../shared/protocol';

type Channel = 'music' | 'effect' | 'result' | 'countdown';
export interface AudioState { effects: boolean; music: boolean; battle: boolean; visible: boolean; result?: boolean; countdown?: boolean; urgent?: boolean }
interface Note { frequency: number; end?: number; delay?: number; duration: number; volume: number; wave: OscillatorType }

// Original short synth motifs. Mid-range harmonics keep attacks audible on phone speakers.
const effects: Record<Role, readonly Note[][]> = {
  attack: [
    [{ frequency: 920, end: 420, duration: .1, volume: .19, wave: 'square' }, { frequency: 620, end: 280, delay: .065, duration: .11, volume: .13, wave: 'square' }],
    [{ frequency: 280, end: 100, duration: .2, volume: .3, wave: 'sawtooth' }, { frequency: 740, end: 170, delay: .035, duration: .16, volume: .12, wave: 'triangle' }],
    [{ frequency: 360, end: 1320, duration: .12, volume: .18, wave: 'sawtooth' }, { frequency: 1480, end: 380, delay: .09, duration: .13, volume: .14, wave: 'square' }],
    [{ frequency: 880, end: 180, duration: .25, volume: .22, wave: 'sawtooth' }, { frequency: 1320, end: 440, delay: .04, duration: .2, volume: .13, wave: 'square' }],
  ],
  defense: [
    [{ frequency: 660, duration: .13, volume: .24, wave: 'sine' }, { frequency: 990, delay: .07, duration: .18, volume: .2, wave: 'triangle' }],
    [{ frequency: 480, end: 320, duration: .12, volume: .25, wave: 'triangle' }, { frequency: 720, end: 480, delay: .06, duration: .14, volume: .18, wave: 'triangle' }],
    [{ frequency: 523.25, duration: .12, volume: .2, wave: 'sine' }, { frequency: 659.25, delay: .05, duration: .13, volume: .18, wave: 'sine' }, { frequency: 783.99, delay: .1, duration: .18, volume: .18, wave: 'triangle' }],
    [{ frequency: 587.33, end: 880, duration: .2, volume: .22, wave: 'triangle' }, { frequency: 1174.66, delay: .06, duration: .24, volume: .15, wave: 'triangle' }],
  ],
};
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const BPM = 168;
const FINAL_BPM = 210;
// An original eight-bar lead: a call/response phrase, an octave lift, then a turnaround.
const melody: readonly (number | null)[][] = [
  [76, null, null, 76, 79, null, 81, null, 83, null, 81, null, 79, null, 76, null],
  [77, null, null, 77, 81, null, 84, null, 81, null, 79, null, 77, null, 76, null],
  [79, null, 79, null, 84, null, 83, null, 79, null, 76, null, 74, 76, 79, null],
  [74, null, null, 74, 79, null, 81, null, 83, null, 81, 79, 77, null, 74, null],
  [81, null, 81, null, 84, null, 88, null, 86, null, 84, null, 83, null, 81, null],
  [81, null, 84, null, 89, null, 88, null, 84, null, 81, null, 79, 81, 84, null],
  [83, null, 81, null, 79, null, 74, null, 79, null, 81, null, 83, 81, 79, null],
  [80, null, 83, null, 88, null, 83, null, 80, null, 76, null, 74, 76, 80, 83],
];

export class BattleAudio {
  private context?: AudioContext;
  private buses?: Record<Channel, GainNode>;
  private state: AudioState = { effects: true, music: true, battle: false, visible: true };
  private voices = new Map<AudioScheduledSourceNode, { gain: GainNode; channel: Channel; filter?: BiquadFilterNode }>();
  private noiseBuffer?: AudioBuffer;
  private timer?: ReturnType<typeof setInterval>;
  private nextBeat = 0;
  private step = 0;
  private resuming?: Promise<void>;
  private closed = false;
  private lastEffect: Record<Role, number> = { attack: -Infinity, defense: -Infinity };

  constructor(private createContext: () => AudioContext = () => new AudioContext()) {}

  /** Called directly from a user gesture; never create audio during initial page load. */
  unlock(): Promise<void> {
    if (this.closed || (!this.state.effects && !this.state.music) || !this.state.visible) return Promise.resolve();
    try {
      if (!this.context) {
        const ctx = this.context = this.createContext();
        const music = ctx.createGain(), effect = ctx.createGain();
        music.connect(ctx.destination); effect.connect(ctx.destination);
        this.buses = { music, effect, result: effect, countdown: effect };
        ctx.onstatechange = () => this.sync();
      }
      if (this.context.state === 'running') { this.sync(); return Promise.resolve(); }
      if (!this.resuming) this.resuming = this.context.resume().then(() => this.sync()).catch(() => {}).finally(() => { this.resuming = undefined; });
      return this.resuming;
    } catch { return Promise.resolve(); } // Audio must never prevent play on unsupported devices.
  }

  configure(state: AudioState) { this.state = state; this.sync(); }

  action(role: Role, strategy: CombatStrategy, remote = false) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.state.effects || !this.state.visible || !this.state.battle) return;
    if (ctx.currentTime - this.lastEffect[role] < .07) return;
    this.lastEffect[role] = ctx.currentTime;
    for (const note of effects[role][strategy]) this.note(note, ctx.currentTime + .006, 'effect', remote ? .65 : 1);
  }

  outcome(won: boolean) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.state.effects || !this.state.visible || !this.state.result) return;
    this.stopVoices('result');
    // Use midrange harmonics and a longer phrase to improve defeat-cue audibility on small speakers.
    const notes = won ? [72, 76, 79, 84] : [79, 76, 72, 69];
    notes.forEach((pitch, index) => {
      const duration = index === 3 ? won ? .48 : .65 : won ? .16 : .2;
      this.note({ frequency: hz(pitch), duration, delay: index * (won ? .145 : .2), volume: won ? .21 : .3, wave: 'triangle' }, ctx.currentTime + .01, 'result');
      if (won && index === 3) this.note({ frequency: hz(pitch - 7), duration: .48, delay: index * .145, volume: .11, wave: 'triangle' }, ctx.currentTime + .01, 'result');
    });
  }

  countdown(second: number) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.state.effects || !this.state.visible) return;
    if (!Number.isInteger(second) || second < 0 || second > 3 || (second === 0 ? !this.state.battle : !this.state.countdown)) return;
    this.stopVoices('countdown');
    this.note({ frequency: second === 0 ? 1046.5 : 880, duration: second === 0 ? .32 : .12, volume: .28, wave: 'triangle' }, ctx.currentTime + .01, 'countdown');
    if (second === 0) this.note({ frequency: 1567.98, duration: .22, delay: .07, volume: .13, wave: 'triangle' }, ctx.currentTime + .01, 'countdown');
  }

  private sync() {
    const ctx = this.context;
    if (!ctx || !this.buses || this.closed) return;
    const effectsAudible = this.state.effects && this.state.visible;
    const musicAudible = this.state.music && this.state.visible && this.state.battle;
    this.buses.effect.gain.setValueAtTime(effectsAudible ? .55 : 0, ctx.currentTime);
    this.buses.music.gain.setValueAtTime(musicAudible ? .26 : 0, ctx.currentTime);
    if (!effectsAudible || !this.state.battle || ctx.state !== 'running') this.stopVoices('effect');
    if (!effectsAudible || !this.state.result || ctx.state !== 'running') this.stopVoices('result');
    if (!effectsAudible || (!this.state.countdown && !this.state.battle) || ctx.state !== 'running') this.stopVoices('countdown');
    if (musicAudible && ctx.state === 'running') {
      if (!this.timer) {
        this.nextBeat = ctx.currentTime + .025; this.step = 0;
        this.schedule(); this.timer = setInterval(() => this.schedule(), 50);
      }
    } else {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined; this.stopVoices('music');
    }
  }

  private schedule() {
    const ctx = this.context!;
    // After a throttled/backgrounded tab, resume at the present time instead of replaying missed notes.
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + .025;
    while (this.nextBeat < ctx.currentTime + .13) {
      const beat = this.step % 16, bar = Math.floor(this.step / 16) % 8;
      const root = [45, 41, 48, 43, 45, 41, 43, 40][bar];
      const time = this.nextBeat, lead = melody[bar][beat];
      const fill = bar % 4 === 3 && beat >= 12;
      if (lead !== null) {
        this.note({ frequency: hz(lead), duration: .16, volume: .11, wave: 'square' }, time, 'music');
        this.note({ frequency: hz(lead - 12), duration: .19, volume: .075, wave: 'triangle' }, time, 'music');
      }
      // Galloping bass and short power chords give the rhythm weight without drowning out actions.
      if (beat % 4 !== 1) {
        this.note({ frequency: hz(root), duration: .085, volume: .28, wave: 'triangle' }, time, 'music');
        this.note({ frequency: hz(root + 12), duration: .055, volume: .045, wave: 'sawtooth' }, time, 'music');
      }
      if (beat % 4 === 0) {
        for (const interval of [12, 19, 24]) this.note({ frequency: hz(root + interval), duration: beat === 0 ? .23 : .13, volume: .05, wave: 'sawtooth' }, time, 'music');
      }
      if (beat % 4 === 0 || (bar % 2 === 1 && (beat === 7 || beat === 14))) {
        this.note({ frequency: 175, end: 46, duration: .16, volume: .58, wave: 'sine' }, time, 'music');
        this.noise(time, .025, .075, 1800);
      }
      if (beat === 4 || beat === 12 || fill) {
        this.note({ frequency: fill ? 190 + (beat - 12) * 24 : 190, end: 115, duration: .09, volume: .22, wave: 'triangle' }, time, 'music');
        this.noise(time, .12, fill ? .14 : .22, 1300);
      }
      if (beat % 2 === 0 || fill) this.noise(time, beat % 4 === 2 ? .09 : .035, beat % 4 === 2 ? .08 : .05, 6500);
      if (beat === 0 && bar % 4 === 0) this.noise(time, .55, .12, 2800);
      this.step = (this.step + 1) % 128; this.nextBeat += 60 / (this.state.urgent ? FINAL_BPM : BPM) / 4;
    }
  }

  private note(note: Note, time: number, channel: Channel, scale = 1) {
    const ctx = this.context!, osc = ctx.createOscillator(), gain = ctx.createGain();
    const start = time + (note.delay || 0), end = start + note.duration;
    osc.type = note.wave; osc.frequency.setValueAtTime(note.frequency, start);
    if (note.end) osc.frequency.exponentialRampToValueAtTime(note.end, end);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(note.volume * scale, start + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, end);
    osc.connect(gain).connect(this.buses![channel]);
    this.track(osc, gain, channel);
    osc.start(start); osc.stop(end + .01);
  }

  private noise(time: number, duration: number, volume: number, cutoff: number) {
    const ctx = this.context!;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .6), ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noiseBuffer; filter.type = 'highpass'; filter.frequency.setValueAtTime(cutoff, time); filter.Q.value = .7;
    gain.gain.setValueAtTime(.0001, time); gain.gain.linearRampToValueAtTime(volume, time + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    source.connect(filter).connect(gain).connect(this.buses!.music);
    this.track(source, gain, 'music', filter); source.start(time); source.stop(time + duration + .01);
  }

  private track(source: AudioScheduledSourceNode, gain: GainNode, channel: Channel, filter?: BiquadFilterNode) {
    this.voices.set(source, { gain, channel, filter });
    source.onended = () => { source.disconnect(); gain.disconnect(); filter?.disconnect(); this.voices.delete(source); };
  }

  private stopVoices(channel: Channel) {
    for (const [osc, voice] of this.voices) if (voice.channel === channel) {
      try { osc.stop(); } catch { /* Already ended. */ }
      osc.disconnect(); voice.gain.disconnect(); voice.filter?.disconnect(); this.voices.delete(osc);
    }
  }

  dispose() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.stopVoices('music'); this.stopVoices('effect'); this.stopVoices('result'); this.stopVoices('countdown');
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
  }
}
