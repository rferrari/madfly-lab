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
import { AVATAR_LAYER } from '../core/arena.js';
import { mintFly } from './mint.js';

/**
 * Sensor drive corresponding to a fully-saturated sensor (value 1.0).
 *
 * This MUST match `REFERENCE_DRIVE` in python/src/madfly_lab/calibrate.py. That
 * is the drive each pack's per-channel calibration was measured at, so feeding
 * sensors on the same scale makes a calibrated motor read of ~1.0 mean "this
 * channel is as active as a fully-saturated sensor can make it".
 *
 * Before this existed the avatar fed raw hemifield means of ~0.05, ~20x below
 * reference, and read RAW activations out the other side -- DNp09 came back at
 * 2e-7 and the fly never moved at all. Both halves of that were wrong; this
 * constant fixes the input half and readCalibrated fixes the output half.
 */
export const SENSOR_REFERENCE_DRIVE = 1.0;

/** Looming drives harder than reference: an expanding threat should be able to
 *  push the escape pathway well past what ordinary scenery does. */
export const LOOM_DRIVE_GAIN = 6.0;

/**
 * A poke drives the tactile population hard -- it is a startling event.
 *
 * MEASURED, so you know what to expect: a poke at this gain lifts the `touch`
 * channel by ~3.5e4x, raises whole-network activity 13x, and lights ~3,000
 * additional neurons in the soma cloud. What it does NOT do is make the fly
 * jump: in this brain-only connectome, tactile input reaches the descending
 * motor neurons ~1000x more weakly than vision does. That is real anatomy --
 * those cells project largely to targets outside this graph -- not a tuning
 * failure, and inflating the gain until the body lurched would be inventing a
 * pathway the data does not show. Watch the brain, not the legs.
 */
export const TOUCH_DRIVE_GAIN = 400.0;
/**
 * Pulse duration in simulated seconds.
 *
 * The gain is large because this is a TRANSIENT. Calibration references are
 * measured at steady state after 4 simulated seconds of sustained drive; a
 * 0.35s pulse never gets close to that, so a drive of 1.0 reads as ~0.002
 * calibrated and the telemetry trace looks dead. The gain compensates for the
 * duration, not for any claim about how hard a real fly gets poked.
 */
