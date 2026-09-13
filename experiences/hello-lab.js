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

import {
  MadFlyLab, Station, Triggers, GENOTYPES, CIRCUITS, CSS, explainGenotype,
} from '../src/index.js';

let genotypeIndex = 0;

/**
 * Arena geometry. These three numbers are ONE decision, not three:
 *
 *   arenaSize 17  -> the wall sits at arenaSize - 2 = 15
 *   RING_RADIUS 11   leaves a 4-unit margin to approach any station from
 *   SCENT_RADIUS 8   puts neighbouring plumes (1.414 * 11 = 15.6 apart) just
 *                    touching, and reaches to within 3 of the arena centre
 *
 * Both failure modes have already been hit once each. Ring outside the wall
 * (16 against a wall at 15) meant the wall-bounce aborted every approach.
 * Plumes much wider than their spacing blend four choosable sources into one
 * smear, which is the thing the interleaved `order` below exists to prevent.
 */
const RING_RADIUS = 11;
const SCENT_RADIUS = 8;

/**
 * Which real glomerulus the switchable bait emits.
 *
 * ORN_VA6 for all of them, sharing the Food Bowl's channel rather than each
 * getting its own, because there are only two genuinely attractive food
 * glomeruli in the shipped packs (DM1 and VA6) and eight places to put bait.
 * With one plume live at a time the channel does not need to be unique -- she
 * goes to the only thing she can smell. Give two bait sources DIFFERENT
 * channels (one DM1, one VA6) if you want a real two-way preference test.
 */
const LURE_SCENT = 'ORN_VA6';

