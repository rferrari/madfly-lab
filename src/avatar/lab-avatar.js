/**
 * Kinematic Sensor-Block Avatar (spec 3.1).
 *
 * Deliberately NOT a biomechanical body. flygym/NeuroMechFly already model real
 * leg joint dynamics in MuJoCo, and that is the right tool when the question is
 * about biomechanics. Here the question is about the brain, so the body is the
 * cheapest thing that can carry real sensors and obey real motor neurons: a
 * block that reads the scene, hands its sensors to the connectome, and moves
 * however the real descending neurons tell it to.
 *
 * The sensor -> brain -> motor loop each frame:
 *
 *   retina.sample(eye frame)      -> LPLC1/LPLC2 left/right       (real cells)
 *   looming.step(eye frame)       -> LC4 left/right               (real cells)
 *   olfaction.sample(scent field) -> ORN_DM1/VA6/DA1/DA2          (real cells)
 *                brain.step(dt)
 *   DNa01 L-R difference          -> steering angle
 *   DNp09                         -> forward velocity
 *   DNp01 (Giant Fiber)           -> escape jump
 *
 * Every neuron named there is a real, verified male-cns:v1.0 cell type, and
 * every DN is a verified clean left/right pair -- which is what makes reading
 * steering as a left-minus-right difference meaningful. The *gains* converting
 * activation to metres per second are engineering constants tuned to arena
 * scale, and are not derived from anything biological.
 */

import * as THREE from 'three';
import { CompoundEye } from './retina.js';
import { LoomingDetector } from './motion.js';
import { OlfactoryReceptors } from './olfaction.js';
import { THEME } from '../core/theme.js';

export class LabAvatar {
  constructor({
    position = [0, 0.4, 0],
    yaw = 0,
    vision = true,
    eyeResolution = [96, 64],
    eyeFov = 90,
    retinaRadius = 15,
    retinaSpacing = 2.3,
    // Motor gains: activation -> world units. Arena-scale engineering constants.
    turnGain = 3.2,
    speedGain = 4.0,
    maxSpeed = 6.0,
    escapeImpulse = 5.0,
    bounds = 38,
  } = {}) {
    this.position = new THREE.Vector3(...position);
    this.velocity = new THREE.Vector3();
    this.yaw = yaw;
    this.speed = 0;
    this.bounds = bounds;

    this.turnGain = turnGain;
    this.speedGain = speedGain;
    this.maxSpeed = maxSpeed;
    this.escapeImpulse = escapeImpulse;

    this.visionEnabled = vision;
    this.retina = vision
      ? new CompoundEye({
        radius: retinaRadius, angularSpacing: retinaSpacing,
        width: eyeResolution[0], height: eyeResolution[1], verticalFov: eyeFov,
      })
      : null;
    this.looming = vision ? new LoomingDetector({ width: eyeResolution[0], height: eyeResolution[1] }) : null;
    this.olfaction = new OlfactoryReceptors();

    // Last sensed values, exposed for the HUD and for scenes.
    this.sensors = {
      left: 0, right: 0, loom: 0, loomL: 0, loomR: 0, scent: new Map(),
    };
    this.motor = { steer: 0, forward: 0, escape: 0 };
    this.escapeUntil = 0;
    this.object3D = null;
  }

