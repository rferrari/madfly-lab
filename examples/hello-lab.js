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

import { MadFlyLab, Station, Triggers, GENOTYPES, CIRCUITS } from '../src/index.js';

let genotypeIndex = 0;

const params = new URLSearchParams(location.search);

const lab = new MadFlyLab({
  canvas: '#app-canvas',
  // 'auto' uses the Mode A server (all 176,422 real neurons) when one is
  // running and falls back to the in-tab pruned pack when it is not, so the
  // scene works either way. Force it with ?mode=pruned-subgraph or
  // ?mode=full-connectome. Start the server with `npm run brain:full`.
  mode: params.get('mode') ?? 'auto',
  circuit: params.get('circuit') ?? 'courtship-and-foraging',
  camera: 'chase',
  avatarOptions: { seed: params.get('seed') ?? undefined },
});

// 1. Screen -- a display the fly can look at, with a dopamine payout. Its
//    surface is a canvas, so anything you draw there becomes real visual input.
const screen = lab.addStation(new Station.Screen({
  blinkHz: 6,
  payoutChance: 0.4,
  onKick: Triggers.throttle(1.5, () => {
    log(`screen: ${screen.views} views, ${screen.payouts} payouts → PAM11`);
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

// 4. Hazard Fan -- looming threat, rotor in a vertical plane facing the arena
//    so the blades genuinely expand across the fly's visual field.
lab.addStation(new Station.HazardFan({ rotationSpeed: 10 }));

// 5. Light switch -- kills all visual input. Watch the retinal panel go dark
//    and the photoreceptors re-adapt.
const lights = lab.addStation(new Station.LightSwitch({
  onToggle: (on) => log(`lights ${on ? 'ON' : 'OFF'} — visual input ${on ? 'restored' : 'removed'}`),
}));

// 6. Workstation -- type on it while the fly is nearby and it watches you.
lab.addStation(new Station.Workstation({
  text: 'hello fly\n',
  onKey: Triggers.throttle(2, () => log('workstation: the fly is watching you type')),
}));

// 7. Mate -- the missing half of the courtship circuit. Nothing in the arena
//    emitted on the real pheromone channels before this, so ORN_DA1 -> pC1/aSP
//    -> DNp13 sat at rest no matter what the fly did.
lab.addStation(new Station.Mate({
  receptiveness: 1.0,
  onCourtship: (v, m) => log(m.courting
    ? `courtship: DNp13 ${v.toFixed(2)} — real copulation-attempt drive`
    : 'courtship: DNp13 fell back below threshold'),
}));

lab.arrangeInRing(11);

// Real Giant Fiber escape. DNp01 firing is the fly deciding to leave.
lab.brain.onSignal('DNp01', (v) => log(`escape: Giant Fiber ${v.toFixed(2)}`), { threshold: 0.5 });

// Poking the fly drives real tactile neurons.
lab.onPoke(() => log('poke: → mechanosensory_tactile (2,558 real cells)'));

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
  if (e.key === 'p' || e.key === 'P') { lab.avatar.touch(1); log('poke: → mechanosensory_tactile'); }
  if (e.key === 'l' || e.key === 'L') lights.toggle();
  if (e.key === 'b' || e.key === 'B') log(`brightness: ${lab.arena.cycleBrightness()}`);
  if (e.key === 'v' || e.key === 'V') log(`brain view: ${lab.observer.cycleCloudView()}`);
  // C cycles circuits live -- swaps which parts of the real brain are loaded.
  if (e.key === 'c' || e.key === 'C') {
    log('loading circuit…');
    lab.cycleCircuit().then((r) => {
      if (!r) return;
      log(`${CIRCUITS[r.circuit].label} — ${r.neurons.toLocaleString()} real neurons`);
      if (r.leftModeA) log('(switched out of Mode A; reload with ?mode=full-connectome)');
    });
  }
  if (e.key === '+' || e.key === '=') log(`brain zoom ${lab.observer.somaCloud?.zoom(1.25)}x`);
  if (e.key === '-' || e.key === '_') log(`brain zoom ${lab.observer.somaCloud?.zoom(1 / 1.25)}x`);
  // Shift+G cycles genotypes -- the "MadFly Dr" bench. Lesions apply live.
  if (e.key === 'G') {
    const names = Object.keys(GENOTYPES);
    genotypeIndex = (genotypeIndex + 1) % names.length;
    const fly = lab.mintNewFly(names[genotypeIndex]);
    log(`${GENOTYPES[names[genotypeIndex]].label}: ${GENOTYPES[names[genotypeIndex]].description}`);
    if (fly.requiresReload) log('…that genotype needs a different pack; reload with ?circuit= or ?mode=');
  }
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
console.info('MadFly Lab ready. 1-4 camera · R reset · N new fly · T touch · H hide HUD');
