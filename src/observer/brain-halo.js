/**
 * BrainHalo -- a colored highlight + expanding shockwave for an arbitrary
 * subset of a `BrainOrb`'s points. Framework-generic: it takes a plain index
 * array and a color, and knows nothing about channels, tools, or reactions --
 * that belongs to whatever picks the indices (see examples/optogenetics/).
 *
 * Both overlay meshes are parented under `orb.points` (not `orb.object3D`),
 * not the orb's own object3D group: `BrainOrb.update()` sets
 * `points.rotation.y` every frame and applies the `magnification` scale only
 * to `points` (the containment shell, added to `object3D`, is unscaled and
 * unrotated). A child of `points` inherits both automatically, so the halo
 * tracks the cloud's spin with no per-frame sync of its own. Their local
 * geometry must therefore be authored in the SAME raw (pre-magnification)
 * units as the orb's own position attribute, which is exactly what
 * `setCluster()` reads it from.
 */

import * as THREE from 'three';

const SHOCKWAVE_DURATION = 0.45; // seconds
const SHOCKWAVE_MAX_RADIUS = 0.5; // local units (pre-magnification)
const HOVER_PULSE_HZ = 3.2;

export class BrainHalo {
  /**
   * @param {import('./brain-orb.js').BrainOrb} orb
   * @param {object} opts
   * @param {number|string} [opts.color]
   */
  constructor(orb, { color = 0xffffff } = {}) {
    this.orb = orb;
    this.color = new THREE.Color(color);
    this.clusterIndices = null;
    this.centroid = new THREE.Vector3();
    this._hoverVisible = false;
    this._hoverPhase = 0;
    this._shockwaveT = null; // null = idle, else elapsed seconds

    this._buildHaloPoints();
    this._buildShockwave();
    this.attached = false;
  }

  _buildHaloPoints() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.material = new THREE.PointsMaterial({
      color: this.color, size: 9, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.raycast = () => {}; // never itself a raycast target
    this.points.renderOrder = 5;
  }

  _buildShockwave() {
    this.shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: 0,
      side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // Unit sphere, scaled per-frame during the shockwave -- same "faint shell"
    // idiom BrainOrb already uses for its containment sphere.
    this.shockwave = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.shockwaveMaterial);
    this.shockwave.raycast = () => {};
    this.shockwave.scale.setScalar(0.001);
    this.shockwave.renderOrder = 4;
  }

  /** Adds the overlay meshes under the orb's points. Call once. */
  attach() {
    if (this.attached || !this.orb.points) return;
    this.orb.points.add(this.points);
    this.orb.points.add(this.shockwave);
    this.attached = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.shockwave.parent?.remove(this.shockwave);
    this.points.geometry.dispose();
    this.material.dispose();
    this.shockwave.geometry.dispose();
    this.shockwaveMaterial.dispose();
  }

  setColor(color) {
    this.color.set(color);
    this.material.color.set(this.color);
    this.shockwaveMaterial.color.set(this.color);
  }

  /**
   * @param {Int32Array|number[]} indices  pack neuron indices, already
   *   filtered against `pack.somaValid` by the caller -- this class only
   *   knows about the orb's raw position buffer, not the pack itself.
   */
  setCluster(indices) {
    this.clusterIndices = indices;
    const src = this.orb.points?.geometry.attributes.position.array;
    if (!src || !indices.length) {
      this.points.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.centroid.set(0, 0, 0);
      return;
    }
    const pos = new Float32Array(indices.length * 3);
    const centroid = new THREE.Vector3();
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      centroid.x += x; centroid.y += y; centroid.z += z;
    }
    centroid.multiplyScalar(1 / indices.length);
    this.centroid.copy(centroid);
    this.points.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.computeBoundingSphere();
    this.shockwave.position.copy(centroid);
  }

  setHoverVisible(visible) { this._hoverVisible = visible; }

  triggerShockwave() { this._shockwaveT = 0; }

  update(dt) {
    this._hoverPhase += dt;
    const breathe = 0.55 + Math.sin(this._hoverPhase * HOVER_PULSE_HZ) * 0.2;
    this.material.opacity = this._hoverVisible ? breathe : 0;

    if (this._shockwaveT == null) return;
    this._shockwaveT += dt;
    const p = this._shockwaveT / SHOCKWAVE_DURATION;
    if (p >= 1) {
      this._shockwaveT = null;
      this.shockwave.scale.setScalar(0.001);
      this.shockwaveMaterial.opacity = 0;
      return;
    }
    this.shockwave.scale.setScalar(Math.max(0.001, p * SHOCKWAVE_MAX_RADIUS));
    this.shockwaveMaterial.opacity = (1 - p) * 0.85;
  }
}
