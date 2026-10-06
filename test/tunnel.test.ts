import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const modulePath = '../scripts/tunnel-controller.mjs';
const { createTunnelController } = await import(modulePath);
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(health: (url: string) => Promise<boolean> = async () => true) {
  let now = 0; const children: any[] = [], updates: any[][] = [], timers = new Set<() => void>();
  const stopped: any[] = [];
  const controller = createTunnelController({
    spawnTunnel() { const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }); children.push(child); return child; },
    async terminate(child: any) { if (child) { stopped.push(child); child.emit('exit', 0); } },
    health, publish: (...args: any[]) => updates.push(args), log() {}, record() {}, now: () => now,
    every(fn: () => void) { timers.add(fn); return fn; }, cancel(fn: () => void) { timers.delete(fn); },
  });
  return { controller, children, updates, stopped, timers, advance(ms: number) { now += ms; for (const fn of timers) fn(); } };
}
test('tunnel rebuild serializes child cleanup and discards old output and pending health replies', async () => {
  let finishOld!: (ok: boolean) => void;
  const f = fixture(url => url.includes('old-') ? new Promise(resolve => finishOld = resolve) : Promise.resolve(true));
  await f.controller.restart(0);
  f.children[0].stderr.write('https://old-game.trycloudflare.com'); await settle();
  await f.controller.restart(1);
  assert.equal(f.stopped[0], f.children[0]); assert.equal(f.children.length, 2); assert.equal(f.timers.size, 1);
  f.children[0].stderr.write('https://stale-game.trycloudflare.com'); finishOld(true); await settle();
  assert.ok(f.updates.every(u => !u[1]), 'old URL must never become ready');
  f.children[1].stderr.write('https://new-game.trycloudflare.com'); await settle();
  assert.deepEqual(f.updates.at(-1)?.slice(1), ['https://new-game.trycloudflare.com', 1, 'ready']);
  await f.controller.stop(); assert.equal(f.timers.size, 0); assert.equal(f.stopped.length, 2);
  f.children[1].stderr.write('https://after-stop.trycloudflare.com');
  assert.equal(f.updates.at(-1)?.[1], 'https://new-game.trycloudflare.com');
});
test('tunnel timeout and process failure withdraw QR and permit a clean retry', async () => {
  const f = fixture(async () => false);
  await f.controller.restart(1); f.advance(120001); await settle();
  assert.equal(f.updates.at(-1)?.[3], 'failed'); assert.equal(f.updates.at(-1)?.[1], ''); assert.equal(f.timers.size, 0);
  await f.controller.restart(2); assert.equal(f.children.length, 2);
  f.children[1].emit('error', { code: 'ENOENT' }); await settle();
  assert.equal(f.updates.at(-1)?.[3], 'failed'); assert.match(f.updates.at(-1)?.[0], /ENOENT/);
  await f.controller.restart(3); f.children[2].emit('exit', 1); await settle();
  assert.equal(f.updates.at(-1)?.[3], 'failed');
  await f.controller.stop(); assert.equal(f.timers.size, 0);
});
test('stop during restart cleanup cannot spawn a replacement tunnel', async () => {
  const f = fixture(); await f.controller.restart();
  const restarting = f.controller.restart(1), stopping = f.controller.stop();
  await Promise.all([restarting, stopping]); assert.equal(f.children.length, 1); assert.equal(f.timers.size, 0);
});
