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

import { TrainingLoop, DOCK_POSITION } from '../../src/index.js';
import { TrainingHUD } from '../../src/observer/training-hud.js';
import { BlackjackTask, BLACKJACK_FEATURE_CHANNELS } from './blackjack-task.js';
import { CardTable } from './card-table.js';

const DECISION_INTERVAL_MS = 350;

export function enterBlackjack(lab, opts = {}) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  const table = lab.addStation(new CardTable());
  table.position.copy(DOCK_POSITION);
  if (table.object3D) table.object3D.position.copy(DOCK_POSITION);

  const hud = new TrainingHUD().mount();

  const task = new BlackjackTask();
  const loop = new TrainingLoop(lab.brain, task, BLACKJACK_FEATURE_CHANNELS, {
    alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15, tickHz: lab.brainHz,
  });

  let awaitingNextHand = true;

  const tickOnce = () => {
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
    // Leg gesture, per the task's mapping: Hit -> left tap, Stand -> right
    // tap, a win -> an extra front-leg kick. Scripted, not brain-driven -- see
    // LegRig's own honesty note.
    lab.legRig?.play(result.action === 'hit' ? 'left' : 'right', 'tap');
    if (result.done && result.reward > 0) lab.legRig?.play('front', 'kick');

    finishAndRedraw(result.action);
    if (result.done) awaitingNextHand = true;
  };

  function finishAndRedraw(action) {
    const q = loop.q.qValues(loop.readFeatures());
    table._render(task.state(), action, loop.decisionState, q);
    hud.sample({
      pam11: lab.brain.readCalibrated('PAM11'),
      ppl1: lab.brain.readCalibrated('PPL1'),
      qHit: q.hit, qStand: q.stand,
    });
    hud.setBadge({ trials: loop.q.trials, successRate: loop.q.successRate, decisionState: loop.decisionState });
    hud.update();
  }

  const interval = setInterval(tickOnce, DECISION_INTERVAL_MS);

  return {
    loop, table, hud,
    dispose() {
      clearInterval(interval);
      hud.dispose();
      lab.removeStation(table);
    },
  };
}
