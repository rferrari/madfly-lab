/**
 * Room 4 -- "I Know Blackjack" Rig.
 *
 * Cloned from Room 2's tethered rig, but WITHOUT the overhead tether rod
 * (brain connector/plug). The fly stands free on the spherical platform.
 */

import * as THREE from 'three';
import { THEME } from '../../src/core/theme.js';
import { BrainOrb } from '../../src/observer/brain-orb.js';
import { LegRig } from '../../src/avatar/leg-rig.js';

export const PLATFORM_POSITION = new THREE.Vector3(0, 0, 0);
export const DOCK_POSITION = new THREE.Vector3(0, 0, 1.5);
export const ORB_POSITION = new THREE.Vector3(0, 1.9, 0);

/**
 * Builds Room 4's static geometry (floor, ball platform, lights, orb, leg rig)
 * WITHOUT the overhead tether rod / brain connector.
 *
 * @param {object} brainSource
 * @returns {{group: THREE.Group, orb: BrainOrb, legRig: LegRig}}
 */
export function buildIKnowRig(brainSource) {
  const group = new THREE.Group();
  group.name = 'iknow-rig';

  // Dark chamber floor
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

  // Treadmill platform under the fly
  const BALL_RADIUS = 0.14;
  const BALL_Y = 0.18;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.075, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.5, metalness: 0.6 }),
  );
  post.position.set(PLATFORM_POSITION.x, 0.09, PLATFORM_POSITION.z);
  group.add(post);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0x241a3a, roughness: 0.25, metalness: 0.7,
      emissive: THEME.violet, emissiveIntensity: 0.2,
    }),
  );
  ball.position.set(PLATFORM_POSITION.x, BALL_Y, PLATFORM_POSITION.z);
  group.add(ball);

  // NOTE: Tether rod (brain connector/plug) IS DELIBERATELY EXCLUDED HERE.
  // The fly is untethered/free in this room.

  // Lighting
  const key = new THREE.SpotLight(0x8ab4ff, 12, 8, Math.PI / 5, 0.5, 1.2);
  key.position.set(0, 3.5, 1);
  key.target.position.set(0, 0.4, 0);
  group.add(key, key.target);

  const rim = new THREE.PointLight(THEME.violet, 6, 6, 2);
  rim.position.set(0, 1.2, -1);
  group.add(rim);

  const ambient = new THREE.AmbientLight(0x1a1030, 0.6);
  group.add(ambient);

  // Brain orb
  const orb = new BrainOrb(brainSource, { magnification: 10 });
  orb.object3D.position.copy(ORB_POSITION);
  group.add(orb.object3D);

  // Scripted leg rig
  const legRig = new LegRig();
  legRig.object3D.position.set(PLATFORM_POSITION.x, BALL_Y + BALL_RADIUS, PLATFORM_POSITION.z);
  group.add(legRig.object3D);

  return { group, orb, legRig };
}
