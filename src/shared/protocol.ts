export type Role = 'attack' | 'defense';
export type Strategy = 0 | 1 | 2;
export type CombatStrategy = Strategy | 3;
export type Phase = 'waiting' | 'countdown' | 'playing' | 'paused' | 'ended';
export const STRATEGIES = [
  {
    attack: '密碼猜測', defense: '多因素驗證', icon: 'key',
    attackTips: [
      '長且不易預測的密碼，能增加猜測難度。',
      '各網站使用不同密碼，避免外洩後連帶失守。',
    ],
    defenseTips: [
      '多因素驗證能降低密碼外洩後的冒用風險。',
      '安全金鑰具抗釣魚能力，降低假網站盜用風險。',
    ],
  },
  {
    attack: '流量轟炸', defense: '流量限制', icon: 'traffic',
    attackTips: [
      '流量轟炸會耗盡服務資源，阻礙正常使用。',
      '攻擊可能塞滿網路，需搭配上游流量防護。',
    ],
    defenseTips: [
      '流量限制減少資源耗用，門檻須避免誤擋正常請求。',
      '限制登入嘗試次數，並搭配多因素驗證。',
    ],
  },
  {
    attack: '漏洞入侵', defense: '安全更新', icon: 'bug',
    attackTips: [
      '漏洞可被用來入侵系統，修補發布後仍須安裝。',
      '定期盤點軟體版本，追蹤廠商的漏洞修補公告。',
    ],
    defenseTips: [
      '安全更新可修補已知漏洞，完成安裝才會生效。',
      '從官方取得更新，避免安裝來路不明的程式。',
    ],
  },
] as const;
export const ROLE_LABEL: Record<Role, string> = { attack: '駭客攻擊方', defense: '醫院防守方' };
export const ULTIMATE_NAMES: Record<Role, string> = { attack: '暗網超頻', defense: '緊急應變' };
export const combatStrategy = (member: MemberView): CombatStrategy => member.ultimate?.remainingMs > 0 ? 3 : member.strategy;
export const combatName = (member: MemberView) => combatStrategy(member) === 3 ? ULTIMATE_NAMES[member.role] : STRATEGIES[member.strategy][member.role];
export const defenseMatches = (attack: MemberView, defense: MemberView) => combatStrategy(defense) === 3 || combatStrategy(attack) === combatStrategy(defense);
export interface Stats { taps: number; damage: number; blocked: number; shieldAdded: number; matchedHits: number; hits: number; byStrategy: number[] }
export interface MemberView { id: string; name: string; role: Role; bot: boolean; connected: boolean; away?: boolean; ready: boolean; strategy: Strategy; cooldownMs: number; stats: Stats; ultimate: { charge: number; remainingMs: number; uses: number } }
export interface RoomView {
  id: string; code: string; mode: 'solo' | 'duo'; ownerId: string; duration: number; ultimateMode: boolean;
  phase: Phase; roundId: string; hp: number; shield: number; remainingMs: number;
  reconnectMs: number; members: MemberView[]; winner: Role | null;
  reason: string; lessons: string[]; attacks: number; blocks: number;
}
export interface SessionView { id: string; token: string; name: string; lastSeq: number; roomId: string | null; }
export interface LobbyView { version: string; accepting: boolean; allowSurrender: boolean; ultimateMode: boolean; defaultDuration: number; online: number; capacity: number; joinUrl: string; }
export type Action =
  | { kind: 'name'; name: string }
  | { kind: 'create'; mode: 'solo' | 'duo'; role: Role; duration?: number; startImmediately?: boolean }
  | { kind: 'join'; code?: string; roomId?: string }
  | { kind: 'role'; role: Role }
  | { kind: 'duration'; duration: number }
  | { kind: 'ready'; ready: boolean }
  | { kind: 'rematch'; startImmediately?: boolean }
  | { kind: 'leave' }
  | { kind: 'away' | 'resume'; roundId: string; seq: number }
  | { kind: 'surrender'; roundId: string; seq: number }
  | { kind: 'ultimate'; roundId: string; seq: number }
  | { kind: 'tap'; roundId: string; seq: number }
  | { kind: 'strategy'; strategy: Strategy; roundId: string; seq: number };
export interface Reply { ok: boolean; code?: string; message?: string; }
export interface HostView { hostingMode?: 'local' | 'cloud'; lobby: LobbyView; rooms: RoomView[]; uptimeSeconds: number; tunnelStatus: string; tunnelControl?: { available: boolean; busy: boolean; failed: boolean }; }

export type SpectatorRoomView = Omit<RoomView, 'ownerId'>;
export type SpectatorSummary = Pick<RoomView, 'id' | 'code' | 'mode' | 'phase' | 'hp' | 'shield' | 'remainingMs' | 'duration'> & { members: Pick<MemberView, 'name' | 'role'>[] };
