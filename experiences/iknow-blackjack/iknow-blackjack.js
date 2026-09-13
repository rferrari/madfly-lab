/**
 * "I Know Blackjack" Experience (Room 4)
 *
 * Spawns a fresh fly at a dedicated Blackjack table in a custom room with NO tether rod
 * (brain connector/plug).
 *
 * IKnowScreen 2D card monitor is centered at the top-middle of the screen.
 * SkillHUD is positioned at the bottom-left of the screen.
 * Telemetry HUD (top-right) displays live traces for Blackjack neural channels.
 * Fly leg rig actively animates foreleg gestures (hit/stand) during action turns.
 *
 * Runs with a human-friendly turn-based pace: rounds, thinking/reasoning phase,
 * action execution, winner announcement, and wait before next round.
 */

import * as THREE from 'three';
import { TrainingLoop, TETHERED_BASE_POSITION, CSS } from '../../src/index.js';
import { IKnowBlackjackTask, IKNOW_FEATURE_CHANNELS } from './iknow-task.js';
import { QReadout } from '../../src/training/q-learning.js';
import { IKnowTable } from './iknow-table.js';
import { IKnowScreen } from './iknow-screen.js';
import { Telemetry } from '../../src/observer/telemetry.js';
import { SkillHUD } from './iknow-hud.js';
import { buildIKnowRig } from './iknow-rig.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function enterIKnowBlackjack(lab, opts = {}) {
  // Set room to tethered mode for avatar scaling and camera framing,
  // then swap in our custom Room 4 rig (which excludes the brain connector / tether rod).
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');
  if (opts.vision ?? true) lab.visionEnabled = true;

  // Replace default tethered-rig geometry with Room 4's untethered rig
  let customRig = null;
  if (lab._tetheredRig) {
    lab.arena.remove(lab._tetheredRig.group);
    lab._tetheredRig.orb.dispose();

    customRig = buildIKnowRig(lab.brain.pack ?? lab.brain.runtime);
    lab.arena.add(customRig.group);
    lab._tetheredRig = customRig;
  }

  // Mint a fresh fly specifically for this experience
  lab.mintNewFly();

  // Configure Telemetry observer HUD with live traces for Blackjack channels
  if (lab.observer) {
    lab.observer.visible = true;
    if (lab.observer.root) lab.observer.root.style.display = 'flex';
    const traces = [
      { channel: 'PAM11', label: 'PAM11 (dopamine win)', color: CSS.magenta },
      { channel: 'PPL1', label: 'PPL1 (punish loss)', color: CSS.red },
      { channel: 'DNa01_L', label: 'DNa01_L (steer L)', color: CSS.cyan },
      { channel: 'DNa01_R', label: 'DNa01_R (steer R)', color: CSS.lime },
      { channel: 'DNp03', label: 'DNp03 (head pitch)', color: CSS.amber },
      { channel: 'DNp13', label: 'DNp13 (action drive)', color: CSS.violet },
    ];
    if (lab.observer.telemetryCanvas) {
      lab.observer.telemetry = new Telemetry(lab.observer.telemetryCanvas, traces);
    }
  }

  const table = lab.addStation(new IKnowTable());
  const SCREEN_POSITION = new THREE.Vector3(0.9, 0, -0.8);
  table.position.copy(SCREEN_POSITION);

  const RING_RADIUS = 3.45;
  const labelDir = new THREE.Vector2(SCREEN_POSITION.x, SCREEN_POSITION.z).normalize();
  if (table.labelMesh) {
    table.labelMesh.position.set(
      labelDir.x * RING_RADIUS, table.labelMesh.position.y, labelDir.y * RING_RADIUS,
    );
  }
  if (table.object3D) {
    table.object3D.position.copy(SCREEN_POSITION);
    table.object3D.lookAt(TETHERED_BASE_POSITION);
  }

  // IKnowScreen centered at top-middle of the screen
  const handScreenRoot = document.createElement('div');
  handScreenRoot.id = 'iknow-handscreen-root';
  Object.assign(handScreenRoot.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '320px',
    zIndex: '25',
  });
  document.body.appendChild(handScreenRoot);
  const handScreen = new IKnowScreen().mount(handScreenRoot);

  // Skill Loader HUD positioned at bottom-left of screen
  const skillHud = new SkillHUD().mount();

  const task = new IKnowBlackjackTask();

  // Start with an untrained QReadout in evaluation mode
  let currentQ = new QReadout(IKNOW_FEATURE_CHANNELS.length, {
    alpha: 0.05, gamma: 0.95, epsilon: 0.0,
  });

  const loop = new TrainingLoop(lab.brain, task, IKNOW_FEATURE_CHANNELS, {
    alpha: 0.05, gamma: 0.95, epsilon: 0.0, tickHz: lab.brainHz,
  });
  loop.q = currentQ;
  loop.startEvaluating();

  let running = true;

  const redraw = (action, phaseMsg = 'EVALUATING') => {
    const q = loop.q.qValues(loop.readFeatures());
    const meta = {
      trials: loop.q.trials,
      successRate: loop.q.successRate,
      wins: loop.q.wins,
      losses: loop.q.losses,
      evaluating: true,
      evalStats: loop.evalStats,
    };
    table._render(task.state(), action, phaseMsg, q);
    handScreen.render(task.state(), action, phaseMsg, q, meta);
    skillHud.updateStats(meta);
  };

  // Animate leg gestures continuously during action phase so movement is clearly visible
  const animateLegAction = async (action, durationMs = 1200) => {
    const gesture = action === 'hit' ? 'vertical' : 'horizontal';
    const startTime = performance.now();
    while (performance.now() - startTime < durationMs && running) {
      lab.legRig?.play('right', gesture);
      await sleep(420);
    }
  };

  // Turn-based round sequence loop so users can follow every decision. Every
  // round -- naturals included -- goes through at least one Hit/Stand
  // decision (see iknow-game.js): `startEpisode()` never resolves a hand by
  // itself here, so its return value doesn't need checking.
  const runGameLoop = async () => {
    while (running) {
      // Phase 1: Deal Cards
      loop.startEpisode();
      redraw(null, '🎲 DEALING CARDS...');
      await sleep(1400);
      if (!running) break;

      // Phase 2: Player Decisions (Round turns)
      let handActive = true;
      while (handActive && running) {
        const state = task.state();

        // 2a. Reasoning phase: show fly considering hand total vs dealer upcard
        redraw(null, `🧠 FLY REASONING (Total: ${state.playerTotal} vs Dealer: ${state.dealerUpcard})`);
        await sleep(1500);
        if (!running) break;

        // 2b. Execute decision step
        const prevWins = loop.q.wins;
        const prevLosses = loop.q.losses;
        const result = loop.step();

        const actLabel = result.action === 'hit' ? '🎯 ACTION: HIT!' : '🛑 ACTION: STAND!';
        redraw(result.action, actLabel);

        // Animate leg gesture throughout the action reveal window
        await animateLegAction(result.action, 1300);
        if (!running) break;

        // 2c. If hand resolved (Stand or Bust)
        if (result.done) {
          handActive = false;
          let outcomeMsg = 'ROUND OVER';
          if (loop.q.wins > prevWins) {
            outcomeMsg = '🏆 WINNER! FLY WINS THE HAND!';
          } else if (loop.q.losses > prevLosses) {
            outcomeMsg = '💥 LOSS / BUST! DEALER WINS';
          } else {
            outcomeMsg = '🤝 PUSH! DRAW GAME';
          }

          redraw(result.action, outcomeMsg);
          // Wait for player to digest the result before next round
          await sleep(2600);
        }
      }
    }
  };

  // Don't auto-start: show a Start Game button and wait for a click, so it's
  // visually obvious the moment the fly's readout is actually driving turns
  // (rather than rounds silently ticking by before anyone's watching).
  const startOverlay = document.createElement('div');
  startOverlay.id = 'iknow-start-overlay';
  Object.assign(startOverlay.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '26',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  });

  const startBtn = document.createElement('button');
  startBtn.textContent = '▶ START GAME';
  Object.assign(startBtn.style, {
    background: 'rgba(0, 20, 10, 0.92)',
    border: '1px solid #00ff66',
    color: '#00ff66',
    fontFamily: CSS.font,
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '0.12em',
    padding: '14px 28px',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 0 25px rgba(0, 255, 102, 0.3)',
  });
  startBtn.onmouseenter = () => { startBtn.style.background = 'rgba(0, 45, 22, 0.95)'; };
  startBtn.onmouseleave = () => { startBtn.style.background = 'rgba(0, 20, 10, 0.92)'; };

  const startHint = document.createElement('div');
  startHint.textContent = 'Pick a skill cartridge below, then start the round';
  Object.assign(startHint.style, {
    color: 'rgba(0, 255, 102, 0.7)',
    fontFamily: CSS.font,
    fontSize: '11px',
  });

  startOverlay.appendChild(startBtn);
  startOverlay.appendChild(startHint);
  document.body.appendChild(startOverlay);

  // No hand has been dealt yet (task.hand is null until the first
  // startEpisode()), so draw the idle placeholder directly rather than
  // through `redraw()`, which calls `task.state()`.
  const idleState = { playerTotal: 0, dealerUpcard: 0, usableAce: false };
  const idleQ = { hit: 0, stand: 0 };
  table._render(idleState, null, '⏸ WAITING TO START...', idleQ);
  handScreen.render(idleState, null, '⏸ WAITING TO START...', idleQ, { evaluating: true });

  startBtn.onclick = () => {
    startOverlay.remove();
    runGameLoop();
  };

  // Skill Cartridge selector callback
  skillHud.onSelectSkill = async (skillId, filename) => {
    if (skillId.startsWith('file:') && filename) {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(filename)}`);
        const saved = await res.json();
        loop.q = QReadout.load(JSON.stringify(saved.data));
      } catch (err) {
        alert(`Failed to load skill file: ${err.message}`);
      }
    } else if (skillId === 'trained') {
      try {
        const res = await fetch('/api/skills/blackjack-trained.json');
        if (res.ok) {
          const json = await res.json();
          loop.q = QReadout.load(JSON.stringify(json.data));
        } else {
          const fallback = new QReadout(IKNOW_FEATURE_CHANNELS.length);
          fallback.weights = {
            hit: [-0.6478, -0.3728, -0.001, -0.035, -0.59],
            stand: [-0.1004, -0.1537, 0.0016, 0.021, -0.099],
          };
          loop.q = fallback;
        }
      } catch (e) {
        const fallback = new QReadout(IKNOW_FEATURE_CHANNELS.length);
        fallback.weights = {
          hit: [-0.6478, -0.3728, -0.001, -0.035, -0.59],
          stand: [-0.1004, -0.1537, 0.0016, 0.021, -0.099],
        };
        loop.q = fallback;
      }
    } else if (skillId === 'flight-escape') {
      // Incompatible skill: Inverted weights
      const wrong = new QReadout(IKNOW_FEATURE_CHANNELS.length);
      wrong.weights = {
        hit: [0.8, 0.5, 0.1, 0.2, 0.7],
        stand: [-0.9, -0.7, -0.2, -0.3, -0.8],
      };
      loop.q = wrong;
    } else if (skillId === 'chemotaxis') {
      // Incompatible skill: Odor attraction weights
      const wrong = new QReadout(IKNOW_FEATURE_CHANNELS.length);
      wrong.weights = {
        hit: [0.05, -0.85, 0.90, -0.4, 0.1],
        stand: [-0.60, 0.10, -0.75, 0.5, -0.2],
      };
      loop.q = wrong;
    } else {
      // Untrained: baseline random readout
      loop.q = new QReadout(IKNOW_FEATURE_CHANNELS.length);
    }

    loop.startEvaluating();
    redraw(null, 'SKILL LOADED - STARTING NEXT ROUND');
  };

  return {
    loop, table, skillHud, handScreen,
    dispose() {
      running = false;
      startOverlay.remove();
      skillHud.dispose();
      handScreen.dispose();
      handScreenRoot.remove();
      lab.removeStation(table);
    },
  };
}
