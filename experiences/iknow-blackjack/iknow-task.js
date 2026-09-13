/**
 * Adapts iknow-game.js + iknow-sensory.js to the TrainingLoop task interface
 * (src/training/training-loop.js). Standalone copy for the iknow-blackjack
 * experience -- not shared with experiences/blackjack/'s blackjack-task.js.
 */

import { Hand } from './iknow-game.js';
import { encodeState } from './iknow-sensory.js';

export class IKnowBlackjackTask {
  constructor() { this.hand = null; }

  start(rng) {
    this.hand = new Hand(rng);
    return { state: this.hand.state(), done: this.hand.done, reward: this.hand.reward };
  }

  state() { return this.hand.state(); }

  step(action) { return this.hand.step(action); }

  encodeState(state) { return encodeState(state); }

  describe(state, action) {
    if (action == null) {
      return `NATURAL · ${this.hand.reward > 0 ? 'WIN' : 'PUSH'}`;
    }
    const label = `[Q-LEARNING] total=${state.playerTotal} dealer=${state.dealerUpcard}`
      + `${state.usableAce ? ' soft' : ''} -> ${action.toUpperCase()}`;
    return this.hand.done
      ? `${this.hand.reward > 0 ? 'WIN' : this.hand.reward < 0 ? 'LOSE' : 'PUSH'} · ${label}`
      : label;
  }
}

/** Real DN channels read as the Q-function's input. All real, all calibrated. */
export const IKNOW_FEATURE_CHANNELS = ['DNa01_L', 'DNa01_R', 'DNp03', 'DNp13'];
