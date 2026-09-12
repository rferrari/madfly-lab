/**
 * Mate -- a pheromone source, and the missing half of the courtship circuit.
 *
 * The `courtship-and-foraging` pack ships the real cVA pheromone pathway:
 *
 *     ORN_DA1 (204 cells) -> DA1_lPN -> pC1/aSP hub (202) -> DNp13 (copulation
 *                                                            attempt) / DNa01
 *
 * ...but until this station existed nothing in the arena ever emitted on those
 * channels, so that entire pathway sat at rest. The fly wandered because food
 * odour and light were the only things talking to it. A Mate fixes that: it
 * emits a real DA1/DA2 blend, the hub responds, and DNp13 is a genuine readout
 * of whether this fly is interested.
 *
 * DA1 is the real cVA glomerulus (Or67d) -- an actual pheromone channel, not a
 * food odour relabelled. DA2 is paired with it as a second blend component,
 * which is how an earlier in-house simulation modelled a "pheromone blend".
 *
 * `receptiveness` scales the emission. It is a property of the SOURCE, not a
 * claim about the perceiving fly's state.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { THEME } from '../core/theme.js';

export class Mate extends Station {
  constructor(opts = {}) {
    super({
      name: 'Mate', kickRadius: 1.6,
      label: 'MATE · cVA', sublabel: 'ORN_DA1 · 204 real pheromone neurons',
      labelColor: '#ff5edb',
      scentType: 'ORN_DA1',
      scentRadius: opts.scentRadius ?? 12,
      scentStrength: opts.receptiveness ?? 1.0,
      ...opts,
    });
    this.receptiveness = opts.receptiveness ?? 1.0;
    // Second blend component on the real DA2 glomerulus (48 cells).
    this.blendDA2 = opts.blendDA2 ?? 0.45;
    this.acceptChannel = opts.acceptChannel ?? 'DNp13';
    this.acceptThreshold = opts.acceptThreshold ?? 0.35;
    this.courting = false;
    this._removeDA2 = null;
  }

  build() {
    const group = new THREE.Group();

    // A second sensor-block, so it reads as another fly rather than a prop.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.34, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0x2a1030, roughness: 0.4, metalness: 0.6,
        emissive: 0xff5edb, emissiveIntensity: 0.5,
      }),
    );
    body.position.y = 0.32;
    body.castShadow = true;
    group.add(body);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0xffd23d, emissive: 0xffd23d, emissiveIntensity: 1.2, roughness: 0.25,
        }),
      );
      eye.position.set(side * 0.2, 0.42, 0.42);
      group.add(eye);
    }

    // Pheromone plume: nested translucent shells that pulse outward, so the
    // gradient the olfactory receptors sample is actually visible.
    this.plumes = [0.45, 0.72, 1.0].map((f) => {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry((this.options.scentRadius ?? 12) * f, 18, 12),
        new THREE.MeshBasicMaterial({
          color: 0xff5edb, transparent: true, opacity: 0.035 * (1 - f) + 0.012,
          side: THREE.BackSide, depthWrite: false,
        }),
      );
      group.add(shell);
      return shell;
    });

    this.glow = new THREE.PointLight(0xff5edb, 7, 10, 2);
    this.glow.position.y = 1.0;
    group.add(this.glow);
    return group;
  }

  attach(lab) {
    super.attach(lab);
    // The DA2 half of the blend is a second emitter on the same position.
    if (this.blendDA2 > 0) {
      this._removeDA2 = lab.scent.emit('ORN_DA2', {
        position: this.position,
        radius: (this.options.scentRadius ?? 12) * 0.8,
        strength: this.receptiveness * this.blendDA2,
        enabled: this.enabled,
      });
    }
  }

  detach() {
    this._removeDA2?.();
    this._removeDA2 = null;
    super.detach();
  }

  update(dt, ctx) {
    const pulse = 0.5 + Math.sin(this.elapsed * 1.6) * 0.5;
    if (this.glow) this.glow.intensity = 3 + pulse * 8;
    for (const [i, shell] of (this.plumes ?? []).entries()) {
      const k = 1 + Math.sin(this.elapsed * 0.9 + i * 0.8) * 0.04;
      shell.scale.setScalar(k);
    }

    // DNp13 is the real copulation-attempt descending neuron and the strongest
    // measured 1-hop target of the pC1/aSP hub. Reading it is how the scene
    // learns the visiting fly is responding -- not a scripted proximity event.
    const accept = ctx.brain.readCalibrated(this.acceptChannel);
    const now = accept > this.acceptThreshold;
    if (now !== this.courting) {
      this.courting = now;
      this.onCourtship?.(accept, this);
    }
  }
}
