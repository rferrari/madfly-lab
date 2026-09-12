/**
 * hello-lab -- the framework's smoke test, and the shortest complete scene.
 *
 * One of each built-in station, wired the way the spec's section 4 example
 * wires them. If this runs, the whole stack works: pack loads, real connectome
 * steps, retina samples, gradients reach real ORNs, real descending neurons
 * move the body, HUD draws.
 *
 * What you should see: the sensor-block wanders, the slot machine blinks and
 * pulses PAM11 when reached, the food bowl's halo marks a real ORN_VA6
 * gradient, and walking into the hazard fan's expansion field spikes the loom
 * trace red and kicks the Giant Fiber.
 */

import { MadFlyLab, Station, Triggers } from '../src/index.js';

const lab = new MadFlyLab({
  canvas: '#app-canvas',
  // 'pruned-subgraph' runs here in the tab. 'full-connectome' needs
  // `npm run brain:full`. 'auto' uses the server if it is up.
  mode: new URLSearchParams(location.search).get('mode') ?? 'pruned-subgraph',
  circuit: new URLSearchParams(location.search).get('circuit') ?? 'courtship-and-foraging',
  camera: 'chase',
});

// 1. Slot Machine -- blinking visual station, dopamine payout into real PAM11.
const slots = lab.addStation(new Station.SlotMachine({
  position: [6, 0, -4],
  lightBlinkHz: 12,
  payoutChance: 0.4,
  onKick: Triggers.throttle(1.5, () => {
    console.log(`[casino] pull ${slots.pulls}, ${slots.wins} payouts -> PAM11`);
  }),
}));

// 2. Food Bowl -- a real ORN_VA6 scent gradient in the arena.
lab.addStation(new Station.FoodBowl({
  position: [-7, 0, 5],
  scentType: 'ORN_VA6',
  scentRadius: 9,
  onKick: () => console.log('[forage] reached the bowl'),
}));

// 3. A second bowl on a different real glomerulus, so the two smells are
//    genuinely different populations rather than one scalar with two labels.
lab.addStation(new Station.FoodBowl({
  position: [8, 0, 8],
  scentType: 'ORN_DM1',
  scentRadius: 7,
  color: 0x00e5ff,
}));

// 4. Hazard Fan -- looming threat. Vision drives LC4 on its own; the callback
//    adds the spec's geometric path on top so the escape is unmissable.
lab.addStation(new Station.HazardFan({
  position: [0, 0, 10],
  rotationSpeed: 10,
  onLooming: (distance) => lab.brain.triggerLooming('LC4', distance),
}));

// Watch the real Giant Fiber. DNp01 firing is the fly deciding to leave.
lab.brain.onSignal('DNp01', (v) => console.log(`[escape] Giant Fiber ${v.toFixed(3)}`), {
  threshold: 0.35,
});

await lab.start();

// Camera modes: 1 chase, 2 orbit, 3 fly's eye, 4 top-down. H hides the HUD.
window.addEventListener('keydown', (e) => {
  const mode = { 1: 'chase', 2: 'orbit', 3: 'eye', 4: 'top' }[e.key];
  if (mode) lab.setCamera(mode);
  if (e.key === 'r' || e.key === 'R') lab.reset();
});

window.lab = lab; // poke at it from the console
console.info('MadFly Lab ready. Keys: 1-4 camera, R reset, H hide HUD.');
