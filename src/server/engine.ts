import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GAME_VERSION } from '../shared/version.js';
import { BALANCE, ULTIMATE } from '../shared/balance.js';
import { STRATEGIES, type Action, type Phase, type Role, type Strategy, type Stats, type RoomView, type SessionView, type LobbyView } from '../shared/protocol.js';

const uid = () => randomBytes(18).toString('base64url');
const opposite = (r: Role): Role => r === 'attack' ? 'defense' : 'attack';
const emptyStats = (): Stats => ({ taps: 0, damage: 0, blocked: 0, shieldAdded: 0, matchedHits: 0, hits: 0, byStrategy: [0, 0, 0] });
export class GameError extends Error { constructor(public code: string, message: string) { super(message); } }
function insist(value: unknown, code: string, message: string): asserts value { if (!value) throw new GameError(code, message); }
function validRole(value: unknown): asserts value is Role { insist(value === 'attack' || value === 'defense', 'INVALID', '請選擇有效陣營。'); }
function validDuration(value: unknown): asserts value is number { insist(typeof value === 'number' && Number.isInteger(value) && value >= 30 && value <= 120 && value % 5 === 0, 'INVALID', '局長需為 30～120 秒，間隔 5 秒。'); }
interface Player {
  id: string; token: string; name: string; bot: boolean; connected: boolean; disconnectedAt: number;
  roomId: string | null; role: Role; ready: boolean; strategy: Strategy; switchAt: number;
  lastSeq: number; tapTimes: number[]; stats: Stats; nextTap: number; nextSwitch: number;
  charge: number; ultimateUntil: number; ultimateUses: number;
}
interface Room {
  id: string; code: string; ownerId: string; mode: 'solo' | 'duo'; duration: number; phase: Phase;
  roundId: string; members: string[]; hp: number; shield: number; deadline: number;
  pausedAt: number; pauseTotal: number; pauseLimit: number; previousPhase: 'playing' | 'countdown'; savedRemaining: number;
  winner: Role | null; reason: string; lessons: string[]; touchedAt: number; attacks: number; blocks: number;
  ultimateMode: boolean;
}
export class Engine {
  readonly players = new Map<string, Player>();
  readonly rooms = new Map<string, Room>();
  private tokens = new Map<string, string>();
  private usedCodes = new Set<string>();
  accepting = true;
  allowSurrender = false;
  private ultimateMode = false;
  defaultDuration = 60;
  joinUrl = '';
  readonly capacity = 30;
  constructor(private clock: () => number = () => performance.now(), private rng: () => number = Math.random) {}
  private now() { return this.clock(); }
  private requirePlayer(id: string) { const p = this.players.get(id); insist(p, 'SESSION_EXPIRED', '活動已重新啟動，請重新加入。'); return p; }
  private requireRoom(p: Player) { const r = p.roomId ? this.rooms.get(p.roomId) : null; insist(r, 'NO_ROOM', '請先加入房間。'); return r; }
  private resetPlayer(p: Player) { p.ready = p.bot; p.strategy = 0; p.switchAt = 0; p.tapTimes = []; p.stats = emptyStats(); p.nextTap = 0; p.nextSwitch = 0; p.charge = 0; p.ultimateUntil = 0; p.ultimateUses = 0; }
  private makePlayer(bot = false): Player {
    return { id: uid(), token: bot ? '' : uid(), name: bot ? '電腦隊友' : '新玩家', bot, connected: true, disconnectedAt: 0, roomId: null, role: 'attack', ready: bot, strategy: 0, switchAt: 0, lastSeq: 0, tapTimes: [], stats: emptyStats(), nextTap: 0, nextSwitch: 0, charge: 0, ultimateUntil: 0, ultimateUses: 0 };
  }
  connect(token?: string): SessionView {
    this.advance();
    const isReserved = (p: Player) => !p.bot && (p.connected || !!(p.roomId && this.rooms.get(p.roomId)?.phase !== 'ended'));
    const occupied = () => [...this.players.values()].filter(isReserved).length;
    if (token) {
      const id = this.tokens.get(token); insist(id, 'SESSION_EXPIRED', '活動已重新啟動，請重新加入。');
      const p = this.requirePlayer(id);
      insist(isReserved(p) || occupied() < this.capacity, 'CAPACITY', '目前已有 30 位玩家，請稍候再加入。');
      p.connected = true;
      const r = p.roomId ? this.rooms.get(p.roomId) : undefined;
      if (r?.phase === 'paused' && r.members.every(id => this.requirePlayer(id).connected)) this.resume(r);
      return this.session(p.id);
    }
    insist(this.accepting, 'CLOSED', '主持人暫停新玩家加入，請稍候。');
    insist(occupied() < this.capacity, 'CAPACITY', '目前已有 30 位玩家，請稍候再加入。');
    const p = this.makePlayer(); this.players.set(p.id, p); this.tokens.set(p.token, p.id);
    return this.session(p.id);
  }
  session(id: string): SessionView { const p = this.requirePlayer(id); return { id: p.id, token: p.token, name: p.name, lastSeq: p.lastSeq, roomId: p.roomId }; }
  lobby(): LobbyView { return { version: GAME_VERSION, accepting: this.accepting, allowSurrender: this.allowSurrender, ultimateMode: this.ultimateMode, defaultDuration: this.defaultDuration, online: [...this.players.values()].filter(p => p.connected && !p.bot).length, capacity: this.capacity, joinUrl: this.joinUrl }; }
  setDuration(duration: unknown) { validDuration(duration); this.defaultDuration = duration; }
  setUltimateMode(enabled: boolean) {
    insist(typeof enabled === 'boolean', 'INVALID', '無效大招模式。');
    if (this.ultimateMode === enabled) return;
    this.ultimateMode = enabled;
    for (const room of this.rooms.values()) if (room.phase === 'waiting') {
      room.ultimateMode = enabled;
      for (const id of room.members) this.requirePlayer(id).ready = this.requirePlayer(id).bot;
    }
  }
  disconnect(id: string) {
    const p = this.players.get(id); if (!p || !p.connected) return;
    this.advance(); p.connected = false; p.disconnectedAt = this.now();
    const r = p.roomId ? this.rooms.get(p.roomId) : undefined;
    if (!r) return;
    if (r.phase === 'waiting') p.ready = false;
    if (r.phase === 'playing' || r.phase === 'countdown') {
      r.previousPhase = r.phase; r.savedRemaining = Math.max(0, r.deadline - this.now());
      r.phase = 'paused'; r.pausedAt = this.now(); r.pauseLimit = Math.min(10_000, 20_000 - r.pauseTotal);
      if (r.pauseLimit <= 0) this.end(r, null, '連線中斷，本局不計勝負。');
    }
  }
  private resume(r: Room) {
    const elapsed = this.now() - r.pausedAt;
    r.pauseTotal += elapsed; r.phase = r.previousPhase; r.deadline = this.now() + r.savedRemaining;
    for (const id of r.members) { const p = this.requirePlayer(id); p.switchAt += elapsed; if (p.ultimateUntil > r.pausedAt) p.ultimateUntil += elapsed; p.nextTap = this.now() + 250; p.nextSwitch = this.now() + (p.role === 'attack' ? 4000 : 900); p.tapTimes = []; }
  }
  action(id: string, input: unknown) {
    this.advance();
    const p = this.requirePlayer(id);
    insist(p.connected, 'DISCONNECTED', '請等待重新連線。');
    insist(input && typeof input === 'object' && !Array.isArray(input), 'INVALID', '無效操作。');
    const a = input as Action;
    if (a.kind === 'name') {
      insist(typeof a.name === 'string', 'INVALID', '請輸入暱稱。');
      const name = a.name.trim().replace(/[\u0000-\u001f\u007f]/g, '');
      insist(name.length >= 1 && name.length <= 16, 'INVALID', '暱稱需為 1～16 個字。'); p.name = name; return;
    }
    if (a.kind === 'create') { this.create(p, a); return; }
    if (a.kind === 'join') { this.join(p, a); return; }
    if (a.kind === 'leave') { this.leave(p); return; }
    const r = this.requireRoom(p); r.touchedAt = this.now();
    if (a.kind === 'tap' || a.kind === 'strategy' || a.kind === 'surrender' || a.kind === 'ultimate') {
      insist(r.phase === 'playing', 'NOT_PLAYING', '目前無法進行攻防。');
      if (a.kind === 'surrender') insist(this.allowSurrender, 'SURRENDER_DISABLED', '主持人目前未開放投降。');
      insist(a.roundId === r.roundId, 'STALE_ROUND', '此操作已過期。');
      insist(Number.isSafeInteger(a.seq) && a.seq > p.lastSeq, 'STALE_INPUT', '重複或過期的操作。');
      p.lastSeq = a.seq;
      if (a.kind === 'surrender') this.end(r, opposite(p.role), `${p.role === 'attack' ? '攻擊方' : '防守方'}投降，${p.role === 'attack' ? '防守方' : '攻擊方'}獲勝。`);
      else if (a.kind === 'ultimate') this.activateUltimate(r, p);
      else if (a.kind === 'tap') this.tap(r, p);
      else { insist(a.strategy === 0 || a.strategy === 1 || a.strategy === 2, 'INVALID', '無效策略。'); this.switch(r, p, a.strategy); }
      return;
    }
    if (a.kind === 'rematch') {
      insist(r.phase === 'ended', 'STATE', '本局尚未結束。');
      insist(r.members.filter(id => !this.requirePlayer(id).bot).every(id => this.requirePlayer(id).connected), 'WAIT', '等待另一位玩家重新連線。');
      this.validateImmediateStart(r.mode, a.startImmediately);
      this.resetRoom(r); if (a.startImmediately) this.startSolo(r); return;
    }
    insist(r.phase === 'waiting', 'LOCKED', '開局後不能變更設定。');
    if (a.kind === 'role') {
      validRole(a.role);
      if (p.role === a.role) return;
      p.role = a.role;
      for (const id of r.members) { const member = this.requirePlayer(id); if (member.bot) { member.role = opposite(p.role); member.name = member.role === 'attack' ? '電腦駭客' : '電腦守護者'; } member.ready = member.bot; }
    } else if (a.kind === 'duration') {
      insist(p.id === r.ownerId, 'FORBIDDEN', '只有房主可以調整局長。'); validDuration(a.duration); r.duration = a.duration;
      for (const id of r.members) { const member = this.requirePlayer(id); member.ready = member.bot; }
    } else if (a.kind === 'ready') {
      insist(typeof a.ready === 'boolean', 'INVALID', '無效準備狀態。');
      if (a.ready) insist(new Set(r.members.map(id => this.requirePlayer(id).role)).size === r.members.length, 'ROLE_CONFLICT', '請其中一位換邊，選擇不同陣營後才能準備。');
      p.ready = a.ready;
      if (r.members.length === 2 && r.members.every(id => { const m = this.requirePlayer(id); return m.connected && m.ready; })) { r.phase = 'countdown'; r.deadline = this.now() + 3000; }
    } else throw new GameError('INVALID', '無效操作。');
  }
  private create(p: Player, a: Extract<Action, { kind: 'create' }>) {
    insist(!p.roomId, 'ALREADY_JOINED', '請先離開目前房間。');
    insist(this.accepting, 'CLOSED', '主持人暫停新房間建立。');
    insist(a.mode === 'solo' || a.mode === 'duo', 'INVALID', '無效遊戲模式。'); validRole(a.role); validDuration(a.duration);
    this.validateImmediateStart(a.mode, a.startImmediately);
    insist(this.usedCodes.size < 9000, 'CODES_FULL', '本次活動房號已用完，請重新啟動活動。');
    let code: string; do { code = String(randomInt(1000, 10000)); } while (this.usedCodes.has(code));
    this.usedCodes.add(code);
    const r: Room = { id: uid(), code, ownerId: p.id, mode: a.mode, duration: a.duration, phase: 'waiting', roundId: uid(), members: [p.id], hp: 100, shield: 30, deadline: 0, pausedAt: 0, pauseTotal: 0, pauseLimit: 0, previousPhase: 'playing', savedRemaining: 0, winner: null, reason: '', lessons: [], touchedAt: this.now(), attacks: 0, blocks: 0, ultimateMode: this.ultimateMode };
    this.resetPlayer(p); p.roomId = r.id; p.role = a.role;
    if (a.mode === 'solo') { const bot = this.makePlayer(true); bot.role = opposite(a.role); bot.name = bot.role === 'attack' ? '電腦駭客' : '電腦守護者'; bot.roomId = r.id; this.players.set(bot.id, bot); r.members.push(bot.id); }
    this.rooms.set(r.id, r);
    if (a.startImmediately) this.startSolo(r);
  }
  private validateImmediateStart(mode: 'solo' | 'duo', enabled: unknown) {
    insist(enabled === undefined || typeof enabled === 'boolean', 'INVALID', '無效開局設定。');
    insist(!enabled || mode === 'solo', 'INVALID', '雙人對局需雙方選好陣營並準備。');
  }
  private startSolo(r: Room) {
    for (const id of r.members) this.requirePlayer(id).ready = true;
    r.phase = 'countdown'; r.deadline = this.now() + 3000;
  }
  private join(p: Player, a: Extract<Action, { kind: 'join' }>) {
    insist(!p.roomId, 'ALREADY_JOINED', '請先離開目前房間。'); insist(this.accepting, 'CLOSED', '主持人暫停新玩家加入。');
    insist((typeof a.roomId === 'string' && a.roomId.length < 64) || (typeof a.code === 'string' && /^[1-9][0-9]{3}$/.test(a.code)), 'INVALID', '請輸入 4 位數房號。');
    const r = a.roomId ? this.rooms.get(a.roomId) : [...this.rooms.values()].find(r => r.code === a.code);
    insist(r, 'NOT_FOUND', '找不到這個房間，請確認房號。');
    insist(r.phase !== 'ended', 'ENDED', '這個房間的對局已結束。');
    insist(r.mode === 'duo' && r.members.length < 2, 'FULL', '這個房間已滿。');
    insist(r.phase === 'waiting', 'STARTED', '這個房間已經開局。');
    const owner = this.requirePlayer(r.members[0]); this.resetPlayer(p); p.role = opposite(owner.role); p.roomId = r.id; r.members.push(p.id); owner.ready = false; r.touchedAt = this.now();
  }
  private resetRoom(r: Room) {
    r.phase = 'waiting'; r.roundId = uid(); r.hp = 100; r.shield = 30; r.deadline = 0; r.pauseTotal = 0; r.winner = null; r.reason = ''; r.lessons = []; r.attacks = 0; r.blocks = 0; r.touchedAt = this.now();
    r.ultimateMode = this.ultimateMode;
    for (const id of r.members) this.resetPlayer(this.requirePlayer(id));
  }
  private leave(p: Player) {
    const r = p.roomId ? this.rooms.get(p.roomId) : undefined;
    if (!r) { p.roomId = null; return; }
    if (r.phase !== 'waiting' && r.phase !== 'ended') this.end(r, null, '玩家離開，本局不計勝負。');
    r.members = r.members.filter(id => id !== p.id); p.roomId = null; p.ready = false;
    if (r.members.every(id => this.requirePlayer(id).bot)) this.closeRoom(r.id);
    else { if (r.ownerId === p.id) r.ownerId = r.members[0]; for (const id of r.members) this.requirePlayer(id).ready = false; }
  }
  closeRoom(id: string) {
    const r = this.rooms.get(id); insist(r, 'NOT_FOUND', '房間已關閉。');
    for (const id of r.members) { const p = this.requirePlayer(id); p.roomId = null; p.ready = false; if (p.bot) this.players.delete(id); }
    this.rooms.delete(id);
  }
  abortForTunnelRebuild(reason = '主持人正在重建公開連線，本局不計勝負。請重新掃描主持台 QR Code。') {
    for (const r of this.rooms.values()) if (r.phase !== 'ended') this.end(r, null, reason);
  }
  clearParticipants() {
    this.rooms.clear(); this.players.clear(); this.tokens.clear();
    // Keep usedCodes and host settings for the lifetime of this activity.
  }
  private switch(r: Room, p: Player, strategy: Strategy) {
    if (p.strategy === strategy) return;
    insist(!this.ultimateActive(p), 'ULTIMATE_ACTIVE', '大招結束後會恢復原招式。');
    insist(this.now() >= p.switchAt, 'COOLDOWN', '策略正在冷卻。');
    p.strategy = strategy; p.switchAt = this.now() + BALANCE.strategyCooldownMs;
    if (p.role === 'attack') { const defender = r.members.map(id => this.requirePlayer(id)).find(m => m.bot && m.role === 'defense'); if (defender) defender.nextSwitch = this.now() + 900; }
  }
  private ultimateActive(p: Player) { return p.ultimateUntil > this.now(); }
  private activateUltimate(r: Room, p: Player) {
    insist(r.ultimateMode, 'ULTIMATE_DISABLED', '本局未開啟大招模式。');
    insist(!this.ultimateActive(p), 'ULTIMATE_ACTIVE', '大招正在施放中。');
    insist(p.ultimateUses < ULTIMATE.maxUses, 'ULTIMATE_SPENT', '本局大招已用完。');
    insist(p.charge >= 100, 'ULTIMATE_CHARGING', '大招尚未集滿。');
    p.charge = 0; p.ultimateUntil = this.now() + ULTIMATE.durationMs; p.ultimateUses++;
  }
  private tap(r: Room, p: Player) {
    p.tapTimes = p.tapTimes.filter(t => t > this.now() - 1000);
    insist(p.tapTimes.length < 6, 'RATE_LIMIT', '已達每秒 6 次有效連點。');
    p.tapTimes.push(this.now()); p.stats.taps++; p.stats.byStrategy[p.strategy]++;
    const scale = 60 / r.duration;
    const ultimate = r.ultimateMode && this.ultimateActive(p);
    if (r.ultimateMode && !ultimate && p.ultimateUses < ULTIMATE.maxUses) p.charge = Math.min(100, p.charge + ULTIMATE.chargePerTap * scale);
    if (p.role === 'defense') { const added = Math.min(30 - r.shield, BALANCE.shieldRestore * scale * (ultimate ? ULTIMATE.defenseShieldMultiplier : 1)); r.shield += added; p.stats.shieldAdded += added; return; }
    const defender = r.members.map(id => this.requirePlayer(id)).find(m => m.role === 'defense')!;
    const guarding = r.ultimateMode && this.ultimateActive(defender);
    const matched = guarding || (!ultimate && p.strategy === defender.strategy); const multiplier = matched ? BALANCE.matchedAbsorption : BALANCE.mismatchedAbsorption;
    const hit = BALANCE.attackDamage * scale * (ultimate ? ULTIMATE.attackMultiplier : 1);
    const emergencyBlock = guarding ? hit * ULTIMATE.defenseDamageReduction : 0;
    const shieldBlock = Math.min(hit - emergencyBlock, r.shield * multiplier), blocked = emergencyBlock + shieldBlock;
    r.shield = Math.max(0, r.shield - shieldBlock / multiplier);
    const damage = Math.min(r.hp, hit - blocked); r.hp = Math.max(0, r.hp - damage);
    p.stats.damage += damage; defender.stats.blocked += blocked; defender.stats.hits++; if (matched) defender.stats.matchedHits++;
    r.attacks++; if (blocked > 0) r.blocks++;
    if (r.hp <= 1e-8) { r.hp = 0; this.end(r, 'attack', '醫院主機失守！'); }
  }
  private end(r: Room, winner: Role | null, reason: string) {
    r.phase = 'ended'; r.winner = winner; r.reason = reason; r.touchedAt = this.now();
    const attacker = r.members.map(id => this.requirePlayer(id)).find(m => m.role === 'attack');
    const defender = r.members.map(id => this.requirePlayer(id)).find(m => m.role === 'defense');
    const dominant = (p?: Player) => {
      if (!p) return 0;
      const mostTaps = Math.max(...p.stats.byStrategy);
      // Prefer the selected strategy for ties, including rounds without any taps.
      return p.stats.byStrategy[p.strategy] === mostTaps ? p.strategy : p.stats.byStrategy.indexOf(mostTaps);
    };
    r.lessons = [STRATEGIES[dominant(attacker)].attackTip, STRATEGIES[dominant(defender)].defenseTip];
  }
  advance() {
    const now = this.now();
    for (const r of this.rooms.values()) {
      if (r.phase === 'paused') { if (now - r.pausedAt >= r.pauseLimit) this.end(r, null, '連線中斷，本局不計勝負。'); continue; }
      if (r.phase === 'countdown' && now >= r.deadline) {
        r.phase = 'playing'; const start = r.deadline; r.deadline = start + r.duration * 1000;
        for (const id of r.members) { const p = this.requirePlayer(id); p.nextTap = start + 250; p.nextSwitch = start + (p.role === 'attack' ? 4000 : 900); }
      }
      if (r.phase === 'playing') {
        if (now >= r.deadline) { this.end(r, 'defense', '醫療服務成功守住！'); continue; }
        for (const id of r.members) {
          const bot = this.requirePlayer(id); if (!bot.bot) continue;
          if (r.ultimateMode && bot.charge >= 100 && bot.ultimateUses < ULTIMATE.maxUses && !this.ultimateActive(bot)) {
            const attacker = r.members.map(id => this.requirePlayer(id)).find(p => p.role === 'attack')!;
            if (bot.role === 'attack' || (this.ultimateActive(attacker) && now >= attacker.ultimateUntil - ULTIMATE.durationMs + ULTIMATE.botReactionMs)) this.activateUltimate(r, bot);
          }
          if (now >= bot.nextSwitch && now >= bot.switchAt && !this.ultimateActive(bot)) {
            if (bot.role === 'attack') { this.switch(r, bot, ((bot.strategy + 1 + Math.floor(this.rng() * 2)) % 3) as Strategy); bot.nextSwitch = now + 4000; }
            else { const attacker = r.members.map(id => this.requirePlayer(id)).find(p => p.role === 'attack')!; this.switch(r, bot, (this.rng() < .8 ? attacker.strategy : (attacker.strategy + 1) % 3) as Strategy); bot.nextSwitch = Infinity; }
          }
          if (now >= bot.nextTap && r.phase === 'playing') { this.tap(r, bot); bot.nextTap = now + 250; }
        }
      }
      if ((r.phase === 'waiting' || r.phase === 'ended') && now - r.touchedAt >= 600_000) this.closeRoom(r.id);
    }
    for (const p of this.players.values()) {
      if (!p.bot && !p.connected && now - p.disconnectedAt >= 60_000) {
        this.leave(p); this.tokens.delete(p.token); this.players.delete(p.id);
      }
    }
  }
  view(id: string): RoomView | null {
    const r = this.rooms.get(id); if (!r) return null;
    const at = r.phase === 'paused' ? r.pausedAt : this.now();
    return { id: r.id, code: r.code, mode: r.mode, ownerId: r.ownerId, duration: r.duration, ultimateMode: r.ultimateMode, phase: r.phase, roundId: r.roundId, hp: Math.round(r.hp * 100) / 100, shield: Math.round(r.shield * 100) / 100,
      remainingMs: r.phase === 'paused' ? r.savedRemaining : r.phase === 'waiting' ? r.duration * 1000 : r.phase === 'ended' ? 0 : Math.max(0, r.deadline - this.now()),
      reconnectMs: r.phase === 'paused' ? Math.max(0, r.pauseLimit - (this.now() - r.pausedAt)) : 0,
      members: r.members.map(id => { const p = this.requirePlayer(id); return { id: p.id, name: p.name, role: p.role, bot: p.bot, connected: p.connected, ready: p.ready, strategy: p.strategy, cooldownMs: Math.max(0, p.switchAt - at), stats: { ...p.stats, byStrategy: [...p.stats.byStrategy] }, ultimate: { charge: Math.floor(p.charge * 10) / 10, remainingMs: r.phase === 'playing' || r.phase === 'paused' ? Math.max(0, p.ultimateUntil - at) : 0, uses: p.ultimateUses } }; }),
      winner: r.winner, reason: r.reason, lessons: [...r.lessons], attacks: r.attacks, blocks: r.blocks };
  }
  playerView(id: string) { const p = this.players.get(id); return p?.roomId ? this.view(p.roomId) : null; }
}