/** host station -> its switchable bait. Filled in by buildRoom1. */
const baitFor = new Map();

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
  // MUST stay comfortably bigger than the station ring below -- bounds is
  // arenaSize - 2, and the ring has to clear it with room to approach from any
  // side. This was once 17 against a ring of 16, i.e. bounds 15, a wall INSIDE
  // the ring: the four axis-aligned stations sat just past it and the
  // wall-bounce (position clamp + turn back toward centre + speed cut, see
  // LabAvatar.act) fired right as she arrived, aborting the approach nearly
  // every time. 17 is fine again now only because the ring came in to 11.
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
  // SCENT RADIUS IS TIED TO THE RING RADIUS, so change them together. The four
  // scent stations sit 90 degrees apart (see the `order` passed to
  // arrangeInRing), which puts 1.414 * ringRadius between neighbouring plumes:
  // at ring 11 that is 15.6, so a radius of 8 leaves them just touching rather
  // than smeared into each other, and still reaches to within 3 of the arena
  // centre so she picks a smell up almost anywhere. 8 was the original value
  // here and was never the problem -- the ring at 16 was, because it put every
  // plume out of reach of where she actually walked.
  lab.addStation(new Station.FoodBowl({
    scentRadius: SCENT_RADIUS, scentType: 'ORN_VA6',
    onKick: () => log('forage: reached the VA6 bowl'),
  }));

  // A sugar cube and a rotten one: matte, unlit, identical but for the odour, so
  // only the smell can decide anything. ORN_DM1 is a real attractive glomerulus,
  // ORN_V the real CO2 one a live fly avoids.
  lab.addStation(new Station.SugarCube({
    scentRadius: SCENT_RADIUS,
    onTaste: (on) => on && log('sugar: tasting → DNp06'),
  }));
  lab.addStation(new Station.PoopCube({ scentRadius: SCENT_RADIUS }));

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
  // `onKey` fires for a human typing (while she is within kickRadius) AND for
  // the fly walking over the keyboard herself -- `key` is null for the latter.
  lab.addStation(new Station.Workstation({
    text: 'hello fly\n',
    onKey: Triggers.throttle(2, (key) => log(key === null
      ? 'workstation: she walked across the keyboard'
      : 'workstation: the fly is watching you type')),
  }));

  // 8. Toad -- a baited trap, and the only thing in the room that produces a
  //    real looming stimulus. The hazard fan cannot: blade sweep is circular
  //    flow, and the looming detector's four-sector agreement test exists
  //    precisely to reject that. A tongue shot at her is expansion from a
  //    point, which is what LC4/LPLC2 actually detect -- and they supply 30.6%
  //    of DNp01's input, so a strike drives the real Giant Fiber and the real
  //    escape takeoff. Strike speed is randomised, so whether she gets away is
  //    a genuine race between the tongue and her escape circuit.
  lab.addStation(new Station.ToadTongue({
    // DM1, not VA6: the ring below seats the toad next to the VA6 bowl, and
    // two plumes of the same glomerulus 7.5 units apart would merge into one
    // smell. On DM1 its only same-channel neighbour is the sugar cube, 19
    // units away -- clear of the 8-unit radius on both sides.
    scentType: 'ORN_DM1',
    scentRadius: SCENT_RADIUS,
    onStrike: (s) => log(`toad: STRIKE in ${(s * 1000).toFixed(0)}ms`),
    onCatch: (s, t) => log(`toad: CAUGHT her (${(s * 1000).toFixed(0)}ms strike) `
      + `— ${t.catches} caught / ${t.misses} escaped`),
    onMiss: (s, t) => log(`toad: she got away (${(s * 1000).toFixed(0)}ms strike) `
      + `— ${t.catches} caught / ${t.misses} escaped`),
  }));

  // 7. Mate -- the missing half of the courtship circuit. Nothing in the arena
  //    emitted on the real pheromone channels before this, so ORN_DA1 -> pC1/aSP
  //    -> DNp13 sat at rest no matter what the fly did.
  // Same scent radius as the food, deliberately: Mate's own default is 12, and
  // leaving it there while the bowls came down to 8 would have handed the
  // pheromone a reach advantage that had nothing to do with the connectome.
  lab.addStation(new Station.Mate({
    receptiveness: 1.0, scentRadius: SCENT_RADIUS,
    onCourtship: (v, m) => log(m.courting
      ? `courtship: DNp13 ${v.toFixed(2)} — real copulation-attempt drive`
      : 'courtship: DNp13 fell back below threshold'),
  }));

  // A tight ring keeps the fly inside the experiment. At radius 11 in a 40-unit
  // arena it simply walked out between the stations and hit the wall.
  //
  // ORDER MATTERS: arrangeInRing walks the station list and drops them around
  // the circle in that order, so the array order IS the arena layout. The four
  // stations that emit an ORN channel are interleaved with the four that emit
  // nothing, rather than sitting next to each other as they did when they were
  // added in build order. Two reasons. Adjacent plumes overlap at this radius
  // (12-unit scent, ~12.25 between neighbours), so clustering the smelly ones
  // blended them into a single smear instead of four choosable sources; and it
  // put every attractive thing in one arc, so a fly following her nose never
  // had cause to visit the other half of the room.
  lab.arrangeInRing(RING_RADIUS, {
    // Nine slots now, 40 degrees apart. Scent stations still take every other
    // one; with an odd count the ring has to close scent-next-to-scent
    // somewhere, and that seam is the toad against the VA6 bowl -- which is
    // why the toad emits DM1 instead.
    order: ['Food Bowl (VA6)', 'Screen', 'Sugar Cube', 'Light Switch',
      'Poop Cube', 'Workstation', 'Mate', 'Hazard Fan', 'Toad'],
  });

  // BAIT. Added after arrangeInRing on purpose -- these are not ring stations
  // and must not take ring slots; each is parked just in front of a host,
  // between it and the arena centre, so walking to the food puts her at the
  // station.
  //
  // This is the lever for driving her to a station that has no pull of its own.
  // Half the ring emits no scent at all (screen, lights, workstation, fan) and
  // she only ever reaches those by blundering into them; smell is the one sense
  // that actually steers her. Rather than invent a smell for a monitor, put
  // real food next to the monitor and switch it on.
  //
  // All off at boot -- eight live plumes would be exactly the smear the
  // interleaved ring ordering exists to avoid. Switch on the one you want.
  const hosts = [...lab.stations];
  for (const host of hosts) {
    const r = Math.hypot(host.position.x, host.position.z) || 1;
    // Far enough out that the two meshes do not intersect, near enough that
    // standing at the food is inside the host's own kickRadius -- checked for
    // every station in the ring, the tightest being the VA6 bowl (1.15 vs 1.2).
    const gap = host.collisionRadius + 0.5;
    const bait = new Station.FoodBowl({
      scentType: LURE_SCENT,
      scentRadius: SCENT_RADIUS,
      label: null,          // the host's own floor label is right there
      collisionRadius: 0.45,
      enabled: false,
      color: 0xffc857,      // amber, so bait reads as bait and not as the VA6 bowl
      position: [host.position.x - (host.position.x / r) * gap, 0,
        host.position.z - (host.position.z / r) * gap],
      onKick: Triggers.throttle(3, () => log(`bait: she took the food at ${host.name}`)),
    });
    bait.isBait = true;
    bait.hostName = host.name;
    lab.addStation(bait);
    baitFor.set(host, bait);
  }

  mountStationPanel(hosts);
}

/**
 * Per-station on/off switches -- the control half of the experiment.
 *
 * The fly only has a way to STEER toward a station that emits a scent (the
 * antennae climb ORN gradients; see LabAvatar.sense). The screen, the light
 * switch and the workstation emit nothing at all, so she reaches those only by
 * walking into them, and with food in the room she never runs out of reasons
 * not to. Switching the food off is the cleanest way to ask what she does when
 * the strongest signal is gone -- no new attraction invented, just the
 * competition removed.
 */
