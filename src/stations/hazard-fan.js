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
    super({ name: 'Hazard Fan', kickRadius: 1.4, ...opts });
    this.rotationSpeed = opts.rotationSpeed ?? 10;
    this.blades = opts.blades ?? 4;
    this.detectRadius = opts.detectRadius ?? 9;
    this.onLooming = opts.onLooming ?? null;
    this.lastDistance = Infinity;
  }

  build() {
    const group = new THREE.Group();

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.14, 1.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a1638, roughness: 0.6, metalness: 0.5 }),
    );
    post.position.y = 0.75;
    post.castShadow = true;
    group.add(post);

    this.rotor = new THREE.Group();
    this.rotor.position.y = 1.5;
    const bladeMat = new THREE.MeshStandardMaterial({
      color: THEME.red, emissive: THEME.red, emissiveIntensity: 0.8,
      roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide,
    });
    for (let i = 0; i < this.blades; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.34), bladeMat);
      blade.rotation.y = (i / this.blades) * Math.PI * 2;
      blade.position.set(
        Math.cos(blade.rotation.y) * 0.75, 0, -Math.sin(blade.rotation.y) * 0.75,
      );
      blade.castShadow = true;
      this.rotor.add(blade);
    }
    group.add(this.rotor);

    this.warn = new THREE.PointLight(THEME.red, 6, 8, 2);
    this.warn.position.y = 1.6;
    group.add(this.warn);
    return group;
  }

  update(dt, ctx) {
    if (this.rotor) this.rotor.rotation.y += this.rotationSpeed * dt;

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
