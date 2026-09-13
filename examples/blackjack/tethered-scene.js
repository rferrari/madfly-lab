/**
 * Wires the blackjack task into an already-running MadFlyLab's Room 2.
 *
 * Call `enterBlackjack(lab)` after `lab.setRoom('tethered-rig')` (or it will
 * call that for you). Call the returned `dispose()` to leave cleanly.
 *
 * Decisions run on their own real-time cadence (DECISION_INTERVAL_MS), fully
 * decoupled from the render loop: each decision synchronously steps the brain
 * ~40 times to settle (see TrainingLoop), which would otherwise fight with
 * the per-frame stepping `MadFlyLab._tick` already does. Running it from a
 * plain interval rather than a per-frame hook keeps those two step sources
 * from being invoked recursively.
 */

import * as THREE from 'three';
import { TrainingLoop, TETHERED_BASE_POSITION, CSS } from '../../src/index.js';
import { TrainingHUD } from '../../src/observer/training-hud.js';
import { BlackjackTask, BLACKJACK_FEATURE_CHANNELS } from './blackjack-task.js';
import { QReadout } from '../../src/training/q-learning.js';
import { CardTable } from './card-table.js';
import { HandScreen } from './hand-screen.js';

// 350ms was tuned for throughput, not for a human watching along -- at that
// pace a hand resolves before you can read what the screen just said. Default
// slow enough to actually follow the reasoning; SPEEDS gives a quick toggle.
const SPEEDS = [
  { label: 'Slow', ms: 1800 },
  { label: 'Normal', ms: 900 },
  { label: 'Fast', ms: 350 },
];

/**
 * A tiny modal listing saved skills (from GET /api/skills), newest first --
 * click one to load it. There's no established picker component elsewhere in
 * this codebase to reuse, so this mirrors examples/room-menu.js's own
 * plain-overlay style (same z-index-above-everything convention) rather than
 * inventing a different look.
 */
