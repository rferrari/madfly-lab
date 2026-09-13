/**
 * LegRig -- scripted foreleg gestures for the tethered rig (Room 2).
 *
 * Deliberately scripted animation, not physics or motor-neuron-driven
 * kinematics: this mirrors NeuroMechFly's own blackjack demo exactly --
 * "the leg tap or sweep afterwards is a scripted animation: this brain model
 * has no nerve cord." Nothing downstream of the descending neurons in this
 * framework models leg muscles or joints (see LabAvatar's own honesty note
 * about being a kinematic sensor-block, not a biomechanical body), so a
 * gesture here is deliberately a tween on a few extra meshes, triggered by
 * whatever decided the action (a Q-readout, in the tethered-rig example) --
 * not something the real connectome computed.
 */

import * as THREE from 'three';
import { THEME } from '../core/theme.js';

const GESTURE_DURATION = 0.45; // seconds

export class LegRig {
  constructor() {
    this.object3D = new THREE.Group();
    this.legs = { left: null, right: null, front: null };
    this._active = null; // {leg, t, kind}
    this._build();
  }

  _build() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a1b44, emissive: THEME.cyan, emissiveIntensity: 0.15, roughness: 0.4,
    });
    const make = (x, z) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4, 6), mat.clone());
      leg.position.set(x, -0.1, z);
      leg.rotation.x = 0.5;
      this.object3D.add(leg);
      return leg;
    };
    this.legs.left = make(-0.28, 0.2);
    this.legs.right = make(0.28, 0.2);
    this.legs.front = make(0, 0.45);
    for (const leg of Object.values(this.legs)) leg.userData.rest = leg.rotation.clone();
  }

  /** @param {'left'|'right'|'front'} which  @param {'tap'|'sweep'|'kick'} kind */
  play(which, kind = 'tap') {
    const leg = this.legs[which];
    if (!leg) return;
    this._active = { leg, t: 0, kind };
  }

  update(dt) {
    if (!this._active) return;
    const { leg, kind } = this._active;
    this._active.t += dt;
    const p = Math.min(1, this._active.t / GESTURE_DURATION);
    // A single up-down-return arc, shaped differently per gesture so the
    // three read as distinct actions rather than the same tap three times.
    const amp = kind === 'kick' ? 0.9 : kind === 'sweep' ? 0.5 : 0.35;
    const swing = Math.sin(p * Math.PI) * amp;
    leg.rotation.x = leg.userData.rest.x - swing;
    if (kind === 'sweep') leg.rotation.z = Math.sin(p * Math.PI) * 0.4;
    if (p >= 1) {
      leg.rotation.copy(leg.userData.rest);
      this._active = null;
    }
  }
}
