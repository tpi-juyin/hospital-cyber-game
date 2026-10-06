import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, GameError } from '../src/server/engine';
import { combatStrategy, defenseMatches, type Strategy } from '../src/shared/protocol';

const error = (code: string) => (value: unknown) => value instanceof GameError && value.code === code;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .015, `${actual} != ${expected}`);
function duel(duration = 60, enabled = true) {
  let now = 0; const e = new Engine(() => now, () => .25), a = e.connect(), d = e.connect();
  e.setUltimateMode(enabled);
  e.action(a.id, { kind: 'create', mode: 'duo', role: 'attack', duration });
  e.action(d.id, { kind: 'join', code: e.playerView(a.id)!.code });
  const view = () => e.playerView(a.id)!;
  const input = (id: string, kind: 'tap' | 'ultimate' | 'strategy', strategy: Strategy = 0) => e.action(id, { kind, strategy, roundId: view().roundId, seq: e.players.get(id)!.lastSeq + 1 });
  const advance = (ms: number) => { now += ms; e.advance(); };
  const start = () => { e.action(a.id, { kind: 'ready', ready: true }); e.action(d.id, { kind: 'ready', ready: true }); advance(3000); };
  const fill = (id: string) => { e.players.get(id)!.charge = 100; }; // Isolate combat boundaries from charging tests below.
  return { e, a, d, view, input, advance, start, fill };
}

test('ultimate mode is host-controlled, resets waiting readiness and never changes an active round', () => {
  const f = duel(60, false); assert.equal(f.e.lobby().ultimateMode, false);
  f.e.action(f.a.id, { kind: 'ready', ready: true }); f.e.setUltimateMode(true);
  assert.equal(f.view().ultimateMode, true); assert.equal(f.view().members[0].ready, false);
  f.e.action(f.a.id, { kind: 'ready', ready: true }); f.e.action(f.d.id, { kind: 'ready', ready: true });
  f.e.setUltimateMode(false); assert.equal(f.view().ultimateMode, true, 'countdown locks this round');
  f.advance(3000); f.fill(f.a.id); f.input(f.a.id, 'ultimate');
  assert.equal(f.view().members[0].ultimate.remainingMs, 5000);
  f.e.allowSurrender = true; f.e.action(f.a.id, { kind: 'surrender', roundId: f.view().roundId, seq: 2 });
  f.e.action(f.a.id, { kind: 'rematch' });
  assert.equal(f.view().ultimateMode, false); assert.deepEqual(f.view().members[0].ultimate, { charge: 0, remainingMs: 0, uses: 0 });
  assert.throws(() => f.e.action(f.a.id, { kind: 'ultimate-mode', value: true }), error('INVALID'));
});

test('only accepted taps charge, including at full shields; idle time and strategy switches never charge', () => {
  for (const duration of [30, 60, 120]) {
    const f = duel(duration); f.advance(2000); assert.equal(f.view().members[0].ultimate.charge, 0);
    f.start(); assert.equal(f.view().members[0].ultimate.charge, 0);
    f.advance(duration * 100); near(f.view().members[0].ultimate.charge, 0);
    for (let i = 0; i < 6; i++) f.input(f.d.id, 'tap');
    const charged = f.view().members[1].ultimate.charge;
    assert.ok(Math.abs(charged - (6 * 1.25 * 60 / duration)) <= .1);
    assert.throws(() => f.input(f.d.id, 'tap'), error('RATE_LIMIT'));
    assert.equal(f.view().members[1].ultimate.charge, charged);
    const last = f.e.players.get(f.d.id)!.lastSeq;
    assert.throws(() => f.e.action(f.d.id, { kind: 'tap', seq: last, roundId: f.view().roundId }), error('STALE_INPUT'));
    assert.equal(f.view().members[1].ultimate.charge, charged);
    f.input(f.a.id, 'strategy', 1); assert.equal(f.view().members[0].ultimate.charge, 0);
    f.advance(duration * 100); assert.equal(f.view().members[0].ultimate.charge, 0);
    assert.equal(f.view().members[1].ultimate.charge, charged);
    while (f.view().members[1].ultimate.charge < 100) { f.advance(250); f.input(f.d.id, 'tap'); }
    f.advance(250); f.input(f.d.id, 'tap'); assert.equal(f.view().members[1].ultimate.charge, 100);
  }
});

