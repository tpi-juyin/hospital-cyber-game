import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, GameError } from '../src/server/engine';
import { STRATEGIES, type Role } from '../src/shared/protocol';

function fixture(duration = 60) {
  let now = 0; const engine = new Engine(() => now, () => .25);
  const a = engine.connect(), d = engine.connect();
  engine.action(a.id, { kind: 'create', mode: 'duo', role: 'attack', duration });
  const waiting = engine.playerView(a.id)!; engine.action(d.id, { kind: 'join', code: waiting.code });
  const start = () => { engine.action(a.id, { kind: 'ready', ready: true }); engine.action(d.id, { kind: 'ready', ready: true }); now += 3000; engine.advance(); };
  return { engine, a, d, start, advance: (ms: number) => { now += ms; engine.advance(); }, tap: (id: string, seq: number) => engine.action(id, { kind: 'tap', roundId: engine.playerView(id)!.roundId, seq }), switch: (id: string, seq: number, strategy: number) => engine.action(id, { kind: 'strategy', roundId: engine.playerView(id)!.roundId, seq, strategy }) };
}
const code = (expected: string) => (e: unknown) => e instanceof GameError && e.code === expected;
test('round lessons follow both sides independently, including mismatched defenses and ultimate mode', () => {
  for (const ultimate of [false, true]) for (const attack of [0, 1, 2]) for (const defense of [0, 1, 2]) {
    const f = fixture(); f.engine.setUltimateMode(ultimate); f.start();
    f.switch(f.a.id, 1, attack); f.switch(f.d.id, 1, defense);
    f.tap(f.a.id, 2); f.tap(f.d.id, 2);
    f.advance(60000);
    const ended = f.engine.playerView(f.a.id)!;
    assert.equal(ended.phase, 'ended');
    assert.deepEqual(ended.lessons, [STRATEGIES[attack].attackTip, STRATEGIES[defense].defenseTip]);
    assert.deepEqual(f.engine.playerView(f.d.id)!.lessons, ended.lessons);
  }
});
test('lessons use the most frequent effective strategy, ignore rejected taps and reset next round', () => {
  const f = fixture(); f.start();
  f.switch(f.a.id, 1, 2); f.switch(f.d.id, 1, 1);
  f.tap(f.a.id, 2); f.tap(f.a.id, 3); f.tap(f.d.id, 2); f.tap(f.d.id, 3);
  f.advance(3000);
  f.switch(f.a.id, 4, 0); f.switch(f.d.id, 4, 2);
  f.tap(f.a.id, 5); f.tap(f.d.id, 5);
  for (let i = 0; i < 3; i++) assert.throws(() => f.tap(f.a.id, 5), code('STALE_INPUT'));
  f.advance(60000);
  assert.deepEqual(f.engine.playerView(f.a.id)!.lessons, [STRATEGIES[2].attackTip, STRATEGIES[1].defenseTip]);
  f.engine.action(f.a.id, { kind: 'rematch' });
  assert.deepEqual(f.engine.playerView(f.a.id)!.lessons, []);
  f.start(); f.advance(60000);
  assert.deepEqual(f.engine.playerView(f.a.id)!.lessons, [STRATEGIES[0].attackTip, STRATEGIES[0].defenseTip]);
});
test('lessons prefer the selected strategy for ties and rounds without taps, even without a winner', () => {
  for (const tiedTaps of [false, true]) {
    const f = fixture(); f.start();
    if (tiedTaps) { f.tap(f.a.id, 1); f.tap(f.d.id, 1); }
    f.switch(f.a.id, 2, 2); f.switch(f.d.id, 2, 1);
    if (tiedTaps) { f.tap(f.a.id, 3); f.tap(f.d.id, 3); }
    f.engine.disconnect(f.d.id); f.advance(10000);
    const ended = f.engine.playerView(f.a.id)!;
    assert.equal(ended.winner, null);
    assert.deepEqual(ended.lessons, [STRATEGIES[2].attackTip, STRATEGIES[1].defenseTip]);
  }
});
test('surrender defaults off, requires an active round and remains host-controlled', () => {
  const f = fixture();
  const surrender = () => f.engine.action(f.a.id, { kind: 'surrender', roundId: f.engine.playerView(f.a.id)!.roundId, seq: 1 });
  assert.equal(f.engine.lobby().allowSurrender, false);
  f.engine.allowSurrender = true;
  assert.throws(surrender, code('NOT_PLAYING'));
  f.engine.action(f.a.id, { kind: 'ready', ready: true }); f.engine.action(f.d.id, { kind: 'ready', ready: true });
  assert.throws(surrender, code('NOT_PLAYING'));
  f.advance(3000); f.engine.allowSurrender = false;
  assert.throws(surrender, code('SURRENDER_DISABLED'));
  assert.throws(() => f.engine.action(f.a.id, { kind: 'allow-surrender', value: true }), code('LOCKED'));
  assert.equal(f.engine.allowSurrender, false);
  f.engine.allowSurrender = true; f.engine.disconnect(f.d.id);
  assert.throws(surrender, code('NOT_PLAYING'));
  f.engine.connect(f.d.token); surrender();
  assert.equal(f.engine.playerView(f.a.id)!.winner, 'defense');
});
test('either role can surrender solo or duo; stats and HP are preserved and rematch resets', () => {
  for (const mode of ['solo', 'duo'] as const) for (const role of ['attack', 'defense'] as const) {
    let now = 0; const e = new Engine(() => now), p = e.connect(); e.allowSurrender = true;
    e.action(p.id, { kind: 'create', mode, role, duration: 60 });
    if (mode === 'duo') { const other = e.connect(); e.action(other.id, { kind: 'join', code: e.playerView(p.id)!.code }); e.action(other.id, { kind: 'ready', ready: true }); }
    e.action(p.id, { kind: 'ready', ready: true }); now = 3000; e.advance();
    const roundId = e.playerView(p.id)!.roundId;
    e.action(p.id, { kind: 'tap', roundId, seq: 1 }); const before = e.playerView(p.id)!;
    e.action(p.id, { kind: 'surrender', roundId, seq: 2 }); const ended = e.playerView(p.id)!;
    assert.equal(ended.phase, 'ended'); assert.equal(ended.winner, role === 'attack' ? 'defense' : 'attack');
    assert.match(ended.reason, /投降/); assert.equal(ended.hp, before.hp); assert.equal(ended.shield, before.shield);
    assert.deepEqual(ended.members.map(m => m.stats), before.members.map(m => m.stats));
    assert.throws(() => e.action(p.id, { kind: 'surrender', roundId, seq: 2 }), code('NOT_PLAYING'));
    e.action(p.id, { kind: 'rematch' }); assert.equal(e.playerView(p.id)!.phase, 'waiting'); assert.equal(e.playerView(p.id)!.winner, null);
    assert.notEqual(e.playerView(p.id)!.roundId, roundId); assert.equal(e.lobby().allowSurrender, true);
  }
});
test('surrender validates sequence, round identity and membership without affecting other rooms', () => {
  const f = fixture(); f.engine.allowSurrender = true; f.start(); f.tap(f.a.id, 1);
  const roundId = f.engine.playerView(f.a.id)!.roundId;
  const other = f.engine.connect();
  assert.throws(() => f.engine.action(other.id, { kind: 'surrender', roundId, seq: 2 }), code('NO_ROOM'));
  f.engine.action(other.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 }); f.engine.action(other.id, { kind: 'ready', ready: true }); f.advance(3000);
  assert.throws(() => f.engine.action(other.id, { kind: 'surrender', roundId, seq: 2 }), code('STALE_ROUND'));
  for (const seq of [1, -1, NaN, 1.5]) assert.throws(() => f.engine.action(f.a.id, { kind: 'surrender', roundId, seq }), code('STALE_INPUT'));
  f.engine.action(f.a.id, { kind: 'surrender', roundId, seq: 2 });
  assert.equal(f.engine.playerView(other.id)!.phase, 'playing');
  f.engine.action(f.a.id, { kind: 'rematch' }); f.start();
  assert.throws(() => f.engine.action(f.a.id, { kind: 'surrender', roundId, seq: 3 }), code('STALE_ROUND'));
});
test('a surrender arriving at the deadline cannot overwrite the timeout result', () => {
  const f = fixture(30); f.engine.allowSurrender = true; f.start();
  const roundId = f.engine.playerView(f.d.id)!.roundId;
  f.advance(30000);
  assert.throws(() => f.engine.action(f.d.id, { kind: 'surrender', roundId, seq: 1 }), code('NOT_PLAYING'));
  assert.equal(f.engine.playerView(f.d.id)!.winner, 'defense');
});
test('four-digit codes are unique for the entire activity, including closed rooms', () => {
  const e = new Engine(); const p = e.connect(); const used = new Set<string>();
  for (let i = 0; i < 250; i++) { e.action(p.id, { kind: 'create', mode: 'solo', role: 'defense', duration: 60 }); const r = e.playerView(p.id)!; assert.match(r.code, /^[1-9][0-9]{3}$/); assert.ok(!used.has(r.code)); used.add(r.code); e.closeRoom(r.id); }
  assert.equal(e.players.size, 1);
});
test('joining, occupancy, roles, room authority and capacity are enforced', () => {
  const f = fixture(); const third = f.engine.connect(); const r = f.engine.playerView(f.a.id)!;
  assert.throws(() => f.engine.action(third.id, { kind: 'join', code: r.code }), code('FULL'));
  f.engine.action(f.a.id, { kind: 'role', role: 'defense' });
  assert.equal(f.engine.playerView(f.a.id)!.members.filter(m => m.role === 'defense').length, 2);
  f.engine.action(f.a.id, { kind: 'role', role: 'attack' });
  assert.throws(() => f.engine.action(f.d.id, { kind: 'duration', duration: 30 }), code('FORBIDDEN'));
  assert.throws(() => f.engine.action(f.a.id, { kind: 'duration', duration: 32 }), code('INVALID'));
  f.engine.action(f.a.id, { kind: 'ready', ready: true }); f.engine.action(f.a.id, { kind: 'duration', duration: 90 });
  assert.equal(f.engine.playerView(f.a.id)!.members.find(m => m.id === f.a.id)!.ready, false);
  for (let i = 3; i < 30; i++) f.engine.connect();
  assert.throws(() => f.engine.connect(), code('CAPACITY'));
  assert.equal(f.engine.connect(f.a.token).id, f.a.id);
});
test('free role selection supports swapping, rejects same-side readiness and cancels both players readiness', () => {
  const f = fixture(), view = () => f.engine.playerView(f.a.id)!;
  f.engine.action(f.a.id, { kind: 'ready', ready: true });
  f.engine.action(f.d.id, { kind: 'role', role: 'attack' });
  assert.ok(view().members.every(m => !m.ready));
  assert.equal(view().phase, 'waiting');
  for (const id of [f.a.id, f.d.id]) assert.throws(() => f.engine.action(id, { kind: 'ready', ready: true }), code('ROLE_CONFLICT'));
  assert.equal(view().phase, 'waiting');
  f.engine.action(f.a.id, { kind: 'role', role: 'defense' });
  assert.deepEqual(view().members.map(m => m.role), ['defense', 'attack']);
  f.start(); assert.equal(view().phase, 'playing');
  assert.throws(() => f.engine.action(f.a.id, { kind: 'role', role: 'attack' }), code('LOCKED'));
});

