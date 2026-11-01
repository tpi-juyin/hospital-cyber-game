import { type RoomView } from '../shared/protocol';
import { icon, arena } from './art';

const phases = { waiting: '等待準備', countdown: '即將開戰', playing: '對戰中', paused: '等待重連', ended: '已結束' };

/** Keep interactive nodes alive across snapshots, including pointer down/up and keyboard focus. */
export class HostRooms {
  private grid: HTMLElement;
  private empty: HTMLElement;
  private cards = new Map<string, HTMLElement>();
  constructor(private root: HTMLElement) {
    root.innerHTML = `<section class="host-attract" aria-label="醫院資安攻防戰介紹"><div class="host-title-copy"><span class="season-stamp">CYBER CARE // ARCADE</span><h1 class="game-logo">醫院資安<strong>攻防戰<span>✦</span></strong></h1></div><div class="host-title-art">${arena()}</div><p class="host-game-description">扮演駭客或醫院防守方，透過連點、切換招式與施放大招展開限時攻防，在對戰中認識多因素驗證、流量限制與安全更新，一起守護醫療服務！</p><p class="empty-board">掃描加入，準備迎接挑戰！</p></section><div class="room-grid" tabindex="0" aria-label="即時戰況房間清單"></div>`;
    this.grid = root.querySelector('.room-grid')!; this.empty = root.querySelector('.empty-board')!;
  }
  render(rooms: RoomView[]) {
    const ids = new Set(rooms.map(r => r.id));
    for (const [id, card] of this.cards) if (!ids.has(id)) { card.remove(); this.cards.delete(id); }
    this.root.classList.toggle('has-rooms',!!rooms.length);
    this.grid.hidden = !rooms.length; this.empty.hidden = !!rooms.length;
    for (const r of rooms) {
      let card = this.cards.get(r.id);
      if (!card) {
        card = this.root.ownerDocument.createElement('article'); card.className = 'room-card'; card.dataset.room = r.id;
        card.innerHTML = `<div class="room-card-top"><strong data-code></strong><span class="phase-pill"></span></div><div class="room-card-names"><span data-attacker></span><b>VS</b><span data-defender></span></div><div class="meter hp"><i></i></div><div class="room-card-info"><span data-health></span><span data-time></span></div><div class="room-card-actions"><button data-project>戰況儀表板 ${icon('arrow',13)}</button><button data-close>關閉房間</button></div>`;
        card.querySelector<HTMLElement>('[data-project]')!.dataset.project = r.id;
        card.querySelector<HTMLElement>('[data-close]')!.dataset.close = r.id;
        this.cards.set(r.id,card); this.grid.append(card);
      }
      const text = (selector:string,value:string) => { const el=card!.querySelector(selector)!; if(el.textContent!==value) el.textContent=value; };
      const attacker = r.phase==='waiting' ? r.members[0] : r.members.find(m=>m.role==='attack');
      const defender = r.phase==='waiting' ? r.members[1] : r.members.find(m=>m.role==='defense');
      const outcome = r.phase==='ended' ? r.winner==='defense' ? 'defense-win' : r.winner==='attack' ? 'defense-loss' : 'no-contest' : '';
      const label = outcome==='defense-win' ? '成功抵禦攻擊' : outcome==='defense-loss' ? '醫院防線失守' : outcome==='no-contest' ? '對戰中止・不計勝負' : phases[r.phase];
      text('[data-code]',r.code); text('.phase-pill',label);
      card.querySelector('.phase-pill')!.className=`phase-pill ${r.phase} ${outcome}`;
      text('[data-attacker]',attacker?.name || '等待玩家');text('[data-defender]',defender?.name || '等待對手');
      card.querySelector<HTMLElement>('.meter i')!.style.width=`${r.hp}%`;
      text('[data-health]',`血量 ${Math.ceil(r.hp)}% · 護盾 ${Math.ceil(r.shield)}`);
      text('[data-time]',`${r.mode==='solo'?'單人':'雙人'}${r.ultimateMode?'・大招':''} · ${r.phase==='playing'?Math.ceil(r.remainingMs/1000):r.duration} 秒`);
    }
  }
}
