/**
 * ToadTongue -- a baited trap that strikes, and the arena's first honest
 * looming stimulus.
 *
 * WHY THIS EXISTS RATHER THAN JUST TUNING THE FAN. The looming detector
 * (avatar/motion.js) fits radial expansion at a grid of receptive-field centres
 * and requires all four opposing sectors to agree the field is growing. That
 * requirement is deliberate -- it is what stops a flash, a turn, or a
 * whole-field translation from reading as a threat. A spinning rotor fails it
 * for the same reason: blade sweep is circular flow around a centre, not
 * expansion outward from one, so the hazard fan produces almost no loom no
 * matter how fast it turns. The only expansion it ever generates comes from the
 * fly's own approach, which is slow.
 *
 * A tongue shot at her is the real thing: one object, growing fast, centred on
 * a point in her visual field. That is the stimulus LC4/LPLC2 evolved to catch,
 * and in this dataset those cells supply 30.6% of DNp01's input -- so a strike
 * drives the real Giant Fiber, which drives the real escape takeoff.
 *
 * THE EXPERIMENT. Strike speed is randomised per strike. A slow tongue she can
 * see coming and escape; a fast one lands before the pathway can fire. Since
 * the aim is COMMITTED at strike time rather than tracking her, dodging is
 * genuinely possible, and the catch/miss counts are a reaction-time measurement
 * on a real escape circuit rather than a scripted outcome.
 *
 * The bait is a real scent emitter, so she is drawn in by the same olfactory
 * machinery as any food station -- which is what makes it a trap rather than a
 * hazard she happens to walk past.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { THEME } from '../core/theme.js';

/** Tongue travels at the fly's eye height, not above it. See Screen's `mount`
 *  note for the bug this avoids -- anything much higher leaves her view as she
 *  gets close, which for a looming stimulus defeats the entire point. */
const MOUTH_Y = 0.42;

export class ToadTongue extends Station {
  constructor(opts = {}) {
    super({
      name: 'Toad', kickRadius: 2.0, collisionRadius: 0.7,
      label: 'TOAD', sublabel: 'baited strike — real loom → LC4 → DNp01',
      labelColor: '#ff3355',
      scentType: opts.scentType ?? 'ORN_VA6',
      scentRadius: opts.scentRadius ?? 8,
      ...opts,
    });
    /** She has to be this close before it will strike. */
    this.strikeRadius = opts.strikeRadius ?? 4.5;
    /** How far the tongue can reach. */
    this.reach = opts.reach ?? 4.2;
    /** Extension time, seconds. Randomised per strike between the two. */
    this.fastStrike = opts.fastStrike ?? 0.10;
    this.slowStrike = opts.slowStrike ?? 0.55;
    /** Quiet time after a strike before it will try again. */
    this.cooldown = opts.cooldown ?? 2.5;
    /** How near the tip has to pass to count as a catch. */
    this.catchRadius = opts.catchRadius ?? 0.5;

    this.catches = 0;
    this.misses = 0;
    this.strikes = 0;
    this.lastSpeed = 0;
    this.onStrike = opts.onStrike ?? null;
    this.onCatch = opts.onCatch ?? null;
    this.onMiss = opts.onMiss ?? null;

    /** 'idle' | 'out' | 'back' */
    this.phase = 'idle';
    this.extension = 0;
    this._phaseT = 0;
    this._readyAt = 0;
    this._dir = { x: 0, y: 0, z: 1 };
    this._hit = false;
  }

