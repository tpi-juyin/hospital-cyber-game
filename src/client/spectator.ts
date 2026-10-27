import { fullscreenButton } from './fullscreen';
import { pushedFetch } from './transport';
const watchFeed=pushedFetch('spectator');
import { GAME_VERSION } from '../shared/version';
import { type SpectatorRoomView, type SpectatorSummary } from '../shared/protocol';
import { escape as esc, icon } from './art';
import { ServerMonitor } from './monitor';
import { TelemetryHistory } from './telemetry';
import './style.css';
import './monitor.css';
import './arcade.css';
import './host-readable.css';
import './spectator.css';
import './landscape.css';

const phases = { waiting: '等待準備', countdown: '即將開戰', playing: '對戰中', paused: '等待重連', ended: '已結束' };
const app = document.querySelector<HTMLElement>('#app')!;
document.body.classList.add('arcade-theme', 'host-theme');
app.innerHTML = `<main class="host-shell spectator-shell"><header class="host-header"><a class="brand" href="/">${icon('shield', 26)} CYBER CARE <small>v${GAME_VERSION}</small></a><div class="spectator-header-actions">${fullscreenButton()}<a class="secondary-button" href="/">返回主選單</a></div></header><section class="host-intro"><div><span class="eyebrow">WATCH THE BATTLE</span><h1>觀戰大廳</h1><p>選一場對戰，看看誰能守住醫院！</p></div></section><p id="watch-status" role="status"></p><section id="watch-rooms" class="room-grid" aria-label="可觀戰的對戰"></section></main><section id="watch-monitor" class="projection" hidden></section>`;
const shell = document.querySelector<HTMLElement>('.spectator-shell')!;
const panel = document.querySelector<HTMLElement>('#watch-monitor')!;
const cards = document.querySelector<HTMLElement>('#watch-rooms')!;
const status = document.querySelector<HTMLElement>('#watch-status')!;
const monitor = new ServerMonitor(panel, '返回觀戰大廳');
const history = new TelemetryHistory();
let selected: string | null = null, generation = 0, stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: AbortController | undefined;
let summaries: SpectatorSummary[] = [];
function renderCards(rooms: SpectatorSummary[]) {
  const known = new Set(rooms.map(r => r.id));
  for (const child of [...cards.children]) if (!known.has((child as HTMLElement).dataset.room!)) child.remove();
  cards.querySelector('.watch-empty')?.remove();
  if (!rooms.length) { cards.innerHTML = '<p class="watch-empty">目前還沒有對戰，等朋友建立房間後就能觀戰。</p>'; return; }
  for (const r of rooms) {
    let card = [...cards.children].find(c => (c as HTMLElement).dataset.room === r.id) as HTMLElement | undefined;
    if (!card) { card = document.createElement('article'); card.className = 'room-card'; card.dataset.room = r.id; card.innerHTML = '<div class="watch-card-content"></div><button class="secondary-button" data-watch>觀看戰況 →</button>'; card.querySelector('button')!.setAttribute('data-watch', r.id); cards.append(card); }
    const content = `<div class="room-card-top"><span class="phase-pill ${r.phase}">${phases[r.phase]}</span><small>房號 ${esc(r.code)}</small></div><div class="watch-contestants">${r.members.map(m => `<div class="watch-person ${m.role}"><span class="watch-avatar">${icon(m.role === 'attack' ? 'bolt' : 'shield', 28)}</span><small>${m.role === 'attack' ? '駭客攻擊方' : '醫院防守方'}</small><strong>${esc(m.name)}</strong></div>`).join('<span class="watch-vs">VS</span>')}${r.members.length < 2 ? '<div class="watch-person"><small>等待對手加入</small></div>' : ''}</div><div class="watch-health"><span>醫院血量</span><strong>${Math.ceil(r.hp)}%</strong><div class="meter hp"><i style="width:${r.hp}%"></i></div></div><div class="room-card-info"><span>護盾 ${Math.ceil(r.shield)} / 30</span><span>${r.mode === 'solo' ? '單人' : '雙人'} · ${r.phase === 'waiting' ? '等待準備' : r.phase === 'ended' ? '本局結束' : `剩 ${Math.ceil(r.remainingMs / 1000)} 秒`}</span></div>`;
    const area = card.querySelector<HTMLElement>('.watch-card-content')!;
    if (area.innerHTML !== content) area.innerHTML = content;
  }
}
function exit() {
  const previous = selected; selected = null; generation++; pending?.abort(); panel.hidden = true; shell.inert = false;
  document.body.classList.remove('monitor-open'); document.title = '醫院資安攻防戰 · 觀戰大廳';
  history.update([]); renderCards(summaries);
  [...cards.querySelectorAll<HTMLButtonElement>('[data-watch]')].find(b => b.dataset.watch === previous)?.focus();
  schedule(0);
}
function schedule(ms: number) { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), ms); }
async function poll() {
  if (stopped || document.hidden) return;
  pending?.abort(); const controller = new AbortController(); pending = controller;
  const version = generation, roomId = selected;
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await watchFeed(roomId ? `/api/spectate/rooms/${encodeURIComponent(roomId)}` : '/api/spectate/rooms', { signal: controller.signal });
    if (version !== generation || stopped) return;
    if (response.status === 404 && roomId) { summaries = summaries.filter(r => r.id !== roomId); exit(); status.textContent = '這場對戰已關閉，請選擇其他對戰。'; return; }
    if (!response.ok) throw new Error('無法取得戰況');
    const data = await response.json();
    if (version !== generation || stopped) return;
    status.textContent = data.version !== GAME_VERSION ? '遊戲已更新，請重新整理觀戰頁。' : '';
    if (roomId) {
      const room = data.room as SpectatorRoomView;
      history.update([room]); const opening = panel.hidden;
      panel.hidden = false; shell.inert = true; document.body.classList.add('monitor-open');
      document.title = '醫院資安攻防戰 · 戰況儀表板'; monitor.render(room, history.get(room.id)!);
      if (opening) panel.querySelector<HTMLButtonElement>('[data-exit]')!.focus();
    } else { summaries = data.rooms; renderCards(summaries); }
  } catch {
    if (version === generation && !stopped) { status.textContent = '戰況連線中斷，正在重新連線…'; monitor.connection(true); }
  } finally { clearTimeout(timeout); if (version === generation && !stopped) schedule(roomId ? 500 : 1000); }
}
cards.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-watch]');
  if (!button || !summaries.some(r => r.id === button.dataset.watch)) return;
  selected = button.dataset.watch!; generation++; pending?.abort(); status.textContent = '正在載入戰況…'; schedule(0);
});
panel.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-exit]')) exit(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) exit(); });
document.addEventListener('visibilitychange', () => { generation++; pending?.abort(); clearTimeout(timer); monitor.connection(true); if (!document.hidden) schedule(0); });
window.addEventListener('pagehide', () => { stopped = true; generation++; clearTimeout(timer); pending?.abort(); });
window.addEventListener('pageshow', () => { if (stopped) { stopped = false; schedule(0); } });
void poll();
