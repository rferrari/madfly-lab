/**
 * Mode B -- the pruned subgraph running in the browser, on the main thread.
 *
 * Dynamics follow the ones running in fly_simulation_3d, fly_drone_delivery and
 * fly_speed_dating, transliterated from numpy to typed arrays:
 *
 *     a <- tanh(W @ a + I)
 *
 * ONE DELIBERATE DIVERGENCE FROM THAT LINEAGE: those projects compute
 * `tanh(W @ a + I * dt)`. Scaling a *sustained* input by dt makes the steady
 * state depend on the tick rate -- `a* = tanh(W a* + I dt)` is a different
 * fixed point for every dt. Measured on the courtship pack, one unchanged
 * sensory drive produces:
 *
 *      20 Hz -> DNp09 4.94e-3        120 Hz -> DNp09 8.41e-4
 *
 * a 5.9x spread across tick rates. Each of those projects ran at a single fixed
 * rate, so it never surfaced. MadFly Lab runs Mode B at 60 Hz and Mode A at
 * ~20 Hz behind the same API, and a scene is promised it need not care which it
 * got -- so a sustained input here contributes I directly and the steady state
 * is a property of the input, not of the clock. One-shot pulses decay over a
 * DURATION in seconds rather than a tick count, for the same reason.
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
    // same channel replaces rather than stacks indefinitely. Remaining life is
    // tracked in seconds, so a pulse lasts the same wall time at any tick rate.
    this.pulses = new Map();
    this.channelCache = new Map();
    /** Lesion mask -- see silence(). Null until something is silenced. */
    this.silenced = null;
    this.silencedChannels = new Set();
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

  /** One-shot pulse fading linearly over `decaySeconds` of simulated time. */
  injectCurrent(channel, amount, decaySeconds = 0.15) {
    const idx = this.resolve(channel);
    if (!idx.length) return;
    const life = Math.max(1e-6, decaySeconds);
    this.pulses.set(channel, { idx, perNeuron: amount / idx.length, remaining: life, total: life });
  }

  clearInputs() {
    this.external.fill(0);
    this.pulses.clear();
  }

  /**
   * Silence a population -- hold its activation at zero every tick.
   *
   * This is a LESION, and it is the framework's honest version of "a fly with
   * no eyes" or "a fly that cannot detect looming". It is the computational
   * analogue of what a real lab does with a null mutant or an optogenetic
   * silencer: the cells are still in the graph, still wired to everything they
   * are really wired to, but they stop contributing. Everything downstream
   * responds to their absence through the real connectivity.
   *
   * Deleting the neurons instead would be wrong -- it would also delete the
   * paths that merely pass THROUGH them.
   */
  silence(channel) {
    const idx = this.resolve(channel);
    if (!idx.length) return this;
    if (!this.silenced) this.silenced = new Uint8Array(this.n);
    for (let k = 0; k < idx.length; k++) this.silenced[idx[k]] = 1;
    this.silencedChannels.add(channel);
    return this;
  }

  unsilence(channel) {
    const idx = this.resolve(channel);
    if (!this.silenced || !idx.length) return this;
    for (let k = 0; k < idx.length; k++) this.silenced[idx[k]] = 0;
    this.silencedChannels.delete(channel);
    return this;
  }

  clearSilenced() {
    this.silenced = null;
    this.silencedChannels.clear();
    return this;
  }

  _applySilencing() {
    if (!this.silenced) return;
    const { activations, silenced } = this;
    for (let i = 0; i < this.n; i++) if (silenced[i]) activations[i] = 0;
  }

  reset(noiseScale = 0) {
    if (noiseScale > 0) {
      for (let i = 0; i < this.n; i++) this.activations[i] = (Math.random() * 2 - 1) * noiseScale;
    } else {
      this.activations.fill(0);
    }
    this.clearInputs();
    this._applySilencing();
    this.t = 0;
  }

  step(dt) {
    const { indptr, indices, data, activations, next, external, pulseBuffer } = this;

    pulseBuffer.set(external);
    for (const [channel, p] of this.pulses) {
      const amt = p.perNeuron * (p.remaining / p.total);
      for (let k = 0; k < p.idx.length; k++) pulseBuffer[p.idx[k]] += amt;
      p.remaining -= dt;
      if (p.remaining <= 0) this.pulses.delete(channel);
    }

    for (let row = 0; row < this.n; row++) {
      let sum = 0;
      const end = indptr[row + 1];
      for (let k = indptr[row]; k < end; k++) sum += data[k] * activations[indices[k]];
      next[row] = Math.tanh(sum + pulseBuffer[row]);
    }

    this.activations.set(next);
    this._applySilencing();
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

  /**
   * Calibrated read in roughly [-1, 1]: raw activation divided by this
   * channel's measured reference response, so ~1.0 means "as active as this
   * channel gets under reference drive".
   *
   * Use this for anything comparing channels or thresholding behaviour; use
   * `read()` when you want the honest raw activation. Falls back to the raw
   * value for a channel the pack has no calibration for (an ad-hoc cell type
   * resolved at runtime), rather than silently reporting a wrong scale.
   */
  readCalibrated(channel) {
    const raw = this.read(channel);
    const ref = this.pack.reference.get(channel);
    return ref ? raw / ref : raw;
  }

  hasCalibration(channel) { return this.pack.reference.has(channel); }

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
