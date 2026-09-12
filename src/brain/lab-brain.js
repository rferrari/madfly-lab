/**
 * LabBrain -- the Dual-Runtime Connectome Engine (spec section 3.2).
 *
 * One API over two runtimes:
 *   Mode B  'pruned-subgraph'   715-7,922 real neurons, in this tab, zero latency
 *   Mode A  'full-connectome'   all 176,422 real neurons, in Python, over a socket
 *
 * A scene calls the same methods either way. That is the framework's core
 * promise: you write `brain.injectCurrent('PAM11', +20)` once and choose the
 * runtime from config, or let `mode: 'auto'` pick Mode A when a server is up
 * and fall back to Mode B when it is not.
 *
 * ON UNITS -- read this before believing a number this class returns.
 * Activations are dimensionless tanh values in [-1, 1]. They are NOT membrane
 * voltages and NOT firing rates. `injectCurrent('PAM11', +20)` keeps the
 * spec's ergonomics but +20 is input-current in this model's own arbitrary
 * scale; it is not +20 mV, and nothing here simulates millivolts. `readHz()`
 * exists because a telemetry panel reading 0.0-200 Hz is more legible than one
 * reading -1..1, but that mapping is a display convention this framework
 * invented, not a measurement. The connectivity is real; the unit labels on
 * top of it are ours.
 */

import { loadPack } from './pack-loader.js';
import { PrunedRuntime } from './pruned-runtime.js';
import { RemoteRuntime } from './remote-runtime.js';

/** Display-only: map a tanh activation in [-1,1] onto the HUD's 0-200 Hz dial. */
export const HZ_PER_ACTIVATION = 200;

/** How long `mode: 'auto'` waits for a Mode A server before falling back. */
export const AUTO_PROBE_MS = 6000;

export class LabBrain {
  constructor({
    mode = 'pruned-subgraph',
    circuit = 'courtship-and-foraging',
    packUrl = null,
    serverUrl = 'ws://localhost:8770',
    tickHz = 60,
    noise = 0,
  } = {}) {
    this.requestedMode = mode;
    this.circuit = circuit;
    this.packUrl = packUrl ?? `/${circuit}.mflpack`;
    this.serverUrl = serverUrl;
    this.tickHz = tickHz;
    this.noise = noise;

    this.runtime = null;
    this.pack = null;
    this.ready = false;

    // channel -> [handler], fired from step() when a channel crosses its threshold.
    this._signals = new Map();
    this._signalState = new Map();
    this._loomState = new Map();
    this._steerBaseline = new Map();
  }

  get mode() { return this.runtime ? this.runtime.mode : this.requestedMode; }
  get nNeurons() { return this.runtime ? this.runtime.nNeurons : 0; }

  async init() {
    if (this.requestedMode === 'full-connectome') {
      this.runtime = new RemoteRuntime({
        url: this.serverUrl, circuit: this.circuit, tickHz: this.tickHz,
      }).connect();
    } else if (this.requestedMode === 'auto') {
      // Try Mode A briefly; a lab that can reach a full-connectome server should
      // use it, but a scene must never hang waiting for one that isn't running.
      const remote = new RemoteRuntime({
        url: this.serverUrl, circuit: this.circuit, tickHz: this.tickHz,
      }).connect();
      // Generous, because this is a one-off at startup behind a loading screen
      // and the cost of being wrong is silently running the small brain. The
      // Mode A handshake takes ~1.7s locally (socket + first GPU sync); the
      // original 1200ms budget expired just before `ready` arrived and 'auto'
      // fell back to Mode B every time with a live server sitting right there.
      const up = await waitFor(() => remote.ready, AUTO_PROBE_MS);
      if (up) {
        this.runtime = remote;
      } else {
        console.info(`[MadFlyLab] no Mode A server on ${this.serverUrl} after `
          + `${AUTO_PROBE_MS}ms — using the in-tab pruned pack.`);
        remote.close();
        this.runtime = await this._loadPruned();
      }
    } else {
      this.runtime = await this._loadPruned();
    }

    if (this.noise > 0) this.runtime.reset(this.noise);
    this.ready = true;
    console.info(`[MadFlyLab] brain ready - ${this.runtime.describe()}`);
    this.onReady?.(this);
    return this;
  }

