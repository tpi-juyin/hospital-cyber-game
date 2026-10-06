import { STRATEGIES, ULTIMATE_NAMES, combatStrategy, defenseMatches, type Phase, type RoomView } from '../shared/protocol';

export type Tone = 'ok' | 'warn' | 'danger' | 'idle';
export interface Sample { at: number; attack: number; blocked: number; attacks: number; blocks: number; gap: boolean }
export interface MonitorEvent { elapsed: number | null; text: string; tone: Tone }
interface Snapshot { at: number; phase: Phase; hp: number; shield: number; attack?: number; defense?: number }
export interface Telemetry {
  roundId: string; samples: Sample[]; events: MonitorEvent[]; attackRate: number; blockedRate: number;
  elapsed: number; segmentStart: number; previous?: Snapshot;
}
const bounded = (n: number, max = 100) => Math.max(0, Math.min(max, n));

/** The host observes snapshots only; none of these values change combat rules. */
export class TelemetryHistory {
  private rooms = new Map<string, Telemetry>();
  constructor(private clock: () => number = () => performance.now()) {}
  get(id: string) { return this.rooms.get(id); }
  update(rooms: RoomView[]) {
    const now = this.clock(), active = new Set(rooms.map(r => r.id));
    for (const id of this.rooms.keys()) if (!active.has(id)) this.rooms.delete(id);
    for (const r of rooms) {
      let history = this.rooms.get(r.id);
      if (!history || history.roundId !== r.roundId) {
        history = { roundId: r.roundId, samples: [], events: [], attackRate: 0, blockedRate: 0, elapsed: 0, segmentStart: now };
        this.rooms.set(r.id, history);
      }
      const h = history, previous = h.previous;
      const attacker = r.members.find(m => m.role === 'attack'), defender = r.members.find(m => m.role === 'defense');
      const attack = attacker ? combatStrategy(attacker) : undefined, defense = defender ? combatStrategy(defender) : undefined;
      if (r.phase === 'playing' || r.phase === 'paused') h.elapsed = bounded(r.duration - r.remainingMs / 1000, r.duration);
      const event = (text: string, tone: Tone = 'idle') => h.events.unshift({ elapsed: previous ? h.elapsed : null, text, tone });
      if (!previous) event(r.phase === 'ended' ? r.reason : r.hp <= 0 ? '兩台主機離線，醫療服務中斷。' : r.hp <= 50 ? '主機已離線，目前由備援機承接服務。' : '監控已就緒，主機與備援機可用。', r.hp <= 0 ? 'danger' : r.hp <= 50 ? 'warn' : 'ok');
      if (previous && previous.phase !== r.phase) {
        if (r.phase === 'playing') event(previous.phase === 'paused' ? '玩家連線恢復，繼續對戰。' : '對戰開始，開始觀測攻擊與防護。', 'ok');
        if (r.phase === 'countdown') event('雙方準備完成，即將開戰。');
        if (r.phase === 'paused') event('玩家斷線，對戰與觀測暫停。', 'warn');
        if (r.phase === 'ended') event(r.reason || '本局已結束。', r.winner === 'defense' ? 'ok' : r.winner === 'attack' ? 'danger' : 'idle');
      }
      if (previous) {
        if (previous.hp > 50 && r.hp <= 50) event('主機故障，備援機接手醫療服務。', 'warn');
        if (previous.hp > 0 && r.hp <= 0) event('備援機離線，所有醫療服務中斷。', 'danger');
        if (previous.shield > 0 && r.shield <= 0 && r.hp > 0) event('護盾耗盡，後續攻擊將直接損傷服務。', 'danger');
        if (r.phase !== 'ended' && attack !== undefined && previous.attack !== attack) event(attack === 3 ? `${ULTIMATE_NAMES.attack}啟動，防守大招可有效反制！` : `攻擊切換：${STRATEGIES[attack].attack}。`, 'warn');
        if (r.phase !== 'ended' && defense !== undefined && previous.defense !== defense) event(defense === 3 ? `${ULTIMATE_NAMES.defense}啟動，大招防護持續 5 秒。` : `加強防護：${STRATEGIES[defense].defense}。`, 'ok');
      }
      h.events = h.events.slice(0, 8);
      if (r.phase === 'playing' && (!previous || now - previous.at >= 200)) {
        const gap = !previous || previous.phase !== 'playing' || now - previous.at > 2000;
        if (gap) h.segmentStart = now;
        h.samples = h.samples.filter(s => now - s.at <= 30_000);
        const base = h.samples.find(s => s.at >= Math.max(h.segmentStart, now - 2000));
        const seconds = base ? (now - base.at) / 1000 : 0;
        h.attackRate = seconds > 0 ? bounded((r.attacks - base!.attacks) / seconds, 6) : 0;
        h.blockedRate = seconds > 0 ? bounded((r.blocks - base!.blocks) / seconds, h.attackRate) : 0;
        h.samples.push({ at: now, attacks: r.attacks, blocks: r.blocks, attack: h.attackRate, blocked: h.blockedRate, gap });
        h.samples = h.samples.slice(-120);
      }
      h.previous = { at: now, phase: r.phase, hp: r.hp, shield: r.shield, attack, defense };
    }
  }
}