  build() {
    const group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({
      color: 0x2f6b3a, roughness: 0.75, metalness: 0.1,
    });

    // Squat body, slightly sunk, so it reads as something crouching.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), skin);
    body.scale.set(1, 0.62, 0.86);
    body.position.y = 0.3;
    body.castShadow = true;
    group.add(body);

    // Eyes on top -- two bumps, the cue that this thing is watching.
    this.eyeMeshes = [-1, 1].map((side) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 14, 10),
        new THREE.MeshStandardMaterial({
          color: 0xffcc33, emissive: 0xffaa00, emissiveIntensity: 0.5, roughness: 0.3,
        }),
      );
      eye.position.set(side * 0.26, 0.62, 0.12);
      group.add(eye);
      return eye;
    });

    // Mouth: a dark slot at the front, at the fly's eye height.
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.12, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x140a10, roughness: 0.9 }),
    );
    mouth.position.set(0, MOUTH_Y, 0.5);
    group.add(mouth);

    // The bait: a visible morsel just in front of the mouth. The SMELL is the
    // station's scent emitter (see the constructor); this is only so that what
    // draws her in is visible to us too.
    this.baitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 10),
      new THREE.MeshStandardMaterial({
        color: THEME.lime, emissive: THEME.lime, emissiveIntensity: 0.8, roughness: 0.4,
      }),
    );
    this.baitMesh.position.set(0, MOUTH_Y - 0.06, 0.78);
    group.add(this.baitMesh);

    // The tongue. Built along +Z with unit length so a strike is a z-scale --
    // the group is aimed, the mesh just grows along it.
    this.tongueGroup = new THREE.Group();
    this.tongueGroup.position.set(0, MOUTH_Y, 0.46);
    // Yaw before pitch, so aiming is the usual two-angle affair.
    this.tongueGroup.rotation.order = 'YXZ';
    group.add(this.tongueGroup);

    const tongueMat = new THREE.MeshStandardMaterial({
      color: 0xff5577, emissive: 0xaa2244, emissiveIntensity: 0.45, roughness: 0.5,
    });
    this.tongueShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 10), tongueMat);
    this.tongueShaft.rotation.x = Math.PI / 2;   // lie the cylinder along +Z
    this.tongueShaft.position.z = 0.5;           // pivot at the mouth end
    this.tongueGroup.add(this.tongueShaft);

    // A blunt tip -- the part that actually expands in her visual field.
    this.tongueTip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), tongueMat);
    this.tongueGroup.add(this.tongueTip);

    this.tongueGroup.visible = false;
    return group;
  }

  /** World position of the mouth the tongue fires from. */
  _mouthWorld() {
    const yaw = this.object3D?.rotation.y ?? 0;
    return {
      x: this.position.x + Math.sin(yaw) * 0.46,
      y: this.position.y + MOUTH_Y,
      z: this.position.z + Math.cos(yaw) * 0.46,
    };
  }

  /** Where the tip is right now, in world space. */
  tipPosition() {
    const m = this._mouthWorld();
    const L = this.extension * this.reach;
    return { x: m.x + this._dir.x * L, y: m.y + this._dir.y * L, z: m.z + this._dir.z * L };
  }

  _beginStrike(avatar) {
    const m = this._mouthWorld();
    const dx = avatar.position.x - m.x;
    const dy = avatar.position.y - m.y;
    const dz = avatar.position.z - m.z;
    const flat = Math.hypot(dx, dz) || 1e-6;

    // AIM IS COMMITTED HERE and never updated again this strike. A tongue that
    // tracked her would always connect, which would make the escape circuit
    // irrelevant -- the whole point is that she can dodge a slow one.
    const worldYaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, flat);
    this._dir = {
      x: Math.sin(worldYaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.cos(worldYaw) * Math.cos(pitch),
    };
    if (this.tongueGroup) {
      this.tongueGroup.rotation.y = worldYaw - (this.object3D?.rotation.y ?? 0);
      this.tongueGroup.rotation.x = -pitch;
      this.tongueGroup.visible = true;
    }

    // Randomised per strike: this is the independent variable of the whole
    // experiment. Fast enough and the escape pathway cannot finish in time.
    this.lastSpeed = this.fastStrike + Math.random() * (this.slowStrike - this.fastStrike);
    this.phase = 'out';
    this._phaseT = 0;
    this._hit = false;
    this.strikes++;
    this.onStrike?.(this.lastSpeed, this);
  }

  _setTongue() {
    if (!this.tongueGroup) return;
    const L = Math.max(1e-3, this.extension * this.reach);
    this.tongueShaft.scale.set(1, 1, L);
    this.tongueShaft.position.z = L / 2;
    this.tongueTip.position.z = L;
    this.tongueGroup.visible = this.extension > 0.001;
  }

  update(dt, ctx) {
    const avatar = ctx.avatar;
    const d = this.distanceTo(avatar.position);

    // Eyes brighten as she gets close -- a tell, so a strike is not a complete
    // ambush from the observer's point of view.
    if (this.eyeMeshes) {
      const near = Math.max(0, 1 - d / this.strikeRadius);
      for (const eye of this.eyeMeshes) eye.material.emissiveIntensity = 0.4 + near * 2.2;
    }
    if (this.baitMesh) {
      this.baitMesh.material.emissiveIntensity = 0.6 + Math.sin(this.elapsed * 3) * 0.25;
    }

    if (this.phase === 'idle') {
      if (d <= this.strikeRadius && this.elapsed >= this._readyAt) this._beginStrike(avatar);
      return;
    }

    this._phaseT += dt;
    if (this.phase === 'out') {
      this.extension = Math.min(1, this._phaseT / this.lastSpeed);

      // Catch test every tick along the way, not just at full extension --
      // the tip sweeps past a lot of space in one frame of a fast strike.
      if (!this._hit) {
        const tip = this.tipPosition();
        const hit = Math.hypot(
          tip.x - avatar.position.x, tip.y - avatar.position.y, tip.z - avatar.position.z,
        ) <= this.catchRadius;
        if (hit) {
          this._hit = true;
          this.catches++;
          // Being caught is emphatically a tactile event.
          avatar.touch(1);
          this.onCatch?.(this.lastSpeed, this);
        }
      }

      if (this.extension >= 1) {
        if (!this._hit) { this.misses++; this.onMiss?.(this.lastSpeed, this); }
        this.phase = 'back';
        this._phaseT = 0;
      }
    } else if (this.phase === 'back') {
      // Retract slower than it struck.
      this.extension = Math.max(0, 1 - this._phaseT / (this.lastSpeed * 2.2));
      if (this.extension <= 0) {
        this.phase = 'idle';
        this.extension = 0;
        this._readyAt = this.elapsed + this.cooldown;
      }
    }
    this._setTongue();
  }

  /** Stop mid-strike if the station is switched off. */
  onDisabled() {
    this.phase = 'idle';
    this.extension = 0;
    this._readyAt = 0;
    this._setTongue();
  }
}
