import { spawn } from 'node:child_process';

// Pass the local credential as one argument, never through a command shell or logs.
export function openHostPage(url, { platform = process.platform, spawnProcess = spawn, log = () => {} } = {}) {
  const fallback = () => log('無法自動開啟指揮中心，請手動開啟上方「指揮中心網址」。');
  let parsed;
  try { parsed = new URL(url); } catch { fallback(); return; }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.username || parsed.password) { fallback(); return; }
  const command = platform === 'darwin' ? '/usr/bin/open' : platform === 'win32' ? 'rundll32.exe' : null;
  if (!command) { fallback(); return; }
  let reported = false;
  const fail = () => { if (!reported) { reported = true; fallback(); } };
  try {
    const child = spawnProcess(command, platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], { stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', fail);
    child.once('exit', (code) => { if (code !== 0) fail(); });
    child.unref();
  } catch { fail(); }
}
