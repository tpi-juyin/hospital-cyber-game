import { spawn, fork } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, appendFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createTunnelController } from './tunnel-controller.mjs';
import { openHostPage } from './open-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localOnly = process.argv.includes('--local-only');
const autoOpen = !process.argv.includes('--no-open');
const runtimeDir = join(root, '.runtime'); const logDir = join(root, 'logs');
const instancePath = join(runtimeDir, 'instance.json');
mkdirSync(runtimeDir, { recursive: true }); mkdirSync(logDir, { recursive: true });
const runId = randomBytes(8).toString('hex');
const logPath = join(logDir, `game-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const node = existsSync(join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')) ? join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node') : process.execPath;
const tunnelBin = join(root, 'runtime', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const cloudflared = existsSync(tunnelBin) ? tunnelBin : 'cloudflared';
let game, playerUrl = '', stopping = false;
function log(message) { const line = `[${new Date().toISOString()}] ${message}`; console.log(message); appendFileSync(logPath, line + '\n'); }
function send(status, url = '', generation = 0, phase) { if (game?.connected) game.send({ type: 'tunnel', status, url, generation, phase }, () => {}); }
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
if (existsSync(instancePath)) {
  try { const old = JSON.parse(readFileSync(instancePath, 'utf8')); if (isAlive(old.pid)) { console.error('已有遊戲正在主持，請先停止原活動。'); console.log(`指揮中心入口：${old.hostUrl}`); process.exit(1); } } catch { /* Stale metadata can be replaced. */ }
}
if (!existsSync(join(root, 'dist-server', 'game.cjs')) || !existsSync(join(root, 'dist', 'index.html'))) {
  log('找不到完整遊戲檔案。原始碼版本請先執行 npm run build；主持包請完整解壓縮。'); process.exit(1);
}
async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise(ok => child.once('exit', ok));
  if (child === game && child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM');
  const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2500);
  await Promise.race([exited, new Promise(ok => setTimeout(ok, 3000))]); clearTimeout(force);
}
async function shutdown(code = 0) {
  if (stopping) return; stopping = true; send('活動已停止。');
  await tunnelController.stop(); await terminate(game);
  try { const current = JSON.parse(readFileSync(instancePath, 'utf8')); if (current.runId === runId) rmSync(instancePath); } catch { /* Already removed. */ }
  log('遊戲服務與公開通道已停止。'); process.exit(code);
}
async function health(url) {
  try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(4000), redirect: 'error' }); if (!response.ok) return false; const data = await response.json(); return data.ok === true && data.entry === 'participant'; } catch { return false; }
}
const tunnelController = createTunnelController({
  spawnTunnel() {
    const configPath = join(runtimeDir, 'tunnel.yml');
    writeFileSync(configPath, 'loglevel: info\n', { mode: 0o600 });
    return spawn(cloudflared, ['--no-autoupdate', '--config', configPath, 'tunnel', '--protocol', 'http2', '--url', playerUrl], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  },
  terminate, health, publish: send, log, record: text => appendFileSync(logPath, text),
});
log('醫院資安攻防戰 · 正在啟動');
log('請保持這個視窗開啟。結束時使用指揮中心「結束活動並停止服務」，或按 Ctrl+C。');
game = fork(join(root, 'dist-server', 'game.cjs'), [], { execPath: node, cwd: root, env: { ...process.env, HOSPITAL_GAME_CHILD: '1', HOSPITAL_GAME_ROOT: root, HOSPITAL_GAME_LOCAL_ONLY: localOnly ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
game.stdout.on('data', chunk => log(chunk.toString().trim())); game.stderr.on('data', chunk => log(chunk.toString().trim()));
game.on('error', error => { log(`遊戲無法啟動：${error.message}`); void shutdown(1); });
game.on('exit', code => { if (!stopping) { log(`遊戲服務停止（${code}）。`); void shutdown(code || 0); } });
game.on('message', message => {
  if (message?.type === 'rebuild-tunnel' && !stopping && !localOnly && Number.isSafeInteger(message.generation)) { void tunnelController.restart(message.generation); return; }
  if (message?.type === 'stop') { void shutdown(); return; }
  if (message?.type !== 'ready' || stopping || playerUrl) return;
  playerUrl = message.playerUrl;
  // The local host credential is intentionally excluded from the diagnostic log.
  console.log(`\n指揮中心網址（僅限這台電腦，請勿分享）：\n${message.hostUrl}\n`);
  writeFileSync(instancePath, JSON.stringify({ pid: process.pid, gamePid: game.pid, runId, hostUrl: message.hostUrl, playerUrl }, null, 2), { mode: 0o600 });
  if (autoOpen) openHostPage(message.hostUrl, { log });
  if (localOnly) { send('本機測試模式：此網址與 QR Code 僅適用這台電腦。', playerUrl); log(`本機玩家入口：${playerUrl}`); }
  else void tunnelController.restart();
});
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown()); process.on('SIGHUP', () => void shutdown());
process.on('uncaughtException', error => { log(`啟動器錯誤：${error.message}`); void shutdown(1); });
