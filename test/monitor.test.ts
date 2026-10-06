import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement } from 'happy-dom';
import { Engine } from '../src/server/engine';
import { TelemetryHistory, serverMetrics } from '../src/client/telemetry';
import { ServerMonitor } from '../src/client/monitor';

function room() {
  const e = new Engine(), p = e.connect(); e.action(p.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  const r = e.playerView(p.id)!; r.phase = 'playing'; return r;
}

test('server and service simulation follows health boundaries, strategy pressure and surrender', () => {
  const r = room();
  const healthy = serverMetrics(r, 0); assert.equal(healthy.online, 2); assert.equal(healthy.nodes[1].state, '同步待命');
  r.hp = 50.01; assert.equal(serverMetrics(r, 0).online, 2);
  r.hp = 50; const failover = serverMetrics(r, 0);
  assert.equal(failover.online, 1); assert.equal(failover.nodes[0].cpu, 0); assert.equal(failover.nodes[1].active, true);
  assert.ok(failover.services.every(s => s.latency !== null));
  r.hp = 0; const offline = serverMetrics(r, 6);
  assert.equal(offline.online, 0); assert.ok(offline.nodes.every(n => !n.up && !n.cpu && !n.memory));
  assert.ok(offline.services.every(s => s.latency === null && s.status === '服務中斷'));
  r.hp = 80; r.members[0].strategy = 1;
  const load = serverMetrics(r, 6); assert.ok(load.nodes[0].cpu > serverMetrics(r, 0).nodes[0].cpu);
  r.members[0].strategy = 2;
  assert.ok(serverMetrics(r, 6).nodes[0].memory > load.nodes[0].memory);
  r.phase = 'ended'; r.winner = 'attack'; r.reason = '防守方投降';
  assert.equal(serverMetrics(r, 6).online, 2, 'surrender must not invent hardware failure');
});

test('telemetry derives attack/block rates from observed counters and stops during pause/end', () => {
  let now = 0; const history = new TelemetryHistory(() => now), r = room(); history.update([r]);
  for (let i = 1; i <= 4; i++) { now += 500; r.attacks += 2; r.blocks += 1; r.remainingMs -= 500; history.update([r]); }
  const h = history.get(r.id)!;
  assert.equal(h.attackRate, 4); assert.equal(h.blockedRate, 2); const samples = h.samples.length;
  r.phase = 'paused'; now += 500; history.update([r]); now += 3000; history.update([r]);
  assert.equal(h.samples.length, samples); assert.equal(h.attackRate, 4);
  r.phase = 'ended'; r.reason = '連線中斷'; history.update([r]); now += 500; history.update([r]);
  assert.equal(h.samples.length, samples); assert.equal(h.events.filter(e => e.text === '連線中斷').length, 1);
});

test('observing late, resuming or reconnecting cannot turn old counters into a traffic spike', () => {
  let now = 0; const history = new TelemetryHistory(() => now), r = room(); r.attacks = 200; history.update([r]);
  assert.equal(history.get(r.id)!.attackRate, 0);
  now = 500; r.attacks += 2; history.update([r]); assert.equal(history.get(r.id)!.attackRate, 4);
  now = 7000; r.attacks += 30; history.update([r]);
  assert.equal(history.get(r.id)!.attackRate, 0); assert.equal(history.get(r.id)!.samples.at(-1)!.gap, true);
  now += 500; r.attacks += 2; history.update([r]); assert.equal(history.get(r.id)!.attackRate, 4);
  r.phase = 'paused'; history.update([r]); now += 500; r.phase = 'playing'; history.update([r]);
  assert.equal(history.get(r.id)!.attackRate, 0);
});

test('event history records transitions once and room histories reset on rematch or removal', () => {
  let now = 0; const history = new TelemetryHistory(() => now), a = room(), b = room(); history.update([a, b]);
  a.hp = 50; a.shield = 0; now += 500; history.update([a, b]); history.update([a, b]);
  assert.equal(history.get(a.id)!.events.filter(e => e.text.includes('主機故障')).length, 1);
  assert.equal(history.get(b.id)!.events.length, 1, 'a different room must not inherit events');
  a.hp = 0; a.phase = 'ended'; a.reason = '醫院主機失守'; history.update([a, b]);
  assert.ok(history.get(a.id)!.events.some(e => e.text.includes('所有醫療服務中斷')));
  a.roundId = 'next-round'; a.phase = 'waiting'; a.hp = 100; a.shield = 30; a.attacks = 0; history.update([a, b]);
  assert.equal(history.get(a.id)!.events.length, 1); assert.equal(history.get(a.id)!.samples.length, 0);
  history.update([a]); assert.equal(history.get(b.id), undefined);
});

test('charts and event logs have bounded storage for long host sessions', () => {
  let now = 0; const history = new TelemetryHistory(() => now), r = room();
  for (let i = 0; i < 2000; i++) { now += 500; r.attacks += 2; r.members[0].strategy = i % 2 ? 0 : 1; history.update([r]); }
  const h = history.get(r.id)!;
  assert.ok(h.samples.length <= 61); assert.ok(h.events.length <= 8); assert.ok(h.samples.every(s => now - s.at <= 30_000));
});

test('monitor keeps controls stable, escapes names and exposes failure, freeze and stale states', t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  window.document.body.innerHTML = '<section id="projection"></section>';
  const root = window.document.querySelector<HTMLElement>('#projection')!;
  const monitor = new ServerMonitor(root as unknown as globalThis.HTMLElement), r = room(), history = new TelemetryHistory();
  r.members[0].name = '<img src=x onerror=alert(1)>'; history.update([r]); monitor.render(r, history.get(r.id)!);
  const exit = root.querySelector<HTMLElement>('[data-exit]')!; exit.focus();
  assert.match(root.textContent, /非真實醫療監控/); assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(root.querySelectorAll('.monitor-node').length, 2); assert.equal(root.querySelectorAll('tbody tr').length, 4);
  r.hp = 50; history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.equal(root.querySelector('[data-exit]'), exit); assert.equal(window.document.activeElement, exit);
  assert.ok(root.querySelector('[data-node="primary"].node-down')); assert.ok(root.querySelector('[data-node="backup"].node-active'));
  monitor.connection(true); assert.equal(root.querySelector<HTMLElement>('#monitor-stale')!.hidden, false);
  r.hp = 0; r.phase = 'ended'; r.winner = 'attack'; r.reason = '醫院主機失守'; history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.equal(root.querySelector<HTMLElement>('#monitor-stale')!.hidden, true);
  assert.equal(root.querySelectorAll('.node-down').length, 2); assert.match(root.textContent, /攻擊方獲勝/);
  assert.equal(root.dataset.phase, 'ended');
});

