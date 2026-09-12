/**
 * Built-in stations. A scene imports these as `Station.SlotMachine` etc. (spec
 * section 4) and subclasses `Station` for anything else.
 */

export { Station, Triggers } from '../core/station.js';
export { SlotMachine } from './slot-machine.js';
export { Screen } from './screen.js';
export { Workstation } from './workstation.js';
export { LightSwitch } from './light-switch.js';
export { FoodBowl } from './food-bowl.js';
export { HazardFan } from './hazard-fan.js';
