import QRCode from 'qrcode';
import { GAME_VERSION } from '../shared/version';
import { type HostView, type RoomView } from '../shared/protocol';
import { icon, hospital, escape as esc } from './art';
import './style.css';
import './monitor.css';
import './arcade.css';
import './host-readable.css';
import { GameDialog } from './game-dialog';
import { QrDialog } from './qr-dialog';
const hostDialog = new GameDialog(), qrDialog = new QrDialog();
import { ServerMonitor } from './monitor';
import { TelemetryHistory } from './telemetry';
const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('host-theme', 'arcade-theme');
const phases = { waiting: '等待準備', countdown: '即將開戰', playing: '對戰中', paused: '等待重連', ended: '已結束' };
let state: HostView | null = null, lastUrl = '', selected: string | null = null, stopped = false, stale = false, rebuildPending = false;
const telemetry = new TelemetryHistory();
app.innerHTML = `<main class="host-shell"><header class="host-header"><a class="brand" href="/">${icon('shield', 29)}<span class="brand-wordmark">CYBER<span class="brand-light"> CARE</span><small class="version-label" aria-label="遊戲版本 ${GAME_VERSION}">v${GAME_VERSION}</small></span></a><div class="host-header-actions"><span class="host-badge">指揮中心</span><form id="cloud-logout" method="post" action="/host/logout" hidden><button class="secondary-button" type="submit">登出</button></form><button class="danger-button" id="stop">結束活動並停止服務</button></div></header><div id="host-error" class="host-error" hidden></div><p id="version-warning" class="host-error" hidden>主持程式已更新，請結束活動並停止服務並重新啟動，以套用新版功能。</p><section class="host-intro"><div><span class="eyebrow">HOSPITAL CYBER BATTLE</span><h1>指揮中心</h1><p>玩家集結、開戰與觀戰，都從這裡出發。</p></div><div class="host-counts"><div><strong id="online">0</strong><span>玩家在線</span></div><div><strong id="playing">0</strong><span>進行中</span></div></div></section><div class="host-grid"><aside class="host-card"><h2>掃描，加入活動</h2><p>手機使用 Wi-Fi 或行動網路皆可加入。<br>不需下載，也不需註冊。</p><button type="button" class="host-qr" id="zoom-qr" aria-label="放大加入遊戲的 QR Code" aria-haspopup="dialog" disabled><canvas id="qr" hidden></canvas><span class="host-qr-placeholder" id="qr-placeholder">${icon('shield', 36)}<span>正在準備加入入口…</span></span></button><p class="qr-zoom-hint">點擊 QR Code 放大</p><a class="join-url" id="join-url" target="_blank" rel="noopener noreferrer" aria-disabled="true">等待公開網址</a><button class="secondary-button" id="copy-url" disabled>${icon('copy', 16)}複製加入網址</button><p class="status-note" id="tunnel-status" role="status" aria-live="polite"></p><button class="secondary-button" id="rebuild-tunnel" hidden disabled>重建公開連線</button><p class="host-mode-note" id="rebuild-hint" hidden>中止目前對戰、不計勝負，玩家需重新掃描加入。</p><div class="host-controls"><h2>活動設定</h2><div class="host-control-row"><label for="host-duration">新房間預設對戰時間</label><select id="host-duration">${Array.from({ length: 19 }, (_, i) => 30 + i * 5).map(s => `<option value="${s}" ${s === 60 ? 'selected' : ''}>${s} 秒</option>`).join('')}</select></div><div class="host-control-row"><span>開放新玩家加入</span><button id="accepting" class="toggle on">開放中</button></div><div class="host-control-row"><span>大招模式 · 持續 5 秒</span><button id="ultimate-mode" class="toggle" aria-pressed="false" disabled>關閉</button></div><p class="host-mode-note">套用等待中的房間與下一局；已開打的對戰維持原規則。</p><div class="host-control-row"><span>顯示玩家投降按鈕</span><button id="allow-surrender" class="toggle" aria-pressed="false" disabled>隱藏</button></div></div></aside><section><div class="board-heading"><h2>即時戰況</h2><span id="room-count">0 個房間</span></div><div id="rooms"></div><p class="host-footnote">每場對戰獨立計算，不會互相影響。<br>請保持主持電腦開機與網路連線；結束活動並停止服務會清除本次活動資料。</p></section></div></main><section id="projection" class="projection" hidden></section>`;
function error(message: string) { const el = document.querySelector<HTMLElement>('#host-error')!; el.hidden = !message; el.textContent = message; }
async function action(data: unknown) {
  try { const response = await fetch('/api/host/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失敗。'); error(''); return true; } catch (e) { error(e instanceof Error ? e.message : '無法連線。'); return false; }
}
function roomCard(r: RoomView) {
  const attacker = r.phase === 'waiting' ? r.members[0] : r.members.find(m => m.role === 'attack'), defender = r.phase === 'waiting' ? r.members[1] : r.members.find(m => m.role === 'defense');
  return `<article class="room-card"><div class="room-card-top"><strong>${r.code}</strong><span class="phase-pill ${r.phase}">${phases[r.phase]}</span></div><div class="room-card-names"><span>${esc(attacker?.name || '等待玩家')}</span><b>VS</b><span>${esc(defender?.name || '等待對手')}</span></div><div class="meter hp"><i style="width:${r.hp}%"></i></div><div class="room-card-info"><span>血量 ${Math.ceil(r.hp)}% · 護盾 ${Math.ceil(r.shield)}</span><span>${r.mode === 'solo' ? '單人' : '雙人'}${r.ultimateMode ? '・大招' : ''} · ${r.phase === 'playing' ? Math.ceil(r.remainingMs / 1000) : r.duration} 秒</span></div><div class="room-card-actions"><button data-project="${r.id}">戰況儀表板 ${icon('arrow', 13)}</button><button data-close="${r.id}">關閉房間</button></div></article>`;
}
const monitorElement = document.querySelector<HTMLElement>('#projection')!;
const monitor = new ServerMonitor(monitorElement);
function projection() {
  const r = state?.rooms.find(r => r.id === selected), opening = monitorElement.hidden && !!r;
  monitorElement.hidden = !r;
  document.title = `醫院資安攻防戰 · ${r ? '戰況儀表板' : '指揮中心'}`;
  document.body.classList.toggle('monitor-open', !!r);
  document.querySelector<HTMLElement>('.host-shell')!.inert = !!r;
  if (!r) { selected = null; return; }
  monitor.render(r, telemetry.get(r.id)!, stale);
  if (opening) monitorElement.querySelector<HTMLButtonElement>('[data-exit]')!.focus();
}
function exitProjection() {
  const previous = selected; selected = null; projection();
  document.querySelector<HTMLButtonElement>(`[data-project="${previous}"]`)?.focus();
}
function render(s: HostView) {
  state = s;
  document.querySelector<HTMLButtonElement>('#zoom-qr')!.disabled = !s.lobby.joinUrl || stale || rebuildPending || !!s.tunnelControl?.busy;
  if (lastUrl !== s.lobby.joinUrl || rebuildPending || s.tunnelControl?.busy) qrDialog.close();
  const cloud = s.hostingMode === 'cloud';
  document.querySelector<HTMLElement>('#cloud-logout')!.hidden = !cloud;
  document.querySelector('#stop')!.textContent = cloud ? '結束活動' : '結束活動並停止服務';
  if (cloud) document.querySelector('.host-footnote')!.textContent = '遊戲由雲端運行；結束活動會清空對戰與玩家，仍可再次開放加入。免費服務休眠或重新部署會清除目前活動。';
  const rebuild = document.querySelector<HTMLButtonElement>('#rebuild-tunnel')!;
  // 暫時隱藏公開連線重建入口，保留功能供日後恢復。
  rebuild.hidden = true;
  document.querySelector<HTMLElement>('#rebuild-hint')!.hidden = true;
  rebuild.disabled = rebuildPending || stale || !s.tunnelControl?.available || !!s.tunnelControl?.busy || s.lobby.version !== GAME_VERSION;
  rebuild.textContent = s.tunnelControl?.busy || rebuildPending ? '公開連線重建中…' : s.tunnelControl?.failed ? '重試公開連線' : '重建公開連線';
  document.querySelector('#rebuild-hint')!.textContent = !s.tunnelControl?.available ? '此啟動方式不支援；請使用新版公開模式啟動檔。' : '中止目前對戰、不計勝負，玩家需重新掃描加入。';
  document.querySelector<HTMLButtonElement>('#accepting')!.disabled = !!s.tunnelControl?.busy || !!s.tunnelControl?.failed;
  telemetry.update(s.rooms); document.querySelector('#online')!.textContent = String(s.lobby.online); document.querySelector('#playing')!.textContent = String(s.rooms.filter(r => ['playing', 'countdown', 'paused'].includes(r.phase)).length);
  document.querySelector('#room-count')!.textContent = `${s.rooms.length} 個房間`;
  const tunnelNote = document.querySelector<HTMLElement>('#tunnel-status')!;
  tunnelNote.hidden = cloud; tunnelNote.textContent = cloud ? '' : s.tunnelStatus;
  const toggle = document.querySelector('#accepting')!; toggle.classList.toggle('on', s.lobby.accepting); toggle.textContent = s.lobby.accepting ? '開放中' : '暫停加入';
  const surrender = document.querySelector<HTMLButtonElement>('#allow-surrender')!;
  surrender.classList.toggle('on', !!s.lobby.allowSurrender); surrender.textContent = s.lobby.allowSurrender ? '顯示' : '隱藏'; surrender.setAttribute('aria-pressed', String(!!s.lobby.allowSurrender));
  surrender.disabled = s.lobby.version !== GAME_VERSION;
  const ultimate = document.querySelector<HTMLButtonElement>('#ultimate-mode')!;
  ultimate.classList.toggle('on', !!s.lobby.ultimateMode); ultimate.textContent = s.lobby.ultimateMode ? '開啟' : '關閉'; ultimate.setAttribute('aria-pressed', String(!!s.lobby.ultimateMode)); ultimate.disabled = s.lobby.version !== GAME_VERSION;
  document.querySelector<HTMLElement>('#version-warning')!.hidden = s.lobby.version === GAME_VERSION;
  const duration = document.querySelector<HTMLSelectElement>('#host-duration')!; if (document.activeElement !== duration) duration.value = String(s.lobby.defaultDuration);
  document.querySelector('#rooms')!.innerHTML = s.rooms.length ? `<div class="room-grid">${s.rooms.map(roomCard).join('')}</div>` : `<div class="empty-board">${hospital()}<h3>準備迎接玩家</h3><p>讓玩家掃描左側 QR Code。<br>第一個房間出現時，戰況會自動顯示在這裡。</p></div>`;
  if (lastUrl !== s.lobby.joinUrl) {
    lastUrl = s.lobby.joinUrl; const canvas = document.querySelector<HTMLCanvasElement>('#qr')!; canvas.hidden = !lastUrl;
    document.querySelector<HTMLElement>('#qr-placeholder')!.hidden = !!lastUrl;
    const link = document.querySelector<HTMLAnchorElement>('#join-url')!;
    link.textContent = lastUrl || '公開入口暫時不可用';
    const usable = /^https?:\/\//.test(lastUrl);
    if (usable) link.href = lastUrl; else link.removeAttribute('href');
    link.setAttribute('aria-disabled', String(!usable));
    document.querySelector<HTMLButtonElement>('#copy-url')!.disabled = !lastUrl;
    if (lastUrl) void QRCode.toCanvas(canvas, lastUrl, { width: 232, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#193246', light: '#fffdf5' } });
  }
  projection();
}
document.querySelector('#rooms')!.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target) return;
  if (target.dataset.project) { selected = target.dataset.project; projection(); }
  if (target.dataset.close) { const roomId = target.dataset.close; void hostDialog.open({ title: '關閉這個房間？', message: '房內玩家將返回主選單，這場對戰會結束。', confirm: '關閉房間', cancel: '保留房間' }).then(ok => { if (ok) void action({ kind: 'close', roomId }); }); }
});
document.querySelector('#projection')!.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-exit]')) exitProjection(); });
document.addEventListener('keydown', e => {
  if (!selected || hostDialog.isOpen) return;
  if (e.key === 'Escape') exitProjection();
  if (e.key === 'Tab') { e.preventDefault(); monitorElement.querySelector<HTMLButtonElement>('[data-exit]')?.focus(); }
});
document.querySelector('#host-duration')!.addEventListener('change', e => { void action({ kind: 'duration', value: Number((e.target as HTMLSelectElement).value) }); });
document.querySelector('#accepting')!.addEventListener('click', () => { if (state) void action({ kind: 'accepting', value: !state.lobby.accepting }); });
document.querySelector('#allow-surrender')!.addEventListener('click', () => { if (state) void action({ kind: 'allow-surrender', value: !state.lobby.allowSurrender }); });
document.querySelector('#ultimate-mode')!.addEventListener('click', () => { if (state) void action({ kind: 'ultimate-mode', value: !state.lobby.ultimateMode }); });
document.querySelector('#zoom-qr')!.addEventListener('click', () => {
  if (!lastUrl || stale || stopped || rebuildPending || state?.tunnelControl?.busy || hostDialog.isOpen) return;
  qrDialog.open(lastUrl, () => error('QR Code 無法產生，請關閉後重試。'));
});
document.querySelector('#copy-url')!.addEventListener('click', () => { void navigator.clipboard.writeText(lastUrl).then(() => { const b = document.querySelector('#copy-url')!; b.textContent = '已複製！'; setTimeout(() => b.innerHTML = `${icon('copy', 16)}複製加入網址`, 1800); }).catch(() => error('請直接選取上方網址複製。')); });
document.querySelector('#rebuild-tunnel')!.addEventListener('click', () => {
  if (rebuildPending || stale || !state?.tunnelControl?.available || state.tunnelControl.busy || state.lobby.version !== GAME_VERSION) return;
  void hostDialog.open({ title: '重建公開連線？', message: '目前對戰將中止且不計勝負，所有房間與玩家連線將清除。新的 QR Code 就緒後，請所有玩家重新掃描加入。這不保證解除 Cloudflare 的請求限制。', confirm: '確認重建', cancel: '繼續目前活動' }).then(async confirmed => {
    if (!confirmed || stopped || stale || rebuildPending || !state?.tunnelControl?.available || state.tunnelControl.busy) return;
    rebuildPending = true; render(state);
    try { await action({ kind: 'rebuild-tunnel' }); }
    finally { rebuildPending = false; if (state && !stopped) render(state); }
  });
});
document.querySelector('#stop')!.addEventListener('click', () => {
  const cloud = state?.hostingMode === 'cloud';
  void hostDialog.open({ title: '結束本次活動？', message: cloud ? '全部對戰將中止且不計勝負，玩家與房間會清空。網址保留，可再次開放加入。' : '全部對戰與公開入口將關閉，下次啟動會建立全新活動。', confirm: cloud ? '結束活動' : '結束活動並停止服務', cancel: '繼續活動' }).then(async confirmed => {
    if (!confirmed || !await action({ kind: 'stop' })) return;
    qrDialog.close();
    if (cloud) return;
    stopped = true; app.innerHTML = `<div class="stopped-card">${icon('shield', 50)}<h1>活動已結束</h1><p>遊戲服務與公開通道正在關閉。<br>下次雙擊啟動檔，即可開始全新活動。</p></div>`;
  });
});
async function poll() {
  if (stopped) return;
  try { const res = await fetch('/api/host/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) }); if (res.status === 401 && location.pathname.startsWith('/host')) { location.assign('/host'); return; } if (!res.ok) throw new Error('主持憑證失效，請使用啟動器的連結重新開啟。'); const data = await res.json(); stale = false; render(data); error(''); }
  catch (e) { stale = true; qrDialog.close(); document.querySelector<HTMLButtonElement>('#zoom-qr')!.disabled = true; document.querySelector<HTMLButtonElement>('#rebuild-tunnel')!.disabled = true; monitor.connection(true); error(e instanceof TypeError || (e as Error).name === 'TimeoutError' ? '暫時無法連線至遊戲服務，請確認啟動視窗仍在執行。' : (e as Error).message); }
  setTimeout(() => void poll(), 500);
}
void poll();
