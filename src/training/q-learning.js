/**
 * A small trainable Q-value readout on top of real (but FIXED) descending-
 * neuron activity.
 *
 * This is the honest architecture, and it deliberately mirrors what the
 * reference experiment (NeuroMechFly's blackjack demo) actually found:
 * "the real connectome did not beat random features." The connectome in this
 * framework has no synaptic plasticity at all -- `python/src/madfly_lab/
 * connectome.py` ships no weight-update rule, and nothing here adds one. So
 * the descending neurons cannot learn blackjack no matter how long you run
 * them: they are a fixed, real, non-adaptive feature extractor. What DOES
 * learn is this module: a linear function of that feature vector, trained by
 * ordinary Q-learning. The dopamine/punishment pulses into PAM11/PPL1 (done
 * by the trainer that calls this, not by this file) are a real, and really
 * driven, reward signal into the real network -- they just are not the thing
 * whose weights the reward signal is fitting. Say this plainly wherever this
 * module's output is displayed, so nobody mistakes "the fly learned
 * blackjack" for "the connectome learned blackjack".
 *
 * Q(features, action) = w[action] . features   (features include a bias term)
 * TD update:  w[action] += alpha * (target - Q) * features
 *   target = reward                                  if the hand is over
 *   target = reward + gamma * max_a' Q(features', a') otherwise
 */

export const ACTIONS = ['hit', 'stand'];

export class QReadout {
  /**
   * @param {number} nFeatures  length of the feature vector, EXCLUDING bias
   * @param {object} opts
   */
  constructor(nFeatures, { alpha = 0.05, gamma = 0.95, epsilon = 0.15, seed = 1 } = {}) {
    this.nFeatures = nFeatures + 1; // + bias
    this.alpha = alpha;
    this.gamma = gamma;
    this.epsilon = epsilon;
    this._rand = seededRandom(seed);
    // Small random init, not zero: a genuinely flat Q(hit)==Q(stand)==0 start
    // makes the FIRST decision of every run a tie broken the same way every
    // time, which looks like a policy before any learning has happened.
    this.weights = { hit: randVec(this.nFeatures, this._rand), stand: randVec(this.nFeatures, this._rand) };
    this.trials = 0;
    this.wins = 0;
    this.losses = 0;
    this.pushes = 0;
  }

  _withBias(features) { return [...features, 1]; }

  /** Q-value for one action given a (bias-free) feature vector. */
  qValue(features, action) {
    const f = this._withBias(features);
    const w = this.weights[action];
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += w[i] * f[i];
    return sum;
  }

  qValues(features) {
    return Object.fromEntries(ACTIONS.map((a) => [a, this.qValue(features, a)]));
  }

  /** Greedy action (ties broken toward 'stand', matching "don't act rashly"). */
  greedyAction(features) {
    const q = this.qValues(features);
    return q.hit > q.stand ? 'hit' : 'stand';
  }

  /** Epsilon-greedy action, for exploration during training. */
  chooseAction(features) {
    if (this._rand() < this.epsilon) return this._rand() < 0.5 ? 'hit' : 'stand';
    return this.greedyAction(features);
  }

  /**
   * One TD update.
   * @param {number[]} features    state the action was taken from
   * @param {'hit'|'stand'} action
   * @param {number} reward
   * @param {number[]|null} nextFeatures  null if the hand ended
   */
  update(features, action, reward, nextFeatures) {
    const current = this.qValue(features, action);
    let target = reward;
    if (nextFeatures) {
      const nextQ = Math.max(this.qValue(nextFeatures, 'hit'), this.qValue(nextFeatures, 'stand'));
      target += this.gamma * nextQ;
    }
    const error = target - current;
    const f = this._withBias(features);
    const w = this.weights[action];
    for (let i = 0; i < f.length; i++) w[i] += this.alpha * error * f[i];
    return error;
  }

  /** Record a completed hand's outcome for the diagnostics badge. */
  recordOutcome(reward) {
    this.trials += 1;
    if (reward > 0) this.wins += 1;
    else if (reward < 0) this.losses += 1;
    else this.pushes += 1;
  }

  get successRate() { return this.trials > 0 ? this.wins / this.trials : 0; }
}

function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function randVec(n, rand) {
  return Array.from({ length: n }, () => (rand() - 0.5) * 0.02);
}
