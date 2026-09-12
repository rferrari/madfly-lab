/**
 * MadFlyLab -- the workbench (spec section 4).
 *
 * Owns the arena, the avatar, the brain and the observer, and runs the loop
 * that wires them together. A scene's entire job is:
 *
 *     const lab = new MadFlyLab({ mode, canvas, circuit });
 *     lab.addStation(new Station.FoodBowl({ ... }));
 *     await lab.start();
 *
 * The loop, per frame:
 *
 *   1. arena renders the fly's-eye view offscreen
 *   2. avatar.sense()   -> real sensory neurons get driven
 *   3. stations tick    -> scene logic, triggers, scent updates
 *   4. brain.step()     -> tanh dynamics over the real connectome; onSignal fires
 *   5. avatar.act()     -> real descending neurons move the body
 *   6. arena renders; observer draws diagnostics
 *
 * The brain steps on a FIXED timestep independent of the display refresh. A
 * 144Hz monitor must not run a fly's brain 2.4x faster than a 60Hz one, and a
 * frame hitch must not hand the network a huge dt that saturates every neuron.
 */

import * as THREE from 'three';
import { Arena, AVATAR_LAYER } from './arena.js';
import { fovForRetina } from '../avatar/retina.js';
import { ScentField } from './gradients.js';
import { LabAvatar } from '../avatar/lab-avatar.js';
import { LabBrain } from '../brain/lab-brain.js';
import { LabObserver } from '../observer/lab-observer.js';
import { resolveGenotype, describeGenotype } from '../avatar/genotype.js';
import { CIRCUITS } from '../circuits.js';

const MAX_CATCHUP_STEPS = 4;

export class MadFlyLab {
  constructor({
    canvas = '#app-canvas',
    mode = 'pruned-subgraph',
    circuit = 'courtship',
    packUrl = null,
    serverUrl = 'ws://localhost:8770',
    brainHz = 60,
    arenaSize = 40,
    brightness = 'normal',
    vision = true,
    eyeResolution = [96, 64],
    retinaRadius = 15,
    retinaSpacing = 2.3,
    camera = 'chase',
    observer = true,
    observerOptions = {},
    avatarOptions = {},
    noise = 0.002,
  } = {}) {
    // One source of truth for the eye's field of view: the retina map defines
    // it, the eye camera matches it. See fovForRetina for why they must agree.
    const eyeFov = fovForRetina({ radius: retinaRadius, angularSpacing: retinaSpacing });

    this.arena = new Arena({ canvas, size: arenaSize, eyeResolution, eyeFov });
    this.scent = new ScentField();
    this.avatar = new LabAvatar({
      vision, eyeResolution, eyeFov, retinaRadius, retinaSpacing,
      bounds: arenaSize - 2, ...avatarOptions,
    });
    this.brain = new LabBrain({ mode, circuit, packUrl, serverUrl, tickHz: brainHz, noise });
    this.observer = observer ? new LabObserver(observerOptions) : null;

    this.stations = [];
    this.brainHz = brainHz;
    this.brainDt = 1 / brainHz;
    this.visionEnabled = vision;
    this.cameraMode = camera;
    this.brightness = brightness;

    this.time = 0;
    this.frame = 0;
    this.running = false;
    this._accumulator = 0;
    this._lastFrame = 0;
    this._hooks = { beforeStep: [], afterStep: [], poke: [] };
  }

  /** Drop a station into the lab. Safe before or after `start()`. */
  addStation(station) {
    this.stations.push(station);
    if (this.arena.scene) this._spawn(station);
    return station;
  }

  removeStation(station) {
    const i = this.stations.indexOf(station);
    if (i === -1) return false;
    this.stations.splice(i, 1);
    if (station.object3D) this.arena.remove(station.object3D);
    if (station.labelMesh) this.arena.remove(station.labelMesh);
    station.detach();
    return true;
  }

  _spawn(station) {
    const object3D = station.build();
    object3D.position.copy(station.position);
    station.object3D = object3D;
    this.arena.add(object3D);

    // Floor label is a sibling of the station, not a child: it must stay flat
    // on the ground and level, while stations rotate to face the ring centre.
    const label = station.buildLabel();
    if (label) {
      label.position.set(station.position.x, label.position.y, station.position.z + 2.2);
      station.labelMesh = label;
      this.arena.add(label);
    }
    station.attach(this);
  }

