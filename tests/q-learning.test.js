/**
 * QReadout is a small linear TD-learning function approximator, tested here
 * in isolation from any brain -- it only ever sees plain feature vectors, the
 * same as it would from real calibrated DN readings.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QReadout, ACTIONS } from '../src/training/q-learning.js';

describe('QReadout basics', () => {
  test('qValue is linear in features plus a bias term', () => {
    const q = new QReadout(2, { seed: 1 });
    q.weights.hit = [2, -1, 0.5]; // [w1, w2, bias]
    assert.equal(q.qValue([3, 4], 'hit'), 2 * 3 + -1 * 4 + 0.5 * 1);
  });

  test('greedyAction ties toward stand', () => {
    const q = new QReadout(1, { seed: 1 });
    q.weights.hit = [0, 0];
    q.weights.stand = [0, 0];
    assert.equal(q.greedyAction([5]), 'stand');
  });

  test('epsilon=0 chooseAction is deterministic and matches greedyAction', () => {
    const q = new QReadout(3, { seed: 7, epsilon: 0 });
    const f = [0.1, -0.2, 0.3];
    assert.equal(q.chooseAction(f), q.greedyAction(f));
  });

  test('ACTIONS is exactly hit/stand', () => {
    assert.deepEqual(ACTIONS, ['hit', 'stand']);
  });
});

describe('TD update', () => {
  test('a terminal update moves Q(features, action) toward the reward', () => {
    const q = new QReadout(2, { seed: 3, alpha: 0.5 });
    const features = [1, 1];
    const before = q.qValue(features, 'hit');
    for (let i = 0; i < 50; i++) q.update(features, 'hit', 1, null);
    const after = q.qValue(features, 'hit');
    assert.ok(Math.abs(after - 1) < Math.abs(before - 1),
      `Q should converge toward reward 1: before=${before}, after=${after}`);
    assert.ok(Math.abs(after - 1) < 0.05, `Q(features,hit) should be near 1, got ${after}`);
  });

  test('a non-terminal update bootstraps off the next state (gamma < 1 pulls it down)', () => {
    const q = new QReadout(1, { seed: 4, alpha: 0.3, gamma: 0.5 });
    // Fix stand's weights so max_a' Q(next, a') is a known constant.
    q.weights.stand = [0, 2]; // Q(next, stand) = 2 regardless of features
    q.weights.hit = [0, 0];
    const error = q.update([1], 'hit', 0, [1]); // reward 0, bootstrapped target = 0.5*2 = 1
    assert.ok(Math.abs(error - 1) < 1e-9, `expected TD error ~1 (0 + 0.5*2 - 0), got ${error}`);
  });

  test('recordOutcome / successRate track wins correctly', () => {
    const q = new QReadout(1, { seed: 5 });
    for (const r of [1, -1, 0, 1, -1, -1]) q.recordOutcome(r);
    assert.equal(q.trials, 6);
    assert.equal(q.wins, 2);
    assert.equal(q.losses, 3);
    assert.equal(q.pushes, 1);
    assert.equal(q.successRate, 2 / 6);
  });
});

describe('a linear readout CAN learn a simple two-state Q-table', () => {
  // Not blackjack -- a minimal sanity check that repeated TD updates converge
  // to sensible relative Q-values on a toy one-step bandit-like task: feature
  // [1,0] should prefer 'hit' (reward 1), feature [0,1] should prefer 'stand'
  // (reward 1), each poisoned by an opposite, wrong action (reward -1).
  test('converges to the correct action per distinguishable feature', () => {
    const q = new QReadout(2, { seed: 9, alpha: 0.1, epsilon: 0 });
    const A = [1, 0];
    const B = [0, 1];
    for (let i = 0; i < 500; i++) {
      q.update(A, 'hit', 1, null);
      q.update(A, 'stand', -1, null);
      q.update(B, 'stand', 1, null);
      q.update(B, 'hit', -1, null);
    }
    assert.equal(q.greedyAction(A), 'hit');
    assert.equal(q.greedyAction(B), 'stand');
  });
});
