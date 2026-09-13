/**
 * Adapts blackjack.js + blackjack-sensory.js to the TrainingLoop task
 * interface (src/training/training-loop.js). This is where the framework's
 * generic training machinery meets a SPECIFIC choice of task -- everything in
 * this file is blackjack, nothing in it is reusable for a different task.
 */

import { Hand } from './blackjack.js';
import { encodeState } from './blackjack-sensory.js';

export class BlackjackTask {
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
export const BLACKJACK_FEATURE_CHANNELS = ['DNa01_L', 'DNa01_R', 'DNp03', 'DNp13'];
