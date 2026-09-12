/**
 * Station -- the unit a developer drops into the lab (spec 3, 4).
 *
 * A Station owns a piece of the arena: some geometry, optionally a scent
 * emitter, and a set of triggers that fire when the avatar interacts with it.
 * The framework handles spawning, gradient registration, proximity tests and
 * the update loop; a scene subclass supplies `build()` and reacts in its
 * handlers.
 *
 * Stations must not touch the WebGL pipeline or the brain's internals. They
 * return a THREE.Object3D from `build()` and talk to the brain through the
 * public LabBrain API (`injectCurrent`, `setInput`, `read`). See AGENTS.md.
 */

import * as THREE from 'three';

let nextId = 0;

export class Station {
  /**
   * @param {object} opts
   * @param {number[]} opts.position   [x, y, z] in arena units
   * @param {string}   opts.name       label shown in the HUD
   * @param {number}   opts.kickRadius distance at which onKick fires
   */
  constructor(opts = {}) {
    this.id = `station-${nextId++}`;
    this.name = opts.name ?? this.constructor.name;
    this.options = opts;
    this.position = new THREE.Vector3(...(opts.position ?? [0, 0, 0]));
    this.kickRadius = opts.kickRadius ?? 1.2;

    this.lab = null;
    this.object3D = null;
    this.enabled = opts.enabled !== false;

    this._insideKick = false;
    this._removeEmitter = null;
    this.elapsed = 0;

    this.onKick = opts.onKick ?? null;
    this.onEnter = opts.onEnter ?? null;
    this.onLeave = opts.onLeave ?? null;
    this.onTick = opts.onTick ?? null;
  }

  /** Subclass hook: return the station's THREE.Object3D. */
  build() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8844ff }),
    );
    mesh.castShadow = true;
    return mesh;
  }

  /** Subclass hook: per-frame animation and sensing. */
  update(/* dt, ctx */) {}

  /**
   * Called once by the lab after `build()`. Registers any scent this station
   * emits; subclasses that emit declare `scentType` / `scentRadius` in options.
   */
  attach(lab) {
    this.lab = lab;
    const { scentType, scentRadius, scentStrength } = this.options;
    if (scentType) {
      this._removeEmitter = lab.scent.emit(scentType, {
        position: this.position,
        radius: scentRadius ?? 5,
        strength: scentStrength ?? 1,
        enabled: this.enabled,
      });
    }
  }

  detach() {
    this._removeEmitter?.();
    this._removeEmitter = null;
    this.lab = null;
  }

  /** Driven by the lab each frame; subclasses override `update`, not this. */
  tick(dt, ctx) {
    if (!this.enabled) return;
    this.elapsed += dt;
    this.update(dt, ctx);
    this.onTick?.(dt, ctx);

    const d = this.position.distanceTo(ctx.avatar.position);
    const inside = d <= this.kickRadius;
    if (inside && !this._insideKick) {
      this._insideKick = true;
      this.onEnter?.(d, this);
      this.onKick?.(d, this);
    } else if (!inside && this._insideKick) {
      this._insideKick = false;
      this.onLeave?.(d, this);
    }
  }

  distanceTo(position) { return this.position.distanceTo(position); }

  setEnabled(on) {
    this.enabled = on;
    if (this.object3D) this.object3D.visible = on;
  }
}

/**
 * Triggers -- small composable predicates for wiring stations to the brain
 * without writing per-frame bookkeeping in a scene (spec section 4's `Triggers`
 * import).
 */
export const Triggers = {
  /** Fire at most once every `seconds`. */
  throttle(seconds, handler) {
    let last = -Infinity;
    return (...args) => {
      const now = performance.now() / 1000;
      if (now - last < seconds) return;
      last = now;
      handler(...args);
    };
  },

  /** Fire when `read()` crosses `threshold` upward. */
  rising(read, threshold, handler) {
    let was = false;
    return (...args) => {
      const now = read() >= threshold;
      if (now && !was) handler(...args);
      was = now;
    };
  },

  /** Fire with probability `p` -- for stations that should pay out sometimes. */
  chance(p, handler) {
    return (...args) => { if (Math.random() < p) handler(...args); };
  },

  /** Fire when the avatar comes within `distance` of a station. */
  proximity(distance, handler) {
    return (d, station) => { if (d <= distance) handler(d, station); };
  },
};