export const TOUCH_DECAY_SECONDS = 0.35;
/** Per-tick falloff for the HUD readout and the body flash only. */
export const TOUCH_VISUAL_DECAY = 0.94;

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
    // Now that steering is a scale-free ratio in ~[-1,1] rather than a tiny
    // raw difference, this is the rad/s at full deflection.
    turnGain = 6.0,
    speedGain = 4.0,
    maxSpeed = 6.0,
    escapeImpulse = 5.0,
    /** Calibrated DNp06 above which the fly stops to feed. */
    /** Rise in DNp06 above its resting level that counts as "this is food". */
    feedThreshold = 0.12,
    /** Klinokinesis: turn when an odour gradient falls. Engineered, see act(). */
    chemotaxis = true,
    chemotaxisGain = 1.9,
    chemotaxisFloor = 0.02,
    bounds = 38,
    seed = null,
  } = {}) {
    // Cosmetic identity only -- see mint.js. Never touches the connectome.
    this.identity = mintFly(seed ?? Date.now().toString(36));
    this.position = new THREE.Vector3(...position);
    this.velocity = new THREE.Vector3();
    this.yaw = yaw;
    this.speed = 0;
    this.bounds = bounds;

    this.turnGain = turnGain;
    this.speedGain = speedGain;
    this.maxSpeed = maxSpeed;
    this.escapeImpulse = escapeImpulse;
    this.feedThreshold = feedThreshold;
    this.feeding = false;
    this.chemotaxis = chemotaxis;
    this.chemotaxisGain = chemotaxisGain;
    this.chemotaxisFloor = chemotaxisFloor;
    this.odourTurn = 0;
    this._castSign = 0;

    this.visionEnabled = vision;
    // One retina and one looming detector PER EYE. The connectome's LC4/LPLC1/
    // LPLC2 populations are annotated left and right and respond asymmetrically
    // (13x, measured), so each eye drives its own real side.
    const eyeOpts = {
      radius: retinaRadius, angularSpacing: retinaSpacing,
      width: eyeResolution[0], height: eyeResolution[1], verticalFov: eyeFov,
    };
    this.eyes = vision
      ? {
        L: { retina: new CompoundEye(eyeOpts), looming: new LoomingDetector({ width: eyeResolution[0], height: eyeResolution[1] }) },
        R: { retina: new CompoundEye(eyeOpts), looming: new LoomingDetector({ width: eyeResolution[0], height: eyeResolution[1] }) },
      }
      : null;
    // `retina` remains the left eye, so anything written against the old
    // single-eye API (and the HUD's fallback path) keeps working.
    this.retina = vision ? this.eyes.L.retina : null;
    this.looming = vision ? this.eyes.L.looming : null;
    this.olfaction = new OlfactoryReceptors();

    /** Displayed touch level (HUD + body flash). The neural pulse is separate. */
    this.touchDrive = 0;
    this._pendingTouch = 0;
    this.odourTurn = 0;
    this._castSign = 0;

    // Last sensed values, exposed for the HUD and for scenes.
    this.sensors = {
      left: 0, right: 0, loom: 0, loomL: 0, loomR: 0, touch: 0,
      odour: 0, odourDelta: 0, scent: new Map(),
    };
    this.motor = { steer: 0, forward: 0, escape: 0, feeding: 0 };
    this.escapeUntil = 0;
    this.object3D = null;
  }

  /** The sensor-block mesh: a body, two glowing compound eyes, a heading fin.
   *  Colours come from the minted identity (cosmetic only -- see mint.js). */
  build() {
    const group = new THREE.Group();
    const id = this.identity;

    this.bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.34, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0x1d1033, roughness: 0.4, metalness: 0.6,
        emissive: id.body, emissiveIntensity: 0.25 * id.glow,
      }),
    );
    this.bodyMesh.castShadow = true;
    group.add(this.bodyMesh);

    // Compound eyes. Their emissive intensity is driven from each retina every
    // frame, so the LEFT mesh brightens when the LEFT eye sees something --
    // making the asymmetry that produces steering visible on the model itself.
    // Mesh-local +X maps to the fly's LEFT (see Arena's heading convention:
    // right = (-cos yaw, sin yaw), and local +X rotates to (cos yaw, -sin yaw)
    // = -right). So index 0 must be +0.2 to be the LEFT eye -- it used to be
    // -0.2, which lit the right-hand sphere when the left eye saw something.
    this.eyeMeshes = ['L', 'R'].map((side) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 12),
        new THREE.MeshStandardMaterial({
          color: id.eye, emissive: id.eye, emissiveIntensity: 1.4, roughness: 0.25,
        }),
      );
      eye.position.set((side === 'L' ? 1 : -1) * 0.2, 0.1, 0.42);
      group.add(eye);
      return eye;
    });

    this.fin = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.4, 4),
      new THREE.MeshStandardMaterial({
        color: id.accent, emissive: id.accent, emissiveIntensity: 0.9,
      }),
    );
    this.fin.rotation.x = Math.PI / 2;
    this.fin.position.set(0, 0.16, -0.55);
    group.add(this.fin);

    group.scale.setScalar(id.scale);
    group.position.copy(this.position);

    // Everything the fly is made of goes on the avatar layer, which the eye
    // cameras do not render. Applied to every descendant, since layers are
    // per-object and not inherited.
    group.traverse((o) => o.layers.set(AVATAR_LAYER));

    this.object3D = group;
    return group;
  }

  /** Re-mint the fly's appearance in place. Cosmetic only. */
  remint(seed = Date.now().toString(36)) {
    this.identity = mintFly(seed);
    const id = this.identity;
    if (!this.object3D) return this.identity;
    this.bodyMesh.material.emissive.setHex(id.body);
    this.bodyMesh.material.emissiveIntensity = 0.25 * id.glow;
    for (const eye of this.eyeMeshes) {
      eye.material.color.setHex(id.eye);
      eye.material.emissive.setHex(id.eye);
    }
    this.fin.material.color.setHex(id.accent);
    this.fin.material.emissive.setHex(id.accent);
    this.object3D.scale.setScalar(id.scale);
    return this.identity;
  }

  /**
   * Sample the world into the brain's real sensory channels.
   * Called by the lab before `brain.step()`.
   */
  sense(brain, { eyePixels, scent, time, visionFresh = true }) {
    // Only re-process vision on a genuinely new frame. The looming detector
    // measures motion between successive frames; feeding it a repeat makes it
    // read zero motion and reset its persistence counter. See Lab._loop.
    if (this.visionEnabled && eyePixels && visionFresh) {
      // eyePixels is {L, R} from Arena.renderEyes; a bare frame (the old
      // single-eye call) is treated as both eyes seeing the same thing.
      const frames = eyePixels.L ? eyePixels : { L: eyePixels, R: eyePixels };
      const perEye = {};

      for (const side of ['L', 'R']) {
        const { retina, looming } = this.eyes[side];
        const response = retina.sample(frames[side]);
        // Adapt first, then split: the brain should see contrast against this
        // eye's own recent average, the way a real photoreceptor does.
        retina.adapt(response);
        const hemi = retina.hemifields(response, { adapted: true });
        const luminance = ((hemi.left + hemi.right) / 2) * SENSOR_REFERENCE_DRIVE;
        const loom = looming.step(frames[side], time);
        perEye[side] = { luminance, loom: loom.loom };

        // Each eye drives its OWN real neurons. This is the whole point of
        // having two: the asymmetry between these two numbers is what the
        // connectome converts into a DNa01 steering difference.
        brain.setInput(`LPLC1_${side}`, luminance);
        brain.setInput(`LPLC2_${side}`, luminance);
        brain.setInput(`LC4_${side}`, loom.loom * SENSOR_REFERENCE_DRIVE * LOOM_DRIVE_GAIN);
      }

      this.sensors.left = perEye.L.luminance / SENSOR_REFERENCE_DRIVE;
      this.sensors.right = perEye.R.luminance / SENSOR_REFERENCE_DRIVE;
      this.sensors.loomL = perEye.L.loom;
      this.sensors.loomR = perEye.R.loom;
      this.sensors.loom = Math.max(perEye.L.loom, perEye.R.loom);

      if (this.eyeMeshes) {
        for (const [i, mesh] of this.eyeMeshes.entries()) {
          const e = i === 0 ? perEye.L : perEye.R;
          mesh.material.emissiveIntensity = 0.6 + (e.luminance / SENSOR_REFERENCE_DRIVE) * 2.2 + e.loom * 3;
        }
      }
    }

    // Touch is a pulse, not a sustained input -- a poke is an event. The pulse
    // is queued by touch() and fired here so it lands on the same tick as the
    // other senses. Decay is handled by the runtime, in seconds.
    if (this._pendingTouch > 0) {
      brain.injectCurrent(
        'touch', this._pendingTouch * SENSOR_REFERENCE_DRIVE * TOUCH_DRIVE_GAIN, TOUCH_DECAY_SECONDS,
      );
      this._pendingTouch = 0;
    }
    // Displayed decay, purely for the HUD's touch readout and the body flash.
    this.touchDrive *= TOUCH_VISUAL_DECAY;
    if (this.touchDrive < 0.001) this.touchDrive = 0;
    this.sensors.touch = this.touchDrive;

    this.olfaction.sample(scent, this.position);
    this.olfaction.drive(brain);
    this.sensors.scent = this.olfaction.intensities;

    // Klinokinesis, computed here and applied in act(). See the comment there
    // for why this is engineered rather than read from the connectome.
    if (this.chemotaxis) {
      const best = this.olfaction.strongest();
      const delta = best.channel ? (this.olfaction.deltas.get(best.channel) ?? 0) : 0;
      this.sensors.odour = best.intensity;
      this.sensors.odourDelta = delta;
      if (best.intensity > this.chemotaxisFloor) {
        // Falling gradient -> cast about; rising -> hold course. The sign is
        // kept across ticks so a cast is a sustained arc, not a jitter.
        if (delta < -1e-5) {
          if (this._castSign === 0) this._castSign = Math.random() < 0.5 ? -1 : 1;
          this.odourTurn = this._castSign * this.chemotaxisGain;
        } else {
          this._castSign = 0;
          this.odourTurn = 0;
        }
      } else {
        this._castSign = 0;
        this.odourTurn = 0;
      }
    }
  }

  /**
   * Move according to the real descending motor neurons.
   * Called by the lab after `brain.step()`.
   */
  act(brain, dt, time) {
    // All three reads are CALIBRATED, not raw. Raw activations span ~1,900x
    // across these channels in the courtship pack alone (PPL1 5.6e-2 down to
    // courtship_hub 2.9e-5), and Mode A reads ~4 orders quieter than Mode B for
    // identical input. Raw values cannot drive a body; one set of gains could
    // never suit all of them. See LabBrain.readCalibrated.
    //
    // DNa01: real steering DN. Read as a baseline-corrected RATIO, not a raw
    // difference -- see LabBrain.readSteering for the measurements showing why
    // the raw difference produced 0.8 degrees per second and a standing bias.
    const steer = brain.readSteering('DNa01');
    // DNp09: real forward-walking-promoting DN (Bidaye et al. 2020).
    const forward = brain.readCalibrated('DNp09');
    // DNp01: the Giant Fiber. A real escape command neuron -- when it fires the
    // fly does not steer, it leaves.
    const escape = brain.readCalibrated('DNp01');
    // DNp06: the real feeding-decision descending neuron, found by tracing the
    // graph as the strongest 2-hop target of gustatory input. When it is
    // driving, the fly stops walking and feeds. This is what makes it halt at a
    // food bowl instead of strolling over the top of it.
    // PHASIC, not absolute: DNp06 rests around 0.37 even with no food in the
    // arena, so an absolute threshold froze the fly in a permanent meal. What
    // matters is that it ROSE when the fly touched something edible.
    const feeding = brain.readPhasic('DNp06');

    this.motor.steer = steer;
    this.motor.forward = forward;
    this.motor.escape = escape;
    this.motor.feeding = feeding;
    this.feeding = feeding > this.feedThreshold;

    if (escape > 0.35 && time > this.escapeUntil) {
      this.escapeUntil = time + 0.6;
      // Escape is away from whichever side the loom came from.
      const away = this.sensors.loomR > this.sensors.loomL ? -1 : 1;
      this.yaw += away * 1.1;
      this.speed = this.escapeImpulse;
    } else if (this.chemotaxis && this.odourTurn !== 0) {
      // Klinokinesis: turn when the odour gradient is FALLING, go straight when
      // it is rising. This is how a real fly finds a smell it cannot localize
      // -- and it cannot localize this one: the ORN populations in male-cns
      // carry no left/right soma annotation at all (every one is '?'), so there
      // is no bilateral comparison to read out of the connectome. The turn is
      // therefore ENGINEERED at the body, not derived from the brain; what
      // comes from the real neurons is the odour intensity driving it.
      //
      // Without it the fly walked past every station and into the wall: smell
      // reached DNp09 (forward) but nothing steered, so a gradient could make
      // it hurry, never aim.
      this.yaw += this.odourTurn * dt;
      const drive = Math.max(0, forward) * this.speedGain;
      this.speed += (drive - this.speed) * Math.min(1, dt * 4);
    } else if (this.feeding) {
      // Feeding suppresses locomotion. Real DNp06 drive, engineered gate.
      this.speed += (0 - this.speed) * Math.min(1, dt * 6);
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
      if (this.bodyMesh) {
        this.bodyMesh.material.emissiveIntensity =
          0.25 * this.identity.glow + this.touchDrive * 3.5;
      }
    }
  }

  /**
   * Poke the fly. Drives the real mechanosensory_tactile population, which then
   * propagates through whatever that population is really wired to.
   *
   * @param {number} strength 0..1
   */
  touch(strength = 1) {
    const s = Math.min(1, Math.max(0, strength));
    this._pendingTouch = Math.max(this._pendingTouch, s);
    this.touchDrive = Math.max(this.touchDrive, s);
    return this;
  }

  reset(position = [0, 0.4, 0], yaw = 0) {
    this.position.set(...position);
    this.yaw = yaw;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    if (this.eyes) for (const side of ['L', 'R']) this.eyes[side].looming.reset();
    this.touchDrive = 0;
    this._pendingTouch = 0;
    this.escapeUntil = 0;
  }
}
