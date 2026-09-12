/**
 * FoodBowl -- an olfactory station emitting a real glomerulus channel (spec 4).
 *
 * `scentType` must be one of the four real ORN populations the packs ship
 * (ORN_DM1, ORN_VA6, ORN_DA1, ORN_DA2). The scent is a spatial gradient in the
 * lab's ScentField; the avatar's receptors sample it and drive those real
 * neurons, and everything downstream of them in the connectome responds on its
 * own. Nothing here tells the fly to approach -- if it does, that is the real
 * ORN -> PN -> central pathway doing it.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { OLFACTORY_CHANNELS } from '../avatar/olfaction.js';
import { THEME } from '../core/theme.js';

export class FoodBowl extends Station {
  constructor(opts = {}) {
    const scentType = opts.scentType ?? 'ORN_VA6';
    if (!OLFACTORY_CHANNELS.includes(scentType)) {
      console.warn(
        `[MadFlyLab] FoodBowl scentType "${scentType}" is not one of the real glomerulus `
        + `channels the shipped packs contain (${OLFACTORY_CHANNELS.join(', ')}). `
        + `It will emit, but no real neuron will receive it.`,
      );
    }
    super({
      name: 'Food Bowl', kickRadius: 1.2,
      scentRadius: opts.scentRadius ?? 5, ...opts, scentType,
    });
    this.scentType = scentType;
    this.nutrition = opts.nutrition ?? 1;
    this.consumed = 0;
    this.color = opts.color ?? THEME.lime;
  }

  build() {
    const group = new THREE.Group();

    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.4, 0.28, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a1a3d, roughness: 0.7, metalness: 0.3 }),
    );
    bowl.position.y = 0.14;
    bowl.castShadow = true;
    group.add(bowl);

    this.food = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 18, 12),
      new THREE.MeshStandardMaterial({
        color: this.color, emissive: this.color, emissiveIntensity: 0.7, roughness: 0.4,
      }),
    );
    this.food.scale.y = 0.5;
    this.food.position.y = 0.26;
    group.add(this.food);

    // A translucent shell showing the scent radius -- the gradient is invisible
    // otherwise, and a scene author debugging chemotaxis needs to see its reach.
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(this.options.scentRadius ?? 5, 20, 14),
      new THREE.MeshBasicMaterial({
        color: this.color, transparent: true, opacity: 0.045,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    group.add(this.halo);
    return group;
  }

  update(dt) {
    if (this.food) {
      const pulse = 0.7 + Math.sin(this.elapsed * 2.2) * 0.25;
      this.food.material.emissiveIntensity = pulse;
      this.food.position.y = 0.26 + Math.sin(this.elapsed * 1.6) * 0.02;
    }
  }

  attach(lab) {
    super.attach(lab);
    const userHandler = this.onKick;
    this.onKick = (distance, station) => {
      this.consumed += this.nutrition;
      userHandler?.(distance, station);
    };
  }
}
