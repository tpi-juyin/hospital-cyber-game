import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { STRATEGIES, ROLE_LABEL, ULTIMATE_NAMES, combatStrategy, combatName, defenseMatches, type Action, type Role, type RoomView, type LobbyView, type SessionView, type Reply } from '../shared/protocol';
import { arena, hacker, hospital, updateHospital, icon, escape as esc } from './art';
import { BattleAudio } from './audio';
import { BattleEffects } from './effects';
import { GAME_VERSION } from '../shared/version';
import { ULTIMATE } from '../shared/balance';
import { randomName } from './names';
import './style.css';
import './arcade.css';
import { GameDialog } from './game-dialog';

const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('arcade-theme');
const surrenderDialog = new GameDialog();
let surrenderRound = '';
let menuStep: 'home' | 'loadout' | 'join' = 'home';
let session: SessionView | null = null, room: RoomView | null = null;
let lobby: LobbyView = { version: GAME_VERSION, accepting: true, allowSurrender: false, ultimateMode: false, defaultDuration: 60, online: 0, capacity: 30, joinUrl: '' };
let name = localStorage.getItem('hospital-name')?.trim() || randomName(), mode: 'solo' | 'duo' = 'solo', role: Role = 'defense', duration = 60;
localStorage.setItem('hospital-name', name);
let code = '', connected = false, connectionMessage = '連線中', lastKey = '', seq = 0, replaced = false;
let muted = localStorage.getItem('hospital-muted') === 'true';
let music = localStorage.getItem('hospital-music') !== 'false';
let reduced = localStorage.getItem('hospital-reduced') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = new BattleAudio(), effects = new BattleEffects();
let outcomeRound = '';
let cueRound = '', countdownSecond = 4, sawCountdown = false, startCuePlayed = false;
let surrenderPending = false, ultimatePending = false;
let oldUltimateUses = { attack: 0, defense: 0 };
let toastTimer: number; let oldAttacks = 0; let oldBlocks = 0; let oldDefenseTaps = 0; let qrKey = '';
const invite = new URL(location.href).searchParams.get('room');
let pendingInvite = invite;
if (pendingInvite) menuStep = 'join';
let hostingReset = false, activityEnded = false;
let invitePending = false;
let startPending = false;
const socket = io({ transports: ['websocket'], auth: { token: localStorage.getItem('hospital-token') || undefined }, autoConnect: false });

