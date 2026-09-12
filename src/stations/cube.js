/**
 * OdourCube -- a plain block that smells of something. No lights, no glow.
 *
 * Deliberately matte and unlit: the point of these is to compare two ODOURS,
 * and anything emissive biases the comparison through vision instead. That
 * mistake has already been made once here -- two food bowls differed in tint
 * and scent radius, and the fly looked like it preferred one when it was only
 * smelling and seeing it better.
 *
 * Two presets ship, on real glomeruli with opposite documented valence:
 *
 *   SugarCube  ORN_DM1  ethyl acetate (Or42b) -- fruit and fermentation.
 *                       Attractive. 74 real neurons.
 *   PoopCube   ORN_V    CO2 (Gr21a/Gr63a) -- what rotting matter gives off.
 *                       AVERSIVE in a real fly. 55 real neurons.
 *
 * ON THE AVERSION, HONESTLY: the CO2 channel is real and really is aversive in
 * the animal, but this pruned rate model does NOT reproduce that. Measured, a
 * CO2 drive moves forward drive by +0.0021 -- weakly positive, the same
 * direction as food, just smaller. So avoidance is ENGINEERED at the body (see
 * LabAvatar's chemotaxis), exactly as approach already is. What is real is
 * which neurons carry the signal; what is ours is what the body does about it.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';

export class OdourCube extends Station {
  constructor(opts = {}) {
    super({
      name: 'Odour Cube', kickRadius: 1.1, collisionRadius: 0.45,
      scentRadius: opts.scentRadius ?? 8,
      ...opts,
    });
    this.size = opts.size ?? 0.7;
    this.cubeColor = opts.cubeColor ?? 0xb9b2a8;
    this.roughness = opts.roughness ?? 0.85;
    this.aversive = opts.aversive ?? false;
    this.tasteRadius = opts.tasteRadius ?? 1.1;
    this.tasteStrength = opts.tasteStrength ?? 18.0;
    this.edible = opts.edible ?? !this.aversive;
    this._tasting = false;
  }

  build() {
    const s = this.size;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      // Matte, no emissive: this station is a smell, not a light.
      new THREE.MeshStandardMaterial({
        color: this.cubeColor, roughness: this.roughness, metalness: 0.05,
      }),
    );
    mesh.position.y = s / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  update(dt, ctx) {
    // Only edible things are worth tasting; a fly does not stop to eat CO2.
    if (!this.edible) return;
    const onIt = this.distanceTo(ctx.avatar.position) <= this.tasteRadius;
    if (onIt !== this._tasting) {
      this._tasting = onIt;
      ctx.brain.setInput('taste', onIt ? this.tasteStrength : 0);
      this.onTaste?.(onIt, this);
    }
  }
}

/** White sugar cube -- ORN_DM1, a real attractive food glomerulus. */
export class SugarCube extends OdourCube {
  constructor(opts = {}) {
    super({
      name: 'Sugar Cube',
      label: 'SUGAR', sublabel: 'ORN_DM1 · 74 real neurons · attractive',
      labelColor: '#e8e0f5',
      cubeColor: 0xf2efe6, roughness: 0.55,
      scentType: 'ORN_DM1', aversive: false, edible: true,
      ...opts,
    });
  }
}

/** Brown cube -- ORN_V, the real CO2 glomerulus. Aversive in a live fly. */
export class PoopCube extends OdourCube {
  constructor(opts = {}) {
    super({
      name: 'Poop Cube',
      label: 'ROT · CO₂', sublabel: 'ORN_V · 55 real neurons · aversive',
      labelColor: '#8a6a3d',
      cubeColor: 0x6b4a2a, roughness: 0.95,
      scentType: 'ORN_V', aversive: true, edible: false,
      ...opts,
    });
  }
}