function showSkillPicker(entries, onPick) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:40;display:grid;place-items:center;'
    + 'background:rgba(11,6,20,0.82);backdrop-filter:blur(6px);';

  const card = document.createElement('div');
  card.style.cssText = `background:${CSS.panel};border:1px solid ${CSS.border};border-radius:12px;`
    + `padding:20px 24px;display:flex;flex-direction:column;gap:8px;min-width:280px;`
    + 'max-height:70vh;overflow:auto;';

  const title = document.createElement('div');
  title.textContent = 'LOAD SKILL';
  title.style.cssText = `color:${CSS.cyan};font-size:13px;letter-spacing:0.15em;margin-bottom:4px;`;
  card.appendChild(title);

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No saved skills yet -- click Save Skill first.';
    empty.style.cssText = `color:${CSS.dim};font-size:11px;`;
    card.appendChild(empty);
  }

  for (const entry of entries) {
    const btn = document.createElement('button');
    const when = new Date(entry.savedAt).toLocaleString();
    btn.innerHTML = `<div style="font-size:12px">${entry.filename}</div>`
      + `<div style="font-size:10px;color:${CSS.dim};margin-top:2px">${when}</div>`;
    btn.style.cssText = `background:transparent;color:${CSS.bone};border:1px solid ${CSS.border};`
      + `border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font:12px ${CSS.font}`;
    btn.onmouseenter = () => { btn.style.borderColor = CSS.cyan; };
    btn.onmouseleave = () => { btn.style.borderColor = CSS.border; };
    btn.onclick = () => { onPick(entry); overlay.remove(); };
    card.appendChild(btn);
  }

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = `margin-top:8px;background:transparent;color:${CSS.dim};`
    + `border:1px solid ${CSS.border};border-radius:8px;padding:6px 12px;cursor:pointer;`;
  cancel.onclick = () => overlay.remove();
  card.appendChild(cancel);

  overlay.appendChild(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

export function enterBlackjack(lab, opts = {}) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  // `setRoom('tethered-rig')` turns vision off by default (the reference
  // task this room is modeled on is odor-only). Re-enabling it here is the
  // extension point `setRoom` itself documents -- the fly's real compound
  // eyes then genuinely see the rig (the orb, the tether, ambient light), so
  // the retinal HUD panel shows a real rendered view instead of being
  // permanently black. Honest caveat: this is a real visual input, not
  // cosmetic -- it now also drives real looming/visual channels, on top of
  // the odor drive the task's features (DNa01/DNp03/DNp13) were designed
  // around. Pass `{vision:false}` to keep the original odor-only behavior.
  if (opts.vision ?? true) lab.visionEnabled = true;

  const table = lab.addStation(new CardTable());
  // In front of the fly (between the platform and the camera), tilted up and
  // rotated to face the camera -- NOT the fly's forward view: the fly's
  // actual learning signal is the odor drive injected directly by
  // `task.encodeState()` -> `brain.setInput()`, never anything read off this
  // screen. It reads as "a lab console the person training the fly looks
  // at," not "the fly is watching a screen to learn." Position/tilt tuned by
  // eye (headless-render iteration) against the fixed rig camera in
  // rooms/tethered-rig.js -- if that camera ever moves, re-check this spot.
  const SCREEN_POSITION = new THREE.Vector3(0.9, 0, -0.8);
  table.position.copy(SCREEN_POSITION);
  // The floor label sits on the room's own ring (rooms/tethered-rig.js draws
  // it at radius 3.4-3.5) instead of down by the platform -- same direction
  // as SCREEN_POSITION (toward the fixed camera), just pushed out to the
  // ring's own radius, since the in-world screen it used to sit under is
  // hidden for now (see card-table.js's SHOW_SCREEN).
  //
  // `MadFlyLab._spawn` (called synchronously inside `addStation()` above,
  // BEFORE this line ever runs) plants the floor label using whatever
  // `station.position` was AT THAT MOMENT -- the Station's just-constructed
  // default, (0,0,0) -- and offsets it `+2.2` in Z besides, a convention
  // tuned for Room 1's ring layout. Overriding it here replaces that
  // default placement, not adjusts it.
  const RING_RADIUS = 3.45; // matches the ring's 3.4-3.5 band in tethered-rig.js
  const labelDir = new THREE.Vector2(SCREEN_POSITION.x, SCREEN_POSITION.z).normalize();
  if (table.labelMesh) {
    table.labelMesh.position.set(
      labelDir.x * RING_RADIUS, table.labelMesh.position.y, labelDir.y * RING_RADIUS,
    );
  }
  if (table.object3D) {
    table.object3D.position.copy(SCREEN_POSITION);
    // `lookAt` turns out to point this group's local +Z (the panel's own
    // visible front, see card-table.js) AT the target directly -- no extra
    // flip needed. (An earlier version added one "to compensate for the
    // camera -Z convention," reasoning from the API doc rather than checking
    // -- it rendered the panel's culled back to the viewer. Verified by
    // rendering both ways and comparing.)
    table.object3D.lookAt(TETHERED_BASE_POSITION);
  }

  const hud = new TrainingHUD().mount();
  // Stacked directly above the TrainingHUD panel (inserted as the first
  // child of its own root, which is already a flex column) -- so this
  // doesn't need separate pixel-position math to sit "above" it.
  const handScreen = new HandScreen().mount(hud.root);

  const task = new BlackjackTask();
  const loop = new TrainingLoop(lab.brain, task, BLACKJACK_FEATURE_CHANNELS, {
    alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15, tickHz: lab.brainHz,
  });
  // Resume with a previously-learned readout instead of a fresh random one --
  // room-menu.js passes this back in across a Room 1 <-> Room 2 switch, so
  // leaving and coming back doesn't throw away training progress. (Genuinely
  // running both rooms at once isn't safe: they'd drive the same real
  // connectome, and Room 1's real food-bowl odors target the exact glomeruli
  // this task injects into.)
  if (opts.initialQ) loop.q = opts.initialQ;

  let running = true;
  let awaitingNextHand = true;

  const tickOnce = () => {
    if (!running) return;
    if (awaitingNextHand) {
      awaitingNextHand = !loop.startEpisode(); // true if it resolved instantly (natural)
      if (!awaitingNextHand) {
        // A decision is needed; fall through to take it below on this same tick
        // so a natural doesn't sit idle for a whole interval doing nothing.
      } else {
        finishAndRedraw(null);
        return;
      }
    }

    const result = loop.step();
    // The right leg gestures -- Hit taps down (vertical), Stand sweeps
    // sideways (horizontal); the left leg stays at rest. Scripted, not
    // brain-driven -- see LegRig's own honesty note.
    lab.legRig?.play('right', result.action === 'hit' ? 'vertical' : 'horizontal');

    finishAndRedraw(result.action);
    if (result.done) awaitingNextHand = true;
  };

  function finishAndRedraw(action) {
    const q = loop.q.qValues(loop.readFeatures());
    table._render(task.state(), action, loop.decisionState, q);
    handScreen.render(task.state(), action, loop.decisionState, q);
    hud.sample({
      pam11: lab.brain.readCalibrated('PAM11'),
      ppl1: lab.brain.readCalibrated('PPL1'),
      qHit: q.hit, qStand: q.stand,
    });
    hud.setBadge({
      trials: loop.q.trials,
      successRate: loop.q.successRate,
      decisionState: loop.decisionState,
      wins: loop.q.wins,
      losses: loop.q.losses,
      evaluating: loop.evaluating,
      evalStats: loop.evalStats,
    });
    hud.update();
  }

  let speedIdx = opts.speedIndex ?? 0; // default 'Slow' -- see SPEEDS
  let interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);
  const speedBtn = hud.addButton(`Speed: ${SPEEDS[speedIdx].label}`, () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    clearInterval(interval);
    interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);
    speedBtn.textContent = `Speed: ${SPEEDS[speedIdx].label}`;
  }, 'secondary');

  // Buttons: each one is a direct, always-available state change -- no
  // "stop training first, THEN click play mode" two-step dance, and no
  // blocking alert()/confirm() (those freeze the whole render loop, since
  // the render/brain loop and this dialog would be fighting over the same
  // single JS thread).
  hud.addButton('Stop', () => { running = false; });
  hud.addButton('Resume Training', () => { running = true; loop.stopEvaluating(); }, 'secondary');
  hud.addButton('Play Learned Policy', () => { running = true; loop.startEvaluating(); }, 'secondary');
  // Saved via the dev-server's /api/skills endpoint (vite-plugins/skill-
  // storage.js) into a real file under training/skills/, not clipboard --
  // that only worked as long as you remembered to paste it somewhere before
  // closing the tab.
  hud.addButton('Save Skill', async () => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'blackjack', data: JSON.parse(loop.q.save()) }),
      });
      const result = await res.json();
      hud.flash(result.error ? `Save failed: ${result.error}` : `Saved training/skills/${result.filename}`);
    } catch (err) {
      hud.flash(`Save failed: ${err.message}`);
    }
  }, 'secondary');
  hud.addButton('Load Skill', async () => {
    try {
      const res = await fetch('/api/skills?task=blackjack');
      const entries = await res.json();
      showSkillPicker(entries, async (entry) => {
        try {
          const fileRes = await fetch(`/api/skills/${encodeURIComponent(entry.filename)}`);
          const saved = await fileRes.json();
          loop.q = QReadout.load(JSON.stringify(saved.data));
          loop.stopEvaluating();
          finishAndRedraw(null);
          hud.flash(`Loaded ${entry.filename}`);
        } catch (err) {
          hud.flash(`Load failed: ${err.message}`);
        }
      });
    } catch (err) {
      hud.flash(`Could not list saved skills: ${err.message}`);
    }
  }, 'secondary');
  hud.addButton('Reset Training', () => {
    // Renamed from "New Fly (reset)" -- it never actually minted a new fly
    // (no `lab.mintNewFly()` call), only the Q-readout, so the old label
    // promised something this button didn't do. Deliberately still not
    // calling mintNewFly here: that also touches vision/silence/genotype
    // state (see MadFlyLab.mintNewFly) which isn't safe to re-run in the
    // middle of a tethered session without re-checking every one of its
    // side effects against Room 2's assumptions (the vision-on override
    // above, the TETHERED_AVATAR_SCALE shrink, etc).
    loop.q = new QReadout(BLACKJACK_FEATURE_CHANNELS.length, {
      alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15,
    });
    loop.stopEvaluating();
    awaitingNextHand = true;
    running = true;
    // Without this, clicking Reset while training was Stopped changed
    // everything above correctly but showed no visible effect at all until
    // the next tick -- which never came, since `running` stayed false. Looked
    // exactly like the button doing nothing.
    finishAndRedraw(null);
  }, 'secondary');

  return {
    loop, table, hud,
    /** Save the learned Q-readout weights as a JSON string. */
    saveSkill() { return loop.q.save(); },
    /** Load a previously saved skill into this loop's Q-readout. */
    loadSkill(json) { loop.q = QReadout.load(json); },
    /** Pause training. */
    pause() { running = false; },
    /** Resume training. */
    resume() { running = true; },
    dispose() {
      clearInterval(interval);
      handScreen.dispose();
      hud.dispose();
      lab.removeStation(table);
    },
  };
}