test('fourth move validates phase, room, sequence and charge; it bypasses cooldown and restores the original move at five seconds', () => {
  const f = duel(); assert.throws(() => f.input(f.a.id, 'ultimate'), error('NOT_PLAYING'));
  f.start(); assert.throws(() => f.input(f.a.id, 'ultimate'), error('ULTIMATE_CHARGING'));
  const stranger = f.e.connect(); assert.throws(() => f.input(stranger.id, 'ultimate'), error('NO_ROOM'));
  f.fill(f.a.id); f.input(f.a.id, 'strategy', 2);
  const roundId = f.view().roundId;
  assert.throws(() => f.e.action(f.a.id, { kind: 'ultimate', roundId: 'other-room', seq: 3 }), error('STALE_ROUND'));
  f.input(f.a.id, 'ultimate'); const seq = f.e.players.get(f.a.id)!.lastSeq;
  assert.equal(f.view().members[0].cooldownMs, 3000);
  assert.equal(combatStrategy(f.view().members[0]), 3); assert.equal(f.view().members[0].strategy, 2);
  assert.throws(() => f.e.action(f.a.id, { kind: 'ultimate', roundId, seq }), error('STALE_INPUT'));
  assert.throws(() => f.input(f.a.id, 'ultimate'), error('ULTIMATE_ACTIVE'));
  assert.throws(() => f.input(f.a.id, 'strategy', 1), error('ULTIMATE_ACTIVE'));
  f.advance(4999); f.input(f.a.id, 'tap'); assert.equal(f.view().members[0].ultimate.charge, 0);
  assert.equal(f.view().members[0].ultimate.remainingMs, 1);
  f.advance(1); assert.equal(combatStrategy(f.view().members[0]), 2); assert.equal(f.view().members[0].ultimate.charge, 0);
  f.advance(1000); near(f.view().members[0].ultimate.charge, 0);
  const ordinary = duel(60, false); ordinary.start(); ordinary.fill(ordinary.a.id);
  assert.throws(() => ordinary.input(ordinary.a.id, 'ultimate'), error('ULTIMATE_DISABLED'));
});

test('all three regular defenses are weak against the fourth attack; the fourth defense blocks either kind even with no shield', () => {
  for (const strategy of [0, 1, 2] as const) {
    const f = duel(); f.start(); f.input(f.d.id, 'strategy', strategy); f.fill(f.a.id); f.input(f.a.id, 'ultimate'); f.input(f.a.id, 'tap');
    near(f.view().shield, 30 - 1.15 * 1.5 / .25); assert.equal(defenseMatches(f.view().members[0], f.view().members[1]), false);
    const internal = f.e.rooms.get(f.view().id)!; internal.shield = 0;
    f.fill(f.d.id); f.input(f.d.id, 'ultimate'); f.input(f.a.id, 'tap');
    near(f.view().hp, 100 - 1.15 * 1.5 * .25);
    assert.equal(defenseMatches(f.view().members[0], f.view().members[1]), true);
    const hp = f.view().hp; f.input(f.d.id, 'tap'); near(f.view().shield, 1.05); assert.equal(f.view().hp, hp, 'no healing');
  }
  const f = duel(); f.start(); f.input(f.d.id, 'strategy', 1); f.e.rooms.get(f.view().id)!.shield = 0;
  f.fill(f.d.id); f.input(f.d.id, 'ultimate'); f.input(f.a.id, 'tap'); near(f.view().hp, 100 - 1.15 * .25);
});