  /** The sensor-block mesh: a body, two glowing compound eyes, a heading fin. */
  build() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.34, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0x1d1033, roughness: 0.4, metalness: 0.6,
        emissive: THEME.violet, emissiveIntensity: 0.25,
      }),
    );
    body.castShadow = true;
    group.add(body);

    // Compound eyes -- amber, as in the lab art. Their emissive intensity is
    // driven from the retina each frame so you can see the eye "light up".
    const eyeMat = new THREE.MeshStandardMaterial({
      color: THEME.amber, emissive: THEME.amber, emissiveIntensity: 1.4, roughness: 0.25,
    });
    this.eyeMeshes = [-1, 1].map((side) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), eyeMat.clone());
      eye.position.set(side * 0.2, 0.1, 0.42);
      group.add(eye);
      return eye;
    });

    const fin = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.4, 4),
      new THREE.MeshStandardMaterial({
        color: THEME.cyan, emissive: THEME.cyan, emissiveIntensity: 0.9,
      }),
    );
    fin.rotation.x = Math.PI / 2;
    fin.position.set(0, 0.16, -0.55);
    group.add(fin);
    this.fin = fin;

    group.position.copy(this.position);
    this.object3D = group;
    return group;
  }

  /**
   * Sample the world into the brain's real sensory channels.
   * Called by the lab before `brain.step()`.
   */
  sense(brain, { eyePixels, scent, time }) {
    if (this.visionEnabled && eyePixels) {
      const response = this.retina.sample(eyePixels);
      const { left, right } = this.retina.hemifields(response);
      this.sensors.left = left;
      this.sensors.right = right;
      brain.setInput('LPLC1', left + right);
      brain.setInput('LPLC2', left + right);

      const loom = this.looming.step(eyePixels, time);
      this.sensors.loom = loom.loom;
      this.sensors.loomL = loom.left;
      this.sensors.loomR = loom.right;
      // One LC4 channel in the shipped packs (the real LC4 subtypes carry no
      // usable L/R split here), so the two hemifields are summed into it.
      brain.setInput('LC4', (loom.left + loom.right) * 6);

      if (this.eyeMeshes) {
        for (const [i, eye] of this.eyeMeshes.entries()) {
          const v = i === 0 ? left : right;
          eye.material.emissiveIntensity = 0.6 + v * 2.2 + this.sensors.loom * 3;
        }
      }
    }

    this.olfaction.sample(scent, this.position);
    this.olfaction.drive(brain);
    this.sensors.scent = this.olfaction.intensities;
  }

  /**
   * Move according to the real descending motor neurons.
   * Called by the lab after `brain.step()`.
   */
  act(brain, dt, time) {
    // DNa01: real steering DN, clean L/R pair -> a genuine lateral difference.
    const steer = brain.readLateral('DNa01');
    // DNp09: real forward-walking-promoting DN (Bidaye et al. 2020).
    const forward = brain.read('DNp09');
    // DNp01: the Giant Fiber. A real escape command neuron -- when it fires the
    // fly does not steer, it leaves.
    const escape = brain.read('DNp01');

    this.motor.steer = steer;
    this.motor.forward = forward;
    this.motor.escape = escape;

    if (escape > 0.35 && time > this.escapeUntil) {
      this.escapeUntil = time + 0.6;
      // Escape is away from whichever side the loom came from.
      const away = this.sensors.loomR > this.sensors.loomL ? -1 : 1;
      this.yaw += away * 1.1;
      this.speed = this.escapeImpulse;
    } else {
      this.yaw += steer * this.turnGain * dt;
      const drive = Math.max(0, forward) * this.speedGain;
      this.speed += (drive - this.speed) * Math.min(1, dt * 4);
    }

    this.speed = Math.min(this.speed, this.maxSpeed);
    this.velocity.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    // Arena walls: reflect rather than clamp, so a fly that walks into the edge
    // turns around instead of grinding along it forever.
    const b = this.bounds;
    if (Math.abs(this.position.x) > b) {
      this.position.x = Math.sign(this.position.x) * b;
      this.yaw = -this.yaw;
    }
    if (Math.abs(this.position.z) > b) {
      this.position.z = Math.sign(this.position.z) * b;
      this.yaw = Math.PI - this.yaw;
    }

    if (this.object3D) {
      this.object3D.position.copy(this.position);
      this.object3D.rotation.y = this.yaw;
      // A small roll into turns -- cosmetic, but it makes steering legible.
      this.object3D.rotation.z = -steer * 0.5;
      if (this.fin) this.fin.material.emissiveIntensity = 0.4 + Math.abs(forward) * 2;
    }
  }

  reset(position = [0, 0.4, 0], yaw = 0) {
    this.position.set(...position);
    this.yaw = yaw;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.looming?.reset();
    this.escapeUntil = 0;
  }
}
