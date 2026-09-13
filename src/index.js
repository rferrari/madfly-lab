/**
 * mad-fly-lab -- an unhinged 3D connectome sandbox for building mad insect
 * brain experiences.
 *
 *     import { MadFlyLab, Station, Triggers } from 'mad-fly-lab';
 *
 *     const lab = new MadFlyLab({
 *       mode: 'pruned-subgraph',
 *       canvas: '#app-canvas',
 *       circuit: 'courtship',
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
export { Arena, CAMERA_MODES, EYE_SPLAY, EYE_SEPARATION } from './core/arena.js';
export { THEME, CSS } from './core/theme.js';

export { LabAvatar } from './avatar/lab-avatar.js';
export { mintFly } from './avatar/mint.js';
export {
  PRESETS as GENOTYPES, resolveGenotype, describeGenotype, explainGenotype,
  explainChannel, CHANNEL_GLOSSARY,
} from './avatar/genotype.js';
export { CompoundEye, fovForRetina } from './avatar/retina.js';
export { LoomingDetector } from './avatar/motion.js';
export { OlfactoryReceptors, OLFACTORY_CHANNELS } from './avatar/olfaction.js';
export { SENSOR_REFERENCE_DRIVE, LOOM_DRIVE_GAIN, TOUCH_DRIVE_GAIN, WIND_DRIVE_GAIN } from './avatar/lab-avatar.js';

export { LabBrain, HZ_PER_ACTIVATION } from './brain/lab-brain.js';
export { PrunedRuntime } from './brain/pruned-runtime.js';
export { RemoteRuntime } from './brain/remote-runtime.js';
export { ConnectomePack, loadPack, parsePack } from './brain/pack-loader.js';

export { LabObserver } from './observer/lab-observer.js';
export { RetinalView } from './observer/retinal-view.js';
export { SomaCloud } from './observer/soma-cloud.js';
export { Telemetry } from './observer/telemetry.js';
export { BrainOrb } from './observer/brain-orb.js';
export { TrainingHUD } from './observer/training-hud.js';
export { BrainRaycaster, DEFAULT_POINTS_THRESHOLD } from './observer/brain-raycaster.js';
export { BrainHalo } from './observer/brain-halo.js';

import { Station as StationBase } from './core/station.js';
import { SlotMachine } from './stations/slot-machine.js';
import { Screen } from './stations/screen.js';
import { Workstation } from './stations/workstation.js';
import { LightSwitch } from './stations/light-switch.js';
import { Mate } from './stations/mate.js';
import { OdourCube, SugarCube, PoopCube } from './stations/cube.js';
import { FoodBowl } from './stations/food-bowl.js';
import { HazardFan } from './stations/hazard-fan.js';
import { ToadTongue } from './stations/toad-tongue.js';

/**
 * The `Station` namespace from the spec's example: `new Station.SlotMachine()`.
 * `Station` is also the base class to subclass for a custom station, so both
 * `Station.FoodBowl` and `class MyThing extends Station` work off this import.
 */
StationBase.SlotMachine = SlotMachine;
StationBase.Screen = Screen;
StationBase.Workstation = Workstation;
StationBase.LightSwitch = LightSwitch;
StationBase.Mate = Mate;
StationBase.OdourCube = OdourCube;
StationBase.SugarCube = SugarCube;
StationBase.PoopCube = PoopCube;
StationBase.FoodBowl = FoodBowl;
StationBase.HazardFan = HazardFan;
StationBase.ToadTongue = ToadTongue;

export { SlotMachine, FoodBowl, HazardFan, ToadTongue, Screen, Workstation, LightSwitch, Mate };
export { OdourCube, SugarCube, PoopCube } from './stations/cube.js';
export { makeFloorLabel, makeScreenTexture } from './core/label.js';

export { CIRCUITS } from './circuits.js';

// Room 2 -- Tethered Training Rig. The room's scene builder + the generic
// (task-agnostic) sense->settle->read->decide->act->learn loop and its
// linear TD-learning readout. Task-specific content (blackjack, or whatever
// else a scene trains on) is NOT exported here -- see examples/blackjack/.
export {
  buildTetheredRig, frameTetheredCamera,
  PLATFORM_POSITION, DOCK_POSITION, ORB_POSITION, TETHERED_BASE_POSITION,
} from './rooms/tethered-rig.js';
export { LegRig } from './avatar/leg-rig.js';
export { TrainingLoop, QReadout, ACTIONS } from './training/training-loop.js';

export const VERSION = '0.1.0';
