import { mkdtemp, rename, readFile, access, rm, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const publicTest = process.argv.includes('--public');
const root = process.cwd(); const source = resolve('release/hospital-cyber-game-macos-arm64');
const temp = await mkdtemp(join(tmpdir(), '醫院 遊戲 ')); const destination = join(temp, '主持 包');
execFileSync('unzip', ['-q', source + '.zip', '-d', temp]);
await rename(join(temp, basename(source)), destination);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let child, socket, combined = '';
async function poll(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(150); } throw new Error('Smoke test timed out. ' + combined.slice(-1200).replace(/key=[^\s]+/g, 'key=REDACTED')); }
try {
  child = spawn(join(destination, 'runtime/node'), [join(destination, 'scripts/launch.mjs'), '--no-open', ...(publicTest ? [] : ['--local-only'])], { cwd: '/private/tmp', env: { ...process.env, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => combined += b.toString()); child.stderr.on('data', b => combined += b.toString());
  const metaPath = join(destination, '.runtime/instance.json');
  const meta = await poll(async () => { try { return JSON.parse(await readFile(metaPath, 'utf8')); } catch { return null; } });
  const hostOrigin = new URL(meta.hostUrl).origin; const login = await fetch(meta.hostUrl, { redirect: 'manual' }); assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const version = JSON.parse(await readFile(join(destination, 'VERSION.json'), 'utf8')).game;
  const hostPage = await fetch(hostOrigin, { headers: { Cookie: cookie } }); assert.equal(hostPage.status, 200);
  const hostHtml = await hostPage.text(); let monitorStyles = false;
  const hostAssets = [...hostHtml.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:css|js))"/g)];
  assert.ok(hostAssets.length >= 2);
  for (const [, path] of hostAssets) {
    const asset = await fetch(hostOrigin + path, { headers: { Cookie: cookie } }); assert.equal(asset.status, 200);
    if (path.endsWith('.css') && (await asset.text()).includes('.server-monitor')) monitorStyles = true;
  }
  assert.ok(monitorStyles, 'the portable host serves the monitor stylesheet');
  const hostAction = a => fetch(hostOrigin + '/api/host/action', { method: 'POST', headers: { Cookie: cookie, Origin: hostOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
  const state = await poll(async () => { const r = await fetch(hostOrigin + '/api/host/state', { headers: { Cookie: cookie } }); const s = await r.json(); return s.lobby.joinUrl ? s : null; }, publicTest ? 120000 : 20000);
  const joinUrl = state.lobby.joinUrl;
  if (publicTest) assert.match(joinUrl, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/); else assert.equal(joinUrl, meta.playerUrl);
  const health = await fetch(joinUrl + '/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).version, version);
  assert.equal(state.lobby.version, version); assert.equal(state.lobby.allowSurrender, false);
  assert.equal(state.lobby.ultimateMode, false);
  assert.equal((await hostAction({ kind: 'ultimate-mode', value: true })).status, 200);
  assert.equal((await fetch(joinUrl + '/api/host/state')).status, 403);
  let latestRoom;
  const session = await new Promise((resolve, reject) => { socket = io(joinUrl, { transports: ['websocket'], extraHeaders: { Origin: joinUrl }, reconnection: false }); socket.on('room', room => latestRoom = room); socket.once('session', resolve); socket.once('connect_error', reject); });
  const action = a => new Promise((resolve, reject) => socket.timeout(5000).emit('action', a, (err, reply) => err ? reject(err) : reply.ok ? resolve(reply) : reject(new Error(reply.message))));
  await action({ kind: 'name', name: '可攜包驗證' }); await action({ kind: 'create', mode: 'solo', role: 'attack', duration: 30, startImmediately: true });
  await poll(async () => latestRoom?.phase === 'playing');
  let seq = 0;
  assert.equal(latestRoom.ultimateMode, true);
  await sleep(1000);
  assert.equal(latestRoom.members.find(m => m.id === session.id).ultimate.charge, 0, 'idle does not charge');
  for (let i = 0; i < 40; i++) {
    await action({ kind: 'tap', roundId: latestRoom.roundId, seq: ++seq });
    await sleep(250);
  }
  await poll(async () => latestRoom?.members.find(m => m.id === session.id)?.ultimate.charge === 100);
  assert.equal(latestRoom.members.find(m => m.id === session.id).stats.taps, 40);
  await action({ kind: 'strategy', strategy: 2, roundId: latestRoom.roundId, seq: ++seq });
  const castAt = Date.now();
  await action({ kind: 'ultimate', roundId: latestRoom.roundId, seq: ++seq });
  await poll(async () => latestRoom?.members.find(m => m.id === session.id)?.ultimate.remainingMs > 0);
  const burst = latestRoom.members.find(m => m.id === session.id);
  assert.ok(burst.ultimate.remainingMs > 4000 && burst.ultimate.remainingMs <= 5000); assert.equal(burst.strategy, 2);
  await poll(async () => latestRoom?.members.find(m => m.bot)?.ultimate.remainingMs > 0);
  assert.equal((await hostAction({ kind: 'ultimate-mode', value: false })).status, 200);
  await poll(async () => latestRoom?.members.find(m => m.id === session.id)?.ultimate.remainingMs === 0);
  assert.ok(Date.now() - castAt >= 4900); assert.equal(latestRoom.ultimateMode, true);
  assert.equal(latestRoom.members.find(m => m.id === session.id).strategy, 2);
  assert.equal((await hostAction({ kind: 'allow-surrender', value: true })).status, 200);
  await action({ kind: 'surrender', roundId: latestRoom.roundId, seq: ++seq });
  await poll(async () => latestRoom?.phase === 'ended'); assert.equal(latestRoom.winner, 'defense'); assert.match(latestRoom.reason, /投降/);
  assert.equal(latestRoom.lessons.length, 2);
  assert.match(latestRoom.lessons[0], /^密碼猜測/);
  assert.match(latestRoom.lessons[1], /^多因素驗證/);
  assert.doesNotMatch(latestRoom.lessons.join(''), /本局有|護盾|大招/);
  const previousRoom = latestRoom.id;
  await action({ kind: 'rematch' }); await poll(async () => latestRoom?.phase === 'waiting');
  await action({ kind: 'role', role: 'defense' }); await action({ kind: 'duration', duration: 60 });
  await poll(async () => latestRoom?.duration === 60 && latestRoom.members.find(m => m.id === session.id)?.role === 'defense');
  assert.equal(latestRoom.phase, 'waiting'); assert.equal(latestRoom.id, previousRoom);
  await action({ kind: 'ready', ready: true }); await poll(async () => latestRoom?.phase === 'countdown');
  socket.close();
  const stop = await hostAction({ kind: 'stop' }); assert.equal(stop.status, 200);
  await poll(async () => child.exitCode !== null); assert.equal(child.exitCode, 0);
  await assert.rejects(() => fetch(meta.playerUrl + '/api/health', { signal: AbortSignal.timeout(1500) }));
  await assert.rejects(() => fetch(hostOrigin + '/api/host/state', { signal: AbortSignal.timeout(1500) }));
  await assert.rejects(() => access(metaPath));
  assert.throws(() => process.kill(meta.gamePid, 0));
  const report = { gameVersion: version, mode: publicTest ? 'public-tunnel' : 'local', platform: process.platform, arch: process.arch, bundledNode: JSON.parse(await readFile(join(destination, 'VERSION.json'), 'utf8')).node, cleanPath: '/usr/bin:/bin', unicodeAndSpacePath: true, hostAuth: true, hostMonitorAssets: true, participantIsolation: true, webSocketGameplay: true, soloImmediateStart: true, soloRematchSelection: true, strategyKnowledge: true, tapOnlyCharge: true, ultimateMode: true, ultimateBotCounter: true, ultimateFiveSecondExpiry: true, hostControlledSurrender: true, gracefulShutdown: true, childProcessExited: true, generatedAt: new Date().toISOString(), note: 'HTTP and WebSocket checks only; no browser was opened or controlled.' };
  await writeFile(join(root, 'docs', `portable-${publicTest ? 'public' : 'local'}-results.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  socket?.close();
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await poll(async () => child.exitCode !== null, 8000).catch(() => child.kill('SIGKILL')); }
  await rm(temp, { recursive: true, force: true });
}
