import { io, type Socket } from 'socket.io-client';
import { startServers } from '../src/server/index';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { RoomView, SessionView, Reply, Action } from '../src/shared/protocol';
import { GAME_VERSION } from '../src/shared/version';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const server = await startServers(); const clients: { socket: Socket; session: SessionView; room: RoomView | null; seq: number }[] = [];
const ultimateMode = process.argv.includes('--ultimate'); server.engine.setUltimateMode(ultimateMode);
let messages = 0, payloadBytes = 0;
async function send(socket: Socket, action: Action) { return new Promise<Reply>((resolve, reject) => socket.timeout(5000).emit('action', action, (e: Error, r: Reply) => e ? reject(e) : r.ok ? resolve(r) : reject(new Error(r.message)))); }
try {
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((resolve, reject) => { const socket = io(server.playerUrl, { transports: ['websocket'], reconnection: false }); const c = { socket, session: null as unknown as SessionView, room: null as RoomView | null, seq: 0 }; socket.on('session', session => { c.session = session; clients.push(c); resolve(); }); socket.on('room', room => { c.room = room; messages++; payloadBytes += Buffer.byteLength(JSON.stringify(room)); }); socket.once('connect_error', reject); });
  }
  const results = [];
  for (const mode of ['duo', 'solo'] as const) {
    for (let i = 0; i < 30; i++) {
      const c = clients[i];
      if (mode === 'solo' || i % 2 === 0) await send(c.socket, { kind: 'create', mode, role: i % 2 ? 'defense' : 'attack', duration: 30 });
      else await send(c.socket, { kind: 'join', code: server.engine.playerView(clients[i - 1].session.id)!.code });
    }
    await Promise.all(clients.map(c => send(c.socket, { kind: 'ready', ready: true }))); await sleep(3200);
    assert.ok(clients.every(c => c.room?.phase === 'playing'));
    const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable(); const cpu = process.cpuUsage(); const start = performance.now(); messages = 0; payloadBytes = 0;
    const latencies: number[] = []; let ultimateAcks = 0;
    const tapping = setInterval(() => { for (const c of clients) if (c.room?.phase === 'playing') { const t = performance.now(); c.socket.emit('action', { kind: 'tap', seq: ++c.seq, roundId: c.room.roundId }, (r: Reply) => { if (r.ok) latencies.push(performance.now() - t); }); } }, 175);
    const switching = setInterval(() => { for (const c of clients) if (c.room?.phase === 'playing') { const me = c.room.members.find(m => m.id === c.session.id)!; if (!me.ultimate.remainingMs && !me.cooldownMs) c.socket.emit('action', { kind: 'strategy', strategy: (me.strategy + 1) % 3, seq: ++c.seq, roundId: c.room.roundId }); } }, 3500);
    const ultimates = ultimateMode ? setInterval(() => {
      for (const c of clients) if (c.room?.phase === 'playing') {
        const me = c.room.members.find(m => m.id === c.session.id)!, enemy = c.room.members.find(m => m.id !== c.session.id)!;
        if (me.ultimate.charge >= 100 && !me.ultimate.remainingMs && me.ultimate.uses < 2 && (me.role === 'attack' || enemy.ultimate.remainingMs > 0)) {
          c.socket.emit('action', { kind: 'ultimate', seq: ++c.seq, roundId: c.room.roundId }, (r: Reply) => { if (r.ok) ultimateAcks++; });
        }
      }
    }, 100) : undefined;
    await sleep(ultimateMode ? 26000 : 12000); clearInterval(tapping); clearInterval(switching); clearInterval(ultimates); delay.disable(); latencies.sort((a, b) => a - b);
    const elapsed = (performance.now() - start) / 1000; const used = process.cpuUsage(cpu);
    const record = { mode, clients: clients.length, rooms: server.engine.rooms.size, seconds: +elapsed.toFixed(1), acceptedTapAcks: latencies.length, snapshotMessagesPerSecond: +(messages / elapsed).toFixed(1), payloadKBPerSecond: +(payloadBytes / elapsed / 1024).toFixed(1), roundTripP95Ms: +(latencies[Math.floor(latencies.length * .95)] || 0).toFixed(2), eventLoopP99Ms: +(delay.percentile(99) / 1e6).toFixed(2), processCpuPercentOfOneCore: +((used.user + used.system) / (elapsed * 1e6) * 100).toFixed(1), processRssMB: +(process.memoryUsage().rss / 1048576).toFixed(1), disconnectedClients: clients.filter(c => !c.socket.connected).length };
    results.push({ ...record, ultimateAcks }); console.log(JSON.stringify({ ...record, ultimateAcks }));
    assert.equal(record.disconnectedClients, 0); assert.ok(record.roundTripP95Ms < 100); assert.ok(record.eventLoopP99Ms < 100); assert.ok(record.acceptedTapAcks > 1500);
    if (ultimateMode) assert.ok(ultimateAcks >= 30, 'thirty simultaneous players can charge and release their fourth move');
    for (const id of [...server.engine.rooms.keys()]) server.engine.closeRoom(id); await sleep(150);
  }
  await mkdir('docs', { recursive: true }); await writeFile(`docs/${ultimateMode ? 'ultimate-' : ''}load-results.json`, JSON.stringify({ gameVersion: GAME_VERSION, ultimateMode, note: 'Local loopback; process metrics include the server and 30 simulated clients, not public tunnel or mobile browser performance.', generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
} finally { clients.forEach(c => c.socket.close()); await server.stop(); }