test('pause freezes charge and the remaining burst, reconnect restores it, and an expired room clears the active effect', () => {
  const f = duel(); f.start(); f.advance(1000); f.fill(f.a.id); f.input(f.a.id, 'ultimate'); f.advance(2000);
  f.e.disconnect(f.d.id); const paused = f.view(); assert.equal(paused.members[0].ultimate.remainingMs, 3000);
  f.advance(5000); assert.deepEqual(f.view().members.map(m => m.ultimate), paused.members.map(m => m.ultimate));
  assert.throws(() => f.input(f.a.id, 'ultimate'), error('NOT_PLAYING'));
  f.e.connect(f.d.token); assert.equal(f.view().members[0].ultimate.remainingMs, 3000);
  f.advance(2999); assert.equal(combatStrategy(f.view().members[0]), 3);
  f.advance(1); assert.equal(combatStrategy(f.view().members[0]), 0);
  f.e.disconnect(f.d.id); f.advance(10000); assert.equal(f.view().winner, null); assert.equal(f.view().phase, 'ended');
  assert.ok(f.view().members.every(m => m.ultimate.remainingMs === 0));
});

test('natural four-tap play supplies two five-second bursts per duration, never a third or extra effective taps', () => {
  for (const duration of [30, 60, 120]) {
    const f = duel(duration); f.start(); const casts: number[] = [];
    for (let elapsed = 250; elapsed < duration * 1000 && f.view().phase === 'playing'; elapsed += 250) {
      f.advance(250);
      if (f.view().members[0].ultimate.charge >= 100) { f.input(f.a.id, 'ultimate'); f.input(f.d.id, 'ultimate'); casts.push(elapsed); }
      f.input(f.d.id, 'tap'); f.input(f.a.id, 'tap');
    }
    assert.equal(casts.length, 2); assert.ok(f.view().members.every(m => m.ultimate.uses === 2));
    f.advance(250); assert.equal(f.view().phase, 'ended'); assert.equal(f.view().winner, 'defense');
  }
  const f = duel(120); f.start();
  for (let i = 0; i < 2; i++) { f.fill(f.a.id); f.input(f.a.id, 'ultimate'); f.advance(5000); }
  f.advance(50000); assert.equal(f.view().members[0].ultimate.charge, 0);
  assert.throws(() => f.input(f.a.id, 'ultimate'), error('ULTIMATE_SPENT'));
  const rate = duel(); rate.start(); rate.fill(rate.a.id); rate.input(rate.a.id, 'ultimate');
  for (let i = 0; i < 6; i++) rate.input(rate.a.id, 'tap');
  assert.throws(() => rate.input(rate.a.id, 'tap'), error('RATE_LIMIT'));
});

test('solo attacker uses a charged ultimate; solo defender saves it and reacts after 650 ms despite strategy cooldown', () => {
  for (const role of ['attack', 'defense'] as const) {
    let now = 0; const e = new Engine(() => now, () => .25), human = e.connect(); e.setUltimateMode(true);
    e.action(human.id, { kind: 'create', mode: 'solo', role, duration: 60 }); e.action(human.id, { kind: 'ready', ready: true }); now = 3000; e.advance();
    const r = e.playerView(human.id)!, bot = e.players.get(r.members.find(m => m.bot)!.id)!;
    bot.charge = 100; bot.switchAt = now + 3000; e.advance();
    if (role === 'defense') { assert.equal(bot.ultimateUses, 1); assert.equal(bot.ultimateUntil - now, 5000); }
    else {
      assert.equal(bot.ultimateUses, 0); e.players.get(human.id)!.charge = 100;
      e.action(human.id, { kind: 'ultimate', roundId: r.roundId, seq: 1 });
      now += 649; e.advance(); assert.equal(bot.ultimateUses, 0);
      now++; e.advance(); assert.equal(bot.ultimateUses, 1); assert.equal(bot.ultimateUntil - now, 5000);
    }
  }
});
