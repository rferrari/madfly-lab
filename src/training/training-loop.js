/**
 * TrainingLoop -- the generic "sense -> settle -> read -> decide -> act ->
 * reward -> learn" cycle for a stationary training task, task-agnostic.
 *
 * This is framework machinery, not a specific task: it orchestrates a real
 * brain (LabBrain), a QReadout (q-learning.js), and a PLUGGABLE `task` object
 * that knows the actual rules of whatever the fly is being trained on --
 * blackjack, a maze, colour discrimination, anything with discrete actions and
 * a terminal reward. Task-specific code (game rules, the card/stimulus ->
 * real-ORN-channel encoding, the 3D dock dressing) lives with the scene that
 * uses it, e.g. `examples/blackjack/`.
 *
 * ARCHITECTURE, STATED PLAINLY: the connectome this loop drives has no
 * synaptic plasticity (see python/src/madfly_lab/connectome.py -- no weight-
 * update rule ships anywhere), so it cannot learn the task no matter how long
 * it runs. It is a fixed, real feature extractor. The QReadout is what
 * learns, via ordinary TD updates on real (but frozen) descending-neuron
 * activity. The dopamine/aversive pulses into PAM11/PPL1 are a real, and
 * really driven, reward signal into the real network -- they are simply not
 * the mechanism fitting the weights. This mirrors NeuroMechFly's own
 * blackjack demo, which found the same thing: the real connectome did not
 * beat random features. Don't let a scene's UI imply "the brain learned" --
 * say "the readout learned from the brain's real response."
 *
 * Task interface a scene provides:
 *   start(rng) -> {state, done, reward}   begin an episode; may resolve
 *                                          instantly (done=true) with no
 *                                          decision needed (e.g. a natural)
 *   step(action) -> {reward, done}        advance one decision
 *   state() -> object                     the task's current state
 *   encodeState(state) -> {channel:value} real ORN drives for this state
 *   describe(state, action) -> string     one-line label for the HUD
 */

import { QReadout } from './q-learning.js';

const SETTLE_TICKS = 40; // see tethered rig docs for the measured basis
const REWARD_PULSE = 20;
const PULSE_DECAY_SECONDS = 0.3;

export class TrainingLoop {
  /**
   * @param {import('../brain/lab-brain.js').LabBrain} brain
   * @param {object} task               see interface above
   * @param {string[]} featureChannels  real, calibrated DN channels read as
   *                                    the Q-function's input
   * @param {object} opts
   * @param {{win:string, lose:string}} [opts.rewardChannels] dopamine/aversive
   *   targets for terminal reward pulses (default PAM11 / PPL1)
   */
  constructor(brain, task, featureChannels, opts = {}) {
    this.brain = brain;
    this.task = task;
    this.featureChannels = featureChannels;
    this.rewardChannels = opts.rewardChannels ?? { win: 'PAM11', lose: 'PPL1' };
    this.q = new QReadout(featureChannels.length, opts);
    this.rng = opts.rng ?? Math.random;
    this.tickHz = opts.tickHz ?? 60;
    this.lastDecision = null;
    this.decisionState = 'IDLE';
    this.episodeState = null;
  }

  readFeatures() {
    return this.featureChannels.map((c) => this.brain.readCalibrated(c));
  }

  settle() {
    const dt = 1 / this.tickHz;
    for (let i = 0; i < SETTLE_TICKS; i++) this.brain.step(dt);
  }

  /** Begin a new episode. Returns false if it resolved with no decision needed. */
  startEpisode() {
    const { state, done, reward } = this.task.start(this.rng);
    this.episodeState = state;
    this.lastDecision = null;
    if (done) {
      this._settleTerminal(reward);
      this.q.recordOutcome(reward);
      this.decisionState = this.task.describe(state, null) ?? 'RESOLVED (no decision)';
      return false;
    }
    return true;
  }

  /** Advance one decision point. Call repeatedly until it returns done. */
  step() {
    const state = this.task.state();
    const drives = this.task.encodeState(state);
    for (const [channel, value] of Object.entries(drives)) this.brain.setInput(channel, value);
    this.settle();

    const features = this.readFeatures();
    const action = this.q.chooseAction(features);
    this.decisionState = this.task.describe(state, action);

    const { reward, done } = this.task.step(action);

    if (this.lastDecision) {
      this.q.update(this.lastDecision.features, this.lastDecision.action, 0, features);
    }

    if (done) {
      this.q.update(features, action, reward, null);
      this.q.recordOutcome(reward);
      this._settleTerminal(reward);
      this.lastDecision = null;
    } else {
      this.lastDecision = { features, action };
    }

    return { action, features, reward, done };
  }

  _settleTerminal(reward) {
    if (reward > 0) this.brain.injectCurrent(this.rewardChannels.win, REWARD_PULSE * reward, PULSE_DECAY_SECONDS);
    else if (reward < 0) this.brain.injectCurrent(this.rewardChannels.lose, REWARD_PULSE * -reward, PULSE_DECAY_SECONDS);
  }

  /** Play one full episode to completion. */
  playOneEpisode() {
    if (this.startEpisode()) {
      let result;
      do { result = this.step(); } while (!result.done);
    }
    return { trials: this.q.trials, successRate: this.q.successRate };
  }
}

// Re-exported so a scene only needs to import from this one module for the
// common case; QReadout itself has no dependency on TrainingLoop.
export { QReadout, ACTIONS } from './q-learning.js';