test('solo create and rematch can start atomically; duo cannot bypass either readiness', () => {
  for (const role of ['attack', 'defense'] as const) for (const duration of [30, 60, 120]) {
    let now = 0; const e = new Engine(() => now), p = e.connect();
    e.action(p.id, { kind: 'create', mode: 'solo', role, duration, startImmediately: true });
    assert.equal(e.playerView(p.id)!.phase, 'countdown'); assert.equal(e.playerView(p.id)!.remainingMs, 3000);
    e.disconnect(p.id); now = 1000; e.connect(p.token); assert.equal(e.playerView(p.id)!.remainingMs, 3000);
    now += 3000; e.advance(); assert.equal(e.playerView(p.id)!.remainingMs, duration * 1000);
    e.allowSurrender = true; e.action(p.id, { kind: 'surrender', roundId: e.playerView(p.id)!.roundId, seq: 1 });
    e.action(p.id, { kind: 'rematch', startImmediately: true });
    assert.equal(e.playerView(p.id)!.phase, 'countdown'); assert.equal(e.playerView(p.id)!.hp, 100);
    assert.equal(e.playerView(p.id)!.members[0].role, role);
  }
  const e = new Engine(), p = e.connect();
  assert.throws(() => e.action(p.id, { kind: 'create', mode: 'duo', role: 'attack', duration: 60, startImmediately: true }), code('INVALID'));
  assert.equal(e.rooms.size, 0); assert.equal(e.playerView(p.id), null);
  const f = fixture(); f.start(); f.advance(60000);
  assert.throws(() => f.engine.action(f.a.id, { kind: 'rematch', startImmediately: true }), code('INVALID'));
  assert.equal(f.engine.playerView(f.a.id)!.phase, 'ended');
});

