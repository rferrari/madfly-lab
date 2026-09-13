/**
 * "I Know Blackjack" game logic, implemented to match Gymnasium's
 * `Blackjack-v1` environment exactly -- the task names that environment by
 * name, and it is a precise, well-known spec rather than an invented casino
 * variant. Standalone copy for the iknow-blackjack experience -- deliberately
 * not shared with experiences/blackjack/, so this experience has no
 * dependency on that one:
 *
 *   - Infinite deck: every card is drawn independently, uniformly from
 *     {1..10} (face cards J/Q/K count as 10; an Ace is drawn as 1 and
 *     re-valued to 11 by `handValue` when that keeps the hand <= 21).
 *   - Actions: Hit or Stand only. No doubling, no splitting.
 *   - Dealer: hits while total < 17, stands at 17 or over (soft or hard --
 *     Gymnasium's reference implementation does not special-case soft 17,
 *     and neither does this).
 *   - Reward: +1 win, -1 lose, 0 push. A player natural (21 on the first two
 *     cards) beats a non-natural dealer for +1 and is a push against a dealer
 *     natural -- but unlike the reference environment, THIS variant does not
 *     auto-resolve a natural before a decision: this experience exists to
 *     show the fly's own readout making a live Hit/Stand call every round
 *     (see iknow-blackjack.js), so a natural still goes through Stand (the
 *     only non-busting choice at 21) rather than skipping straight to the
 *     outcome.
 *
 * This module is pure game logic -- no THREE.js, no brain, no DOM. Sensory
 * encoding (state -> real ORN drives) and the learning loop live in sibling
 * modules that import this one.
 */

/** Draw one card, 1..10 uniformly (an infinite-deck draw, not a finite shoe). */
export function drawCard(rng = Math.random) {
  return Math.min(10, Math.floor(rng() * 13) + 1);
}

/**
 * Value of a hand, choosing whether an Ace counts as 11 ("usable") without
 * busting. Returns { total, usable } where `usable` is true iff at least one
 * Ace is currently being counted as 11.
 */
export function handValue(cards) {
  let total = cards.reduce((a, b) => a + b, 0);
  let aces = cards.filter((c) => c === 1).length;
  let usable = false;
  // An ace counts as 11 by adding 10 to the all-aces-as-1 sum, one at a time,
  // for as long as that stays <= 21 and there is an ace left to promote.
  while (aces > 0 && total + 10 <= 21) {
    total += 10;
    aces -= 1;
    usable = true;
  }
  return { total, usable };
}

export function isBust(cards) { return handValue(cards).total > 21; }
export function isNatural(cards) { return cards.length === 2 && handValue(cards).total === 21; }

/** Play out the dealer's hand per the fixed policy: hit while < 17. */
export function playDealer(cards, rng = Math.random) {
  const hand = [...cards];
  while (handValue(hand).total < 17) hand.push(drawCard(rng));
  return hand;
}

/** +1 win, -1 lose, 0 push, comparing two final hands (dealer already played out). */
export function resolve(playerCards, dealerCards) {
  const playerBust = isBust(playerCards);
  const dealerBust = isBust(dealerCards);
  if (playerBust) return -1;
  if (dealerBust) return 1;
  const p = handValue(playerCards).total;
  const d = handValue(dealerCards).total;
  if (p > d) return 1;
  if (p < d) return -1;
  return 0;
}

/**
 * One hand of blackjack, played one decision at a time so a caller (the
 * training loop) can inject a real sensory encode / brain step / reward
 * pulse between every Hit and the next.
 *
 * Usage:
 *   const hand = new Hand(rng);
 *   while (!hand.done) {
 *     const state = hand.state();         // {playerTotal, dealerUpcard, usableAce}
 *     const action = policy(state);       // 'hit' | 'stand'
 *     const { reward, done } = hand.step(action);
 *   }
 */
export class Hand {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.player = [drawCard(rng), drawCard(rng)];
    this.dealer = [drawCard(rng), drawCard(rng)];
    this.done = false;
    this.reward = 0;
    // Deliberately NOT auto-resolving a player natural here -- see the module
    // docstring. `step()` handles it: Stand plays the dealer out and
    // `resolve()` still scores a natural-vs-natural push / natural-vs-lower
    // win correctly, since it only compares final totals.
  }

  /** Current decision-point state, in the classic (total, dealer-upcard, ace) form. */
  state() {
    const { total, usable } = handValue(this.player);
    return { playerTotal: total, dealerUpcard: this.dealer[0], usableAce: usable };
  }

  /** @param {'hit'|'stand'} action @returns {{reward:number, done:boolean}} */
  step(action) {
    if (this.done) return { reward: this.reward, done: true };

    if (action === 'hit') {
      this.player.push(drawCard(this.rng));
      if (isBust(this.player)) {
        this.done = true;
        this.reward = -1;
      }
      return { reward: this.done ? this.reward : 0, done: this.done };
    }

    // 'stand': the dealer plays out and the hand resolves.
    this.dealer = playDealer(this.dealer, this.rng);
    this.reward = resolve(this.player, this.dealer);
    this.done = true;
    return { reward: this.reward, done: true };
  }
}