function mountStationPanel(hosts) {
  const root = document.createElement('div');
  // bottom:64px clears the #log toast at bottom:16px, the same way the Room 2
  // training HUD does.
  root.style.cssText = `position:fixed;bottom:64px;left:16px;width:212px;z-index:10;`
    + `background:${CSS.panel};border:1px solid ${CSS.border};border-radius:8px;`
    + `padding:8px 10px;backdrop-filter:blur(8px);font:11px ${CSS.font};color:${CSS.bone};`;

  const title = document.createElement('div');
  title.textContent = 'STATIONS';
  title.style.cssText = `color:${CSS.violet};font-size:9px;letter-spacing:0.14em;margin-bottom:6px`;
  root.appendChild(title);

  const foodBtn = document.createElement('button');
  foodBtn.style.cssText = `width:100%;padding:6px;margin-bottom:6px;border-radius:4px;`
    + `cursor:pointer;font:10px ${CSS.font};border:none;color:#fff;background:${CSS.violet};`;
  root.appendChild(foodBtn);

  const head = document.createElement('div');
  head.style.cssText = `display:grid;grid-template-columns:1fr 34px;gap:4px;`
    + `color:${CSS.dim};font-size:8px;letter-spacing:0.1em;margin-bottom:3px;`;
  head.innerHTML = '<span>STATION</span><span style="text-align:center">BAIT</span>';
  root.appendChild(head);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 34px;gap:4px;';
  root.appendChild(grid);

  // Only the ring stations get a row. The bait sources are stations too (that
  // is how they get scent, taste and switching for free) but they belong to a
  // host, so they appear as that host's second button rather than as rows of
  // their own.
  const food = hosts.filter((s) => s.edible);
  const rows = hosts.map((station) => {
    const chip = document.createElement('button');
    chip.title = station.name;
    chip.textContent = station.name.replace(/ \(.*\)$/, '');
    chip.style.cssText = `padding:5px 4px;border-radius:4px;cursor:pointer;font:9px ${CSS.font};`
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;';
    chip.onclick = () => {
      station.setEnabled(!station.enabled);
      log(`${station.name} ${station.enabled ? 'ON' : 'OFF'}`);
      paint();
    };
    grid.appendChild(chip);

    const bait = baitFor.get(station);
    const baitBtn = document.createElement('button');
    baitBtn.textContent = '🍯';
    baitBtn.title = `Put food in front of ${station.name} to draw her there`;
    baitBtn.style.cssText = `padding:5px 0;border-radius:4px;cursor:pointer;font-size:10px;`;
    baitBtn.onclick = () => {
      bait.setEnabled(!bait.enabled);
      log(`bait at ${station.name} ${bait.enabled ? 'ON — she should come' : 'OFF'}`);
      paint();
    };
    grid.appendChild(baitBtn);
    return { chip, baitBtn, station, bait };
  });

  function paint() {
    for (const { chip, baitBtn, station, bait } of rows) {
      chip.style.background = station.enabled ? CSS.panel : 'transparent';
      chip.style.color = station.enabled ? CSS.bone : CSS.dim;
      chip.style.border = `1px solid ${station.enabled ? CSS.cyan : CSS.border}`;
      chip.style.opacity = station.enabled ? '1' : '0.5';

      baitBtn.style.background = bait.enabled ? 'rgba(255, 200, 87, 0.25)' : 'transparent';
      baitBtn.style.border = `1px solid ${bait.enabled ? CSS.amber : CSS.border}`;
      baitBtn.style.opacity = bait.enabled ? '1' : '0.35';
    }
    const anyFood = food.some((s) => s.enabled);
    foodBtn.textContent = anyFood ? '⏻ ALL FOOD OFF' : '⏻ ALL FOOD ON';
  }

  foodBtn.onclick = () => {
    const turnOff = food.some((s) => s.enabled);
    for (const s of food) s.setEnabled(!turnOff);
    log(`food ${turnOff ? 'OFF' : 'ON'} — ${food.map((s) => s.name).join(', ')}`);
    paint();
  };

  paint();
  document.body.appendChild(root);
  // Room 2 has its own stations and its own HUD; this panel is Room 1's.
  lab.onFrame(() => { root.style.display = lab.room === 'free-roaming' ? 'block' : 'none'; });
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
    // Say what she has LOST, not just which cells were silenced -- the raw
    // names mean nothing without the fly-anatomy background.
    const { headline, effects } = explainGenotype(lab.genotype);
    log(`${GENOTYPES[names[genotypeIndex]].label} — ${headline}`
      + (effects.length ? `  ·  ${effects[0]}` : ''));
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

// Room menu -- the mandatory first screen (see room-menu.js's own docstring):
// shown here, while the lab is still paused (`lab.stop()` above), so the
// player picks a room before anything is built or ticking. Press M to reopen
// later. Kept as a separate module since choosing which room/task to enter is
// scene glue, not framework code.
const roomMenuReady = import('./room-menu.js').then(({ mountRoomMenu }) => (
  mountRoomMenu(lab, { onLog: log, onEnterFreeRoaming: buildRoom1 })
));

// Entering from the landing page shows the room menu -- it does NOT jump
// straight into Room 1. `lab.resume()` happens inside room-menu.js's own
// button handlers, once the player actually picks a room.
window.enterMadflyLab = () => {
  roomMenuReady.then((menu) => menu.show());
};

console.info('MadFly Lab ready. 1-4 camera · N new fly · R reset · P poke (or click the fly) · '
  + 'L lights · F fan · B brightness · C circuit · V brain view · +/- brain zoom · '
  + 'shift+G genotype · shift+R record · M room menu · H hide HUD');