/** CPU, memory and latency are explicitly illustrative, derived from game pressure. */
export function serverMetrics(r: RoomView, rate: number) {
  const primaryUp = r.hp > 50, backupUp = r.hp > 0, failover = !primaryUp && backupUp;
  const attack = r.members.find(m => m.role === 'attack'), defense = r.members.find(m => m.role === 'defense');
  const matched = !!attack && !!defense && defenseMatches(attack, defense);
  const pressure = bounded(rate, 6) / 6, injury = 1 - bounded(r.hp) / 100;
  const load = Math.round(bounded(18 + pressure * (attack && combatStrategy(attack) === 3 ? 80 : attack?.strategy === 1 ? 68 : 45) + injury * 20 + (matched ? 0 : pressure * 12), 98));
  const memory = Math.round(bounded(29 + injury * 31 + pressure * (attack?.strategy === 2 ? 33 : 18), 97));
  const nodes = [
    { id: 'primary', title: '主機', code: 'HOSPITAL-01', up: primaryUp, active: primaryUp, state: primaryUp ? '服務中' : '已故障', cpu: primaryUp ? load : 0, memory: primaryUp ? memory : 0 },
    { id: 'backup', title: '備援機', code: 'HOSPITAL-02', up: backupUp, active: failover, state: !backupUp ? '已故障' : failover ? '承接服務' : '同步待命', cpu: !backupUp ? 0 : failover ? Math.min(99, load + 12) : 8 + Math.round(pressure * 8), memory: !backupUp ? 0 : failover ? Math.min(98, memory + 14) : 22 + Math.round(pressure * 6) },
  ];
  const latency = 35 + pressure * 180 + injury * 170 + (failover ? 130 : 0);
  const services = ['掛號與門診', '電子病歷', '檢驗報告', '醫囑查詢'].map((name, i) => {
    const ms = Math.round(latency * [1, 1.18, 1.08, .94][i]);
    return { name, latency: backupUp ? ms : null, status: !backupUp ? '服務中斷' : ms >= 350 ? '回應延遲' : '正常運作', tone: (!backupUp ? 'danger' : ms >= 350 ? 'warn' : 'ok') as Tone };
  });
  return { nodes, services, matched, failover, online: Number(primaryUp) + Number(backupUp),
    tone: (!backupUp ? 'danger' : failover || r.shield <= 5 ? 'warn' : 'ok') as Tone,
    title: !backupUp ? '醫療服務中斷' : failover ? '備援機接手，服務持續中' : r.shield <= 5 ? '防護資源不足，主機仍在線' : '醫療服務穩定運作',
    detail: !backupUp ? '兩台主機皆已故障，等待下一局重新啟動。' : failover ? '主機已故障；備援承接服務，但仍需持續防護。' : '主機提供服務，備援機同步待命。',
  };
}
