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
    this.legs = { left: null, right: null };
    this._active = null; // {leg, t, kind}
    this._activeBody = null; // {t, kind}
    // Captured lazily on first 'body' gesture -- the rig is repositioned by
    // its owner (see buildTetheredRig) AFTER construction, so capturing a
    // rest position here would freeze it at the pre-placement (0,0,0).
    this._bodyRest = null;
    this._build();
  }

  _build() {
    // Brighter than the body's own material and clearly emissive, so these
    // read as distinct legs against the platform rather than blending into
    // the (dark, similarly-colored) avatar body behind them.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a3a74, emissive: THEME.cyan, emissiveIntensity: 0.45, roughness: 0.35,
    });
    // Sized and spread against the avatar's ROOM-2 scale (~0.5-0.6x its
    // free-roaming size, half-width/half-depth roughly 0.17/0.26 -- see
    // MadFlyLab.setRoom's TETHERED_AVATAR_SCALE): pivots sit just OUTSIDE
    // those edges so the legs are visibly external, not swallowed by the
    // body the way the old free-roaming-scale offsets (+-0.28, tuned for a
    // body twice this size) were.
    const make = (x, z) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.26, 6), mat.clone());
      leg.position.set(x, -0.06, z);
      leg.rotation.x = 0.5;
      this.object3D.add(leg);
      return leg;
    };
    this.legs.left = make(-0.26, 0.08);
    this.legs.right = make(0.26, 0.08);
    for (const leg of Object.values(this.legs)) leg.userData.rest = leg.rotation.clone();
  }

  /**
   * @param {'left'|'right'|'body'} which  two legs only -- 'body' is the
   *   whole rig (used by 'jump', which recoils the group itself, not one
   *   leg). Tasks that only need one active leg (blackjack's hit/stand,
   *   the optogenetics dopamine kick) use 'right'; 'left' is free for a
   *   second, independent gesture (the courtship shimmer plays both).
   * @param {'tap'|'sweep'|'kick'|'jump'|'shimmer'|'vertical'|'horizontal'} kind
   *   'vertical'/'horizontal' are the blackjack task's pair (hit/stand) --
   *   one leg, two clearly-different motions, rather than picking which leg
   *   moves.
   */
  play(which, kind = 'tap') {
    if (which === 'body') {
      if (!this._bodyRest) this._bodyRest = this.object3D.position.clone();
      this._activeBody = { t: 0, kind };
      return;
    }
    const leg = this.legs[which];
    if (!leg) return;
    this._active = { leg, t: 0, kind };
  }

  update(dt) {
    if (this._active) {
      const { leg, kind } = this._active;
      this._active.t += dt;
      const p = Math.min(1, this._active.t / GESTURE_DURATION);
      if (kind === 'shimmer') {
        // Higher-frequency oscillation than a single arc, so a left+right
        // pair fired together reads as a flutter rather than one more tap.
        const envelope = Math.sin(p * Math.PI);
        const flutter = Math.sin(p * Math.PI * 9) * 0.22 * envelope;
        leg.rotation.x = leg.userData.rest.x - flutter;
        leg.rotation.z = flutter * 0.6;
      } else if (kind === 'vertical') {
        // Hit: a clean down-and-back tap, rotation.x only -- no sideways
        // component, so it reads as unambiguously different from 'horizontal'.
        const swing = Math.sin(p * Math.PI) * 0.7;
        leg.rotation.x = leg.userData.rest.x - swing;
      } else if (kind === 'horizontal') {
        // Stand: a sideways sweep, rotation.z only -- rotation.x stays at
        // rest, so there's no vertical component to confuse it with 'vertical'.
        leg.rotation.z = Math.sin(p * Math.PI) * 0.6;
      } else {
        // A single up-down-return arc, shaped differently per gesture so the
        // three read as distinct actions rather than the same tap three times.
        const amp = kind === 'kick' ? 0.9 : kind === 'sweep' ? 0.5 : 0.35;
        const swing = Math.sin(p * Math.PI) * amp;
        leg.rotation.x = leg.userData.rest.x - swing;
        if (kind === 'sweep') leg.rotation.z = Math.sin(p * Math.PI) * 0.4;
      }
      if (p >= 1) {
        leg.rotation.copy(leg.userData.rest);
        this._active = null;
      }
    }

    if (this._activeBody) {
      this._activeBody.t += dt;
      const p = Math.min(1, this._activeBody.t / GESTURE_DURATION);
      // A short back-and-up recoil of the whole rig -- the Giant Fiber escape
      // jump. Still purely scripted: nothing here models an actual leg push.
      const arc = Math.sin(p * Math.PI);
      this.object3D.position.z = this._bodyRest.z - arc * 0.22;
      this.object3D.position.y = this._bodyRest.y + arc * 0.12;
      if (p >= 1) {
        this.object3D.position.copy(this._bodyRest);
        this._activeBody = null;
      }
    }
  }
}
