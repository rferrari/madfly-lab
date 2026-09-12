/**
 * Mode A -- the full 176,422-neuron connectome, running in Python, reached over
 * a WebSocket. Server half: python/src/madfly_lab/server.py.
 *
 * The scene-facing API is identical to PrunedRuntime's, which is the whole
 * point: `lab.brain.injectCurrent('PAM11', +20)` means the same thing in both
 * modes and a scene never branches on which one it got.
 *
 * The one real difference is time. Reads here are *last known* values from the
 * most recent server tick, not values computed this frame. Inputs are fire-and
 * -forget. That is the same thin-client arrangement fly_drone_delivery and
 * fly_speed_dating both run on: Python owns the neural state, the browser
 * renders it and does not wait for it. `read()` therefore never blocks, and a
 * scene written against Mode B behaves the same in Mode A modulo one network
 * round-trip of lag.
 */

const RECONNECT_DELAY_MS = 1500;

export class RemoteRuntime {
  constructor({ url = 'ws://localhost:8770', circuit = 'courtship-and-foraging', tickHz = 60 } = {}) {
    this.mode = 'full-connectome';
    this.url = url;
    this.circuit = circuit;
    this.tickHz = tickHz;

    this.ready = false;
    this.connected = false;
    this.info = null;
    this.readings = new Map();
    this.population = 0;
    this.t = 0;
    this.cloud = null;
    this.achievedHz = 0;
    this.somaXYZ = null;
    this.somaCount = 0;
    this.subscribeCloud = false;

    this._ws = null;
    this._reconnectTimer = null;
    this._closed = false;
    this._warned = new Set();
  }

  get nNeurons() { return this.info ? this.info.nNeurons : 0; }

  connect() {
    if (this._closed) return this;
    const ws = new WebSocket(this.url);
    this._ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._send({ op: 'hello', circuit: this.circuit, tickHz: this.tickHz });
      this._send({ op: 'subscribe', cloud: this.subscribeCloud });
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.op === 'ready') {
        // Decode the soma positions the server ships once at handshake. Mode B
        // gets these from the pack; Mode A has no pack, and without them the
        // brain panel would be empty in exactly the mode where the whole brain
        // is what you came to see.
        if (msg.somaB64) {
          const raw = Uint8Array.from(atob(msg.somaB64), (ch) => ch.charCodeAt(0));
          const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
          const inv = 1 / (msg.somaQuant ?? 8192);
          this.somaXYZ = new Float32Array(q.length);
          for (let i = 0; i < q.length; i++) this.somaXYZ[i] = q[i] * inv;
          this.somaCount = this.somaXYZ.length / 3;
          delete msg.somaB64;      // 1MB string; no reason to retain it
        }
        this.info = msg;
        this.ready = true;
      } else if (msg.op === 'tick') {
        this.t = msg.t;
        this.achievedHz = msg.achievedHz ?? this.achievedHz;
        this.population = msg.population;
        for (const [k, v] of Object.entries(msg.readings)) this.readings.set(k, v);
        if (msg.cloud) this.cloud = msg.cloud;
      } else if (msg.op === 'error') {
        console.warn('[MadFlyLab] Mode A server error:', msg.message);
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.ready = false;
      if (!this._closed) {
        this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    };

    // A refused connection fires error then close; the close handler owns the
    // retry, so this only needs to keep the console honest about what happened.
    ws.onerror = () => {
      if (!this._warned.has('connect')) {
        this._warned.add('connect');
        console.warn(
          `[MadFlyLab] Mode A: cannot reach ${this.url}. Start it with `
          + `\`npm run brain:full\`, or switch to mode: 'pruned-subgraph'.`,
        );
      }
    };
    return this;
  }

  close() {
    this._closed = true;
    clearTimeout(this._reconnectTimer);
    this._ws?.close();
  }

  _send(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) this._ws.send(JSON.stringify(msg));
  }

  setInput(channel, intensity) { this._send({ op: 'input', channel, intensity }); }

  injectCurrent(channel, amount, decayTicks = 8) {
    this._send({ op: 'inject', channel, amount, decayTicks });
  }

  clearInputs() { this._send({ op: 'clear' }); }

  reset(noiseScale = 0) {
    this._send({ op: 'reset', noise: noiseScale });
    this.readings.clear();
  }

  /** No-op: the server steps on its own clock. Kept so the interfaces match. */
  step() {}

  read(channel) { return this.readings.get(channel) ?? 0; }

  /** See PrunedRuntime.readCalibrated. The server measures the full graph's
   *  reference responses at startup and ships them in its `ready` frame, so a
   *  calibrated read means the same thing in both modes even though the raw
   *  activations differ by orders of magnitude between them. */
  readCalibrated(channel) {
    const ref = this.info?.reference?.[channel];
    return ref ? this.read(channel) / ref : this.read(channel);
  }

  hasCalibration(channel) { return !!this.info?.reference?.[channel]; }

  populationActivity() { return this.population; }

  /** Mode A streams only the most-active few thousand neurons, not all 176k. */
  activationView() { return null; }

  enableCloud(on = true) {
    this.subscribeCloud = on;
    this._send({ op: 'subscribe', cloud: on });
  }

  describe() {
    return this.info
      ? `Mode A (remote) - ${this.info.nNeurons} real neurons, ${this.info.nEdges} real edges `
        + `(${this.info.dataset}, source=${this.info.source})`
      : `Mode A (remote) - connecting to ${this.url}`;
  }
}
