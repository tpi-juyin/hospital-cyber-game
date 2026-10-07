import { STRATEGIES, combatName, combatStrategy, type RoomView } from '../shared/protocol';
import { ULTIMATE } from '../shared/balance';
import { GAME_VERSION } from '../shared/version';
import { escape as esc, hospital, icon } from './art';
import { serverMetrics, type Telemetry } from './telemetry';

const phases = { waiting: '等待準備', countdown: '開戰倒數', playing: '即時觀測', paused: '對戰暫停', ended: '本局結束' };
const number = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const bar = (value: number, label: string, tone = 'ok') => `<div class="monitor-bar ${tone}" role="meter" aria-label="${label}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"><i style="width:${value}%"></i></div>`;

function trend(h: Telemetry) {
  const samples = h.samples, latest = samples.at(-1)?.at || 0, left = latest - 30000;
  const groups: typeof samples[] = [];
  for (const sample of samples) {
    if (sample.at < left) continue;
    if (sample.gap || !groups.length) groups.push([]);
    groups.at(-1)!.push(sample);
  }
  const x = (at: number) => 34 + (at - left) / 30000 * 502;
  const y = (rate: number) => 140 - rate / 6 * 112;
  const lines = (field: 'attack' | 'blocked', color: string) => groups.map(group => `<polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${group.map(s => `${x(s.at).toFixed(1)},${y(s[field]).toFixed(1)}`).join(' ')}"/>`).join('');
  const final = samples.at(-1);
  return `<svg class="monitor-chart" viewBox="0 0 560 174" role="img" aria-label="最近三十秒有效攻擊與防護攔截曲線，每秒零到六次">
    ${[0, 3, 6].map(v => `<path d="M34 ${y(v)}H536" stroke="#304650" stroke-dasharray="3 5"/><text x="17" y="${y(v) + 4}" fill="#a7bac2">${v}</text>`).join('')}
    <text x="34" y="165" fill="#a7bac2">−30 秒</text><text x="276" y="165" fill="#a7bac2">−15 秒</text><text x="510" y="165" fill="#a7bac2">現在</text>
    ${lines('attack', '#ff956e')}${lines('blocked', '#6fe0ba')}
    ${final ? `<circle cx="536" cy="${y(final.attack)}" r="4" fill="#ff956e"/><circle cx="536" cy="${y(final.blocked)}" r="4" fill="#6fe0ba"/>` : '<text x="280" y="87" text-anchor="middle" fill="#a7bac2">開戰後開始累積曲線</text>'}
  </svg>`;
}

