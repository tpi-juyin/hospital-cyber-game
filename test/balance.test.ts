import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateBalance, simulateSoloDefense } from './balance-simulation';

test('fast wrong defense cannot outclick moderate attacks; correct defense can hold at each duration', () => {
  for (const duration of [30, 60, 120]) {
    assert.equal(simulateBalance(duration, 4, 6, false).winner, 'attack');
    assert.equal(simulateBalance(duration, 4, 6, true).winner, 'defense');
    assert.equal(simulateBalance(duration, 4, 4, true).winner, 'defense');
    assert.equal(simulateBalance(duration, 6, 6, true).winner, 'defense');
  }
});

test('against a switching bot, holding one defense loses while reacting within cooldown can hold', () => {
  for (const duration of [30, 60, 120]) for (const rng of [.25, .75]) {
    assert.equal(simulateSoloDefense(duration, 6, false, rng).winner, 'attack');
    assert.equal(simulateSoloDefense(duration, 4, true, rng).winner, 'defense');
  }
});
