/**
 * Wires the "Math Class" (even vs. odd) task into an already-running
 * MadFlyLab's Room 2 -- same shape as experiences/blackjack/tethered-scene.js,
 * right down to reusing the framework's `TrainingHUD` unmodified.
 *
 * Call `enterMathClass(lab)` after `lab.setRoom('tethered-rig')` (or it will
 * call that for you). Call the returned `dispose()` to leave cleanly.
 *
 * This version uses smell-based input (ORN channels) instead of visual input,
 * enabling comparison of learning performance between modalities.
 */

import { TrainingLoop, TETHERED_BASE_POSITION, CSS } from '../../src/index.js';
import { TrainingHUD } from '../../src/observer/training-hud.js';
import { MathClassTask, MATH_CLASS_FEATURE_CHANNELS } from './math-task.js';
import { QReadout } from '../../src/training/q-learning.js';
import { driveState } from './math-sensory.js';

/** DotScreen -- a 2D DOM "monitor" for the math-class task, stacked directly
 * above the TrainingHUD panel (same pattern as blackjack's HandScreen).
 * Shows the two dot counts, which side is EVEN, the fly's choice, and the
 * live Q-values, plus the same IDLE/LEARNING/PLAYING banner
 * experiences/blackjack/hand-screen.js uses.
 */
class DotScreen {
  mount(container) {
    const box = document.createElement('div');
    box.style.cssText = `background:${CSS.panel};border:1px solid ${CSS.border};`
      + 'border-radius:8px;padding:8px 10px;backdrop-filter:blur(8px);';

    const title = document.createElement('div');
    title.textContent = 'DOT SCREEN';
    title.style.cssText = `color:${CSS.violet};font-size:9px;letter-spacing:0.14em;margin-bottom:6px`;
    box.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 300;
    this.canvas.height = 200;
    this.canvas.style.cssText = 'width:100%;display:block;border-radius:4px;';
    box.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    container.insertBefore(box, container.firstChild);
    this.box = box;
    this.render({ leftDots: 0, rightDots: 0, evenSide: 'left' }, null, 'IDLE', {}, {});
    return this;
  }

