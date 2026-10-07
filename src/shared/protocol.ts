export type Role = 'attack' | 'defense';
export type Strategy = 0 | 1 | 2;
export type CombatStrategy = Strategy | 3;
export type Phase = 'waiting' | 'countdown' | 'playing' | 'paused' | 'ended';
export const STRATEGIES = [
  {
    attack: '密碼猜測', defense: '多因素驗證', icon: 'key',
    attackTips: [
      '密碼猜測會反覆嘗試不同組合，短又常見的密碼較容易被破解。使用長且不易預測的密碼，能提高猜中的難度。',
      '不同服務應使用不同密碼，避免一處外洩就讓其他帳號也遭入侵。密碼管理器能協助產生並保存各站的獨立密碼。',
    ],
    defenseTips: [
      '多因素驗證在密碼之外，還會核對驗證器或安全金鑰等憑證。即使密碼外洩，也能降低帳號被冒用的風險。',
      '多因素驗證也有強弱之分，安全金鑰能提供抗釣魚保護。選擇支援抗釣魚的驗證方式，可減少假網站騙取憑證的風險。',
    ],
  },
  {
    attack: '流量轟炸', defense: '流量限制', icon: 'traffic',
    attackTips: [
      '流量轟炸會用大量請求耗盡伺服器資源，讓正常使用者無法連線。多台裝置一起發動時，稱為分散式阻斷服務攻擊。',
      '流量轟炸可能在到達主機前就塞滿網路，單靠主機擋流量仍不夠。搭配網路服務商或專門的防護服務，能分散與過濾攻擊流量。',
    ],
    defenseTips: [
      '流量限制會限制一定時間內的請求次數，減少資源被大量占用。門檻要配合正常使用量，避免把合法使用者一起擋住。',
      '登入頁也能設定嘗試次數限制，降低大量猜密碼造成的風險。限制只是其中一層防護，仍需搭配強密碼與多因素驗證。',
    ],
  },
  {
    attack: '漏洞入侵', defense: '安全更新', icon: 'bug',
    attackTips: [
      '漏洞入侵會利用軟體缺陷，存取原本不該開放的檔案或帳號。即使修補程式已經發布，未安裝的系統仍可能受到攻擊。',
      '已知漏洞可能被持續利用，醫療系統也需要定期盤點軟體版本。追蹤廠商修補公告，能幫助找出仍需更新的設備與服務。',
    ],
    defenseTips: [
      '安全更新不只增加功能，也會修補已知漏洞。必須完成安裝才能套用修補，持續追蹤並更新能減少攻擊者可利用的入口。',
      '更新應從官方或可信任的來源取得，避免安裝來路不明的程式。支援自動更新的設備可開啟此功能，減少漏裝修補的機會。',
    ],
  },
] as const;
export const ROLE_LABEL: Record<Role, string> = { attack: '駭客攻擊方', defense: '醫院防守方' };
export const ULTIMATE_NAMES: Record<Role, string> = { attack: '暗網超頻', defense: '緊急應變' };
export const combatStrategy = (member: MemberView): CombatStrategy => member.ultimate?.remainingMs > 0 ? 3 : member.strategy;
export const combatName = (member: MemberView) => combatStrategy(member) === 3 ? ULTIMATE_NAMES[member.role] : STRATEGIES[member.strategy][member.role];
export const defenseMatches = (attack: MemberView, defense: MemberView) => combatStrategy(defense) === 3 || combatStrategy(attack) === combatStrategy(defense);
export interface Stats { taps: number; damage: number; blocked: number; shieldAdded: number; matchedHits: number; hits: number; byStrategy: number[] }
export interface MemberView { id: string; name: string; role: Role; bot: boolean; connected: boolean; ready: boolean; strategy: Strategy; cooldownMs: number; stats: Stats; ultimate: { charge: number; remainingMs: number; uses: number } }
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
  | { kind: 'create'; mode: 'solo' | 'duo'; role: Role; duration: number; startImmediately?: boolean }
  | { kind: 'join'; code?: string; roomId?: string }
  | { kind: 'role'; role: Role }
  | { kind: 'duration'; duration: number }
  | { kind: 'ready'; ready: boolean }
  | { kind: 'rematch'; startImmediately?: boolean }
  | { kind: 'leave' }
  | { kind: 'surrender'; roundId: string; seq: number }
  | { kind: 'ultimate'; roundId: string; seq: number }
  | { kind: 'tap'; roundId: string; seq: number }
  | { kind: 'strategy'; strategy: Strategy; roundId: string; seq: number };
export interface Reply { ok: boolean; code?: string; message?: string; }
export interface HostView { hostingMode?: 'local' | 'cloud'; lobby: LobbyView; rooms: RoomView[]; uptimeSeconds: number; tunnelStatus: string; tunnelControl?: { available: boolean; busy: boolean; failed: boolean }; }
