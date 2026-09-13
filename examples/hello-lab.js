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
  circuit: params.get('circuit') ?? 'courtship',
  camera: 'chase',
  arenaSize: 17,
  avatarOptions: { seed: params.get('seed') ?? undefined },
});

// Room 1's equipment is built lazily, on the player's first "Free-Roaming" or
// "Chaos Chair" choice from the boot menu (see room-menu.js) -- NOT here at
// module load. The lab starts loaded but PAUSED (see `lab.stop()` below) so
// nothing is ticking, no fly is wandering, before the player has chosen a
// room at all. `built` guards against re-running this on a later return trip.
let screen, fan, lights;
let room1Built = false;

function buildRoom1() {
  if (room1Built) return;
  room1Built = true;

  // 1. Screen -- a display the fly can look at, with a dopamine payout. Its
  //    surface is a canvas, so anything you draw there becomes real visual input.
  screen = lab.addStation(new Station.Screen({
    blinkHz: 6,
    payoutChance: 0.4,
    onKick: Triggers.throttle(1.5, () => {
      log(`screen: ${screen.views} views, ${screen.payouts} payouts → PAM11`);
    }),
  }));

  // 2 & 3. Two food bowls on DIFFERENT real glomeruli, so the two smells are
  // genuinely different neuron populations rather than one scalar with two names.
  // Deliberately IDENTICAL except for which real glomerulus they drive, so any
  // preference the fly shows is the connectome's and not the scene's. They used
  // to differ (VA6 radius 9, DM1 radius 7, and DM1 tinted a dimmer cyan), which
  // made the fly look like it liked one food and avoided the other -- it was
  // simply smelling one from further away and seeing it better.
  lab.addStation(new Station.FoodBowl({
    scentRadius: 8, scentType: 'ORN_VA6',
    onKick: () => log('forage: reached the VA6 bowl'),
  }));

  // A sugar cube and a rotten one: matte, unlit, identical but for the odour, so
  // only the smell can decide anything. ORN_DM1 is a real attractive glomerulus,
  // ORN_V the real CO2 one a live fly avoids.
  lab.addStation(new Station.SugarCube({
    scentRadius: 8,
    onTaste: (on) => on && log('sugar: tasting → DNp06'),
  }));
  lab.addStation(new Station.PoopCube({ scentRadius: 8 }));

  // 4. Hazard Fan -- looming threat, rotor in a vertical plane facing the arena
  //    so the blades genuinely expand across the fly's visual field.
  fan = lab.addStation(new Station.HazardFan({
    rotationSpeed: 10,
    onRunning: (on) => log(`fan ${on ? 'ON' : 'OFF'} — airflow ${on ? 'restored' : 'stopped'}`),
  }));

  // 5. Light switch -- kills all visual input. Watch the retinal panel go dark
  //    and the photoreceptors re-adapt.
  lights = lab.addStation(new Station.LightSwitch({
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

  // A tight ring keeps the fly inside the experiment. At radius 11 in a 40-unit
  // arena it simply walked out between the stations and hit the wall.
  lab.arrangeInRing(16);
}

// Real Giant Fiber escape. DNp01 firing is the fly deciding to leave. General
// hook, not Room-1-specific -- kept registered regardless of room/pause state.
lab.brain.onSignal('DNp01', (v) => log(`escape: Giant Fiber ${v.toFixed(2)}`), { threshold: 0.5 });

// Poking the fly drives real tactile neurons.
lab.onPoke(() => log('poke: → mechanosensory_tactile (2,558 real cells)'));

// Walking into something is mechanosensory too -- same real cells as a poke.
lab.onBump(Triggers.throttle(1.2, (station) => log(`bumped ${station.name} → tactile`)));

// Report real milestones to the splash screen (see index.html).
const boot = (pct, label) => window.__madflyBoot?.(pct, label);
boot(12, 'BUILDING ARENA…');
lab.brain.onReady = () => boot(74, 'CONNECTOME LOADED');

boot(22, `LOADING <b>${(params.get('circuit') ?? 'courtship').toUpperCase()}</b>`);
await lab.start();
boot(94, `<b>${lab.brain.nNeurons.toLocaleString()}</b> REAL NEURONS ONLINE`);
log(`minted ${lab.avatar.identity.name}  ·  seed ${lab.avatar.identity.seed}`);

// Pause immediately: `start()` unconditionally kicks the render/brain loop,
// but with zero stations built and no room chosen yet there is nothing worth
// ticking. The boot menu (mounted below) is what resumes it, via
// `lab.resume()`, once the player actually picks a room.
lab.stop();

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
  if (e.key === 'l' || e.key === 'L') lights?.toggle();
  if (e.key === 'f' || e.key === 'F') fan?.toggle();
  if (e.key === 'b' || e.key === 'B') log(`brightness: ${lab.arena.cycleBrightness()}`);
  if (e.key === 'v' || e.key === 'V') log(`brain view: ${lab.observer.cycleCloudView()}`);
  // C cycles circuits live -- swaps which parts of the real brain are loaded.
  if (e.key === 'c' || e.key === 'C') {
    log('loading circuit…');
    lab.cycleCircuit().then((r) => {
      if (!r) return;
      if (r.serverMissing) {
        log('no Mode A server — run `npm run brain:full`. Stayed on '
          + `${CIRCUITS[r.circuit].label}.`);
        return;
      }
      log(`${CIRCUITS[r.circuit].label} — ${r.neurons.toLocaleString()} real neurons`
        + (r.modeA ? ' (Mode A)' : ''));
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

// Room menu -- press M to reopen later. Kept as a separate module since
// choosing which room/task to enter is scene glue, not framework code.
// Shown immediately (not waiting for M) as the mandatory first choice: the
// lab is paused (see `lab.stop()` above) until a room is picked here.
import('./room-menu.js').then(({ mountRoomMenu }) => {
  const menu = mountRoomMenu(lab, { onLog: log, onEnterFreeRoaming: buildRoom1 });
  menu.show();
});

console.info('MadFly Lab ready. 1-4 camera · N new fly · R reset · P poke (or click the fly) · '
  + 'L lights · F fan · B brightness · C circuit · V brain view · +/- brain zoom · '
  + 'shift+G genotype · shift+R record · M room menu · H hide HUD');
