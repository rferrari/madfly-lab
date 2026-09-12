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

import { Arena } from './arena.js';
import { fovForRetina } from '../avatar/retina.js';
import { ScentField } from './gradients.js';
import { LabAvatar } from '../avatar/lab-avatar.js';
import { LabBrain } from '../brain/lab-brain.js';
import { LabObserver } from '../observer/lab-observer.js';

const MAX_CATCHUP_STEPS = 4;

export class MadFlyLab {
  constructor({
    canvas = '#app-canvas',
    mode = 'pruned-subgraph',
    circuit = 'courtship-and-foraging',
    packUrl = null,
    serverUrl = 'ws://localhost:8770',
    brainHz = 60,
    arenaSize = 40,
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

    this.time = 0;
    this.frame = 0;
    this.running = false;
    this._accumulator = 0;
    this._lastFrame = 0;
    this._hooks = { beforeStep: [], afterStep: [] };
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
    station.detach();
    return true;
  }

  _spawn(station) {
    const object3D = station.build();
    object3D.position.copy(station.position);
    station.object3D = object3D;
    this.arena.add(object3D);
    station.attach(this);
  }

  /** Run `fn(dt, lab)` every brain tick, before or after the network steps. */
  onBeforeStep(fn) { this._hooks.beforeStep.push(fn); return this; }
  onAfterStep(fn) { this._hooks.afterStep.push(fn); return this; }

  async start() {
    this.arena.init();
    this.arena.setCameraMode(this.cameraMode);

    await this.brain.init();

    this.arena.add(this.avatar.build());
    for (const station of this.stations) this._spawn(station);
    this.observer?.mount(this);

    this.running = true;
    this._lastFrame = performance.now();
    requestAnimationFrame(this._loop);
    return this;
  }

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
    const eyePixels = this.visionEnabled ? this.arena.renderEye(this.avatar) : null;

    this._accumulator += frameDt;
    let steps = 0;
    while (this._accumulator >= this.brainDt && steps < MAX_CATCHUP_STEPS) {
      this._accumulator -= this.brainDt;
      steps++;
      this._tick(this.brainDt, eyePixels);
    }
    // Drop the backlog rather than spiral after a long stall (tab switch, GC).
    if (steps === MAX_CATCHUP_STEPS) this._accumulator = 0;

    this.arena.updateCamera(this.avatar);
    this.arena.render();
    this.observer?.update(this, frameDt);
  };

  _tick(dt, eyePixels) {
    this.time += dt;

    this.avatar.sense(this.brain, { eyePixels, scent: this.scent, time: this.time });

    const ctx = { lab: this, avatar: this.avatar, brain: this.brain, time: this.time };
    for (const station of this.stations) station.tick(dt, ctx);

    for (const fn of this._hooks.beforeStep) fn(dt, this);
    this.brain.step(dt);
    for (const fn of this._hooks.afterStep) fn(dt, this);

    this.avatar.act(this.brain, dt, this.time);
  }

  setCamera(mode) { this.arena.setCameraMode(mode); this.cameraMode = mode; return this; }

  reset() {
    this.avatar.reset();
    this.brain.reset();
    this.time = 0;
    return this;
  }
}
