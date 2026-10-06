import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const modulePath = '../scripts/open-host.mjs';
const { openHostPage } = await import(modulePath);

test('host opener uses default OS handler with a single URL argument and no shell', () => {
  for (const platform of ['darwin', 'win32']) {
    const child = Object.assign(new EventEmitter(), { unref() {} });
    const calls: unknown[][] = []; const logs: string[] = [];
    const url = 'http://127.0.0.1:4567/?key=private&test=value';
    openHostPage(url, { platform, spawnProcess: (...args: unknown[]) => { calls.push(args); return child; }, log: (s: string) => logs.push(s) });
    assert.deepEqual(calls, [[platform === 'darwin' ? '/usr/bin/open' : 'rundll32.exe', platform === 'darwin' ? [url] : ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true, shell: false }]]);
    child.emit('exit', 0); assert.deepEqual(logs, []);
  }
});

test('host opener failures retain manual fallback without logging credentials', () => {
  for (const failure of ['error', 'exit', 'throw']) {
    const child = Object.assign(new EventEmitter(), { unref() {} }); const logs: string[] = [];
    openHostPage('http://127.0.0.1:4567/?key=secret', { platform: 'darwin', spawnProcess: () => { if (failure === 'throw') throw new Error('secret'); return child; }, log: (s: string) => logs.push(s) });
    if (failure === 'error') { child.emit('error', new Error('secret')); child.emit('exit', 1); }
    if (failure === 'exit') child.emit('exit', 1);
    assert.equal(logs.length, 1); assert.match(logs[0], /手動開啟/); assert.doesNotMatch(logs[0], /secret/);
  }
});

test('host opener rejects non-local and malformed URLs before invoking OS', () => {
  for (const url of ['invalid', 'https://example.com/', 'file:///tmp/test', 'http://127.0.0.1:4567@example.com/', 'http://user:pass@127.0.0.1:4567/']) {
    let spawned = false;
    openHostPage(url, { spawnProcess: () => { spawned = true; }, log: () => {} });
    assert.equal(spawned, false);
  }
});
