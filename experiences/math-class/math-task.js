/**
 * "Math Class" -- Even vs. Odd visual discrimination, one decision per
 * trial: two dot counts are presented (one EVEN, one ODD, split randomly
 * left/right), and the fly must pick the side showing the EVEN count.
 *
 * Pure task logic -- no THREE.js, no brain, no DOM. Sensory encoding (state
 * -> real visual-interneuron drive) lives in dot-sensory.js; the scene that
 * wires this into TrainingLoop lives in tethered-scene.js. Same three-way
 * split experiences/blackjack/ uses (blackjack.js / blackjack-sensory.js /
 * blackjack-task.js), just two files instead of three since there's no
 * separate "pure rules" module worth splitting out from the adapter here.
 *
 * ARCHITECTURE NOTE (see src/training/q-learning.js's own header for the
 * full version): `TrainingLoop` drives a real connectome under a fixed rate
 * model, activation <- tanh(W . activation + input) -- there is no synaptic
 * weight-update rule anywhere in this framework, so the connectome cannot
 * learn "even vs. odd" no matter how long it runs. It is a fixed, real
 * feature reservoir. What learns is the `QReadout`: an ordinary linear TD
 * readout fit on top of that reservoir's real (but frozen) response to the
 * dot-count drive below.
 *
 * ACTION LABELS: `QReadout`'s two action slots are hardcoded 'hit'/'stand'
 * (see src/training/q-learning.js's `ACTIONS`) -- that file is framework
 * infrastructure and this task deliberately does not touch it. So this task
 * reuses those two slots under different names: 'hit' means "steer left",
 * 'stand' means "steer right". `describe()` below always renders them back
 * out as LEFT/RIGHT so nothing user-facing leaks the borrowed vocabulary.
 */

import { encodeState } from './dot-sensory.js';

const MIN_DOTS = 1;
const MAX_DOTS = 9;
const EVEN_CHOICES = [2, 4, 6, 8];
const ODD_CHOICES = [1, 3, 5, 7, 9];

// The vocabulary QReadout actually understands (see the module docstring)
// mapped to what this task means by them.
export const ACTION_TO_SIDE = { hit: 'left', stand: 'right' };
export const SIDE_TO_ACTION = { left: 'hit', right: 'stand' };

/** Draw one trial: one side even, one side odd, side assignment randomized. */
export function drawTrial(rng = Math.random) {
  const evenCount = EVEN_CHOICES[Math.floor(rng() * EVEN_CHOICES.length)];
  const oddCount = ODD_CHOICES[Math.floor(rng() * ODD_CHOICES.length)];
  const evenSide = rng() < 0.5 ? 'left' : 'right';
  const leftDots = evenSide === 'left' ? evenCount : oddCount;
  const rightDots = evenSide === 'left' ? oddCount : evenCount;
  return { leftDots, rightDots, evenSide };
}

/**
 * One trial, resolved in a single decision (unlike blackjack's multi-step
 * Hand -- there's no "hit again" here, just pick a side).
 */
export class Trial {
  constructor(rng = Math.random) {
    const { leftDots, rightDots, evenSide } = drawTrial(rng);
    this.leftDots = leftDots;
    this.rightDots = rightDots;
    this.evenSide = evenSide;
    this.done = false;
    this.reward = 0;
    this.chosenSide = null;
  }

  state() {
    return { leftDots: this.leftDots, rightDots: this.rightDots, evenSide: this.evenSide };
  }

  /** @param {'hit'|'stand'} action  see ACTION_TO_SIDE */
  step(action) {
    if (this.done) return { reward: this.reward, done: true };
    this.chosenSide = ACTION_TO_SIDE[action];
    this.reward = this.chosenSide === this.evenSide ? 1 : -1;
    this.done = true;
    return { reward: this.reward, done: true };
  }
}

/** Adapts Trial + dot-sensory.js to the TrainingLoop task interface. */
export class MathClassTask {
  constructor() { this.trial = null; }

  start(rng) {
    this.trial = new Trial(rng);
    return { state: this.trial.state(), done: this.trial.done, reward: this.trial.reward };
  }

  state() { return this.trial.state(); }

  step(action) { return this.trial.step(action); }

  encodeState(state) { return encodeState(state); }

  describe(state, action) {
    const dots = `L=${state.leftDots} R=${state.rightDots} (even side: ${state.evenSide.toUpperCase()})`;
    if (action == null) return `IDLE · ${dots}`;
    const side = ACTION_TO_SIDE[action].toUpperCase();
    const label = `[Q-LEARNING] ${dots} -> ${side}`;
    if (!this.trial.done) return label;
    return `${this.trial.reward > 0 ? 'CORRECT' : 'WRONG'} · ${label}`;
  }
}

/**
 * Real DN channels read as the Q-function's input. `DNa01_L/R` are the
 * calibrated steering pair the visual interneurons (LPLC1/LPLC2, see
 * dot-sensory.js) feed into; `DNp09`/`DNp03` are included per the task spec
 * as additional real descending reads, same "small, real, calibrated slice"
 * approach blackjack's own feature set takes.
 */
export const MATH_CLASS_FEATURE_CHANNELS = ['DNa01_L', 'DNa01_R', 'DNp09', 'DNp03'];

export { MIN_DOTS, MAX_DOTS };