  /** Run `fn(dt, lab)` every brain tick, before or after the network steps. */
  onBeforeStep(fn) { this._hooks.beforeStep.push(fn); return this; }
  onAfterStep(fn) { this._hooks.afterStep.push(fn); return this; }

  async start() {
    this.arena.init();
    this.arena.setCameraMode(this.cameraMode);
    this.arena.setBrightness(this.brightness);

    await this.brain.init();

    this.arena.add(this.avatar.build());
    for (const station of this.stations) this._spawn(station);
    this.observer?.mount(this);

    this._bindPointer();

    this.running = true;
    this._lastFrame = performance.now();
    requestAnimationFrame(this._loop);
    return this;
  }

  /**
   * Click the fly to poke it -- drives the real mechanosensory_tactile
   * population. Clicking a station fires that station's `onPoke` if it has one.
   *
   * Raycasting is done here rather than in Arena because the hit has to be
   * resolved against the avatar and the station list, which are the lab's
   * business; Arena only owns the camera the ray is cast from.
   */
  _bindPointer() {
    const raycaster = new THREE.Raycaster();
    // The avatar lives on its own layer so the eye cameras cannot see it (a fly
    // does not see its own head). A Raycaster tests layer 0 only by default, so
    // without this the fly becomes unclickable -- which is exactly what
    // happened when that layer was introduced: click-to-poke silently stopped
    // working with no error anywhere.
    raycaster.layers.enable(AVATAR_LAYER);
    const ndc = new THREE.Vector2();
    let downAt = null;

    this.arena.canvas.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY };
    });
    this.arena.canvas.addEventListener('pointerup', (e) => {
      // Ignore drags -- the same pointer is how the orbit camera is moved.
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
        downAt = null;
        return;
      }
      downAt = null;

      const rect = this.arena.canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, this.arena.camera);

      const hits = raycaster.intersectObjects(
        [this.avatar.object3D, ...this.stations.map((s) => s.object3D)].filter(Boolean), true,
      );
      if (!hits.length) return;

      // Walk up to whichever top-level object owns the hit mesh.
      let node = hits[0].object;
      while (node.parent && node.parent !== this.arena.scene) node = node.parent;

      if (node === this.avatar.object3D) {
        this.avatar.touch(1);
        this._hooks.poke.forEach((fn) => fn(this.avatar, this));
      } else {
        const station = this.stations.find((st) => st.object3D === node);
        station?.onPoke?.(hits[0].distance, station);
      }
    });
  }

  /** Called when the player pokes the fly. */
  onPoke(fn) { this._hooks.poke.push(fn); return this; }

  stop() { this.running = false; }

  dispose() {
    this.stop();
    this.observer?.dispose();
    this.brain.dispose();
    for (const s of this.stations) s.detach();
  }

  _loop = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this._loop);

    const frameDt = Math.min(0.25, (now - this._lastFrame) / 1000);
    this._lastFrame = now;
    this.frame++;

    // Vision is the expensive part of the frame; sample it once per rendered
    // frame rather than once per brain tick. The brain then sees the most
    // recent frame across however many fixed steps it catches up on.
    const eyePixels = this.visionEnabled ? this.arena.renderEyes(this.avatar) : null;

    this._accumulator += frameDt;
    let steps = 0;
    while (this._accumulator >= this.brainDt && steps < MAX_CATCHUP_STEPS) {
      this._accumulator -= this.brainDt;
      steps++;
      // `visionFresh` only on the FIRST catch-up step. The looming detector
      // measures motion BETWEEN successive frames, so handing it the same
      // buffer twice makes it measure zero motion -- and its persistence
      // counter, which requires ~40ms of sustained expansion, gets reset to
      // zero by every duplicate. At 15fps rendering with a 60Hz brain that is
      // 3 resets out of every 4 ticks, and looming could essentially never
      // fire: the fly flew straight past a hazard fan without reacting.
      // Sensory INPUT is sustained (setInput holds until changed), so skipping
      // re-processing on the catch-up steps loses nothing.
      this._tick(this.brainDt, eyePixels, steps === 1);
    }
    // Drop the backlog rather than spiral after a long stall (tab switch, GC).
    if (steps === MAX_CATCHUP_STEPS) this._accumulator = 0;

    this.arena.updateCamera(this.avatar);
    this._orientLabels();
    this.arena.render();
    this.observer?.update(this, frameDt);
  };

  /**
   * Keep floor labels readable from wherever the camera is.
   *
   * A fixed orientation only works from one viewpoint: a label aligned for a
   * viewer at the arena centre reads mirrored and upside down from anywhere
   * else, which is what the chase camera saw. The plate stays flat on the
   * ground; only its spin about Y follows the camera, so the text always runs
   * left-to-right across the view.
   *
   * Derivation: with rotation.x = -PI/2 the plane's local +X maps to world
   * (cos z, 0, -sin z), and we want that along the camera's right vector
   * (-fz, 0, fx) -- hence atan2(-fx, -fz).
   */
  _orientLabels() {
    const c = this.arena.camera;
    const fx = -Math.sin(c.rotation.y) * Math.cos(c.rotation.x);
    const fz = -Math.cos(c.rotation.y) * Math.cos(c.rotation.x);
    const spin = Math.atan2(-fx, -fz);
    for (const station of this.stations) {
      if (station.labelMesh) station.labelMesh.rotation.set(-Math.PI / 2, 0, spin);
    }
  }

  _tick(dt, eyePixels, visionFresh = true) {
    this.time += dt;

    this.avatar.sense(this.brain, {
      eyePixels, scent: this.scent, time: this.time, visionFresh,
    });

    const ctx = { lab: this, avatar: this.avatar, brain: this.brain, time: this.time };
    for (const station of this.stations) station.tick(dt, ctx);

    for (const fn of this._hooks.beforeStep) fn(dt, this);
    this.brain.step(dt);
    for (const fn of this._hooks.afterStep) fn(dt, this);

    this.avatar.act(this.brain, dt, this.time);
  }

  setCamera(mode) { this.arena.setCameraMode(mode); this.cameraMode = mode; return this; }

  /**
   * Swap to a different circuit without reloading the page.
   *
   * Loads that circuit's pack, rebuilds the runtime around it, and rebuilds the
   * HUD panels that are sized by the pack (the soma cloud's point count and the
   * telemetry's channel list both change). Lesions are dropped, because channel
   * names are not guaranteed to exist in the new pack.
   *
   * Only meaningful in Mode B: in Mode A the circuit is whatever the server was
   * started with, so this switches the brain to the local pack and says so.
   */
  async setCircuit(name) {
    if (this._swapping) return null;
    this._swapping = true;
    const previous = this.brain.circuit;
    const wantsModeA = !!CIRCUITS[name]?.modeA;
    try {
      const fromModeA = this.brain.mode === 'full-connectome';
      const { serverUrl, noise } = this.brain;
      this.brain.dispose();

      this.brain = new LabBrain({
        // The 'full' circuit IS Mode A -- there is no pack for it. Requesting
        // it connects to the server; everything else loads a local pack.
        mode: wantsModeA ? 'full-connectome' : 'pruned-subgraph',
        circuit: wantsModeA ? (this._serverCircuit ?? 'courtship') : name,
        tickHz: this.brainHz,
        noise,
        serverUrl,
      });
      await this.brain.init();

      if (wantsModeA) {
        // init() resolves as soon as the socket is opened; the handshake may
        // still be in flight. Give it a moment, then report honestly if the
        // server never answered rather than leaving a dead brain in place.
        const up = await new Promise((res) => {
          const started = performance.now();
          const poll = () => {
            if (this.brain.runtime?.ready) return res(true);
            if (performance.now() - started > 15000) return res(false);
            setTimeout(poll, 100);
          };
          poll();
        });
        if (!up) {
          console.warn(`[MadFlyLab] no Mode A server on ${serverUrl} — `
            + `start it with \`npm run brain:full\`. Falling back to ${previous}.`);
          this.brain.dispose();
          this.brain = new LabBrain({
            mode: 'pruned-subgraph', circuit: previous,
            tickHz: this.brainHz, noise, serverUrl,
          });
          await this.brain.init();
          if (this.observer) { this.observer.dispose(); this.observer.mount(this); }
          this.avatar.reset();
          return { circuit: previous, neurons: this.brain.nNeurons, serverMissing: true };
        }
      }

      // The observer caches pack-derived state; rebuild it against the new one.
      if (this.observer) {
        this.observer.dispose();
        this.observer.mount(this);
      }
      this.avatar.reset();
      this.genotype = null;

      console.info(`[MadFlyLab] circuit ${previous} -> ${name}`
        + (fromModeA && !wantsModeA ? ' (left Mode A)' : ''));
      return {
        circuit: name, neurons: this.brain.nNeurons,
        leftModeA: fromModeA && !wantsModeA, modeA: wantsModeA,
      };
    } finally {
      this._swapping = false;
    }
  }

  /** Cycle through the circuits the framework ships packs for. */
  async cycleCircuit() {
    const names = Object.keys(CIRCUITS);
    const i = names.indexOf(this.brain.circuit);
    return this.setCircuit(names[(i + 1) % names.length]);
  }

  /**
   * Reset the run. `remint` gives the fly a new cosmetic identity; `noise`
   * seeds the network from a different real initial condition.
   *
   * Those two are deliberately separate. Re-minting changes only how the fly
   * LOOKS -- same connectome, same weights, same behaviour. Noise is the part
   * that genuinely differs between runs. Bundling them would imply the colours
   * mean something.
   */
  reset({ remint = false, seed = null, noise = this.brain.noise } = {}) {
    this.avatar.reset();
    this.brain.reset(noise);
    this.time = 0;
    this._accumulator = 0;
    if (remint) this.avatar.remint(seed ?? Date.now().toString(36));
    for (const station of this.stations) station.elapsed = 0;
    return this.avatar.identity;
  }

  /**
   * Mint a new fly. With no argument it is purely cosmetic; with a genotype it
   * builds a fly to spec -- see avatar/genotype.js.
   *
   *     lab.mintNewFly()                        // new colours, same brain
   *     lab.mintNewFly('blind')                 // a named genotype
   *     lab.mintNewFly({ silence: ['LC4'] })    // a custom lesion
   *
   * Lesions apply immediately. A `circuit` or `mode` change needs a different
   * pack or server, so that returns a genotype flagged `requiresReload` rather
   * than pretending to have applied it.
   */
  mintNewFly(spec = null, seed = null) {
    const genotype = resolveGenotype(spec ?? {});
    this.genotype = genotype;

    this.reset({ remint: true, seed: genotype.seed ?? seed });

    // Vision is a property of the body, lesions of the brain.
    this.avatar.visionEnabled = genotype.vision && !!this.avatar.eyes;
    this.visionEnabled = this.avatar.visionEnabled;
    if (!this.avatar.visionEnabled) {
      // Leave no stale drive on the visual channels, or a blind fly would keep
      // coasting on whatever it last saw.
      for (const c of ['LPLC1_L', 'LPLC1_R', 'LPLC2_L', 'LPLC2_R', 'LC4_L', 'LC4_R']) {
        this.brain.setInput(c, 0);
      }
    }

    this.brain.clearSilenced();
    if (genotype.silence.length) this.brain.silence(...genotype.silence);

    const requiresReload = !!(
      (genotype.circuit && genotype.circuit !== this.brain.circuit)
      || (genotype.mode && genotype.mode !== this.brain.mode)
    );

    console.info(`[MadFlyLab] minted ${this.avatar.identity.name} — ${describeGenotype(genotype)}`
      + (requiresReload ? ' (circuit/mode change needs a reload)' : ''));
    return { ...this.avatar.identity, genotype, requiresReload };
  }

  /**
   * Arrange stations evenly on a circle around the origin, facing inward.
   * Stations placed at explicit positions tend to end up in one quadrant, and
   * the fly walks out of the experiment; a ring keeps it surrounded.
   */
  arrangeInRing(radius = 9, { startAngle = 0 } = {}) {
    const n = this.stations.length;
    this.stations.forEach((station, i) => {
      const a = startAngle + (i / n) * Math.PI * 2;
      station.position.set(Math.cos(a) * radius, station.position.y, Math.sin(a) * radius);
      if (station.object3D) {
        station.object3D.position.copy(station.position);
        // Face the ring centre. Mesh-local +Z is the station's front (same
        // convention as the avatar), and atan2 gives the yaw that points it
        // back toward the origin.
        station.object3D.rotation.y = Math.atan2(-station.position.x, -station.position.z);
      }
      if (station.labelMesh) {
        // Just outside the station, pushed radially away from centre. Its spin
        // is handled per-frame by _orientLabels so it stays readable.
        station.labelMesh.position.set(
          Math.cos(a) * (radius + 2.4), station.labelMesh.position.y, Math.sin(a) * (radius + 2.4),
        );
      }
    });
    return this;
  }
}