test('waiting monitor retains both names when players choose the same side', t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  const root = window.document.body as unknown as globalThis.HTMLElement;
  const monitor = new ServerMonitor(root), history = new TelemetryHistory(), r = room();
  r.mode = 'duo'; r.phase = 'waiting'; r.members[0].name = '玩家甲'; r.members[1].name = '玩家乙';
  r.members[1].role = 'attack'; r.members[1].bot = false; r.members[1].ready = false;
  history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.match(root.querySelector('.monitor-players')!.textContent!, /玩家甲.*玩家乙/s);
  assert.equal(root.querySelectorAll('.monitor-players .monitor-attacker').length, 2);
  assert.match(root.querySelector('.monitor-players')!.textContent!, /選角中/);
});

test('monitor shows each side charge, active fourth move and one event per activation without mislabeling the defense', t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  const root = window.document.body as unknown as globalThis.HTMLElement;
  const monitor = new ServerMonitor(root), history = new TelemetryHistory(), r = room();
  r.ultimateMode = true; history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.equal(root.querySelector<globalThis.HTMLElement>('#monitor-ultimates')!.hidden, false);
  r.members[0].ultimate = { charge: 0, remainingMs: 5000, uses: 1 };
  assert.equal(serverMetrics(r, 4).matched, false, 'a regular matching strategy cannot counter the fourth move');
  history.update([r]); history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.equal(history.get(r.id)!.events.filter(e => e.text.includes('暗網超頻啟動')).length, 1);
  assert.match(root.querySelector('#monitor-ultimates')!.textContent!, /5.0 秒/);
  assert.match(root.querySelector('.monitor-attacker')!.textContent!, /暗網超頻/);
  r.members[1].ultimate = { charge: 0, remainingMs: 4800, uses: 1 }; history.update([r]); monitor.render(r, history.get(r.id)!);
  assert.equal(serverMetrics(r, 4).matched, true); assert.match(root.querySelector('.monitor-defender')!.textContent!, /緊急應變/);
  r.ultimateMode = false; monitor.render(r, history.get(r.id)!);
  assert.equal(root.querySelector<globalThis.HTMLElement>('#monitor-ultimates')!.hidden, true);
});
