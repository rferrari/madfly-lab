/**
 * BrainRaycaster -- hit-tests a `BrainOrb`'s point cloud against the main
 * viewport camera. Framework-generic: it knows nothing about channels, tools,
 * or which cluster is "selected" -- it only answers "is the pointer over the
 * cloud, and which point index did it hit".
 *
 * `Raycaster.params.Points.threshold` is world-space and, per three.js's own
 * Points#raycast, gets divided by the object's average scale before testing
 * against the RAW (pre-scale) point positions -- so the right threshold
 * depends on the orb's `magnification`, not on absolute soma-coordinate
 * spacing. Nothing in this codebase set this before now; three.js's default
 * (1 world unit) is untuned for a 10x-magnified cloud and must be set
 * explicitly, not left to chance.
 */

import * as THREE from 'three';

/** Tuned empirically against BrainOrb's default magnification=10 (see AGENTS.md
 * verification notes for this feature) -- large enough to comfortably hit a
 * point without a pixel-perfect aim, small enough that adjacent points in a
 * dense cluster don't all register from one ray. */
export const DEFAULT_POINTS_THRESHOLD = 0.35;

export class BrainRaycaster {
  constructor({ pointsThreshold = DEFAULT_POINTS_THRESHOLD } = {}) {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = pointsThreshold;
    this.ndc = new THREE.Vector2();
  }

  /**
   * @param {{x:number,y:number}} ndc  normalized device coords, already
   *   converted from a client pointer position (see optogenetics-palette.js)
   * @param {THREE.Camera} camera
   * @param {THREE.Points} points  a BrainOrb's `.points`, never its `.object3D`
   *   (which also contains the non-interactive containment shell)
   * @returns {{index:number, distance:number, point:THREE.Vector3}|null}
   */
  hitTest(ndc, camera, points) {
    if (!points) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(points, false);
    if (!hits.length) return null;
    const hit = hits[0];
    return { index: hit.index, distance: hit.distance, point: hit.point };
  }
}