  async _loadPruned() {
    this.pack = await loadPack(this.packUrl);
    return new PrunedRuntime(this.pack);
  }

  // ---- input (spec section 4) -----------------------------------------

  /**
   * One-shot current pulse into a real cell population, fading over
   * `decayTicks`. The spec's dopamine surge: injectCurrent('PAM11', +20).
   */
  injectCurrent(channel, amount, decayTicks = 8) {
    this.runtime?.injectCurrent(channel, amount, decayTicks);
    return this;
  }

  /** Sustained drive on a channel, held until set again (scent fields, light). */
  setInput(channel, intensity) {
    this.runtime?.setInput(channel, intensity);
    return this;
  }

  /**
   * Looming threat, as the spec's `brain.triggerLooming('LC4', distance)`.
   *
   * Converts distance to drive with the standard 1/(1+d/attenuation) falloff
   * the sibling projects all use for sensory attenuation, so a closer hazard
   * drives the real LC4/LPLC2 population harder. This is a geometric proxy for
   * optical expansion, not a retinal computation -- LabAvatar's retina + motion
   * opponency is the real one, and a scene that wants that should pass the
   * avatar's measured loom instead (see LabAvatar.loom).
   */
  triggerLooming(channel = 'LC4', distance = 1, { attenuation = 4, gain = 6 } = {}) {
    const drive = gain / (1 + Math.max(0, distance) / attenuation);
    this.setInput(channel, drive);
    this._loomState.set(channel, drive);
    return this;
  }

  clearLooming(channel = 'LC4') {
    this.setInput(channel, 0);
    this._loomState.delete(channel);
    return this;
  }

  clearInputs() { this.runtime?.clearInputs(); return this; }

  /**
   * Lesion a population -- silence it while leaving it wired in place.
   * See PrunedRuntime.silence. A no-op on runtimes that cannot lesion.
   */
  silence(...channels) {
    for (const c of channels) this.runtime?.silence?.(c);
    return this;
  }

  unsilence(...channels) {
    for (const c of channels) this.runtime?.unsilence?.(c);
    return this;
  }

  clearSilenced() { this.runtime?.clearSilenced?.(); return this; }

  get silencedChannels() {
    return [...(this.runtime?.silencedChannels ?? [])];
  }

  reset(noiseScale = this.noise) {
    this.runtime?.reset(noiseScale);
    this._steerBaseline.clear();
    return this;
  }

  // ---- output ----------------------------------------------------------

  /** Mean activation over a channel's real neurons, in [-1, 1]. */
  read(channel) { return this.runtime ? this.runtime.read(channel) : 0; }

  /**
   * Calibrated read, roughly [-1, 1] -- raw activation divided by this
   * channel's measured reference response.
   *
   * THIS is the one to threshold on. Raw activations span ~38,000x across
   * channels of a single graph (DNp01 sits close to visual input, PAM11 does
   * not), and Mode A's full graph reads ~4 orders of magnitude quieter than a
   * pruned pack for the same input simply because the signal is diluted over
   * 22x more neurons. Calibration removes both effects, so a threshold written
   * once works across channels, circuits and runtimes. `read()` remains the
   * honest raw value for anyone who wants it.
   */
  readCalibrated(channel) {
    return this.runtime?.readCalibrated ? this.runtime.readCalibrated(channel) : this.read(channel);
  }

  /** Display-only Hz for the telemetry HUD. See the units note above. */
  readHz(channel) { return Math.abs(this.readCalibrated(channel)) * HZ_PER_ACTIVATION; }

  /**
   * Left-minus-right difference across a paired descending neuron -- the real
   * steering signal. Every DN this framework ships as a channel is a verified
   * clean L/R pair in male-cns:v1.0, which is what makes this difference
   * meaningful rather than decorative.
   */
  readLateral(base) { return this.read(`${base}_L`) - this.read(`${base}_R`); }

