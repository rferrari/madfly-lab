/**
 * Room 2 -- Tethered Training Rig.
 *
 * A dark neurobiology chamber: a tethered platform holding the stationary
 * fly, a magnified brain point-cloud floating above it, and a mount point in
 * front where a scene attaches its own training equipment (a card table, a
 * math screen, an odour dispenser -- whatever the task is). This module only
 * builds the ROOM; the equipment is task-specific and lives with the scene
 * that uses it (see examples/blackjack/ for the card-table dock).
 */

import * as THREE from 'three';
import { THEME } from '../core/theme.js';
import { BrainOrb } from '../observer/brain-orb.js';
import { LegRig } from '../avatar/leg-rig.js';

/** Where the fly's platform sits, and where equipment mounts in front of it. */
export const PLATFORM_POSITION = new THREE.Vector3(0, 0, 0);
export const DOCK_POSITION = new THREE.Vector3(0, 0, 1.5);
// y=0: equipment (e.g. CardTable) builds its own geometry up from a floor
// origin the same way every other Station does; a nonzero y here used to
// double-stack with that, putting the table almost 2 units up.
export const ORB_POSITION = new THREE.Vector3(0, 1.9, 0);

/**
 * Builds Room 2's static geometry and lighting into its own group, so the
 * whole room can be added/removed from the arena in one call.
 *
 * @param {object} brainSource  a ConnectomePack or RemoteRuntime, passed to
 *   BrainOrb (same source LabObserver hands SomaCloud).
 * @returns {{group: THREE.Group, orb: BrainOrb, legRig: LegRig}}
 */
export function buildTetheredRig(brainSource) {
  const group = new THREE.Group();
  group.name = 'tethered-rig';

  // Dark chamber floor -- a small lit disc rather than the free-roaming
  // arena's grid, so the room reads as a distinct, contained space.
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 3.8, 0.15, 32),
    new THREE.MeshStandardMaterial({ color: 0x0a0612, roughness: 0.7, metalness: 0.4 }),
  );
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  group.add(floor);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.5, 48),
    new THREE.MeshBasicMaterial({ color: THEME.cyan, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  group.add(ring);

  // Tethered platform / spherical treadmill under the fly.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.4, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.5, metalness: 0.6 }),
  );
  post.position.set(PLATFORM_POSITION.x, 0.2, PLATFORM_POSITION.z);
  group.add(post);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0x241a3a, roughness: 0.25, metalness: 0.7,
      emissive: THEME.violet, emissiveIntensity: 0.2,
    }),
  );
  ball.position.set(PLATFORM_POSITION.x, 0.42, PLATFORM_POSITION.z);
  group.add(ball);

  // A thin tether rod from above -- purely visual, communicates "held in place".
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6),
    new THREE.MeshStandardMaterial({ color: THEME.cyan, emissive: THEME.cyan, emissiveIntensity: 0.6 }),
  );
  tether.position.set(PLATFORM_POSITION.x, 1.05, PLATFORM_POSITION.z);
  group.add(tether);

  // Chamber lighting -- dim and blue-violet, deliberately different from the
  // free-roaming arena's lab-spot rig so Room 2 reads as its own space.
  const key = new THREE.SpotLight(0x8ab4ff, 12, 8, Math.PI / 5, 0.5, 1.2);
  key.position.set(0, 3.5, 1);
  key.target.position.set(0, 0.4, 0);
  group.add(key, key.target);

  const rim = new THREE.PointLight(THEME.violet, 6, 6, 2);
  rim.position.set(0, 1.2, -1);
  group.add(rim);

  const ambient = new THREE.AmbientLight(0x1a1030, 0.6);
  group.add(ambient);

  // Brain orb, floating above the platform.
  const orb = new BrainOrb(brainSource, { magnification: 10 });
  orb.object3D.position.copy(ORB_POSITION);
  group.add(orb.object3D);

  // Scripted leg rig, attached under where the avatar will sit.
  const legRig = new LegRig();
  legRig.object3D.position.set(PLATFORM_POSITION.x, 0.5, PLATFORM_POSITION.z);
  group.add(legRig.object3D);

  return { group, orb, legRig };
}

/**
 * Fixed close-up camera framing for the tethered rig -- called once per frame.
 *
 * Positioned to the SIDE of the platform-to-dock axis, not behind the dock:
 * an earlier version put the camera further along +z than the dock itself,
 * meaning it looked back at the platform THROUGH the card table's tabletop --
 * the underside of a large flat mesh fills almost the whole frame from there.
 * Sitting off to one side keeps both the tethered fly (and the orb above it)
 * and the dock in view without either occluding the other.
 */
export function frameTetheredCamera(camera) {
  camera.position.set(1.9, 1.7, -1.1);
  camera.lookAt(PLATFORM_POSITION.x, 0.85, (PLATFORM_POSITION.z + DOCK_POSITION.z) / 2);
}
