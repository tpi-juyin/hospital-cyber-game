import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

test('actual launcher rebuilds only its tunnel child, preserves host service and cleans up on stop', { skip: process.platform === 'win32', timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), '遊戲 rebuild '));
  for (const dir of ['scripts', 'runtime', 'dist', 'dist-server']) await mkdir(join(root, dir));
  for (const file of ['scripts/launch.mjs', 'scripts/tunnel-controller.mjs', 'scripts/open-host.mjs', 'dist-server/game.cjs']) await cp(resolve(file), join(root, file));
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>fixture</title>');
  const pids: number[] = []; let gamePid = 0;
  const pidPath = join(root, 'mock-tunnel-pids.jsonl');
  // No URL is emitted, so this fixture cannot create a public tunnel or make a public health request.
  const fakeScript = join(root, 'mock-tunnel.cjs');
  await writeFile(fakeScript, `require('node:fs').appendFileSync(${JSON.stringify(pidPath)}, process.pid+'\\n');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));`);
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  await writeFile(join(root, 'runtime/cloudflared'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fakeScript)}\n`, { mode: 0o755 });
  const launcher = spawn(process.execPath, [join(root, 'scripts/launch.mjs'), '--no-open'], { cwd: tmpdir(), stdio: 'ignore' });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const poll = async (fn: () => Promise<boolean>) => { const end = Date.now() + 7000; while (Date.now() < end) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out waiting for launcher fixture'); };
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGTERM');
    await poll(async () => launcher.exitCode !== null || launcher.signalCode !== null).catch(() => launcher.kill('SIGKILL'));
    for (const pid of [...pids, gamePid]) if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
  });
  const metaPath = join(root, '.runtime/instance.json');
  await poll(async () => { const lines = (await readFile(pidPath, 'utf8')).trim().split('\n'); pids.splice(0, pids.length, ...lines.map(Number)); return pids.length === 1; });
  const meta = JSON.parse(await readFile(metaPath, 'utf8')); gamePid = meta.gamePid;
  const host = new URL(meta.hostUrl).origin, login = await fetch(meta.hostUrl, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const post = (kind: string) => fetch(host + '/api/host/action', { method: 'POST', headers: { Cookie: cookie, Origin: host, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
  const state = () => fetch(host + '/api/host/state', { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal((await state()).tunnelControl.available, true);
  assert.equal((await post('rebuild-tunnel')).status, 200);
  await poll(async () => { pids.splice(0, pids.length, ...(await readFile(pidPath, 'utf8')).trim().split('\n').map(Number)); return pids.length === 2; });
  assert.equal(alive(pids[0]), false); assert.equal(alive(pids[1]), true); assert.equal(alive(gamePid), true);
  assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).gamePid, gamePid);
  assert.equal((await state()).tunnelControl.busy, true);
  assert.equal((await post('rebuild-tunnel')).status, 400);
  process.kill(pids[1], 'SIGTERM');
  await poll(async () => (await state()).tunnelControl.failed);
  assert.equal((await post('rebuild-tunnel')).status, 200);
  await poll(async () => { pids.splice(0, pids.length, ...(await readFile(pidPath, 'utf8')).trim().split('\n').map(Number)); return pids.length === 3; });
  assert.equal((await post('stop')).status, 200);
  await poll(async () => launcher.exitCode === 0);
  assert.equal(alive(gamePid), false); assert.equal(alive(pids[2]), false);
  await assert.rejects(() => readFile(metaPath));
});
