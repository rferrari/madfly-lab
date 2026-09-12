/**
 * mad-fly-lab -- an unhinged 3D connectome sandbox for building mad insect
 * brain experiences.
 *
 *     import { MadFlyLab, Station, Triggers } from 'mad-fly-lab';
 *
 *     const lab = new MadFlyLab({
 *       mode: 'pruned-subgraph',
 *       canvas: '#app-canvas',
 *       circuit: 'courtship-and-foraging',
 *     });
 *
 *     lab.addStation(new Station.FoodBowl({
 *       position: [-3, 0, 2], scentType: 'ORN_VA6', scentRadius: 5,
 *     }));
 *
 *     await lab.start();
 *
 * WHAT IS REAL HERE
 *   Every neuron, every synaptic weight and every soma coordinate comes from
 *   the male-cns:v1.0 connectome (CC BY 4.0). Cell types are addressed by their
 *   real NeuPrint names and the build refuses to ship a channel that does not
 *   resolve to real cells.
 *
 * WHAT IS NOT
 *   The dynamics are a rate model -- a <- tanh(W a + I dt) -- not spiking
 *   neurons, and activations are dimensionless, not millivolts or Hz. Sensors
 *   (hex retina, motion opponency, scent falloff) are engineered image and
 *   geometry measurements that drive real cells; they are not models of
 *   phototransduction or olfactory receptor binding. Motor gains converting
 *   activation to metres per second are arena-scale constants. See
 *   brain/lab-brain.js and AGENTS.md.
 */

export { MadFlyLab } from './core/lab.js';
export { Station, Triggers } from './core/station.js';
export { ScentField } from './core/gradients.js';
export { Arena, CAMERA_MODES } from './core/arena.js';
export { THEME, CSS } from './core/theme.js';

export { LabAvatar } from './avatar/lab-avatar.js';
export { CompoundEye, fovForRetina } from './avatar/retina.js';
export { LoomingDetector } from './avatar/motion.js';
export { OlfactoryReceptors, OLFACTORY_CHANNELS } from './avatar/olfaction.js';
export { SENSOR_REFERENCE_DRIVE, LOOM_DRIVE_GAIN } from './avatar/lab-avatar.js';

export { LabBrain, HZ_PER_ACTIVATION } from './brain/lab-brain.js';
export { PrunedRuntime } from './brain/pruned-runtime.js';
export { RemoteRuntime } from './brain/remote-runtime.js';
export { ConnectomePack, loadPack, parsePack } from './brain/pack-loader.js';

export { LabObserver } from './observer/lab-observer.js';
export { RetinalView } from './observer/retinal-view.js';
export { SomaCloud } from './observer/soma-cloud.js';
export { Telemetry } from './observer/telemetry.js';

import { Station as StationBase } from './core/station.js';
import { SlotMachine } from './stations/slot-machine.js';
import { FoodBowl } from './stations/food-bowl.js';
import { HazardFan } from './stations/hazard-fan.js';

/**
 * The `Station` namespace from the spec's example: `new Station.SlotMachine()`.
 * `Station` is also the base class to subclass for a custom station, so both
 * `Station.FoodBowl` and `class MyThing extends Station` work off this import.
 */
StationBase.SlotMachine = SlotMachine;
StationBase.FoodBowl = FoodBowl;
StationBase.HazardFan = HazardFan;

export { SlotMachine, FoodBowl, HazardFan };

/** Circuits the framework ships packs for. Mirrors python/src/madfly_lab/circuits.py. */
export const CIRCUITS = {
  'minimal': '715 real neurons - looming in, steering out. Smoke tests.',
  'escape-and-steering': '4,963 real neurons - LC4/LPLC2 -> DNp01 Giant Fiber, DNp03, DNa01, DNp09.',
  'dopamine-mushroom-body': '7,638 real neurons - ORN -> KC -> MBON with real PAM/PPL1 dopamine.',
  'courtship-and-foraging': '7,922 real neurons - pheromone + food odour -> pC1/aSP -> DNp13/DNa01/DNp09.',
};

export const VERSION = '0.1.0';
