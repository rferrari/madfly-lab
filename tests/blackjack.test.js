/**
 * Pure game-logic tests for examples/blackjack/blackjack.js -- no brain, no
 * THREE.js, verified against known Blackjack-v1 statistics rather than just
 * internal self-consistency.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drawCard, handValue, isBust, isNatural, playDealer, resolve, Hand } from '../examples/blackjack/blackjack.js';

function seeded(s) {
  let x = s >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

describe('card values', () => {
  test('drawCard is always 1..10', () => {
    const rng = seeded(1);
    for (let i = 0; i < 2000; i++) {
      const c = drawCard(rng);
      assert.ok(c >= 1 && c <= 10, `card ${c} out of range`);
    }
  });

  test('handValue promotes exactly one ace to 11 when it fits', () => {
    assert.deepEqual(handValue([1, 10]), { total: 21, usable: true });   // blackjack
    assert.deepEqual(handValue([1, 9]), { total: 20, usable: true });
    assert.deepEqual(handValue([1, 1, 9]), { total: 21, usable: true }); // soft 21
    assert.deepEqual(handValue([10, 10, 1]), { total: 21, usable: false }); // ace forced to 1
  });

  test('isBust / isNatural', () => {
    assert.equal(isBust([10, 10, 5]), true);
    assert.equal(isBust([10, 10]), false);
    assert.equal(isNatural([1, 10]), true);
    assert.equal(isNatural([9, 9, 3]), false); // 21 but three cards, not natural
  });
});

describe('dealer policy and resolution', () => {
  test('dealer hits strictly below 17, then stops', () => {
    const rng = seeded(2);
    for (let i = 0; i < 200; i++) {
      const hand = playDealer([2, 3], rng);
      assert.ok(handValue(hand).total >= 17 || isBust(hand));
    }
  });

  test('resolve: bust, high total, tie', () => {
    assert.equal(resolve([10, 10, 5], [10, 9]), -1); // player bust
    assert.equal(resolve([10, 9], [10, 10, 5]), 1);  // dealer bust
    assert.equal(resolve([10, 9], [10, 8]), 1);      // 19 beats 18
    assert.equal(resolve([10, 8], [10, 9]), -1);
    assert.equal(resolve([10, 9], [10, 9]), 0);       // push
  });
});

describe('Hand -- one decision point at a time', () => {
  test('a natural resolves immediately, no decision needed', () => {
    // Force player [Ace, King] via a rng returning exactly the draws we want.
    const scripted = [0.0, 0.7]; // drawCard: floor(r*13)+1 clamped to 10 -> 1, then 10
    let i = 0;
    const rng = () => scripted[i++];
    const hand = new Hand(rng);
    assert.equal(hand.done, true);
    assert.ok(hand.reward === 1 || hand.reward === 0); // win, or push vs dealer natural
  });

  test('hit until bust ends the hand with reward -1', () => {
    const rng = seeded(3);
    for (let trial = 0; trial < 100; trial++) {
      const hand = new Hand(rng);
      let guard = 0;
      while (!hand.done && guard++ < 20) hand.step('hit');
      assert.equal(hand.done, true);
      if (isBust(hand.player)) assert.equal(hand.reward, -1);
    }
  });

  test('stand always ends the hand (terminal)', () => {
    const rng = seeded(4);
    for (let trial = 0; trial < 50; trial++) {
      const hand = new Hand(rng);
      if (hand.done) continue; // natural, no decision to make
      const { done } = hand.step('stand');
      assert.equal(done, true);
      assert.ok([-1, 0, 1].includes(hand.reward));
    }
  });

  test('state() reports total/upcard/usableAce consistent with handValue', () => {
    const rng = seeded(5);
    const hand = new Hand(rng);
    if (!hand.done) {
      const s = hand.state();
      const v = handValue(hand.player);
      assert.equal(s.playerTotal, v.total);
      assert.equal(s.usableAce, v.usable);
      assert.equal(s.dealerUpcard, hand.dealer[0]);
    }
  });
});

describe('policy comparison -- matches known Blackjack-v1 statistics', () => {
  // These bands are wide on purpose: this asserts the engine is in the right
  // ballpark of well-known reference numbers, not a specific RNG's exact luck.
  function play(policy, n, seed) {
    const rng = seeded(seed);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const hand = new Hand(rng);
      while (!hand.done) hand.step(policy(hand.state()));
      total += hand.reward;
    }
    return total / n;
  }

  test('random policy averages roughly -0.3 to -0.42', () => {
    const avg = play((s, rng = Math.random) => (Math.random() < 0.5 ? 'hit' : 'stand'), 20000, 11);
    assert.ok(avg < -0.28 && avg > -0.45, `random policy avg ${avg} outside expected band`);
  });

  test('"hit below 17" beats "always stand", both beat random', () => {
    const random = play(() => (Math.random() < 0.5 ? 'hit' : 'stand'), 20000, 12);
    const alwaysStand = play(() => 'stand', 20000, 12);
    const hitBelow17 = play((s) => (s.playerTotal < 17 ? 'hit' : 'stand'), 20000, 12);
    assert.ok(hitBelow17 > alwaysStand, `hit<17 (${hitBelow17}) should beat always-stand (${alwaysStand})`);
    assert.ok(alwaysStand > random, `always-stand (${alwaysStand}) should beat random (${random})`);
  });
});
