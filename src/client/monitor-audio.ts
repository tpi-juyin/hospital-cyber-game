import { BattleAudio } from './audio';
import { combatStrategy, type SpectatorRoomView } from '../shared/protocol';
import { icon } from './art';

type Snapshot = { key: string; phase: string; taps: number; uses: number; second: number };
/** Shared by the read-only spectator and host dashboard. Never sends player actions. */
export class MonitorAudio {
  private audio: BattleAudio;
  private entered = false;
  private lobbyMusic = false;
  private previous?: Snapshot;
  private room?: SpectatorRoomView;
  private stale = false;
  private effects = true;
  private music = true;
  private doc: Document;
  constructor(private root: HTMLElement, audio = new BattleAudio()) {
    this.audio = audio; this.doc = root.ownerDocument;
    try { const prefs = JSON.parse(this.doc.defaultView!.localStorage.getItem('hospital-monitor-audio') || '{}'); this.effects = prefs.effects !== false; this.music = prefs.music !== false; } catch { /* Storage may be unavailable. */ }
    root.addEventListener('click', e => {
      const button = (e.target as Element).closest<HTMLButtonElement>('[data-monitor-audio]');
      if (!button) return;
      const enabled = button.dataset.monitorAudio === 'music' ? this.music : this.effects;
      if (enabled && !this.audio.isRunning()) { void this.unlock(); return; }
      if (button.dataset.monitorAudio === 'music') this.music = !this.music; else this.effects = !this.effects;
      try { this.doc.defaultView!.localStorage.setItem('hospital-monitor-audio', JSON.stringify({effects:this.effects,music:this.music})); } catch { /* Optional preference. */ }
      this.configure(); this.buttons(); void this.unlock();
    });
    this.doc.addEventListener('visibilitychange', () => { this.previous = undefined; this.configure(); });
    this.doc.defaultView?.addEventListener('pagehide', () => this.connection(true));
  }
  controls() { return '<div class="monitor-audio-controls"><button type="button" class="icon-button" data-monitor-audio="effects"></button><button type="button" class="icon-button" data-monitor-audio="music"></button><span data-monitor-audio-hint hidden>點音樂或音效按鈕啟用聲音</span></div>'; }
  buttons() {
    for (const kind of ['effects','music'] as const) {
      for (const b of this.root.querySelectorAll<HTMLButtonElement>(`[data-monitor-audio="${kind}"]`)) {
        const enabled = kind === 'music' ? this.music : this.effects, label = kind === 'music' ? '戰鬥音樂' : '音效';
        b.classList.toggle('audio-on', enabled); b.setAttribute('aria-pressed',String(enabled)); b.setAttribute('aria-label',`${enabled?'關閉':'開啟'}${label}`); b.title = `${label}：${enabled?'開':'關'}`;
        b.innerHTML = icon(kind === 'music' ? 'music' : 'sound',19) + (enabled ? '' : '<span class="audio-slash" aria-hidden="true"></span>');
      }
    }
  }
  lobby(enabled: boolean) { this.lobbyMusic = enabled; this.configure(); this.buttons(); this.hints(); }
  activate() { void this.unlock(); }
  enter() { this.leave(); this.entered = true; this.stale = false; this.configure(); void this.unlock(); }
  private async unlock() {
    const pending = this.audio.unlock();
    this.hints();
    await pending;
    this.hints();
  }
  private hints() {
    for (const hint of this.root.querySelectorAll<HTMLElement>('[data-monitor-audio-hint]')) hint.hidden = !((this.entered || this.lobbyMusic) && (this.music || this.effects) && !this.audio.isRunning());
  }
  leave() { this.entered = false; this.previous = undefined; this.room = undefined; this.configure(); }
  connection(stale: boolean) { this.stale = stale; if (stale) this.previous = undefined; this.configure(); }
  private configure() {
    const lobby = this.lobbyMusic && !this.entered;
    const visible = (this.entered || lobby) && !this.stale && !this.doc.hidden, phase = this.room?.phase;
    this.audio.configure({effects:this.effects && !lobby,music:this.music,visible,battle:lobby || phase==='playing',countdown:phase==='countdown',result:phase==='ended',urgent:!lobby && (this.room?.remainingMs || 0)<=10000});
  }
  update(room: SpectatorRoomView, stale = false) {
    this.room = room; this.stale = stale; this.configure(); this.buttons();
    if (!this.entered || stale || this.doc.hidden) { this.previous = undefined; return; }
    const defense = room.members.find(m=>m.role==='defense');
    const current: Snapshot = {key:room.id+':'+room.roundId,phase:room.phase,taps:defense?.stats.taps || 0,uses:defense?.ultimate?.uses || 0,second:Math.ceil(room.remainingMs/1000)};
    const old = this.previous; this.previous = current;
    if (!old || old.key !== current.key) return; // Joining never replays historical cues.
    if (room.phase==='countdown' && current.second!==old.second) this.audio.countdown(current.second);
    if (room.phase==='playing') {
      if (old.phase==='countdown') this.audio.countdown(0);
      if (old.phase==='playing' && defense && (current.taps>old.taps || current.uses>old.uses)) this.audio.action('defense',combatStrategy(defense),true);
    }
    if (room.phase==='ended' && old.phase!=='ended' && room.winner) this.audio.outcome(room.winner==='defense');
  }
}
