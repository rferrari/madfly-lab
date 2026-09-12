/**
 * hello-lab -- the framework's smoke test, and the shortest complete scene.
 *
 * Stations are arranged in a RING around the fly rather than scattered, so it
 * stays inside the experiment instead of walking off the edge of it.
 *
 * What to watch:
 *   - The retinal panel shows BOTH eyes. The difference between them is what
 *     the real connectome turns into a steering signal -- watch the fly turn
 *     toward whichever side lights up.
 *   - Click the fly to poke it: that drives 2,558 real mechanosensory_tactile
 *     neurons and whatever they are genuinely wired to.
 *   - Walking into the hazard fan's expansion field spikes the loom ring red on
 *     the eye that saw it and kicks the real DNp01 Giant Fiber.
 */

import { MadFlyLab, Station, Triggers } from '../src/index.js';

const params = new URLSearchParams(location.search);

const lab = new MadFlyLab({
  canvas: '#app-canvas',
  // 'pruned-subgraph' runs here in the tab. 'full-connectome' needs
  // `npm run brain:full`. 'auto' uses the server if it is up.
  mode: params.get('mode') ?? 'pruned-subgraph',
  circuit: params.get('circuit') ?? 'courtship-and-foraging',
  camera: 'chase',
  avatarOptions: { seed: params.get('seed') ?? undefined },
});

// 1. Slot Machine -- blinking visual station, dopamine payout into real PAM11.
const slots = lab.addStation(new Station.SlotMachine({
  lightBlinkHz: 12,
  payoutChance: 0.4,
  onKick: Triggers.throttle(1.5, () => {
    log(`slots: pull ${slots.pulls}, ${slots.wins} payouts → PAM11`);
  }),
}));

// 2 & 3. Two food bowls on DIFFERENT real glomeruli, so the two smells are
// genuinely different neuron populations rather than one scalar with two names.
lab.addStation(new Station.FoodBowl({
  scentType: 'ORN_VA6', scentRadius: 9,
  onKick: () => log('forage: reached the VA6 bowl'),
}));
lab.addStation(new Station.FoodBowl({
  scentType: 'ORN_DM1', scentRadius: 7, color: 0x00e5ff,
  onKick: () => log('forage: reached the DM1 bowl'),
}));

// 4. Hazard Fan -- looming threat. Each eye's own motion detector drives its
//    own real LC4 population, so which side it approaches from matters.
lab.addStation(new Station.HazardFan({ rotationSpeed: 10 }));

lab.arrangeInRing(10);

// Real Giant Fiber escape. DNp01 firing is the fly deciding to leave.
lab.brain.onSignal('DNp01', (v) => log(`escape: Giant Fiber ${v.toFixed(2)}`), { threshold: 0.5 });

// Poking the fly drives real tactile neurons.
lab.onPoke(() => log('touch: poked → mechanosensory_tactile (2,558 real cells)'));

await lab.start();
log(`minted ${lab.avatar.identity.name}  ·  seed ${lab.avatar.identity.seed}`);

// ---- controls -------------------------------------------------------------
addEventListener('keydown', (e) => {
  const camera = { 1: 'chase', 2: 'orbit', 3: 'eye', 4: 'top' }[e.key];
  if (camera) lab.setCamera(camera);
  if (e.key === 'r' || e.key === 'R') { lab.reset(); log('reset (same fly)'); }
  if (e.key === 'n' || e.key === 'N') {
    const fly = lab.mintNewFly();
    log(`minted ${fly.name}  ·  seed ${fly.seed}`);
  }
  if (e.key === 't' || e.key === 'T') { lab.avatar.touch(1); log('touch: poked via keyboard'); }
});

function log(msg) {
  console.log(`[madfly] ${msg}`);
  const el = document.getElementById('log');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(log._t);
  log._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

window.lab = lab;
console.info('MadFly Lab ready. 1-4 camera · R reset · N new fly · T touch · H hide HUD · click the fly to poke it.');