  /** Calibrated left-minus-right. Raw difference; see readSteering. */
  readLateralCalibrated(base) {
    return this.readCalibrated(`${base}_L`) - this.readCalibrated(`${base}_R`);
  }

  /**
   * Directional steering signal from a paired descending neuron, in ~[-1, 1].
   *
   * A plain left-minus-right does not work as a control signal, for two
   * measured reasons:
   *
   *  1. THE COMMON MODE SWAMPS IT. With a realistic 10% brightness asymmetry
   *     (lumL 0.55 / lumR 0.45) the real DNa01 pair reads 0.1466 / 0.1423 --
   *     a difference of 0.0043 sitting on top of a common mode of ~0.145. At
   *     turnGain 3.2 that is 0.8 degrees per second. The fly walked in a
   *     straight line into the wall no matter what it saw.
   *  2. THE PAIR IS NOT SYMMETRIC AT REST. With both eyes equally lit the real
   *     cells read 0.1369 / 0.1530 -- a standing -0.056 bias that would curve
   *     the fly permanently in one direction.
   *
   * So: take the RATIO (difference over total), which is scale-free and is the
   * quantity that actually carries direction, and subtract a slowly-adapting
   * baseline so the animal's own standing asymmetry cancels out and it steers
   * on CHANGE. This is the same treatment duckfly applies to its DNa pair, and
   * the reason it is legitimate is that neither operation invents a signal --
   * both discard components that carry no directional information.
   */
  readSteering(base = 'DNa01', { adaptRate = 0.004 } = {}) {
    const l = this.readCalibrated(`${base}_L`);
    const r = this.readCalibrated(`${base}_R`);
    const ratio = (l - r) / (Math.abs(l) + Math.abs(r) + 1e-9);

    const prev = this._steerBaseline.get(base) ?? ratio;
    const baseline = prev + (ratio - prev) * adaptRate;
    this._steerBaseline.set(base, baseline);

    return Math.max(-1, Math.min(1, ratio - baseline));
  }

  /** Forget adapted steering baselines (on reset / re-mint). */
  resetSteering() { this._steerBaseline.clear(); return this; }

  populationActivity() { return this.runtime ? this.runtime.populationActivity() : 0; }

  /**
   * Channel names available in this runtime.
   *
   * Mode B reads them from the pack. Mode A has no pack, and returning []
   * there left the telemetry panel completely blank in the one mode where the
   * whole brain is running -- the server's `ready` frame carries the list, so
   * use it. `kind` filtering is pack-only; the server does not distinguish.
   */
  channels(kind) {
    if (this.pack) return this.pack.channelNames(kind);
    const remote = this.runtime?.info?.channels;
    return remote ? Object.keys(remote).sort() : [];
  }

  /**
   * Fire `handler` when a channel crosses `threshold` upward (edge-triggered,
   * so a sustained high channel fires once, not every frame). The spec's
   * `lab.brain.onSignal()`.
   */
  onSignal(channel, handler, { threshold = 0.2, mode = 'rising' } = {}) {
    if (!this._signals.has(channel)) this._signals.set(channel, []);
    this._signals.get(channel).push({ handler, threshold, mode });
    return this;
  }

  step(dt) {
    if (!this.runtime) return;
    this.runtime.step(dt);

    for (const [channel, listeners] of this._signals) {
      // Calibrated, so a threshold means the same thing on any channel, in any
      // circuit, in either runtime. See readCalibrated.
      const value = this.readCalibrated(channel);
      const was = this._signalState.get(channel) ?? 0;
      for (const l of listeners) {
        const above = value >= l.threshold;
        const wasAbove = was >= l.threshold;
        if (l.mode === 'level' && above) l.handler(value, channel);
        else if (l.mode === 'rising' && above && !wasAbove) l.handler(value, channel);
        else if (l.mode === 'falling' && !above && wasAbove) l.handler(value, channel);
      }
      this._signalState.set(channel, value);
    }
  }

  dispose() { this.runtime?.close?.(); }
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const started = performance.now();
    const poll = () => {
      if (predicate()) return resolve(true);
      if (performance.now() - started > timeoutMs) return resolve(false);
      setTimeout(poll, 50);
    };
    poll();
  });
}
