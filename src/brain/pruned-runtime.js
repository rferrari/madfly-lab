/**
 * Mode B -- the pruned subgraph running in the browser, on the main thread.
 *
 * Dynamics are exactly the ones running in fly_simulation_3d,
 * fly_drone_delivery and fly_speed_dating, transliterated from numpy to typed
 * arrays:
 *
 *     a <- tanh(W @ a + I * dt)
 *
 * `W` arrives from the pack already stability-normalized (spectral radius 0.9,
 * diagonal self-inhibition -0.2) -- see python/src/madfly_lab/prune.py for why
 * that normalization is load-bearing and not cosmetic: the raw real adjacency
 * has a spectral radius near 2.7, at which every neuron saturates to +-1 and
 * the readouts stop responding to input at all.
 *
 * Cost is one pass over the CSR data per tick: 1.38M multiply-adds for the
 * largest shipped pack, ~1-2ms. That is why this runs inline rather than in a
 * worker -- a worker would add a frame of latency to a step that already fits
 * inside the frame budget. If a scene ships a pack large enough that it does
 * not, Mode A is the answer, not a worker.
 */

export class PrunedRuntime {
  constructor(pack) {
    this.pack = pack;
    this.mode = 'pruned-subgraph';
    this.n = pack.nNeurons;

    this.indptr = pack.indptr;
    this.indices = pack.indices;
    this.data = pack.data;

    this.activations = new Float32Array(this.n);
    this.next = new Float32Array(this.n);
    this.external = new Float32Array(this.n);
    this.pulseBuffer = new Float32Array(this.n);

    // Decaying one-shot injections, keyed by channel so a second inject on the
    // same channel replaces rather than stacks indefinitely.
    this.pulses = new Map();
    this.channelCache = new Map();
    this.t = 0;
    this.ready = true;
  }

  get nNeurons() { return this.n; }

  /** Indices for a channel name, or for any real cell type in the pack. */
  resolve(channel) {
    if (this.pack.channels.has(channel)) return this.pack.channels.get(channel);
    if (this.channelCache.has(channel)) return this.channelCache.get(channel);
    const idx = this.pack.indicesOfType(channel);
    this.channelCache.set(channel, idx);
    if (idx.length === 0) {
      console.warn(
        `[MadFlyLab] channel "${channel}" matches no neuron in pack "${this.pack.circuit.name}". `
        + `It will stay silent. Available channels: ${this.pack.channelNames().join(', ')}`,
      );
    }
    return idx;
  }

  /** Sustained drive, held until changed. Split across the channel's neurons. */
  setInput(channel, intensity) {
    const idx = this.resolve(channel);
    if (!idx.length) return;
    const per = intensity / idx.length;
    for (let k = 0; k < idx.length; k++) this.external[idx[k]] = per;
  }

  /** One-shot pulse fading linearly over `decayTicks`. */
  injectCurrent(channel, amount, decayTicks = 8) {
    const idx = this.resolve(channel);
    if (!idx.length) return;
    this.pulses.set(channel, {
      idx,
      perNeuron: amount / idx.length,
      remaining: Math.max(1, decayTicks | 0),
      total: Math.max(1, decayTicks | 0),
    });
  }

  clearInputs() {
    this.external.fill(0);
    this.pulses.clear();
  }

  reset(noiseScale = 0) {
    if (noiseScale > 0) {
      for (let i = 0; i < this.n; i++) this.activations[i] = (Math.random() * 2 - 1) * noiseScale;
    } else {
      this.activations.fill(0);
    }
    this.clearInputs();
    this.t = 0;
  }

  step(dt) {
    const { indptr, indices, data, activations, next, external, pulseBuffer } = this;

    pulseBuffer.set(external);
    for (const [channel, p] of this.pulses) {
      const frac = p.remaining / p.total;
      const amt = p.perNeuron * frac;
      for (let k = 0; k < p.idx.length; k++) pulseBuffer[p.idx[k]] += amt;
      if (--p.remaining <= 0) this.pulses.delete(channel);
    }

    for (let row = 0; row < this.n; row++) {
      let sum = 0;
      const end = indptr[row + 1];
      for (let k = indptr[row]; k < end; k++) sum += data[k] * activations[indices[k]];
      next[row] = Math.tanh(sum + pulseBuffer[row] * dt);
    }

    this.activations.set(next);
    this.t += dt;
  }

  /** Mean activation over a channel, in [-1, 1]. */
  read(channel) {
    const idx = this.resolve(channel);
    if (!idx.length) return 0;
    let sum = 0;
    for (let k = 0; k < idx.length; k++) sum += this.activations[idx[k]];
    return sum / idx.length;
  }

  /** Mean |activation| over the whole graph -- the HUD's arousal trace. */
  populationActivity() {
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += Math.abs(this.activations[i]);
    return sum / this.n;
  }

  /** Live activations for the soma point cloud -- no copy, the cloud reads it directly. */
  activationView() { return this.activations; }

  describe() { return `Mode B (browser) - ${this.pack.describe()}`; }
}
