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
import { ScreenRecorder } from '../observer/screen-recorder.js';
import { resolveGenotype, describeGenotype } from '../avatar/genotype.js';
import { CIRCUITS } from '../circuits.js';
import { buildTetheredRig, frameTetheredCamera } from '../rooms/tethered-rig.js';

const MAX_CATCHUP_STEPS = 4;

/** See setRoom()'s 'tethered-rig' branch. */
const TETHERED_AVATAR_SCALE = 0.55;

/** Half-width of the sensor block, for collision resolution. */
const AVATAR_RADIUS = 0.35;

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
    this._hooks = { beforeStep: [], afterStep: [], poke: [], bump: [], frame: [] };

    // Screen recording will be initialized after arena is created
    this.screenRecorder = null;

    /**
     * Which room is active: 'free-roaming' (Room 1, the default arena) or
     * 'tethered-rig' (Room 2). See setRoom().
     */
    this.room = 'free-roaming';
    this._tetheredRig = null;   // {group, orb, legRig} while in Room 2
    this._savedRoom1 = null;    // stations/camera/vision/bounds set aside
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
    // A station added switched off must LOOK switched off. setEnabled handles
    // this on a later toggle, but it early-returns when the flag already
    // matches, so a station constructed with `enabled: false` used to spawn
    // fully visible and only vanish once someone toggled it twice.
    if (!station.enabled) {
      object3D.visible = false;
      if (station.labelMesh) station.labelMesh.visible = false;
    }
    station.attach(this);
  }

  /** Run `fn(dt, lab)` every brain tick, before or after the network steps. */
  onBeforeStep(fn) { this._hooks.beforeStep.push(fn); return this; }
  onAfterStep(fn) { this._hooks.afterStep.push(fn); return this; }

  /**
   * Run `fn(frameDt, lab)` once per RENDERED frame (not per brain tick --
   * see onBeforeStep/onAfterStep for that), after the frame's render and
   * observer update. For scene glue that needs to animate something every
   * frame regardless of which room is active (e.g. examples/optogenetics/'s
   * hover-halo pulse); the hook itself is room-agnostic, callers gate their
   * own logic on `lab.room`.
   */
  onFrame(fn) { this._hooks.frame.push(fn); return this; }

  async start() {
    this.arena.init();
    this.arena.setCameraMode(this.cameraMode);
    this.arena.setBrightness(this.brightness);

    // Initialize screen recorder with arena canvas
    this.screenRecorder = new ScreenRecorder(this.arena.canvas, { fps: 30 });

    await this.brain.init();

    this.arena.add(this.avatar.build());
    for (const station of this.stations) this._spawn(station);
    this.observer?.mount(this);

    this._bindPointer();
    this._bindRecordingKeys();

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

  /**
   * Resume the render/brain loop after `stop()`. Safe to call when already
   * running (no-op). Resets `_lastFrame` to now -- otherwise the first frame
   * after an arbitrarily long pause would compute a huge `frameDt` (clamped
   * to 0.25s by `_loop` regardless, but resetting is the honest fix rather
   * than relying on the clamp).
   */
  resume() {
    if (this.running) return;
    this.running = true;
    this._lastFrame = performance.now();
    requestAnimationFrame(this._loop);
  }

  /**
   * Keyboard bindings for screen recording:
   * Shift+R: Start/stop recording
   * Shift+P: Open replay modal (while recording exists)
   * Shift+V: Export MP4 video
   * Shift+J: Export JSON telemetry
   * Shift+C: Clear recording
   */
  _bindRecordingKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey) {
        const key = e.key.toUpperCase();
        if (key === 'R') {
          e.preventDefault();
          this.toggleRecording();
        } else if (key === 'P') {
          e.preventDefault();
          this.screenRecorder.openReplayModal();
        } else if (key === 'V') {
          e.preventDefault();
          this.screenRecorder.exportVideo();
        } else if (key === 'J') {
          e.preventDefault();
          this.screenRecorder.exportTelemetry();
        } else if (key === 'C') {
          e.preventDefault();
          if (confirm('Clear recording? This cannot be undone.')) {
            this.screenRecorder.clear();
          }
        }
      }
    });
  }

  /**
   * Toggle recording on/off
   */
  toggleRecording() {
    if (this.screenRecorder.isRecording) {
      const summary = this.screenRecorder.stop();
      console.log(`✅ Recording saved: ${summary.frameCount} frames, ${summary.duration.toFixed(2)}s`);
      this._showRecordingStatus(`📹 STOPPED · ${summary.frameCount} frames`);
    } else {
      this.screenRecorder.start();
      this._showRecordingStatus('🔴 RECORDING');
    }
  }

  /**
   * Show a temporary status message in the corner
   */
  _showRecordingStatus(message) {
    let status = document.getElementById('recording-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'recording-status';
      // top-center, not top-right -- top-right is the MADFLY LAB panel's own
      // corner (src/observer/lab-observer.js mounts its root at top:0;
      // right:0), so this toast used to sit directly on top of it.
      status.style.cssText = `
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 20;
        background: rgba(18, 10, 34, 0.9); border: 2px solid rgba(154, 92, 255, 0.6);
        color: #00e5ff; font: 11px 'SF Mono', ui-monospace, monospace;
        padding: 10px 16px; border-radius: 6px; pointer-events: none;
        opacity: 0; transition: opacity 0.4s ease;
      `;
      document.body.appendChild(status);
    }
    status.textContent = message;
    clearTimeout(this._recordingStatusTimer);
    // Force the opacity transition to actually replay even if this message
    // arrives while a previous one is still fading in/out.
    status.style.opacity = '0';
    requestAnimationFrame(() => { status.style.opacity = '1'; });
    // Auto-fade -- this never used to happen at all, so a "STOPPED · N
    // frames" toast from a while ago just sat there permanently.
    this._recordingStatusTimer = setTimeout(() => {
      status.style.opacity = '0';
    }, 2800);
  }

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

    if (this.room === 'tethered-rig') {
      frameTetheredCamera(this.arena);
      if (this._tetheredRig) {
        this._tetheredRig.orb.update(
          this.brain.runtime?.activationView?.(), frameDt, this.brain.runtime?.cloud,
        );
        this._tetheredRig.legRig.update(frameDt);
      }
    } else {
      this.arena.updateCamera(this.avatar);
      this._orientLabels();
    }
    this.arena.render();
    this.observer?.update(this, frameDt);
    for (const fn of this._hooks.frame) fn(frameDt, this);

    // Capture frame for recording
    if (this.screenRecorder.isRecording) {
      this.screenRecorder.captureFrame(this);
    }

    // Update replay if modal is open
    if (this.screenRecorder.isReplaying) {
      this.screenRecorder.updatePlayback(frameDt);
    }
  };

  /**
   * Stop the fly walking through the furniture, and make the collision a real
   * sensory event.
   *
   * Bumping into something is mechanosensory, so a collision drives the same
   * 2,558 real `touch` neurons a deliberate poke does -- the fly finds out it
   * hit something the way an actual fly would, through its own tactile cells,
   * rather than through a scripted callback.
   *
   * Resolution is a push-out along the contact normal plus a speed penalty.
   * That is engineered, not physics: there is no mass, momentum or restitution
   * here, and there does not need to be.
   */
  _resolveCollisions() {
    const a = this.avatar;
    for (const station of this.stations) {
      if (!station.enabled || !station.collisionRadius) continue;
      const dx = a.position.x - station.position.x;
      const dz = a.position.z - station.position.z;
      const d = Math.hypot(dx, dz);
      const minD = station.collisionRadius + AVATAR_RADIUS;
      if (d >= minD || d === 0) continue;

      // Push out along the contact normal.
      const nx = dx / d;
      const nz = dz / d;
      a.position.x = station.position.x + nx * minD;
      a.position.z = station.position.z + nz * minD;

      // Losing most of its speed is what makes a wall feel like a wall.
      a.speed *= 0.25;

      // Real tactile drive, scaled by how hard it was going.
      const force = Math.min(1, 0.35 + a.speed / a.maxSpeed);
      a.touch(force);
      station.onBump?.(force, station);
      this._hooks.bump.forEach((fn) => fn(station, force, this));
    }
  }

  /** Called when the fly walks into a station. */
  onBump(fn) { this._hooks.bump.push(fn); return this; }

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
    this._resolveCollisions();
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

  /** The scripted leg-gesture rig, while Room 2 is active; otherwise null. */
  get legRig() { return this._tetheredRig?.legRig ?? null; }

  /** Room 2's floating brain point-cloud (BrainOrb), while active; otherwise null. */
  get brainOrb() { return this._tetheredRig?.orb ?? null; }

  /** Cycle through the circuits the framework ships packs for. */
  async cycleCircuit() {
    const names = Object.keys(CIRCUITS);
    const i = names.indexOf(this.brain.circuit);
    return this.setCircuit(names[(i + 1) % names.length]);
  }

  /**
   * Switch between Room 1 (free-roaming) and Room 2 (tethered training rig).
   *
   * Same avatar, same brain -- only the room around them changes. Room 2
   * hides Room 1's stations (their scent fields would otherwise keep driving
   * the brain during training, exactly the "physical locomotion noise" a
   * tethered rig exists to remove), freezes the avatar in place
   * (`avatar.tethered = true` -- see LabAvatar.act()), and swaps in the
   * platform/brain-orb/leg-rig scene from rooms/tethered-rig.js. Task-specific
   * equipment (a card table, a math screen) is NOT built here -- a scene adds
   * its own station at `DOCK_POSITION` after switching, the same way Room 1
   * stations are added via `addStation()`.
   *
   * @param {'free-roaming'|'tethered-rig'} name
   */
  setRoom(name) {
    if (name === this.room) return this.room;
    if (name !== 'free-roaming' && name !== 'tethered-rig') {
      throw new Error(`[MadFlyLab] unknown room "${name}". Known: free-roaming, tethered-rig`);
    }

    if (name === 'tethered-rig') {
      // Set Room 1 aside rather than disposing it, so switching back is cheap
      // and lossless -- restarting Mode B / re-minting the fly would also
      // reset the very brain state Room 2 exists to isolate and observe.
      this._savedRoom1 = {
        stations: this.stations,
        visionEnabled: this.visionEnabled,
        bounds: this.avatar.bounds,
        position: this.avatar.position.clone(),
        yaw: this.avatar.yaw,
        cameraMode: this.cameraMode,
      };
      for (const station of this.stations) {
        if (station.object3D) this.arena.remove(station.object3D);
        if (station.labelMesh) this.arena.remove(station.labelMesh);
        station.detach(); // stops scent/wind emitters -- no Room 1 noise in Room 2
      }
      this.stations = [];

      this.avatar.tethered = true;
      this.avatar.reset([0, 0.42, 0], 0);
      // Room 2's rig (platform ball, dock) is built at a small, fixed scale
      // (see rooms/tethered-rig.js) -- the avatar's normal free-roaming size
      // (tuned to read well in a 17-40 unit arena) visually swallowed it and
      // the scripted leg gestures along with it. Shrink just for this room;
      // restored exactly on the way back out below.
      this._avatarScaleBeforeTether = this.avatar.object3D.scale.x;
      this.avatar.object3D.scale.setScalar(this._avatarScaleBeforeTether * TETHERED_AVATAR_SCALE);
      // Vision is switched off in the tethered rig by default: this room's
      // reference task (see examples/blackjack/) drives the brain purely
      // through olfactory channels, deliberately -- "visual input was tried
      // first and did not reach the central brain" in the demo this room is
      // modelled on. A scene using the DIRECT VISUAL CHANNEL a different task
      // might want can re-enable it after switching (`lab.visionEnabled =
      // true`); this default just avoids paying for eye rendering nobody asked
      // for.
      this.visionEnabled = false;

      const rig = buildTetheredRig(this.brain.pack ?? this.brain.runtime);
      this.arena.add(rig.group);
      // legRig is already parented to rig.group at its intended WORLD position
      // (see buildTetheredRig) -- do not also parent it under the avatar.
      // THREE.Object3D.add() re-parents rather than duplicating, so an
      // earlier version of this line silently moved it OUT of rig.group and
      // reinterpreted its (0, 0.5, 0) position as avatar-LOCAL instead of
      // world, which (combined with the avatar's own position/scale) put the
      // legs floating well above the body instead of under it.
      this._tetheredRig = rig;

      this.room = 'tethered-rig';
    } else {
      // Back to free-roaming: tear down Room 2's scenery and restore Room 1.
      if (this._tetheredRig) {
        this.arena.remove(this._tetheredRig.group); // legRig goes with it, as its child
        this._tetheredRig.orb.dispose();
        this._tetheredRig = null;
      }
      this.avatar.tethered = false;
      if (this._avatarScaleBeforeTether != null) {
        this.avatar.object3D.scale.setScalar(this._avatarScaleBeforeTether);
        this._avatarScaleBeforeTether = null;
      }
      if (this._savedRoom1) {
        this.stations = this._savedRoom1.stations;
        for (const station of this.stations) this._spawn(station);
        this.visionEnabled = this._savedRoom1.visionEnabled;
        this.avatar.bounds = this._savedRoom1.bounds;
        this.avatar.reset(
          [this._savedRoom1.position.x, this._savedRoom1.position.y, this._savedRoom1.position.z],
          this._savedRoom1.yaw,
        );
        this.cameraMode = this._savedRoom1.cameraMode;
        this._savedRoom1 = null;
      }
      this.room = 'free-roaming';
    }

    console.info(`[MadFlyLab] room -> ${this.room}`);
    return this.room;
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
  /**
   * @param {number} radius
   * @param {object} [opts]
   * @param {number} [opts.startAngle]
   * @param {string[]} [opts.order] station names, in the order they should go
   *   round the circle. Anything not named keeps its existing relative order
   *   and follows on after; anything named but absent is skipped. Lets a scene
   *   choose the LAYOUT without having to add its stations in that order, which
   *   matters when neighbouring stations interact -- overlapping scent plumes,
   *   for one.
   */
  arrangeInRing(radius = 9, { startAngle = 0, order = null } = {}) {
    let ring = this.stations;
    if (order) {
      const rank = new Map(order.map((name, i) => [name, i]));
      // Stable: unnamed stations sort after named ones, keeping their order.
      ring = [...this.stations].sort((x, y) =>
        (rank.get(x.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(y.name) ?? Number.MAX_SAFE_INTEGER));
    }
    const n = ring.length;
    ring.forEach((station, i) => {
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
