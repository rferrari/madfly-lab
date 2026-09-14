/**
 * Wires the "Math Class" (even vs. odd) task into an already-running
 * MadFlyLab's Room 2 -- same shape as experiences/blackjack/tethered-scene.js,
 * right down to reusing the framework's `TrainingHUD` unmodified.
 *
 * Call `enterMathClass(lab)` after `lab.setRoom('tethered-rig')` (or it will
 * call that for you). Call the returned `dispose()` to leave cleanly.
 *
 * Deliberately leaves vision OFF (`tethered-rig`'s own default -- see
 * lab.setRoom's docs): this task drives the real visual interneurons
 * (LPLC1/LPLC2, see dot-sensory.js) directly and on its own decision cadence,
 * exactly like blackjack drives its ORN channels directly. Leaving real
 * per-frame vision on would have the actual rendered rig ALSO writing to
 * those same two channels every frame, for no reason -- there is nothing in
 * the empty tethered dock worth seeing here, unlike blackjack's optional
 * "let the fly see the rig" extension.
 */

import { TrainingLoop, CSS } from '../../src/index.js';
import { TrainingHUD } from '../../src/observer/training-hud.js';
import { MathClassTask, MATH_CLASS_FEATURE_CHANNELS } from './math-task.js';
import { QReadout } from '../../src/training/q-learning.js';

// Single-decision trials resolve fast -- these are a little quicker than
// blackjack's own SPEEDS since there's no multi-card reveal to read, just one
// dot count vs. another.
const SPEEDS = [
  { label: 'Slow', ms: 1400 },
  { label: 'Normal', ms: 700 },
  { label: 'Fast', ms: 250 },
];

// Same reasoning as experiences/blackjack/tethered-scene.js's own cap: a
// definite end instead of training forever. Matches that room's cap so the
// two are directly comparable.
const TRAINING_EPISODE_CAP = 1500;

/**
 * DotScreen -- a 2D DOM "monitor" for the math-class task, stacked directly
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

export function enterMathClass(lab, opts = {}) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  const hud = new TrainingHUD().mount();
  const dotScreen = new DotScreen().mount(hud.root);

  const task = new MathClassTask();
  const loop = new TrainingLoop(lab.brain, task, MATH_CLASS_FEATURE_CHANNELS, {
    alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15, tickHz: lab.brainHz,
  });
  // See tethered-scene.js's blackjack counterpart for why: lets a Room 1 <->
  // Room 2 switch resume instead of discarding progress.
  if (opts.initialQ) loop.q = opts.initialQ;

  // Starts stopped, same as blackjack's room -- entering shouldn't silently
  // spend training trials before anyone's watching.
  let running = false;

  const tickOnce = () => {
    if (!running) return;
    // Every trial is exactly one decision (pick a side, done) -- unlike
    // blackjack's multi-step Hand, there's no "awaiting next hand" gap to
    // track: start and resolve happen in the same tick.
    loop.startEpisode();
    const result = loop.step();
    // Scripted leg gesture, not brain-driven (see LegRig's own honesty note)
    // -- reusing blackjack's hit/stand -> vertical/horizontal convention
    // purely as a visual "which way she leaned" flourish.
    lab.legRig?.play('right', result.action === 'hit' ? 'vertical' : 'horizontal');

    finishAndRedraw(result.action);

    if (!loop.evaluating && loop.q.trials >= TRAINING_EPISODE_CAP) {
      running = false;
      hud.flash(`Training complete: ${TRAINING_EPISODE_CAP} rounds. Click Play to test it.`);
    }
  };

  function finishAndRedraw(action) {
    // No trial has started yet (task.trial is null before the first
    // Resume/Play click) -- draw the idle placeholder instead.
    const state = task.trial ? task.state() : { leftDots: 0, rightDots: 0, evenSide: 'left' };
    const q = loop.q.qValues(loop.readFeatures());
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
    // Real, calibrated steering read -- NOT the decision mechanism (that's
    // the QReadout above, exactly like every other task in this lab): purely
    // a telemetry check that the real DNa01 pair is in fact moving with the
    // dot-count drive, independent of what the (separately-trained) readout
    // has learned to do with it.
    if (opts.onSteeringSample) {
      opts.onSteeringSample(lab.brain.readSteering('DNa01'));
    }
  }

  // Initial IDLE frame, same as blackjack's room.
  finishAndRedraw(null);

  let speedIdx = opts.speedIndex ?? 0;
  let interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);
  const speedBtn = hud.addButton(`Speed: ${SPEEDS[speedIdx].label}`, () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    clearInterval(interval);
    interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);
    speedBtn.textContent = `Speed: ${SPEEDS[speedIdx].label}`;
  }, 'secondary');

  hud.addButton('Stop', () => { running = false; finishAndRedraw(null); });
  hud.addButton('Resume Training', () => { running = true; loop.stopEvaluating(); }, 'secondary');
  hud.addButton('Play', () => { running = true; loop.startEvaluating(); }, 'secondary');
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
      if (!entries.length) { hud.flash('No saved math-class skills yet.'); return; }
      const entry = entries[0]; // newest first
      const fileRes = await fetch(`/api/skills/${encodeURIComponent(entry.filename)}`);
      const saved = await fileRes.json();
      loop.q = QReadout.load(JSON.stringify(saved.data));
      loop.stopEvaluating();
      finishAndRedraw(null);
      hud.flash(`Loaded ${entry.filename}`);
    } catch (err) {
      hud.flash(`Load failed: ${err.message}`);
    }
  }, 'secondary');
  hud.addButton('Reset Training', () => {
    loop.q = new QReadout(MATH_CLASS_FEATURE_CHANNELS.length, {
      alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15,
    });
    loop.stopEvaluating();
    running = true;
    finishAndRedraw(null);
  }, 'secondary');

  return {
    loop, hud,
    saveSkill() { return loop.q.save(); },
    loadSkill(json) { loop.q = QReadout.load(json); },
    pause() { running = false; },
    resume() { running = true; },
    dispose() {
      clearInterval(interval);
      dotScreen.dispose();
      hud.dispose();
    },
  };
}
