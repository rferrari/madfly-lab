/**
 * BrainOrb -- the magnified, floating 3D soma point-cloud for Room 2 (the
 * tethered training rig). Same real per-neuron soma positions and the same
 * activation-driven shader as the HUD's `SomaCloud` (see soma-shader.js), but
 * mounted directly in the WORLD as a `THREE.Points` object hovering above the
 * fly -- rendered by the arena's own renderer, not a second offscreen one.
 *
 * "10x magnified" (per the brief) is a display choice: it means the point
 * cloud's own local scale, not a claim about the neurons' real physical size.
 */

import * as THREE from 'three';
import { THEME } from '../core/theme.js';
import { SOMA_VERTEX_SHADER, SOMA_FRAGMENT_SHADER, densityForCount } from './soma-shader.js';

export class BrainOrb {
  /**
   * @param {object} source  a ConnectomePack (Mode B) or a RemoteRuntime with
   *   `somaXYZ`/`somaCount` (Mode A) -- same duck-typed source SomaCloud takes.
   * @param {object} opts
   * @param {number} [opts.magnification] local scale applied to the normalized
   *   (unit-ish box) soma coordinates the pack ships.
   */
  constructor(source, { magnification = 10 } = {}) {
    const pack = source && source.somaXYZ
      ? { nNeurons: source.somaCount ?? source.somaXYZ.length / 3, somaXYZ: source.somaXYZ }
      : null;

    this.n = pack ? pack.nNeurons : 0;
    this.activation = new Float32Array(this.n);
    this.object3D = new THREE.Group();
    this.points = null;
    this.magnification = magnification;
    this.spin = 0;

    if (this.n > 0) this._build(pack);
  }

  _build(pack) {
    const src = pack.somaXYZ;
    const pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      pos[i * 3] = src[i * 3];
      pos[i * 3 + 1] = -src[i * 3 + 1]; // same anatomical up-flip SomaCloud uses
      pos[i * 3 + 2] = src[i * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('activation', new THREE.BufferAttribute(this.activation, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: 3.2 },
        uCold: { value: new THREE.Color(THEME.violet) },
        uHot: { value: new THREE.Color(THEME.cyan) },
        uDensity: { value: densityForCount(this.n) },
      },
      vertexShader: SOMA_VERTEX_SHADER,
      fragmentShader: SOMA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.scale.setScalar(this.magnification);
    this.object3D.add(this.points);

    // A faint containment sphere -- purely so the orb reads as an object
    // floating in space rather than a formless sparkle cloud.
    const shellRadius = this.magnification * 1.15;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(shellRadius, 24, 16),
      new THREE.MeshBasicMaterial({
        color: THEME.violet, transparent: true, opacity: 0.05,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.object3D.add(shell);
  }

  /** @param {Float32Array|null} activations live view (Mode B), or null */
  update(activations, dt, remoteCloud = null) {
    if (!this.points) return;
    if (activations) {
      let peak = 0;
      for (let i = 0; i < this.n; i++) {
        const v = Math.abs(activations[i]);
        this.activation[i] = v;
        if (v > peak) peak = v;
      }
      if (peak > 0) { const k = 1 / peak; for (let i = 0; i < this.n; i++) this.activation[i] *= k; }
    } else if (remoteCloud) {
      this.activation.fill(0);
      const { idx, act } = remoteCloud;
      for (let k = 0; k < idx.length; k++) {
        if (idx[k] < this.n) this.activation[idx[k]] = Math.abs(act[k]);
      }
    }
    this.points.geometry.attributes.activation.needsUpdate = true;
    this.spin += dt * 0.12;
    this.points.rotation.y = this.spin;
  }

  dispose() {
    this.points?.geometry.dispose();
    this.material?.dispose();
  }
}