  /** Draw N dots centered in a half-width column. */
  _drawDots(cx, y, n, color) {
    const { ctx } = this;
    const cols = 3;
    const spacing = 22;
    const r = 6;
    const startX = cx - ((Math.min(n, cols) - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(startX + col * spacing, y + row * spacing, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  render(state, action, decisionState, q, meta = {}) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0b0614';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Mode/win-rate banner -- IDLE while stopped, PLAYING while evaluating,
    // LEARNING with an explicit, color-coded win rate otherwise (same fix
    // applied to both other hand/dot screens in this lab -- see
    // iknow-blackjack/iknow-screen.js and blackjack/hand-screen.js).
    const running = meta.running !== false;
    const evaluating = !!meta.evaluating;
    const bannerH = 26;
    ctx.textAlign = 'center';
    ctx.font = `700 13px ${CSS.font}`;
    if (!running) {
      ctx.fillStyle = 'rgba(232, 224, 245, 0.08)';
      ctx.fillRect(2, 2, w - 4, bannerH);
      ctx.fillStyle = CSS.dim;
      ctx.fillText('○ IDLE', w / 2, bannerH / 2 + 5);
    } else if (evaluating) {
      ctx.fillStyle = 'rgba(0, 229, 255, 0.16)';
      ctx.fillRect(2, 2, w - 4, bannerH);
      ctx.fillStyle = CSS.cyan;
      const n = meta.evalStats?.trials ?? 0;
      const pct = n ? ((meta.evalStats.wins / n) * 100).toFixed(1) : '0.0';
      ctx.fillText(`▶ PLAYING · WIN ${pct}% (${n} trials)`, w / 2, bannerH / 2 + 5);
    } else {
      ctx.fillStyle = 'rgba(154, 92, 255, 0.18)';
      ctx.fillRect(2, 2, w - 4, bannerH);
      const pct = (meta.successRate ?? 0) * 100;
      ctx.fillStyle = pct > 60 ? CSS.lime : pct < 45 ? CSS.red : CSS.amber;
      const cap = meta.cap ? ` / ${meta.cap}` : '';
      ctx.fillText(`● LEARNING · WIN ${pct.toFixed(1)}% (${meta.trials ?? 0}${cap})`, w / 2, bannerH / 2 + 5);
    }

    // Left/right dot columns, even side highlighted lime, odd side amber --
    // same color convention as the HIT/STAND action colors elsewhere in this
    // lab (lime = correct-shaped, amber = the other one), not a new one.
    const leftColor = state.evenSide === 'left' ? CSS.lime : CSS.amber;
    const rightColor = state.evenSide === 'right' ? CSS.lime : CSS.amber;
    ctx.font = `600 13px ${CSS.font}`;
    ctx.fillStyle = leftColor;
    ctx.fillText(`LEFT: ${state.leftDots}`, w / 4, bannerH + 20);
    ctx.fillStyle = rightColor;
    ctx.fillText(`RIGHT: ${state.rightDots}`, (3 * w) / 4, bannerH + 20);
    this._drawDots(w / 4, bannerH + 40, state.leftDots, leftColor);
    this._drawDots((3 * w) / 4, bannerH + 40, state.rightDots, rightColor);

    if (action) {
      const chosenSide = action === 'hit' ? 'left' : 'right';
      const correct = chosenSide === state.evenSide;
      ctx.fillStyle = correct ? CSS.lime : CSS.red;
      ctx.font = `700 20px ${CSS.font}`;
      ctx.fillText(`STEER ${chosenSide.toUpperCase()}`, w / 2, bannerH + 118);
    }

    ctx.font = `11px ${CSS.font}`;
    ctx.fillStyle = CSS.dim;
    ctx.fillText(`Q(left) ${(q.hit ?? 0).toFixed(3)}   Q(right) ${(q.stand ?? 0).toFixed(3)}`, w / 2, bannerH + 140);

    ctx.font = `10px ${CSS.font}`;
    ctx.fillStyle = CSS.violet;
    ctx.fillText(decisionState, w / 2, h - 12);
    ctx.textAlign = 'left';
  }

  dispose() {
    this.box?.remove();
  }
}
// 350ms was tuned for throughput, not for a human watching along -- at that
// pace a hand resolves before you can read what the screen just said. Default
// slow enough to actually follow the reasoning; SPEEDS gives a quick toggle.
const SPEEDS = [
  { label: 'Slow', ms: 1800 },
  { label: 'Normal', ms: 900 },
  { label: 'Fast', ms: 350 },
];

// Only paces how often a real, already-settled decision gets taken -- every
// tick still runs the same fixed TrainingLoop.settle() + TD update regardless
// of this interval, so Speed changes how fast you watch training happen, not
// what gets learned or how well.
//
// A round cap so training has a definite end instead of running forever --
// 1,500 episodes matches the sample size `training/blackjack-findings.md`'s
// offline run used, enough to see whether the readout's success rate has
// leveled off. Reset Training clears `loop.q.trials` back to 0, so the cap
// re-applies after a reset.
const TRAINING_EPISODE_CAP = 1500;

/**
 * A tiny modal listing saved skills (from GET /api/skills), newest first --
 * click one to load it. There's no established picker component elsewhere in
 * this codebase to reuse, so this mirrors experiences/room-menu.js's own
 * plain-overlay style (same z-index-above-everything convention) rather than
 * inventing a different look.
 */
function showSkillPicker(entries, onPick) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:40;display:grid;place-items:center;'
    + 'background:rgba(11,6,20,0.82);backdrop-filter:blur(6px);';

  const card = document.createElement('div');
  card.style.cssText = `background:${CSS.panel};border:1px solid ${CSS.border};border-radius:12px;` +
    `padding:20px 24px;display:flex;flex-direction:column;gap:8px;min-width:280px;` +
    'max-height:70vh;overflow:auto;';

  const title = document.createElement('div');
  title.textContent = 'LOAD SKILL';
  title.style.cssText = `color:${CSS.cyan};font-size:13px;letter-spacing:0.15em;margin-bottom:4px;` +
    '';
  card.appendChild(title);

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No saved skills yet -- click Save Skill first.' +
      '';
    empty.style.cssText = `color:${CSS.dim};font-size:11px;` +
      '';
    card.appendChild(empty);
  }

  for (const entry of entries) {
    const btn = document.createElement('button');
    const when = new Date(entry.savedAt).toLocaleString();
    btn.innerHTML = `<div style="font-size:12px">${entry.filename}</div>` +
      `<div style="font-size:10px;color:${CSS.dim};margin-top:2px">${when}</div>`;
    btn.style.cssText = `background:transparent;color:${CSS.bone};border:1px solid ${CSS.border};` +
      `border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font:12px ${CSS.font}`;
    btn.onmouseenter = () => { btn.style.borderColor = CSS.cyan; };
    btn.onmouseleave = () => { btn.style.borderColor = CSS.border; };
    btn.onclick = () => { onPick(entry); overlay.remove(); };
    card.appendChild(btn);
  }

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = `margin-top:8px;background:transparent;color:${CSS.dim};` +
    `border:1px solid ${CSS.border};border-radius:8px;padding:6px 12px;cursor:pointer;`;
  cancel.onclick = () => overlay.remove();
  card.appendChild(cancel);

  overlay.appendChild(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

export function enterMathClass(lab, opts = {}) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  const hud = new TrainingHUD().mount();
  const dotScreen = new DotScreen().mount(hud.root);

  // Widget showing current input numbers
  const inputDisplay = document.createElement('div');
  inputDisplay.style.cssText = 'position:fixed;top:10px;left:10px;color:#fff;font:14px monospace;background:rgba(0,0,0,0.5);padding:4px 8px;border-radius:4px;z-index:1000;';
  inputDisplay.textContent = 'Input: L:0 R:0';
  document.body.appendChild(inputDisplay);
  window.inputDisplay = inputDisplay;

  const task = new MathClassTask();
  const loop = new TrainingLoop(lab.brain, task, MATH_CLASS_FEATURE_CHANNELS, {
    alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15, tickHz: lab.brainHz,
  });
  // Resume with a previously-learned readout instead of a fresh random one --
  // room-menu.js passes this back in across a Room 1 <-> Room 2 switch, so
  // leaving and coming back doesn't throw away training progress. (Genuinely
  // running both rooms at once isn't safe: they'd drive the same real
  // connectome, and Room 1's real food-bowl odors target the exact glomeruli
  // this task injects into.)
  if (opts.initialQ) loop.q = opts.initialQ;

  // Starts stopped -- entering the room shouldn't silently start spending
  // training rounds before anyone's watching. `awaitingNextHand` stays true
  // until the first "Resume Training"/"Play" click starts the first episode.
  let running = false;
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
    if (result.done) {
      awaitingNextHand = true;
      // Training (not eval) has hit the round cap -- stop rather than run
      // forever, so there's a definite point at which training is "done."
      if (!loop.evaluating && loop.q.trials >= TRAINING_EPISODE_CAP) {
        running = false;
        hud.flash(`Training complete: ${TRAINING_EPISODE_CAP} rounds. Click Play to test it.`);
      }
    }
  };

  function finishAndRedraw(action) {
      // No episode has started yet (task.hand is null before the first
      // Resume/Play click) -- draw the idle placeholder rather than reading
      // through a hand that doesn't exist yet.
      const state = task.trial ? task.state() : { leftDots: 0, rightDots: 0, evenSide: 'left' };
      // Update input display
      if (window.inputDisplay) {
        window.inputDisplay.textContent = `Input: L:${state.leftDots} R:${state.rightDots}`;
      }
      const q = loop.q.qValues(loop.readFeatures());
      // Same {evaluating, successRate, trials, evalStats} shape both widgets
      // read -- one source of truth for "is this training or playing," so the
      // two can't quietly disagree. `running` lets the HUD show a genuine
      // IDLE state, distinct from LEARNING, while stopped.
      const meta = {
        trials: loop.q.trials,
        successRate: loop.q.successRate,
        wins: loop.q.wins,
        losses: loop.q.losses,
        evaluating: loop.evaluating,
        evalStats: loop.evalStats,
        running,
        cap: TRAINING_EPISODE_CAP,
      };
      dotScreen.render(state, action, loop.decisionState, q, meta);
      hud.sample({
        pam11: lab.brain.readCalibrated('PAM11'),
        ppl1: lab.brain.readCalibrated('PPL1'),
        qHit: q.hit, qStand: q.stand,
      });
      hud.setBadge({ ...meta, decisionState: loop.decisionState });
      hud.update();

      // Drive the smell-based sensory input to the brain
      driveState(lab.brain, state);
    }

  // Draw the initial IDLE frame immediately -- otherwise the HUD sits blank
  // (or on stale defaults) until the first click, same gap the iknow-blackjack
  // room's Start Game screen was added to avoid.
  finishAndRedraw(null);

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
  hud.addButton('Stop', () => { running = false; finishAndRedraw(null); });
  hud.addButton('Resume Training', () => { running = true; loop.stopEvaluating(); }, 'secondary');
  hud.addButton('Play', () => { running = true; loop.startEvaluating(); }, 'secondary');
  // Vision is on by default for this room (see the note above on
  // `opts.vision`) -- toggling it off mid-session blinds the fly for real
  // (no compound-eye/looming input reaches the brain at all), which is the
  // most direct way to show the task's decisions come from the odor-driven
  // DN reads, not from anything she's seeing.
  let eyesCovered = false;
  const eyesBtn = hud.addButton('Cover Eyes', () => {
    eyesCovered = !eyesCovered;
    lab.visionEnabled = !eyesCovered;
    eyesBtn.textContent = eyesCovered ? 'Uncover Eyes' : 'Cover Eyes';
    hud.flash(eyesCovered
      ? 'Eyes covered — decisions now come only from odor-driven DN reads'
      : 'Eyes uncovered — vision is back on');
  }, 'secondary');
  // Saved via the dev-server's /api/skills endpoint (vite-plugins/skill-
  // storage.js) into a real file under training/skills/, not clipboard --
  // that only worked as long as you remembered to paste it somewhere before
  // closing the tab.
  hud.addButton('Save Skill', async () => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'math-class', data: JSON.parse(loop.q.save()) }),
      });
      const result = await res.json();
      hud.flash(result.error ? `Save failed: ${result.error}` : `Saved training/skills/${result.filename}`);
    } catch (err) {
      hud.flash(`Save failed: ${err.message}`);
    }
  }, 'secondary');
  hud.addButton('Load Skill', async () => {
    try {
      const res = await fetch('/api/skills?task=math-class');
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
    loop.q = new QReadout(MATH_CLASS_FEATURE_CHANNELS.length, {
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
    loop, hud,
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
      hud.dispose();
    },
  };
}

// Experience info for dynamic menu loading
/** @type {{label: string, description: string}} */
export const experienceInfo = {
  label: 'Math Class',
  description: 'Even vs. odd discrimination using smell-based input'
};
