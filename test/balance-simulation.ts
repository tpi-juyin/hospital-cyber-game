import { Engine } from '../src/server/engine';

/** Fixed-strategy duel with independent legal click cadences; no bot randomness. */
export function simulateBalance(duration: number, attackRate: number, defenseRate: number, matched: boolean) {
  let now = 0; const engine = new Engine(() => now), attacker = engine.connect(), defender = engine.connect();
  engine.action(attacker.id, { kind: 'create', mode: 'duo', role: 'attack', duration });
  engine.action(defender.id, { kind: 'join', code: engine.playerView(attacker.id)!.code });
  engine.action(attacker.id, { kind: 'ready', ready: true }); engine.action(defender.id, { kind: 'ready', ready: true });
  now = 3000; engine.advance();
  const roundId = engine.playerView(attacker.id)!.roundId;
  let attackSeq = 0, defenseSeq = 0;
  if (!matched) engine.action(defender.id, { kind: 'strategy', roundId, strategy: 1, seq: ++defenseSeq });
  const attackPeriod = Math.ceil(1000 / attackRate), defensePeriod = Math.ceil(1000 / defenseRate);
  let nextAttack = attackPeriod, nextDefense = defensePeriod;
  while (engine.playerView(attacker.id)!.phase === 'playing') {
    const elapsed = Math.min(nextAttack, nextDefense, duration * 1000); now = 3000 + elapsed; engine.advance();
    if (engine.playerView(attacker.id)!.phase !== 'playing') break;
    if (elapsed === nextDefense) { engine.action(defender.id, { kind: 'tap', roundId, seq: ++defenseSeq }); nextDefense += defensePeriod; }
    if (elapsed === nextAttack) { engine.action(attacker.id, { kind: 'tap', roundId, seq: ++attackSeq }); nextAttack += attackPeriod; }
  }
  const result = engine.playerView(attacker.id)!;
  return { duration, attackRate, defenseRate, matched, winner: result.winner, hp: result.hp, seconds: (now - 3000) / 1000 };
}

/** Real attacking bot; a human defender either holds one strategy or reacts after 400 ms. */
export function simulateSoloDefense(duration: number, defenseRate: number, reactive: boolean, rngValue = .25) {
  let now = 0; const engine = new Engine(() => now, () => rngValue), defender = engine.connect();
  engine.action(defender.id, { kind: 'create', mode: 'solo', role: 'defense', duration });
  engine.action(defender.id, { kind: 'ready', ready: true });
  now = 3000; engine.advance();
  const roundId = engine.playerView(defender.id)!.roundId;
  const period = Math.ceil(1000 / defenseRate);
  let seq = 0, nextTap = period, observedStrategy = 0, reactAt = Infinity;
  for (let elapsed = 1; elapsed <= duration * 1000; elapsed++) {
    now = 3000 + elapsed;
    // Server ticks at 20 Hz; player operations also advance the authoritative clock.
    if (elapsed % 50 === 0 || elapsed === nextTap) engine.advance();
    const room = engine.playerView(defender.id)!;
    if (room.phase !== 'playing') break;
    const bot = room.members.find(member => member.bot)!, human = room.members.find(member => !member.bot)!;
    if (observedStrategy !== bot.strategy) { observedStrategy = bot.strategy; reactAt = now + 400; }
    if (reactive && now >= reactAt && human.strategy !== bot.strategy && human.cooldownMs === 0) {
      engine.action(defender.id, { kind: 'strategy', roundId, strategy: bot.strategy, seq: ++seq });
    }
    if (elapsed === nextTap) {
      engine.action(defender.id, { kind: 'tap', roundId, seq: ++seq }); nextTap += period;
    }
  }
  const result = engine.playerView(defender.id)!, stats = result.members.find(member => !member.bot)!.stats;
  return { duration, defenseRate, reactive, rngValue, winner: result.winner, hp: result.hp, seconds: (now - 3000) / 1000,
    matchedPercent: Math.round(100 * stats.matchedHits / stats.hits) };
}