/** Only update changing regions, preserving exit-button focus and the scroll position. */
export class ServerMonitor {
  private mounted = false;
  private cache = new Map<string, string>();
  constructor(private root: HTMLElement) {}
  private fill(id: string, html: string) {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html); this.root.querySelector<HTMLElement>(`#${id}`)!.innerHTML = html;
  }
  private mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.root.classList.add('server-monitor');
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'monitor-title');
    this.root.innerHTML = `<div class="monitor-wrap">
      <header class="monitor-header"><div class="monitor-brand"><span class="monitor-brand-icon">${icon('shield', 29)}</span><div><span class="monitor-eyebrow">CYBER CARE / OPERATIONS</span><h1 id="monitor-title">戰況儀表板 <small class="projection-version">v${GAME_VERSION}</small></h1></div></div><div class="monitor-header-right"><div id="monitor-round"></div><button class="monitor-exit" data-exit>返回指揮中心 ${icon('close', 18)}</button></div></header>
      <div class="monitor-meta"><span>演練模擬 · 非真實醫療監控</span><span id="monitor-feed" role="status"></span></div>
      <div id="monitor-stale" class="monitor-stale" role="status" hidden>監控連線中斷 · 畫面保留最後資料，尚未確認目前戰況。</div>
      <section id="monitor-status" class="monitor-status"></section>
      <section id="monitor-ultimates" class="monitor-ultimates" aria-label="雙方大招狀態"></section><section id="monitor-kpis" class="monitor-kpis" aria-label="對戰即時指標"></section>
      <div class="monitor-grid">
        <section class="monitor-panel"><div class="monitor-panel-heading"><h2>雙機運作狀態</h2><span>CPU / 記憶體為模擬值</span></div><div id="monitor-route" class="monitor-route"></div><div id="monitor-nodes" class="monitor-nodes"></div></section>
        <section class="monitor-panel"><div class="monitor-panel-heading"><h2>攻擊與攔截趨勢</h2><span class="monitor-legend"><i></i>攻擊 <i></i>防護攔截</span></div><div id="monitor-trend"></div><p class="monitor-caption">次／秒 · 近 2 秒平均 · 攔截含部分吸收 · 暫停／結算凍結</p><div id="monitor-protection" class="monitor-protection"></div></section>
        <section class="monitor-panel monitor-services"><div class="monitor-panel-heading"><h2>醫療服務狀態</h2><span>回應時間為模擬值</span></div><div id="monitor-services"></div></section>
        <section class="monitor-panel"><div class="monitor-panel-heading"><h2>戰況事件</h2><span>本局遊戲時間 · 最新在上</span></div><ol id="monitor-events" class="monitor-events"></ol></section>
      </div>
      <footer class="monitor-footer">血量、護盾與攻防次數來自對戰；主備切換、負載與服務回應用於教學模擬。三項基礎防護持續啟用，策略代表加強重點。</footer>
    </div>`;
  }
  connection(stale: boolean) {
    if (!this.mounted) return;
    this.root.classList.toggle('monitor-disconnected', stale);
    this.root.querySelector<HTMLElement>('#monitor-stale')!.hidden = !stale;
  }
  render(r: RoomView, h: Telemetry, stale = false) {
    this.mount(); this.connection(stale);
    this.root.dataset.phase = r.phase;
    const m = serverMetrics(r, h.attackRate), attack = r.members.find(p => p.role === 'attack'), defense = r.members.find(p => p.role === 'defense');
    const ready = !!attack && !!defense;
    const outcome = r.phase === 'ended' ? r.winner === 'attack' ? '攻擊方獲勝' : r.winner === 'defense' ? '防守方獲勝' : '本局不計勝負' : '';
    this.fill('monitor-round', `<span class="monitor-room">房間 ${r.code}</span><strong class="monitor-countdown">${r.phase === 'ended' ? 'END' : clock(Math.ceil(r.remainingMs / 1000))}</strong>`);
    this.fill('monitor-feed', `<span class="monitor-live-dot"></span>${phases[r.phase]}${r.phase === 'paused' ? ` · 等待重連 ${Math.ceil(r.reconnectMs / 1000)} 秒` : ''}`);
    this.fill('monitor-status', `<div class="monitor-status-art">${hospital(r.hp)}</div><div class="monitor-status-copy"><div class="monitor-status-label ${m.tone}">${outcome ? esc(outcome) : r.phase === 'countdown' ? '雙方準備完成' : r.phase === 'waiting' ? '等待玩家準備' : 'SERVICE STATUS'}</div><h2 class="${m.tone}">${m.title}</h2><p>${esc(r.phase === 'ended' ? r.reason : m.detail)}</p></div><div class="monitor-players">${[...r.members, ...Array.from({ length: 2 - r.members.length }, () => null)].map(member => `<span class="${member?.role === 'attack' ? 'monitor-attacker' : 'monitor-defender'}">${icon(member?.role === 'attack' ? 'bolt' : 'shield', 16)}<b>${esc(member?.name || '等待對手')}</b><em>${!member ? '尚未加入' : r.phase === 'waiting' ? `${member.role === 'attack' ? '攻擊方' : '防守方'} · ${member.ready ? '已準備' : '選角中'}` : combatName(member)}</em></span>`).join('')}</div>`);
    this.root.querySelector<HTMLElement>('#monitor-ultimates')!.hidden = !r.ultimateMode;
    this.fill('monitor-ultimates', r.ultimateMode ? r.members.map(member => {
      const u = member.ultimate, active = u.remainingMs > 0;
      const label = active ? `施放中 · 剩 ${(u.remainingMs / 1000).toFixed(1)} 秒` : u.uses >= ULTIMATE.maxUses ? '本局已用完' : u.charge >= 100 ? '大招就緒' : `集氣 ${Math.floor(u.charge)}%`;
      return `<article class="${member.role} ${active ? 'is-active' : ''}"><span>${member.role === 'attack' ? '暗網超頻' : '緊急應變'} <b>${label}</b></span>${bar(active ? u.remainingMs / ULTIMATE.durationMs * 100 : u.charge, '大招集氣與剩餘時間', member.role === 'attack' ? 'warn' : 'ok')}<small>已使用 ${u.uses} / ${ULTIMATE.maxUses} 次</small></article>`;
    }).join('') : '');
    const hpTone = r.hp <= 0 ? 'danger' : r.hp <= 50 ? 'warn' : 'ok';
    this.fill('monitor-kpis', `<article><span>服務健康度</span><strong class="${hpTone}">${number(r.hp)}<small>%</small></strong>${bar(r.hp, '醫院血量', hpTone)}</article><article><span>防護資源</span><strong>${number(r.shield)}<small>/ 30</small></strong>${bar(r.shield / 30 * 100, '護盾百分比', r.shield <= 5 ? 'warn' : 'ok')}</article><article><span>可用主機</span><strong class="${m.tone}">${m.online}<small>/ 2 台</small></strong><p>${m.online === 2 ? '主機 + 同步備援' : m.online === 1 ? '備援承接中' : '全部離線'}</p></article><article><span>有效攻擊強度</span><strong class="attack-color">${h.attackRate.toFixed(1)}<small>次 / 秒</small></strong><p>本局累積 ${r.attacks} 次攻擊</p></article>`);
    this.fill('monitor-route', `<span>${icon('bolt', 14)}異常輸入</span><i>→</i><span class="${!ready ? 'idle' : m.matched ? 'ok' : 'warn'}">${icon('shield', 14)}${!ready ? '等待雙方加入' : m.matched ? '對應防護加強中' : '防護未對應'}</span><i>→</i><span>${m.failover ? '備援承接' : m.online ? '主機服務' : '服務中斷'}</span>`);
    this.fill('monitor-nodes', m.nodes.map(n => `<article class="monitor-node ${!n.up ? 'node-down' : n.active ? 'node-active' : 'node-standby'}" data-node="${n.id}"><div class="monitor-node-top"><div class="monitor-rack" aria-hidden="true"><i></i><i></i><i></i></div><div><small>${n.code}</small><h3>${n.title}</h3><span class="monitor-node-state">${n.up ? '●' : '×'} ${n.state}</span></div></div><div class="monitor-node-metric"><span>CPU</span><b>${n.up ? `${n.cpu}%` : '離線'}</b></div>${bar(n.cpu, `${n.title} CPU 模擬負載`, n.cpu >= 85 ? 'warn' : 'ok')}<div class="monitor-node-metric"><span>記憶體</span><b>${n.up ? `${n.memory}%` : '離線'}</b></div>${bar(n.memory, `${n.title}記憶體模擬用量`, n.memory >= 85 ? 'warn' : 'ok')}</article>`).join(''));
    this.fill('monitor-trend', trend(h));
    this.fill('monitor-protection', STRATEGIES.map((s, i) => `<div class="${defense && combatStrategy(defense) === i ? 'is-focused' : ''}">${icon(i === 1 ? 'gate' : s.icon, 18)}<span>${s.defense}<small>${defense && combatStrategy(defense) === i ? '重點強化' : '基礎防護啟用'}</small></span></div>`).join(''));
    this.fill('monitor-services', `<table><thead><tr><th>服務</th><th>狀態</th><th>回應時間</th></tr></thead><tbody>${m.services.map(s => `<tr><th scope="row">${s.name}</th><td><span class="service-state ${s.tone}"><i></i>${s.status}</span></td><td>${s.latency === null ? '—' : `${s.latency}<small> ms</small>`}</td></tr>`).join('')}</tbody></table>`);
    this.fill('monitor-events', h.events.slice(0, 4).map(e => `<li><time>${e.elapsed === null ? '監看時' : clock(e.elapsed)}</time><i class="${e.tone}"></i><span>${esc(e.text)}</span></li>`).join(''));
  }
}
