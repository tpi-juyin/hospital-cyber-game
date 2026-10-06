import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Server } from 'socket.io';
import { Engine, GameError } from './engine.js';
import { CloudAuth, loginPage } from './cloud-auth.js';
import { GAME_VERSION } from '../shared/version.js';

interface Options { cloud?: { origin: string; password: string; port: number }; root?: string; onStop?: () => void; onRebuildTunnel?: (generation: number) => void; }
function secureEqual(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage) { let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) throw new GameError('INVALID', '資料過大。'); } try { return JSON.parse(raw || '{}'); } catch { throw new GameError('INVALID', '無效 JSON。'); } }
export async function startServers(options: Options = {}) {
  const cloud = options.cloud;
  if (cloud && (new URL(cloud.origin).origin !== cloud.origin || !cloud.origin.startsWith('https://') || !Number.isInteger(cloud.port) || cloud.port < 0 || cloud.port > 65535)) throw new Error('無效雲端網址或連接埠。');
  const auth = cloud ? new CloudAuth(cloud.password) : null;
  const root = resolve(options.root || process.cwd()); const assets = resolve(root, 'dist');
  const engine = new Engine(); const key = randomBytes(32).toString('base64url');
  if (cloud) { engine.joinUrl = cloud.origin; engine.accepting = false; }
  const startup = performance.now(); let tunnelStatus = cloud ? '雲端入口已就緒；開放加入後即可開始活動。' : '正在建立公開連線…'; let closed = false;
  let tunnelGeneration = 0, tunnelBusy = false, tunnelFailed = false, resumeAccepting: boolean | null = null;
  let rebuildTimeout: ReturnType<typeof setTimeout> | undefined;
  let hostPort = 0, playerPort = 0;
  const sessions = new Map<string, string>();
  const limits = new Map<string, number[]>();
  function limit(id: string, category: string, count: number, window = 1000) {
    const k = `${id}:${category}`; const now = performance.now(); const times = (limits.get(k) || []).filter(t => t > now - window);
    if (times.length >= count) return false; times.push(now); limits.set(k, times); return true;
  }
  function headers(res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }
  async function staticFile(path: string, res: ServerResponse, host: boolean) {
    let file: string;
    if (path === '/' || path === '/index.html' || (host && path === '/host.html')) file = resolve(assets, host ? 'host.html' : 'index.html');
    else if (path.startsWith('/assets/')) {
      file = resolve(assets, '.' + path);
      if (!file.startsWith(resolve(assets, 'assets') + sep)) return json(res, 404, { error: 'Not found' });
    } else return json(res, 404, { error: 'Not found' });
    try {
      const content = await readFile(file); const type: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': type[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' }); res.end(content);
    } catch { json(res, 404, { error: '找不到檔案，請先完成建置。' }); }
  }
  const playerServer = createServer((req, res) => {
    headers(res); const url = new URL(req.url || '/', 'http://localhost');
    if (cloud && (url.pathname === '/host' || url.pathname.startsWith('/host/') || url.pathname.startsWith('/api/host'))) return void hostHandler(req, res);
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/api/health') return json(res, 200, { entry: 'participant', ok: true, version: GAME_VERSION });
    if (url.pathname.startsWith('/api/host')) return json(res, 403, { error: '此入口不提供主持功能。' });
    void staticFile(url.pathname, res, false);
  });
  async function hostHandler(req: IncomingMessage, res: ServerResponse) {
    headers(res);
    // Native login/logout POST forms need their same-origin Origin header.
    // no-referrer makes browsers send Origin: null; keep cross-site referrers private.
    if (cloud) res.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (!cloud && req.headers.host !== `127.0.0.1:${hostPort}`) return json(res, 403, { error: '僅限本機主持入口。' });
      const url = new URL(req.url || '/', `http://127.0.0.1:${hostPort}`);
      if (cloud && auth) {
        if (req.method === 'POST' && req.headers.origin !== cloud.origin) return json(res, 403, { error: '無效操作來源。' });
        if (req.method === 'POST' && url.pathname === '/host/login') {
          let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) return json(res, 413, { error: '資料過大。' }); }
          const result = await auth.login(new URLSearchParams(raw).get('password') || '', res);
          if (result === 429) res.setHeader('Retry-After', '60');
          if (result !== 200) { res.writeHead(result, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(loginPage(true)); return; }
          res.writeHead(303, { Location: '/host', 'Cache-Control': 'no-store' }); res.end(); return;
        }
        if (req.method === 'POST' && url.pathname === '/host/logout') { auth.logout(req, res); res.writeHead(303, { Location: '/host' }); res.end(); return; }
        if (!auth.authorized(req)) {
          if (req.method === 'GET' && (url.pathname === '/host' || url.pathname === '/host/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(loginPage()); return; }
          return json(res, 401, { error: '請重新登入主持台。' });
        }
        if (url.pathname === '/host' || url.pathname === '/host/') url.pathname = '/host.html';
      }
      if (!cloud && req.method === 'GET' && url.pathname === '/' && secureEqual(url.searchParams.get('key') || '', key)) {
        res.writeHead(303, { Location: '/', 'Set-Cookie': `hospital_host=${key}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }); return res.end();
      }
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('hospital_host='))?.slice(14) || '';
      if (!cloud && !secureEqual(cookie, key)) return json(res, 403, { error: '請使用啟動器顯示的主持頁連結。' });
      if (url.pathname === '/api/host/state' && req.method === 'GET') return json(res, 200, { lobby: engine.lobby(), rooms: [...engine.rooms.keys()].map(id => engine.view(id)), hostingMode: cloud ? 'cloud' : 'local', uptimeSeconds: Math.floor((performance.now() - startup) / 1000), tunnelStatus, tunnelControl: { available: !!options.onRebuildTunnel, busy: tunnelBusy, failed: tunnelFailed } });
      if (req.method === 'POST' && url.pathname === '/api/host/action') {
        if (req.headers.origin !== (cloud?.origin || `http://127.0.0.1:${hostPort}`)) return json(res, 403, { error: '無效操作來源。' });
        const a = await body(req);
        if (a.kind === 'rebuild-tunnel') {
          if (!options.onRebuildTunnel) throw new GameError('UNAVAILABLE', '此啟動方式不支援重建公開連線。請使用新版啟動檔。');
          if (tunnelBusy) throw new GameError('BUSY', '公開連線正在重建，請稍候。');
          tunnelBusy = true; tunnelFailed = false; const generation = ++tunnelGeneration;
          resumeAccepting ??= engine.accepting;
          engine.accepting = false; engine.joinUrl = ''; tunnelStatus = '正在重建公開連線…目前對局已中止，請等待新的 QR Code。';
          engine.abortForTunnelRebuild();
          for (const [id, socketId] of sessions) io.sockets.sockets.get(socketId)?.emit('room', engine.playerView(id));
          io.emit('hosting-reset'); sessions.clear(); io.disconnectSockets(true); limits.clear(); engine.clearParticipants();
          clearTimeout(rebuildTimeout);
          rebuildTimeout = setTimeout(() => setTunnel('', '重建逾時。請確認網路後按「重試公開連線」。', generation, 'failed'), 150_000);
          rebuildTimeout.unref();
          try { options.onRebuildTunnel(generation); }
          catch { setTunnel('', '無法啟動重建，請確認啟動器仍在執行後重試。', generation, 'failed'); }
          return json(res, 200, { ok: true });
        }
        if (a.kind === 'accepting' && (tunnelBusy || resumeAccepting !== null)) throw new GameError('BUSY', '請等公開連線恢復後再開放加入。');
        if (a.kind === 'accepting' && typeof a.value === 'boolean') engine.accepting = a.value;
        else if (a.kind === 'allow-surrender' && typeof a.value === 'boolean') engine.allowSurrender = a.value;
        else if (a.kind === 'ultimate-mode' && typeof a.value === 'boolean') engine.setUltimateMode(a.value);
        else if (a.kind === 'duration') engine.setDuration(a.value);
        else if (a.kind === 'close' && typeof a.roomId === 'string') engine.closeRoom(a.roomId);
        else if (a.kind === 'stop' && cloud) {
          engine.accepting = false; engine.abortForTunnelRebuild('主持人已結束活動，本局不計勝負。');
          for (const [id, socketId] of sessions) io.sockets.sockets.get(socketId)?.emit('room', engine.playerView(id));
          io.emit('hosting-reset', { reason: 'activity-ended' }); sessions.clear(); io.disconnectSockets(true); limits.clear(); engine.clearParticipants();
          tunnelStatus = '活動已結束；按「開放新玩家加入」可開始下一場活動。';
        }
        else if (a.kind === 'stop') { json(res, 200, { ok: true }); setTimeout(() => options.onStop?.(), 100); return; }
        else throw new GameError('INVALID', '無效主持操作。');
        io.emit('lobby', engine.lobby());
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET') return void await staticFile(url.pathname, res, true);
      json(res, 405, { error: 'Method not allowed' });
    } catch (error) { json(res, 400, { error: error instanceof GameError ? error.message : '無法完成操作。' }); }
  }
  const hostServer = createServer(hostHandler);
  const io = new Server(playerServer, {
    transports: ['websocket'], maxHttpBufferSize: 4096, pingInterval: 3000, pingTimeout: 3000,
    serveClient: false, perMessageDeflate: false,
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      callback(null, !origin || origin === engine.joinUrl || (!cloud && origin === `http://127.0.0.1:${playerPort}`));
    },
  });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (token !== undefined && (typeof token !== 'string' || token.length > 100)) throw new GameError('INVALID', '無效加入憑證。');
      socket.data.session = engine.connect(token); next();
    } catch (error) { const e = new Error(error instanceof Error ? error.message : '無法加入。') as Error & { data: unknown }; e.data = { code: error instanceof GameError ? error.code : 'ERROR' }; next(e); }
  });
  io.on('connection', socket => {
    const session = socket.data.session; const oldId = sessions.get(session.id); sessions.set(session.id, socket.id);
    if (oldId && oldId !== socket.id) { const old = io.sockets.sockets.get(oldId); old?.emit('replaced'); old?.disconnect(true); }
    socket.emit('session', engine.session(session.id)); socket.emit('lobby', engine.lobby()); socket.emit('room', engine.playerView(session.id));
    socket.on('action', (action: unknown, ack?: (reply: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (sessions.get(session.id) !== socket.id) throw new GameError('REPLACED', '已在另一分頁登入。');
        if (!limit(socket.id, 'messages', 60)) throw new GameError('RATE_LIMIT', '操作過於頻繁。');
        const kind = (action as { kind?: string })?.kind;
        if ((kind === 'join' || kind === 'create') && !limit(session.id, 'rooms', 20, 60_000)) throw new GameError('RATE_LIMIT', '加入房間太頻繁，請稍候。');
        engine.action(session.id, action);
        if (kind !== 'tap' && kind !== 'strategy') socket.emit('room', engine.playerView(session.id));
        reply({ ok: true });
      } catch (error) { reply({ ok: false, code: error instanceof GameError ? error.code : 'ERROR', message: error instanceof GameError ? error.message : '操作失敗，請重試。' }); }
    });
    socket.on('disconnect', () => { limits.delete(`${socket.id}:messages`); if (sessions.get(session.id) === socket.id) { sessions.delete(session.id); engine.disconnect(session.id); } });
  });
  async function listen(server: typeof playerServer, port = 0, address = '127.0.0.1') { await new Promise<void>((ok, reject) => { server.once('error', reject); server.listen(port, address, () => { server.removeListener('error', reject); ok(); }); }); return (server.address() as { port: number }).port; }
  playerPort = await listen(playerServer, cloud?.port || 0, cloud ? '0.0.0.0' : '127.0.0.1');
  try { hostPort = await listen(hostServer); } catch (error) { io.close(); throw error; }
  let ticks = 0;
  const timer = setInterval(() => {
    engine.advance(); ticks++;
    if (ticks % 2 === 0) {
      const views = new Map([...engine.rooms.keys()].map(id => [id, engine.view(id)]));
      for (const [playerId, socketId] of sessions) { const roomId = engine.players.get(playerId)?.roomId; io.sockets.sockets.get(socketId)?.volatile.emit('room', roomId ? views.get(roomId) || null : null); }
    }
    if (ticks % 20 === 0) { io.emit('lobby', engine.lobby()); for (const key of limits.keys()) { const id = key.split(':')[0]; if (!io.sockets.sockets.has(id) && !engine.players.has(id)) limits.delete(key); } }
  }, 50);
  async function stop() {
    if (closed) return; closed = true; clearInterval(timer); clearTimeout(rebuildTimeout);
    await new Promise<void>(ok => io.close(() => ok()));
    await new Promise<void>(ok => { hostServer.close(() => ok()); hostServer.closeIdleConnections(); });
  }
  function setTunnel(url: string, status: string, generation = 0, phase?: string) {
    if (cloud || closed || generation !== tunnelGeneration) return;
    if (url && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url) && url !== `http://127.0.0.1:${playerPort}`) return;
    if (phase === 'failed' || url) {
      clearTimeout(rebuildTimeout); tunnelBusy = false; tunnelFailed = phase === 'failed';
      if (url && resumeAccepting !== null) { engine.accepting = resumeAccepting; resumeAccepting = null; }
    }
    engine.joinUrl = url; tunnelStatus = status; io.emit('lobby', engine.lobby());
  }
  return { engine, io, playerPort, hostPort, hostUrl: `http://127.0.0.1:${hostPort}/?key=${key}`, playerUrl: `http://127.0.0.1:${playerPort}`, stop, setTunnel };
}
if (process.env.HOSPITAL_GAME_CHILD === '1') {
  let runtime: Awaited<ReturnType<typeof startServers>>;
  const shutdown = async () => { await runtime?.stop(); process.exit(0); };
  startServers({ root: process.env.HOSPITAL_GAME_ROOT, onStop: () => process.send ? process.send({ type: 'stop' }) : void shutdown(),
    onRebuildTunnel: process.env.HOSPITAL_GAME_LOCAL_ONLY === '1' ? undefined : generation => {
      if (!process.connected || !process.send) throw new Error('Launcher disconnected');
      process.send({ type: 'rebuild-tunnel', generation }, undefined, undefined, (error: Error | null) => { if (error) runtime?.setTunnel('', '啟動器無法接收重建要求，請重新啟動主持。', generation, 'failed'); });
    },
  }).then(result => {
    runtime = result; process.send?.({ type: 'ready', hostUrl: result.hostUrl, playerUrl: result.playerUrl, playerPort: result.playerPort });
    process.on('message', (m: any) => { if (m?.type === 'tunnel') result.setTunnel(m.url, m.status, m.generation, m.phase); else if (m?.type === 'stop') void shutdown(); });
    process.on('disconnect', () => void shutdown()); process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
  }).catch(error => { console.error('遊戲服務啟動失敗：', error.message); process.exit(1); });
}