function toast(text: string) {
  document.querySelector('#toast')?.remove(); const el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.textContent = text; document.body.append(el);
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.remove(), 3500);
}
function syncAudio() {
  audio.configure({ effects: !muted, music, battle: connected && room?.phase === 'playing', urgent: connected && room?.phase === 'playing' && room.remainingMs > 0 && room.remainingMs <= 10_000, countdown: connected && room?.phase === 'countdown', result: connected && room?.phase === 'ended' && !!room.winner, visible: !document.hidden });
}
// Touch receives browser activation on release; an earlier resume can remain pending.
document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') void audio.unlock(); }, { capture: true, passive: true });
document.addEventListener('pointerup', () => { void audio.unlock(); }, { capture: true, passive: true });
document.addEventListener('click', () => { void audio.unlock(); }, { capture: true });
document.addEventListener('keydown', e => { if (!e.repeat) void audio.unlock(); }, { capture: true });
document.addEventListener('visibilitychange', syncAudio);
window.addEventListener('pagehide', () => { audio.configure({ effects: !muted, music, battle: false, visible: false }); effects.clear(); });
window.addEventListener('pageshow', syncAudio);
function send(action: Action): Promise<boolean> {
  if (!connected) { toast('請等待重新連線。'); return Promise.resolve(false); }
  return new Promise(resolve => socket.timeout(5000).emit('action', action, (error: Error | null, reply: Reply) => { if (error || !reply?.ok) { toast(error ? '連線稍慢，請稍候再試。' : reply.message || '操作失敗。'); resolve(false); } else resolve(true); }));
}
function audioButton(id: string, enabled: boolean, label: string, glyph: string) {
  return `<button class="icon-button ${enabled ? 'audio-on' : ''}" id="${id}" aria-pressed="${enabled}" aria-label="${enabled ? '關閉' : '開啟'}${label}" title="${label}">${icon(glyph, 19)}${enabled ? '' : '<span class="audio-off-line" aria-hidden="true"></span>'}</button>`;
}
function prefButtons() { return `<div class="preferences">${audioButton('sound', !muted, '音效', 'sound')}${audioButton('music', music, '戰鬥音樂', 'music')}<button class="motion-button" id="motion" aria-pressed="${reduced}">${reduced ? '動畫：少' : '動畫：開'}</button></div>`; }
function shell(content: string, battle = false, screenOverride?: 'loadout') {
  effects.clear();
  const screen = screenOverride || (room ? battle ? 'battle' : room.phase === 'waiting' ? 'waiting' : 'result' : menuStep);
  app.innerHTML = `<main class="player-shell screen-${screen} ${battle ? 'battle-shell' : ''}"><header class="topbar"><a class="brand" href="/" aria-label="醫院資安攻防戰首頁">${icon('shield', 25)}<span class="brand-wordmark">CYBER<span class="brand-light"> CARE</span><small class="version-label" aria-label="遊戲版本 ${GAME_VERSION}">v${GAME_VERSION}</small></span></a>${prefButtons()}</header><div class="connection ${connected ? '' : 'offline'}" role="status"><span></span><b id="connection-label">${esc(connectionMessage)}</b></div>${content}<footer class="page-footer">醫院資安攻防戰 <span>•</span> 學會防護，一起守住醫療服務</footer></main>`;
  document.body.classList.toggle('reduced-motion', reduced);
  document.querySelector('#sound')?.addEventListener('click', () => { muted = !muted; localStorage.setItem('hospital-muted', String(muted)); syncAudio(); if (!muted) void audio.unlock(); render(true); });
  document.querySelector('#music')?.addEventListener('click', () => { music = !music; localStorage.setItem('hospital-music', String(music)); syncAudio(); if (music) void audio.unlock(); render(true); });
  document.querySelector('#motion')?.addEventListener('click', () => { reduced = !reduced; localStorage.setItem('hospital-reduced', String(reduced)); render(true); });
}
function bind(id: string, fn: () => void) { document.getElementById(id)?.addEventListener('click', fn); }
function roleCards(selected: Role) { return `<div class="role-cards"><button class="role-card attack ${selected === 'attack' ? 'selected' : ''}" data-role="attack" aria-pressed="${selected === 'attack'}"><span class="role-art">${hacker()}</span><b>我要進攻</b><small>限時攻下醫院主機</small><i>${icon('key', 17)}</i></button><button class="role-card defense ${selected === 'defense' ? 'selected' : ''}" data-role="defense" aria-pressed="${selected === 'defense'}"><span class="role-art">${hospital()}</span><b>我要防守</b><small>守住每一秒醫療服務</small><i>${icon('shield', 17)}</i></button></div>`; }
function durationInput(value: number, disabled = false) { return `<div class="duration-row"><label for="duration">${icon('clock', 17)}對戰時間</label><strong><span id="duration-value">${value}</span><small> 秒</small></strong></div><input class="range" id="duration" type="range" min="30" max="120" step="5" value="${value}" ${disabled ? 'disabled' : ''}><div class="range-labels"><span>30 秒</span><span>2 分鐘</span></div>`; }
function lobbyScreen(soloRoom?: RoomView) {
  if (soloRoom) {
    menuStep = 'loadout'; mode = 'solo'; duration = soloRoom.duration;
    role = soloRoom.members.find(m => m.id === session?.id)!.role;
  }
  if (menuStep === 'home') {
    shell(`<section class="title-screen"><span class="season-stamp">CYBER CARE // ARCADE</span><h1 class="game-logo">醫院資安<strong>攻防戰<span>✦</span></strong></h1><div class="title-stage">${arena()}</div><p class="title-tag">連點出招 · 大招反制 · 守住最後一秒</p></section><nav class="game-menu" aria-label="遊戲模式"><button id="menu-solo" class="game-mode solo">${icon('cpu', 28)}<span>單人挑戰<small>SOLO / VS 電腦</small></span>${icon('arrow', 23)}</button><button id="menu-duo" class="game-mode duo">${icon('users', 28)}<span>雙人對決<small>VERSUS / 找朋友 PK</small></span>${icon('arrow', 23)}</button><button id="menu-join" class="party-button">${icon('key', 18)}${pendingInvite ? '收到好友邀請 · 點此入場' : '輸入房號，加入朋友'}<span>JOIN</span></button></nav><div class="menu-status"><span>免註冊 · 30–120 秒</span><span><b id="online">${lobby.online}</b> 人在線</span></div>${!connected ? '<button class="retry-button" id="retry">重新連線</button>' : ''}`);
    bind('menu-solo', () => { mode = 'solo'; menuStep = 'loadout'; render(true); });
    bind('menu-duo', () => { mode = 'duo'; menuStep = 'loadout'; render(true); });
    bind('menu-join', () => { menuStep = 'join'; render(true); });
    bind('retry', () => { replaced = false; socket.connect(); });
    return;
  }
  shell(`<header class="selection-heading"><button class="menu-back" id="menu-back" aria-label="返回主選單">←</button><div><span class="eyebrow">${menuStep === 'join' ? 'JOIN THE BATTLE' : mode === 'solo' ? 'CHOOSE YOUR SIDE' : 'CREATE YOUR ARENA'}</span><h1>${menuStep === 'join' ? '好友集結' : mode === 'solo' ? '選擇你的角色' : '開房，邀請對手！'}</h1></div></header>
  <section class="setup-card"><label class="field-label" for="nickname">你的作戰代號</label><div class="nickname-row"><input id="nickname" class="text-input" maxlength="16" autocomplete="nickname" placeholder="輸入自己的代號" value="${esc(name)}"><button id="random-name" class="dice-button" type="button" aria-label="骰子隨機命名" title="隨機換個代號">${icon('dice', 24)}</button></div><p class="nickname-hint">直接使用，或擲骰子換個代號。</p>${soloRoom ? '' : `<div class="mode-tabs" role="group" aria-label="遊戲模式"><button id="solo" class="${mode === 'solo' ? 'selected' : ''}">${icon('cpu', 20)}單人挑戰<small>VS 電腦</small></button><button id="duo" class="${mode === 'duo' ? 'selected' : ''}">${icon('users', 20)}雙人對戰<small>找朋友 PK</small></button></div>`}${mode === 'solo' ? `<div class="section-label"><span>選擇你的陣營</span><small>選好就能出發</small></div>${roleCards(role)}` : '<p class="duo-setup-hint">先建立房間，再和朋友自由選角。<br>一攻一守、雙方準備，就能開戰！</p>'}<div class="duration-box">${durationInput(duration)}</div><button id="create" class="primary-button" ${!connected || startPending || (!soloRoom && !lobby.accepting) ? 'disabled' : ''}>${mode === 'solo' ? '出發！挑戰電腦' : '建立雙人房間'} ${icon('arrow', 21)}</button>${pendingInvite ? `<p class="invite-intro">好友邀請已就緒，選好代號就能入場！</p><button class="primary-button invite-button" id="invite" ${!connected || !lobby.accepting || invitePending ? 'disabled' : ''}>${invitePending ? '正在加入…' : '點此加入'} ${icon('arrow', 21)}</button>` : `<div class="divider"><span>朋友已經開好房間？</span></div><form id="join-form" class="join-form"><input id="room-code" class="text-input code-input" inputmode="numeric" pattern="[1-9][0-9]{3}" maxlength="4" placeholder="4 位房號" aria-label="四位數房號" value="${esc(code)}"><button class="secondary-button" ${!connected || !lobby.accepting ? 'disabled' : ''}>加入</button></form>`}<p class="micro-copy">免註冊・每局 30～120 秒・目前 <b id="online">${lobby.online}</b> 人在線</p></section><p class="simulation-note">這是一場模擬演練。遊戲中的攻擊不會影響真實醫院系統。</p>${!connected ? '<button class="retry-button" id="retry">重新連線</button>' : ''}`, false, soloRoom ? 'loadout' : undefined);
  bind('menu-back', () => { if (soloRoom) void send({ kind: 'leave' }); else { menuStep = 'home'; render(true); } });
  const nick = document.querySelector<HTMLInputElement>('#nickname')!;
  nick.addEventListener('input', () => { name = nick.value; localStorage.setItem('hospital-name', name); });
  bind('random-name', () => { name = randomName(name); nick.value = name; localStorage.setItem('hospital-name', name); toast(`你的新代號：${name}`); });
  bind('solo', () => { mode = 'solo'; render(true); }); bind('duo', () => { mode = 'duo'; render(true); });
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(b => b.addEventListener('click', () => { if (soloRoom) void send({ kind: 'role', role: b.dataset.role as Role }); else { role = b.dataset.role as Role; render(true); } }));
  document.querySelector<HTMLInputElement>('#duration')!.addEventListener('input', e => { duration = Number((e.target as HTMLInputElement).value); document.querySelector('#duration-value')!.textContent = String(duration); });
  if (soloRoom) document.querySelector<HTMLInputElement>('#duration')!.addEventListener('change', () => { void send({ kind: 'duration', duration }); });
  const setName = async () => { if (!name.trim()) { nick.focus(); toast('先取個作戰代號吧！'); return false; } return send({ kind: 'name', name }); };
  bind('create', () => { void (async () => {
    if (startPending) return;
    if (!name.trim()) { nick.focus(); toast('先取個作戰代號吧！'); return; }
    const b = document.querySelector<HTMLButtonElement>('#create')!, selectedDuration = Number(document.querySelector<HTMLInputElement>('#duration')!.value), selectedMode = mode, selectedRole = role;
    startPending = true; b.disabled = true;
    try {
      if (await setName()) {
        if (soloRoom) { if (await send({ kind: 'duration', duration: selectedDuration })) await send({ kind: 'ready', ready: true }); }
        else await send({ kind: 'create', mode: selectedMode, role: selectedMode === 'solo' ? selectedRole : 'attack', duration: selectedDuration, startImmediately: selectedMode === 'solo' });
      }
    } finally { startPending = false; render(true); }
  })(); });
  document.querySelector('#join-form')?.addEventListener('submit', e => { e.preventDefault(); void (async () => { if (await setName()) await send({ kind: 'join', code }); })(); });
  document.querySelector<HTMLInputElement>('#room-code')?.addEventListener('input', e => { const el = e.target as HTMLInputElement; el.value = el.value.replace(/[^0-9]/g, '').slice(0, 4); code = el.value; });
  bind('invite', () => { void (async () => {
    if (invitePending || !pendingInvite || !connected || !lobby.accepting) return;
    if (!name.trim()) { nick.focus(); toast('先取個作戰代號吧！'); return; }
    const target = pendingInvite; invitePending = true;
    const button = document.querySelector<HTMLButtonElement>('#invite')!; button.disabled = true; button.textContent = '正在加入…';
    try {
      if (await setName() && await send({ kind: 'join', roomId: target })) { pendingInvite = null; history.replaceState(null, '', '/'); }
    } finally { invitePending = false; render(true); }
  })(); });
  bind('retry', () => { replaced = false; socket.connect(); });
}
function waitScreen(r: RoomView) {
  const me = r.members.find(m => m.id === session?.id)!; if (!me) return;
  role = me.role; const owner = r.ownerId === me.id;
  const conflict = r.members.length === 2 && r.members[0].role === r.members[1].role;
  const link = `${lobby.joinUrl || location.origin}/?room=${encodeURIComponent(r.id)}`;
  const seats = [...r.members, ...Array.from({ length: 2 - r.members.length }, () => null)];
  shell(`<section class="room-header"><span class="eyebrow">${r.mode === 'solo' ? 'SOLO CHALLENGE' : 'FRIEND BATTLE'}</span><h1>選好角色，準備開戰！</h1></section>
    <section class="waiting-card">${r.mode === 'duo' ? `<div class="room-share"><div><span class="room-code-label">房號</span><b class="big-room-code">${r.code}</b></div><button class="secondary-button small" id="copy-link">${icon('copy', 16)}邀請朋友</button></div><details class="room-qr-details"><summary>顯示房間 QR Code</summary><div class="invite-tools"><canvas id="room-qr" aria-label="加入此房間的 QR Code"></canvas><p>請朋友掃描，直接加入此房間。</p></div></details>` : ''}
    <div class="member-list player-seats">${seats.map(m => `<div class="member ${m?.role || 'empty'}"><span class="member-icon">${icon(m?.role === 'attack' ? 'key' : 'shield', 18)}</span><div><small>${m ? ROLE_LABEL[m.role] : '等待對手'}</small><b>${m ? esc(m.name) + (m.id === me.id ? '（你）' : '') : '等待朋友加入…'}</b><span class="ready-badge ${m?.ready ? 'is-ready' : ''}">${m ? !m.connected ? '離線' : m.ready ? '已準備' : '選角中' : '空位'}</span></div></div>`).join('')}</div>
    <div class="room-role-selection"><div class="section-label"><span>選擇你的陣營</span><small>換角會取消雙方準備</small></div>${roleCards(me.role)}</div>
    <p id="role-hint" class="role-hint ${conflict ? 'is-conflict' : ''}" role="status">${conflict ? '⚠ 選到同一邊了！請其中一位換邊。' : r.members.length < 2 ? '邀請朋友加入，一攻一守就能開戰。' : '一攻一守就定位！雙方準備即可開戰。'}</p>
    <div class="duration-box">${durationInput(r.duration, !owner)}</div><p class="mode-description">${r.ultimateMode ? '大招模式 · 連點集氣，手動施放 5 秒大招。' : '一般模式 · 觀察招式，選對防護。'}${owner ? '' : ' 局長由房主設定。'}</p>
    <button class="primary-button ${me.ready ? 'ready-button' : ''}" id="ready" ${conflict || !connected ? 'disabled' : ''}>${conflict ? '請先選擇不同陣營' : me.ready ? '已準備，等待對手…' : '我準備好了！'} ${icon('arrow', 20)}</button><button class="text-button leave-button" id="leave">離開房間</button></section>`);
  bind('ready', () => { void send({ kind: 'ready', ready: !me.ready }); }); bind('leave', () => { void send({ kind: 'leave' }); });
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(b => b.addEventListener('click', () => { void send({ kind: 'role', role: b.dataset.role as Role }); }));
  const range = document.querySelector<HTMLInputElement>('#duration')!;
  range.addEventListener('input', () => { document.querySelector('#duration-value')!.textContent = range.value; });
  range.addEventListener('change', () => { void send({ kind: 'duration', duration: Number(range.value) }); });
  bind('copy-link', () => { void navigator.clipboard?.writeText(link).then(() => toast('加入連結已複製！')).catch(() => toast(link)); });
  const canvas = document.querySelector<HTMLCanvasElement>('#room-qr'); if (canvas) void QRCode.toCanvas(canvas, link, { width: 112, margin: 1, color: { dark: '#193246', light: '#fffdf4' } });
}
function ultimateButton() {
  return `<div class="ultimate-panel ${role}"><div id="ultimate-meter" class="ultimate-meter" role="progressbar" aria-label="${ULTIMATE_NAMES[role]}集氣" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ultimate-charge" aria-hidden="true"></i><span>${icon(role === 'attack' ? 'bolt' : 'shield', 18)}<b>${ULTIMATE_NAMES[role]}</b><small id="ultimate-charge-label">連點集氣 0%</small></span></div><button class="ultimate-button ${role}" id="ultimate" hidden disabled aria-pressed="false">${icon(role === 'attack' ? 'bolt' : 'shield', 20)}<b>${ULTIMATE_NAMES[role]}</b><span id="ultimate-action-label">點我開大！</span><i class="ultimate-charge" aria-hidden="true"></i></button></div>`;
}
async function releaseUltimate() {
  const me = room?.members.find(m => m.id === session?.id);
  if (ultimatePending || !connected || !room?.ultimateMode || room.phase !== 'playing' || !me || me.ultimate.charge < 100 || me.ultimate.remainingMs > 0 || me.ultimate.uses >= ULTIMATE.maxUses) return;
  ultimatePending = true; updateBattle(room);
  try { await send({ kind: 'ultimate', roundId: room.roundId, seq: ++seq }); }
  finally { ultimatePending = false; if (room && document.querySelector('#tap')) updateBattle(room); }
}
function battleScreen(r: RoomView) {
  const me = r.members.find(m => m.id === session?.id)!; if (!me) return; role = me.role; oldAttacks = r.attacks; oldBlocks = r.blocks;
  oldDefenseTaps = r.members.find(m => m.role === 'defense')?.stats.taps || 0;
  ultimatePending = false;
  oldUltimateUses = { attack: r.members.find(m => m.role === 'attack')?.ultimate?.uses || 0, defense: r.members.find(m => m.role === 'defense')?.ultimate?.uses || 0 };
  shell(`<section class="battle-top"><div><span class="eyebrow">${r.mode === 'solo' ? '單人挑戰' : `房間 ${r.code}`} ${r.ultimateMode ? '· 大招模式' : ''}</span><h1 class="side-title ${role}">${ROLE_LABEL[role]}</h1></div><div class="timer" id="timer">${icon('clock', 20)}<b id="remaining">60</b><small>秒</small></div></section><div class="battle-objective"><span>${role === 'attack' ? '突破護盾，在倒數結束前攻下主機！' : '強化護盾，讓醫療服務撐到最後！'}</span><button id="surrender" class="surrender-button" hidden>投降</button></div><section class="health-card"><div class="meter-label"><span>${icon('heart', 16)}醫院血量</span><b id="hp-text">100 / 100</b></div><div class="meter hp"><i id="hp-bar"></i></div><div class="meter-label shield-label"><span>${icon('shield', 16)}防護盾</span><b id="shield-text">30 / 30</b></div><div class="meter shield"><i id="shield-bar"></i></div></section><section class="battle-arena">${arena(r.hp)}<div class="battle-effects" aria-hidden="true"><div class="effect-lane attack-effects" data-effects="attack"></div><div class="effect-lane defense-effects" data-effects="defense"></div></div><div class="versus-names"><span>${esc(r.members.find(m => m.role === 'attack')?.name || '')}</span><span>${esc(r.members.find(m => m.role === 'defense')?.name || '')}</span></div></section><div class="intel-strip"><span>攻擊：<b id="attack-type"></b></span><span>防護：<b id="defense-type"></b></span></div><section class="controls">${r.ultimateMode ? ultimateButton() : ''}<div class="section-label"><b>${role === 'attack' ? '選擇攻擊招式' : '選擇防護重點'}</b><span class="match-hint" id="match-hint"></span></div><div class="strategy-grid">${STRATEGIES.map((s, i) => `<button class="strategy-button ${role}" data-strategy="${i}">${icon(s.icon, 24)}<b>${s[role]}</b><small class="cooldown-text">點選切換</small></button>`).join('')}</div><button class="tap-button ${role}" id="tap">${icon(role === 'attack' ? 'bolt' : 'shield', 30)}<span>${role === 'attack' ? '發動攻擊' : '強化防護'}<small>連續點擊，每秒最多 6 次</small></span><span class="tap-spark">✦</span></button><div class="tap-counter">有效連點 <b id="tap-count">0</b><span id="ultimate-status">策略切換冷卻 3 秒</span></div></section><div id="overlay" class="game-overlay" hidden></div>`, true);
  document.querySelectorAll<HTMLButtonElement>('[data-strategy]').forEach(b => b.addEventListener('click', () => {
    if (!connected || room?.phase !== 'playing') return;
    socket.volatile.emit('action', { kind: 'strategy', strategy: Number(b.dataset.strategy), roundId: room.roundId, seq: ++seq }, (reply: Reply) => { if (!reply.ok && reply.code !== 'COOLDOWN') toast(reply.message || '無法切換。'); });
  }));
  bind('surrender', () => { void surrender(); });
  bind('ultimate', () => { void releaseUltimate(); });
  const tap = document.querySelector<HTMLButtonElement>('#tap')!;
  const press = () => {
    if (!connected || room?.phase !== 'playing') return;
    socket.volatile.emit('action', { kind: 'tap', roundId: room.roundId, seq: ++seq });
    const strategy = combatStrategy(room.members.find(m => m.id === session?.id)!);
    audio.action(role, strategy); effects.play(document.querySelector('.battle-arena'), role, strategy);
    tap.classList.remove('pressed'); void tap.offsetWidth; tap.classList.add('pressed'); setTimeout(() => tap.classList.remove('pressed'), 100);
  };
  tap.addEventListener('pointerdown', e => { if (e.isPrimary && e.button === 0) { e.preventDefault(); press(); } });
  tap.addEventListener('click', e => { if (e.detail === 0) press(); });
  updateBattle(r);
}
async function surrender() {
  if (surrenderPending || !connected || !lobby.allowSurrender || room?.phase !== 'playing') return;
  const roundId = room.roundId;
  if (surrenderDialog.isOpen) return;
  surrenderRound = roundId;
  const confirmed = await surrenderDialog.open({ title: '要撤離戰場嗎？', message: '對戰仍在進行。確認投降後，本局由對方獲勝。', confirm: '確認投降', cancel: '繼續戰鬥', tone: role });
  if (!confirmed || !connected || !lobby.allowSurrender || room?.phase !== 'playing' || room.roundId !== roundId) return;
  surrenderPending = true;
  updateBattle(room);
  try { await send({ kind: 'surrender', roundId, seq: ++seq }); }
  finally { surrenderPending = false; if (room) updateBattle(room); }
}
function updateBattle(r: RoomView) {
  const me = r.members.find(m => m.id === session?.id); if (!me) return;
  const attack = r.members.find(m => m.role === 'attack')!, defense = r.members.find(m => m.role === 'defense')!;
  const set = (id: string, value: string) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('remaining', String(Math.ceil(r.remainingMs / 1000))); set('hp-text', `${Math.ceil(r.hp)} / 100`); set('shield-text', `${Math.ceil(r.shield)} / 30`); set('tap-count', String(me.stats.taps));
  set('attack-type', combatName(attack)); set('defense-type', combatName(defense));
  const matched = defenseMatches(attack, defense);
  const attackUltimate = combatStrategy(attack) === 3, defenseUltimate = combatStrategy(defense) === 3, mine = me.ultimate || { charge: 0, remainingMs: 0, uses: 0 }, active = mine.remainingMs > 0;
  set('match-hint', defenseUltimate ? '大招防護中 ✓' : attackUltimate ? '⚠ 大招來襲！' : matched ? '防護對應 ✓' : '⚠ 防護未對應');
  const matchHint = document.querySelector('#match-hint');
  matchHint?.classList.toggle('is-matched', matched); matchHint?.classList.toggle('is-mismatched', !matched);
  const hp = document.querySelector<HTMLElement>('#hp-bar'), shield = document.querySelector<HTMLElement>('#shield-bar');
  if (hp) hp.style.width = `${r.hp}%`; if (shield) shield.style.width = `${r.shield / 30 * 100}%`;
  document.querySelector('#timer')?.classList.toggle('urgent', r.remainingMs <= 10_000 && r.phase === 'playing');
  document.querySelector('.health-card')?.classList.toggle('critical', r.hp <= 25);
  document.querySelectorAll<HTMLButtonElement>('[data-strategy]').forEach(b => { const selected = !active && Number(b.dataset.strategy) === me.strategy; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); b.disabled = !connected || r.phase !== 'playing' || active || (!selected && me.cooldownMs > 0); b.querySelector('.cooldown-text')!.textContent = active ? '大招結束恢復' : selected ? '使用中' : me.cooldownMs > 0 ? `${(me.cooldownMs / 1000).toFixed(1)} 秒` : '點選切換'; });
  const ultimate = document.querySelector<HTMLButtonElement>('#ultimate');
  if (ultimate) {
    const ready = mine.charge >= 100 && mine.uses < ULTIMATE.maxUses;
    const spent = mine.uses >= ULTIMATE.maxUses;
    const meter = document.querySelector<HTMLElement>('#ultimate-meter')!;
    ultimate.hidden = !ready && !active; meter.hidden = ready || active;
    meter.classList.toggle('spent', spent);
    meter.setAttribute('aria-valuenow', String(mine.charge));
    meter.setAttribute('aria-valuetext', spent ? '本局大招已用完' : `集氣 ${Math.floor(mine.charge)}%`);
    meter.querySelector<HTMLElement>('.ultimate-charge')!.style.width = `${mine.charge}%`;
    ultimate.disabled = !connected || r.phase !== 'playing' || !ready || active || ultimatePending;
    ultimate.classList.toggle('charged', ready); ultimate.classList.toggle('active', active);
    ultimate.classList.toggle('counter-alert', role === 'defense' && attackUltimate && ready && connected && r.phase === 'playing');
    ultimate.setAttribute('aria-pressed', String(active));
    const label = active ? `剩 ${(mine.remainingMs / 1000).toFixed(1)} 秒` : mine.uses >= ULTIMATE.maxUses ? '本局已用完' : ready ? '點我開大！' : `集氣 ${Math.floor(mine.charge)}%`;
    set('ultimate-charge-label', spent ? '本局已用完' : `連點集氣 ${Math.floor(mine.charge)}%`); set('ultimate-action-label', label); ultimate.setAttribute('aria-label', `${ULTIMATE_NAMES[role]}，${label}`);
    const bar = ultimate.querySelector<HTMLElement>('.ultimate-charge')!;
    bar.style.width = `${active ? mine.remainingMs / ULTIMATE.durationMs * 100 : mine.charge}%`;
    set('ultimate-status', active ? '繼續連點！大招結束自動恢復' : mine.uses >= ULTIMATE.maxUses ? '本局大招已用完 · 繼續連點' : `大招剩 ${ULTIMATE.maxUses - mine.uses} 次 · 換招冷卻 3 秒`);
  }
  const tap = document.querySelector<HTMLButtonElement>('#tap'); if (tap) { tap.disabled = !connected || r.phase !== 'playing'; tap.classList.toggle('ultimate-tap', active); }

  const surrenderButton = document.querySelector<HTMLButtonElement>('#surrender');
  if (surrenderButton) { surrenderButton.hidden = !lobby.allowSurrender || r.phase !== 'playing'; surrenderButton.disabled = !connected || surrenderPending; }
  const stage = document.querySelector<HTMLElement>('.battle-arena');
  if (stage) { updateHospital(stage, r.hp); stage.classList.toggle('overdrive-attack', attackUltimate); stage.classList.toggle('overdrive-defense', defenseUltimate); }
  if (connected && r.phase === 'playing' && !document.hidden) {
    for (const member of [attack, defense]) if ((member.ultimate?.uses || 0) > oldUltimateUses[member.role] && combatStrategy(member) === 3) { audio.action(member.role, 3, member.id !== me.id); effects.play(stage, member.role, 3); }
    if (r.attacks > oldAttacks) {
      stage?.classList.remove('hit', 'blocked'); void stage?.offsetWidth; stage?.classList.add(r.blocks > oldBlocks ? 'blocked' : 'hit');
      if (me.role !== 'attack') { audio.action('attack', combatStrategy(attack), true); effects.play(stage, 'attack', combatStrategy(attack)); }
    }
    if (defense.stats.taps > oldDefenseTaps && me.role !== 'defense') { audio.action('defense', combatStrategy(defense), true); effects.play(stage, 'defense', combatStrategy(defense)); }
  }
  oldAttacks = r.attacks; oldBlocks = r.blocks; oldDefenseTaps = defense.stats.taps;
  oldUltimateUses = { attack: attack.ultimate?.uses || 0, defense: defense.ultimate?.uses || 0 };
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (overlay) {
    const key = !connected ? 'disconnect' : r.phase;
    overlay.hidden = connected && r.phase === 'playing';
    if (key === 'countdown') overlay.innerHTML = `<div class="countdown-card"><span>準備開戰</span><b>${Math.ceil(r.remainingMs / 1000)}</b><p>${role === 'attack' ? '觀察防護，找出突破口。' : '看清攻擊，選對防護。'}</p></div>`;
    else if (key === 'paused' || key === 'disconnect') overlay.innerHTML = `<div class="countdown-card"><span>暫停一下</span>${icon('users', 50)}<h2>等待重新連線</h2><p>${connected ? `保留對局 ${Math.ceil(r.reconnectMs / 1000)} 秒` : '網路恢復後自動回到戰場。'}</p></div>`;
  }
}
function resultScreen(r: RoomView) {
  const me = r.members.find(m => m.id === session?.id)!; if (!me) return;
  const win = r.winner === me.role; const defender = r.members.find(m => m.role === 'defense');
  shell(`<section class="result-hero ${win ? 'won' : r.winner ? 'lost' : 'neutral'} ${me.role}"><div class="result-medal">${icon(r.winner ? 'trophy' : 'users', 52)}</div><span class="eyebrow">${r.winner ? win ? 'VICTORY' : 'DEFEAT' : 'NO CONTEST'}</span><h1>${r.winner ? win ? me.role === 'attack' ? '入侵成功！' : '守護成功！' : me.role === 'attack' ? '入侵失敗' : '防線失守' : '任務中止'}</h1><p>${esc(r.reason)}</p><div class="result-character" role="img" aria-label="${me.role === 'attack' ? '駭客' : '醫院守護者'}${r.winner ? win ? '勝利' : '戰敗' : '中止對戰'}">${me.role === 'attack' ? hacker(r.winner ? win ? 'win' : 'loss' : 'neutral') : hospital(r.hp)}</div></section><section class="result-card"><div class="result-stats"><div><strong>${me.stats.taps}</strong><span>你的有效連點</span></div><div><strong>${Math.ceil(r.hp)}<small>%</small></strong><span>醫院剩餘血量</span></div><div><strong>${defender?.stats.hits ? Math.round(defender.stats.matchedHits / defender.stats.hits * 100) : 0}<small>%</small></strong><span>防護對應率</span></div></div><button class="primary-button" id="rematch">再挑戰一局 ${icon('arrow', 20)}</button><button class="text-button leave-button" id="leave">返回大廳</button><details class="learning" open><summary>收集本局資安情報 × ${r.lessons.length}</summary><div>${r.lessons.map((t, i) => `<p><span class="lesson-number">0${i + 1}</span>${esc(t)}</p>`).join('')}<small>真實防護需要多層措施；切換策略代表加強重點，不是關閉其他防護。</small></div></details></section>`);
  bind('rematch', () => { void send({ kind: 'rematch' }); }); bind('leave', () => { void send({ kind: 'leave' }); });
}
function render(force = false) {
  syncAudio();
  if (hostingReset) {
    surrenderDialog.close();
    if (activityEnded) { shell(`<section class="stopped-card"><h1>活動已結束</h1><p>目前對局已中止，不計勝負。<br>請等待主持人開放下一場活動。</p><a class="primary-button" href="/">重新加入</a></section>`); return; }
    shell(`<section class="stopped-card"><h1>公開連線重新建立中</h1><p>目前對局已中止，不計勝負。<br>請等待主持台顯示新的 QR Code，再掃描加入。</p></section>`);
    return;
  }
  if (surrenderDialog.isOpen && (!connected || !lobby.allowSurrender || room?.phase !== 'playing' || room.roundId !== surrenderRound)) surrenderDialog.close();
  if (room && room.roundId !== cueRound) { cueRound = room.roundId; countdownSecond = 4; sawCountdown = false; startCuePlayed = false; }
  if (connected && room?.phase === 'countdown') {
    sawCountdown = true;
    const second = Math.ceil(room.remainingMs / 1000);
    if (second >= 1 && second <= 3 && second !== countdownSecond) { countdownSecond = second; audio.countdown(second); }
  }
  if (connected && room?.phase === 'playing' && sawCountdown && !startCuePlayed) { startCuePlayed = true; audio.countdown(0); }
  if (connected && room?.phase === 'ended' && room.winner && room.roundId !== outcomeRound) {
    const me = room.members.find(m => m.id === session?.id);
    if (me) { outcomeRound = room.roundId; audio.outcome(room.winner === me.role); }
  }
  const screen = room ? ['playing', 'countdown', 'paused'].includes(room.phase) ? 'battle' : room.phase : 'lobby';
  if (screen === 'waiting' && room?.mode === 'solo') menuStep = 'loadout';
  const key = JSON.stringify([screen, menuStep, room?.id, screen !== 'battle' ? room?.members.map(m => [m.id, m.role, m.ready, m.connected, m.name]) : room?.roundId, screen !== 'battle' ? room?.duration : '', room?.ultimateMode, connected, !room ? lobby.accepting : '', room?.winner]);
  if (force || key !== lastKey) { lastKey = key; qrKey = ''; if (!room) lobbyScreen(); else if (screen === 'waiting') { if (room.mode === 'solo') lobbyScreen(room); else waitScreen(room); } else if (screen === 'ended') resultScreen(room); else battleScreen(room); }
  if (room && screen === 'battle') updateBattle(room);
  const label = document.querySelector('#connection-label'); if (label) label.textContent = connectionMessage;
  const online = document.querySelector('#online'); if (online) online.textContent = String(lobby.online);
  if (room?.phase === 'waiting' && room.mode === 'duo' && qrKey !== lobby.joinUrl) { qrKey = lobby.joinUrl; const canvas = document.querySelector<HTMLCanvasElement>('#room-qr'); if (canvas) void QRCode.toCanvas(canvas, `${lobby.joinUrl || location.origin}/?room=${room.id}`, { width: 112, margin: 1, color: { dark: '#193246', light: '#fffdf4' } }); }
}
socket.on('connect', () => { connected = true; connectionMessage = '已連線，準備出發'; render(); });
socket.on('session', (s: SessionView) => { session = s; seq = s.lastSeq; localStorage.setItem('hospital-token', s.token); socket.auth = { token: s.token }; if (s.name !== '新玩家') name = s.name; });
socket.on('room', (r: RoomView | null) => { const prior = room; room = r; if (prior && !r) { menuStep = 'home'; toast('已返回主選單。'); } render(); });
socket.on('lobby', (l: LobbyView) => { if (lobby.defaultDuration !== l.defaultDuration) duration = l.defaultDuration; lobby = l; render(); });
socket.on('disconnect', () => { connected = false; connectionMessage = replaced ? '已在另一個分頁開啟' : '連線中斷，正在重連'; render(); });
socket.on('hosting-reset', (notice?: { reason?: string }) => { activityEnded = notice?.reason === 'activity-ended'; hostingReset = true; connected = false; room = null; session = null; localStorage.removeItem('hospital-token'); socket.disconnect(); connectionMessage = '請重新掃描加入'; render(true); });
socket.on('replaced', () => { replaced = true; socket.disconnect(); toast('遊戲已在另一分頁開啟，此分頁暫停操作。'); });
socket.on('connect_error', (e: Error & { data?: { code: string } }) => {
  connected = false;
  if (e.data?.code === 'SESSION_EXPIRED') { localStorage.removeItem('hospital-token'); socket.auth = {}; session = null; room = null; socket.connect(); }
  else { connectionMessage = e.data ? e.message : '正在連線，請確認活動仍在進行'; render(true); }
});
socket.connect(); render();