test('only both ready starts the countdown and combat input cannot bypass it', () => {
  const f = fixture(); f.engine.action(f.a.id, { kind: 'ready', ready: true }); assert.equal(f.engine.playerView(f.a.id)!.phase, 'waiting');
  assert.throws(() => f.tap(f.a.id, 1), code('NOT_PLAYING'));
  f.engine.action(f.d.id, { kind: 'ready', ready: true }); assert.equal(f.engine.playerView(f.a.id)!.phase, 'countdown');
  f.advance(2999); assert.throws(() => f.tap(f.a.id, 1), code('NOT_PLAYING')); f.advance(1); assert.equal(f.engine.playerView(f.a.id)!.phase, 'playing');
});
test('matched defense spends fewer shield points, excess damage reaches health', () => {
  const f = fixture(); f.start(); f.tap(f.a.id, 1); let r = f.engine.playerView(f.a.id)!;
  assert.equal(r.hp, 100); assert.equal(r.shield, 29.08);
  f.switch(f.a.id, 2, 1); f.tap(f.a.id, 3); r = f.engine.playerView(f.a.id)!; assert.equal(r.shield, 24.48);
  f.tap(f.d.id, 1); assert.equal(f.engine.playerView(f.a.id)!.shield, 25.18);
  for (let i = 4; i < 150 && f.engine.playerView(f.a.id)!.phase === 'playing'; i++) { f.advance(200); f.tap(f.a.id, i); }
  r = f.engine.playerView(f.a.id)!; assert.equal(r.winner, 'attack'); assert.equal(r.hp, 0);
});
test('rate caps, sequence replay, round identity, cooldowns and invalid payloads', () => {
  const f = fixture(); f.start(); for (let i = 1; i <= 6; i++) f.tap(f.a.id, i);
  assert.throws(() => f.tap(f.a.id, 7), code('RATE_LIMIT')); assert.throws(() => f.tap(f.a.id, 6), code('STALE_INPUT'));
  assert.throws(() => f.engine.action(f.a.id, { kind: 'tap', seq: 99, roundId: 'old' }), code('STALE_ROUND'));
  f.switch(f.a.id, 8, 1); assert.throws(() => f.switch(f.a.id, 9, 2), code('COOLDOWN'));
  assert.throws(() => f.switch(f.d.id, 1, -1), code('INVALID'));
  f.advance(1000); f.tap(f.a.id, 10); assert.equal(f.engine.playerView(f.a.id)!.members[0].stats.taps, 7);
  f.advance(2000); f.switch(f.a.id, 11, 2);
});
test('both roles wait a full three seconds before switching again', () => {
  for (const role of ['a', 'd'] as const) {
    const f = fixture(); f.start(); const id = f[role].id;
    f.switch(id, 1, 1); assert.equal(f.engine.playerView(id)!.members.find(m => m.id === id)!.cooldownMs, 3000);
    f.advance(500); assert.throws(() => f.switch(id, 2, 2), code('COOLDOWN'));
    f.advance(2499); assert.throws(() => f.switch(id, 3, 2), code('COOLDOWN'));
    f.advance(1); f.switch(id, 4, 2);
  }
});
for (const duration of [30, 60, 120]) {
  test(`${duration}s duration scales damage and ends exactly at the server deadline`, () => {
    const f = fixture(duration); f.start(); f.tap(f.a.id, 1);
    assert.ok(Math.abs(f.engine.playerView(f.a.id)!.shield - (30 - 1.15 * 60 / duration / 1.25)) < .011);
    f.advance(duration * 1000 - 1); assert.equal(f.engine.playerView(f.a.id)!.phase, 'playing');
    f.advance(1); assert.equal(f.engine.playerView(f.a.id)!.winner, 'defense'); assert.throws(() => f.tap(f.a.id, 2), code('NOT_PLAYING'));
    const oldRound = f.engine.playerView(f.a.id)!.roundId; f.engine.action(f.a.id, { kind: 'rematch' });
    const r = f.engine.playerView(f.a.id)!; assert.notEqual(r.roundId, oldRound); assert.equal(r.hp, 100); assert.equal(r.shield, 30); assert.ok(r.members.every(m => !m.ready));
  });
}
test('disconnect freezes only its room and reconnect restores authoritative state', () => {
  const f = fixture(); f.start(); f.advance(8000); const other = f.engine.connect(); f.engine.action(other.id, { kind: 'create', mode: 'solo', role: 'defense', duration: 60 }); f.engine.action(other.id, { kind: 'ready', ready: true });
  const before = f.engine.playerView(f.a.id)!; f.engine.disconnect(f.d.id); f.advance(5000);
  assert.equal(f.engine.playerView(f.a.id)!.remainingMs, before.remainingMs); assert.equal(f.engine.playerView(other.id)!.phase, 'playing');
  f.engine.connect(f.d.token); assert.equal(f.engine.playerView(f.a.id)!.phase, 'playing'); assert.equal(f.engine.playerView(f.a.id)!.remainingMs, before.remainingMs);
  f.advance(1000); assert.equal(f.engine.playerView(f.a.id)!.remainingMs, before.remainingMs - 1000);
});
test('10 second disconnect and 20 second cumulative limit yield no winner', () => {
  const f = fixture(); f.start();
  for (let i = 0; i < 2; i++) { f.engine.disconnect(f.d.id); f.advance(9000); f.engine.connect(f.d.token); }
  f.engine.disconnect(f.d.id); f.advance(1999); assert.equal(f.engine.playerView(f.a.id)!.phase, 'paused'); f.advance(1);
  assert.equal(f.engine.playerView(f.a.id)!.phase, 'ended'); assert.equal(f.engine.playerView(f.a.id)!.winner, null);
  const g = fixture(); g.start(); g.engine.disconnect(g.a.id); g.advance(10000); assert.equal(g.engine.playerView(g.d.id)!.winner, null); assert.equal(g.engine.playerView(g.d.id)!.phase, 'ended');
});
test('disconnect during countdown resumes countdown without replaying elapsed time', () => {
  const f = fixture(); f.engine.action(f.a.id, { kind: 'ready', ready: true }); f.engine.action(f.d.id, { kind: 'ready', ready: true }); f.advance(1000); f.engine.disconnect(f.a.id); f.advance(5000); f.engine.connect(f.a.token); assert.equal(f.engine.playerView(f.a.id)!.remainingMs, 2000); f.advance(2000); assert.equal(f.engine.playerView(f.a.id)!.phase, 'playing');
});
test('leaving or closing affects only the selected room; expired rooms release resources', () => {
  const f = fixture(); f.start(); f.engine.action(f.a.id, { kind: 'leave' }); assert.equal(f.engine.playerView(f.d.id)!.winner, null); assert.equal(f.engine.playerView(f.d.id)!.phase, 'ended');
  f.engine.action(f.d.id, { kind: 'leave' }); assert.equal(f.engine.rooms.size, 0);
  f.engine.action(f.a.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 }); f.advance(600000); assert.equal(f.engine.rooms.size, 0); assert.equal(f.engine.players.size, 2);
});
test('closed admission still permits a valid reconnect, never a fresh player', () => {
  const f = fixture(); f.start(); f.engine.accepting = false; assert.throws(() => f.engine.connect(), code('CLOSED')); f.engine.disconnect(f.d.id); assert.equal(f.engine.connect(f.d.token).id, f.d.id);
  assert.throws(() => f.engine.connect('unknown-token'), code('SESSION_EXPIRED'));
});
test('unreserved lobby reconnect cannot exceed 30 connected players', () => {
  const e = new Engine(); const p = e.connect(); e.disconnect(p.id); for (let i = 0; i < 30; i++) e.connect();
  assert.throws(() => e.connect(p.token), code('CAPACITY')); assert.equal(e.lobby().online, 30);
});
for (const role of ['attack', 'defense'] as Role[]) test(`solo ${role}: bot uses only legal cadence and both roles can complete rounds`, () => {
  let now = 0; const e = new Engine(() => now, () => .1); const p = e.connect(); e.action(p.id, { kind: 'create', mode: 'solo', role, duration: 30 }); e.action(p.id, { kind: 'ready', ready: true });
  for (now = 0; now <= 33000; now += 50) e.advance();
  const r = e.playerView(p.id)!; assert.equal(r.phase, 'ended'); const bot = r.members.find(m => m.bot)!; assert.ok(bot.stats.taps <= 120); assert.ok(r.hp >= 0 && r.shield >= 0 && r.shield <= 30);
});
test('equal speed with correct strategy survives; wrong strategy loses across durations', () => {
  for (const duration of [30, 60, 120]) for (const match of [true, false]) {
    const f = fixture(duration); f.start(); if (!match) f.switch(f.a.id, 1, 1);
    let seq = 2;
    for (let elapsed = 0; elapsed < duration * 1000 && f.engine.playerView(f.a.id)!.phase === 'playing'; elapsed += 250) {
      f.tap(f.d.id, seq); f.tap(f.a.id, seq++); f.advance(250);
    }
    assert.equal(f.engine.playerView(f.a.id)!.winner, match ? 'defense' : 'attack');
  }
});

test('new activities accept players and enable ultimates by default, while host can disable both', () => {
  const e = new Engine(); assert.equal(e.lobby().accepting, true); assert.equal(e.lobby().ultimateMode, true);
  const p = e.connect(); e.action(p.id, { kind: 'create', mode: 'solo', role: 'attack', duration: 60 });
  assert.equal(e.playerView(p.id)!.ultimateMode, true);
  e.setUltimateMode(false); e.accepting = false;
  assert.equal(e.playerView(p.id)!.ultimateMode, false); assert.throws(() => e.connect(), code('CLOSED'));
});
