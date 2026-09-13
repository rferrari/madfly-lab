/**
 * HazardFan -- a rotating looming threat (spec 4).
 *
 * Two ways a scene can use it, and they are genuinely different:
 *
 *   onLooming callback  ->  lab.brain.triggerLooming('LC4', distance)
 *       A geometric proxy. Distance in, drive out. Cheap, deterministic, and
 *       exactly what the spec's example does.
 *
 *   vision (default)    ->  nothing; the avatar sees it
 *       The fan's blades are real geometry, so as the avatar approaches, the
 *       compound eye's motion-opponency detector measures real optical
 *       expansion from the rendered frame and drives LC4 itself. Slower but
 *       honest: the fly escapes because its eye saw something expand.
 *
 * Both drive the same real LC4/LPLC2 cells. The default leaves it to vision;
 * pass `onLooming` to add the geometric path on top.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { THEME } from '../core/theme.js';

export class HazardFan extends Station {
  constructor(opts = {}) {
    super({
      name: 'Hazard Fan', kickRadius: 1.4, collisionRadius: 0.5,
      label: 'HAZARD FAN', sublabel: 'looming → LC4_L / LC4_R · 202 real neurons',
      labelColor: '#ff3355', ...opts,
    });
    this.rotationSpeed = opts.rotationSpeed ?? 10;
    this.blades = opts.blades ?? 4;
    this.detectRadius = opts.detectRadius ?? 9;
    this.onLooming = opts.onLooming ?? null;
    this.lastDistance = Infinity;
    /**
     * Airflow. A fan blows, and a fly feels that through Johnston's Organ --
     * 335 real JO-C/JO-E antennal neurons that respond to sustained deflection.
     * Wind reaches the fly BEFORE the blades do, which is what makes a hazard
     * dangerous to an animal that has not seen it yet.
     */
    this.windRadius = opts.windRadius ?? 8;
    this.windStrength = opts.windStrength ?? 1.0;
    this._removeWind = null;
    /** Running state. Click the fan (or call toggle()) to switch it off. */
    this.running = opts.running !== false;
    this._windEmitter = null;
  }

  build() {
    const group = new THREE.Group();

    // Rotor raised to 1.05 to avoid blade tips colliding with ground during rotation.
    // Blades (0.34 tall) extend from ~0.88 to ~1.22, with tips at 0.75 radius.
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.14, 1.0, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a1638, roughness: 0.6, metalness: 0.5 }),
    );
    post.position.y = 0.5;
    post.castShadow = true;
    group.add(post);

    // The rotor spins in a VERTICAL plane facing the fly, not flat like a
    // ceiling fan. That is the whole point of a looming station: the blades
    // have to sweep across the fly's visual field and grow as it approaches,
    // so the motion-opponency detector sees radial expansion. A horizontal
    // rotor is edge-on from ground level and produces almost no expansion.
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 1.05, 0.12);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: THEME.red, emissive: THEME.red, emissiveIntensity: 0.8,
      roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide,
    });
    for (let i = 0; i < this.blades; i++) {
      // Blades lie in the local XY plane; the rotor then spins about local Z,
      // which points out of the fan's face toward the arena centre.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.04), bladeMat);
      const a = (i / this.blades) * Math.PI * 2;
      blade.rotation.z = a;
      blade.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0);
      blade.castShadow = true;
      this.rotor.add(blade);
    }
    group.add(this.rotor);

    // A hub disc so the centre of expansion is a solid, trackable feature.
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20),
      new THREE.MeshStandardMaterial({
        color: 0x3a1020, emissive: THEME.red, emissiveIntensity: 0.5, metalness: 0.7,
      }),
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 1.05, 0.2);
    group.add(hub);

    this.warn = new THREE.PointLight(THEME.red, 6, 8, 2);
    this.warn.position.y = 1.3;
    group.add(this.warn);
    return group;
  }

  attach(lab) {
    super.attach(lab);
    // The lab's spatial field is channel-keyed, so it carries wind as readily
    // as odour -- same falloff, different modality and different real neurons.
    if (this.windStrength > 0) {
      this._windEmitter = {
        position: this.position,
        radius: this.windRadius,
        strength: this.windStrength,
        // The field honours `enabled`, so switching the fan off stops the wind
        // at source rather than merely hiding the blades.
        enabled: this.enabled && this.running,
      };
      this._removeWind = lab.scent.emit('wind', this._windEmitter);
    }
  }

  detach() {
    this._removeWind?.();
    this._removeWind = null;
    super.detach();
  }

  /** Switch the fan on or off. Stops the blades AND the airflow. */
  toggle() { return this.setRunning(!this.running); }

  /**
   * Wind lives in its own emitter, so the base class (which only knows about
   * the scent one) cannot silence it. Re-sync in BOTH directions: switching the
   * fan off has to stop the airflow, and switching it back on must not restore
   * wind for a fan that was not running in the first place.
   */
  setEnabled(on) {
    super.setEnabled(on);
    if (this._windEmitter) this._windEmitter.enabled = this.enabled && this.running;
    return this;
  }

  setRunning(on) {
    this.running = !!on;
    if (this._windEmitter) this._windEmitter.enabled = this.enabled && this.running;
    if (this.warn) this.warn.visible = this.running;
    this.onRunning?.(this.running, this);
    return this.running;
  }

  update(dt, ctx) {
    if (!this.running) {
      // Spin down rather than stopping dead; a coasting fan still looms.
      this.rotationSpeed = Math.max(0, this.rotationSpeed - dt * 6);
      if (this.rotor) this.rotor.rotation.z += this.rotationSpeed * dt;
      if (this.warn) this.warn.intensity = 0;
      return;
    }
    if (this.rotationSpeed < (this.options.rotationSpeed ?? 10)) {
      this.rotationSpeed = Math.min(this.options.rotationSpeed ?? 10,
        this.rotationSpeed + dt * 8);
    }
    if (this.rotor) this.rotor.rotation.z += this.rotationSpeed * dt;

    const distance = this.distanceTo(ctx.avatar.position);
    this.lastDistance = distance;
    if (this.warn) {
      const near = Math.max(0, 1 - distance / this.detectRadius);
      this.warn.intensity = 2 + near * 16 + (Math.sin(this.elapsed * 9) * 0.5 + 0.5) * near * 8;
    }

    if (this.onLooming && distance <= this.detectRadius) {
      this.onLooming(distance, this);
    } else if (this.onLooming && distance > this.detectRadius) {
      // Stop driving LC4 once out of range, or the geometric path would pin the
      // escape circuit on forever after one approach.
      ctx.brain.clearLooming('LC4');
    }
  }
}
