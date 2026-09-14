---
name: create-madfly-experience
description: Create new madfly-lab experience with templates including experienceInfo for dynamic menu loading.
---

# Skill: Create MadFly Lab Experience

## Description
Creates a new experience folder with template files following madfly-lab conventions. All code stays within the experience folder, uses framework APIs, doesn't touch core framework code, and includes experienceInfo export for dynamic menu loading.

## When to Use
When you want to create a new experiential task for the madfly-lab framework that will automatically appear in the room menu via dynamic experience loading (e.g., new learning experiment, behavioral task, etc.)

## Parameters
- **name**: The name of the new experience (will be used for folder and file names)

## Steps
1. Creates `experiences/<name>/` directory
2. Creates `<name>-task.js` with core task logic template
3. Creates `<name>-sensory.js` with neural encoding template  
4. Creates `tethered-scene.js` with Room 2 integration template and experienceInfo export
5. All files use proper imports and follow framework conventions
6. Experience automatically appears in room menu after creation (no manual menu updates needed)

## Templates Included
- Task logic: state management, rewards, action mapping
- Sensory encoding: maps experience state to real neuron channels
- Tethered scene: wiring into TrainingLoop with HUD, controls, persistence + experienceInfo export

## Rules Followed
- ✅ All code in experiences/<name>/ folder
- ✅ Uses framework APIs (TrainingLoop, QReadout, etc.)
- ✅ No relative path hacks like "../../"
- ✅ Doesn't touch framework core files
- ✅ Follows honesty rules from AGENTS.md
- ✅ Includes experienceInfo export for dynamic menu loading
- ✅ Uses available APIs for sensory encoding and task logic

## Example
```bash
# After loading this skill, run:
hermes skill run create-madfly-experience --name "my-new-task"
# Creates: experiences/my-new-task/ with all template files
# Experience automatically appears in room menu!
```

## File Templates

### `<name>-task.js`
```javascript
/**
 * \"<Name>\" -- Brief description of the task.
 * 
 * Pure task logic -- no THREE.js, no brain, no DOM. Sensory encoding (state
 * -> real neuron drive) lives in <name>-sensory.js; the scene that
 * wires this into TrainingLoop lives in tethered-scene.js.
 * 
 * ACTION LABELS: QReadout's two action slots are hardcoded 'hit'/'stand'
 * (see src/training/q-learning.js's ACTIONS) -- this task reuses those
 * slots under domain-specific names. describe() renders them back out
 * appropriately.
 */

import { encodeState } from './<name>-sensory.js';

// Task-specific constants
const MIN_VALUE = 1;
const MAX_VALUE = 9;
// Add more constants as needed

// The vocabulary QReadout actually understands mapped to what this task means by them.
export const ACTION_TO_SIDE = { hit: 'left', stand: 'right' };
export const SIDE_TO_ACTION = { left: 'hit', right: 'stand' };

/** Draw one trial/trial equivalent. */
export function drawTrial(rng = Math.random) {
  // Implement trial generation logic here
  // Return state object relevant to your task
  return { /* state */ };
}

/**
 * One trial, resolved in a single decision.
 */
export class Trial {
  constructor(rng = Math.random) {
    // Initialize trial state
    const state = drawTrial(rng);
    Object.assign(this, state);
    this.done = false;
    this.reward = 0;
    this.chosenSide = null;
  }

  state() {
    // Return current state for sensory encoding
    return { /* state */ };
  }

  /**
   * @param {'hit'|'stand'} action
   */
  step(action) {
    if (this.done) return { reward: this.reward, done: true };
    this.chosenSide = ACTION_TO_SIDE[action];
    // Calculate reward based on action and state
    this.reward = /* calculate reward */;
    this.done = true;
    return { reward: this.reward, done: true };
  }
}

/** Adapts Trial + <-sensory.js to the TrainingLoop task interface. */
export class <pascalcase:name>Task {
  constructor() { this.trial = null; }

  start(rng) {
    this.trial = new Trial(rng);
    return { state: this.trial.state(), done: this.trial.done, reward: this.trial.reward };
  }

  state() { return this.trial.state(); }

  step(action) { return this.trial.step(action); }

  encodeState(state) { return encodeState(state); }

  describe(state, action) {
    // Implement description logic for HUD/debugging
    if (action == null) return `IDLE · /* state description */`;
    const side = ACTION_TO_SIDE[action].toUpperCase();
    const label = `[Q-LEARNING] /* state description */ -> ${side}`;
    if (!this.trial.done) return label;
    return `${this.trial.reward > 0 ? 'CORRECT' : 'WRONG'} · ${label}`;
  }
}

/** 
 * Real DN channels read as the Q-function's input.
 * Customize based on what neurons your task reads for decisions.
 */
export const <uppercase:name>_FEATURE_CHANNELS = ['DNa01_L', 'DNa01_R', 'DNp09', 'DNp03'];

export { MIN_VALUE, MAX_VALUE };
```

### `<name>-sensory.js`
```javascript
/**
 * \"<Name>\" -> real neuron channels (sensory encoding).
 * 
 * This module takes an honest approach: rather than fake a complex stimulus
 * through limited sensory pathways, it drives real neuron populations with
 * a meaningful signal -- 
 *   CHANNEL_LEFT  <- left/relevant stimulus dimension
 *   CHANNEL_RIGHT <- right/relevant stimulus dimension
 *   CHANNEL_CONTEXT <- contextual information
 * 
 * BE CLEAR ABOUT WHAT THIS IS: there may be no real biology in which these
 * specific channels encode these specific stimulus dimensions -- these are
 * genuine male-cns:v1.0 cell populations, genuinely propagated through their
 * real downstream wiring, but the MEANING assigned to \"stimulus -> drive\" 
 * is ours, exactly as arbitrary as other task encodings in this framework.
 */

export const SENSORY_CHANNELS = {
  // Map your stimulus dimensions to real neuron channels
  // Example: leftStim: 'ORN_DM1', rightStim: 'ORN_VA6', context: 'ORN_DA1'
};

/** Reference drive the pack's channels were calibrated against (see LabBrain). */
const REFERENCE_DRIVE = 1.0;

/** 
 * @param {Object} state - Your task's state object
 * @returns {Object} drive per channel (keyed by SENSORY_CHANNELS values)
 */
export function encodeState(state) {
  // Normalize your state values to [0,1] range and apply reference drive
  const drives = {};
  // Example implementation:
  // drives[SENSORY_CHANNELS.leftStim] = clamp01(state.leftValue / maxLeft) * REFERENCE_DRIVE;
  // drives[SENSORY_CHANNELS.rightStim] = clamp01(state.rightValue / maxRight) * REFERENCE_DRIVE;
  // drives[SENSORY_CHANNELS.context] = (state.contextCondition ? 1 : 0) * REFERENCE_DRIVE;
  return drives;
}

/** Drive every sensory channel into the brain (sustained, held until changed). */
export function driveState(brain, state) {
  const drives = encodeState(state);
  for (const [channel, value] of Object.entries(drives)) brain.setInput(channel, value);
  return drives;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
```

### `tethered-scene.js`
```javascript
/**
 * Wires the \"<Name>\" task into an already-running MadFlyLab's Room 2.
 * 
 * Call `enter<Name>(lab)` after `lab.setRoom('tethered-rig')` (or it will
 * call that for you). Call the returned `dispose()` to leave cleanly.
 * 
 * This experience uses [describe modality, e.g., smell-based input] enabling 
 * comparison with other modalities.
 */

import { TrainingLoop, TETHERED_BASE_POSITION, CSS } from '../../src/index.js';
import { TrainingHUD } from '../../src/observer/training-hud.js';
import { <pascalcase:name>Task, <uppercase:name>_FEATURE_CHANNELS } from './<name>-task.js';
import { QReadout } from '../../src/training/q-learning.js';
import { driveState } from './<name>-sensory.js';

// Experience-specific configuration
const SPEEDS = [
  { label: 'Slow', ms: 1800 },
  { label: 'Normal', ms: 900 },
  { label: 'Fast', ms: 350 },
];

const TRAINING_EPISODE_CAP = 1500; // Matches blackjack for comparability

/**
 * A tiny modal listing saved skills (from GET /api/skills), newest first.
 */
function showSkillPicker(entries, onPick) {
  // Implementation copied from blackjack experience - reusable framework component
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:40;display:grid;place-items:center;' +
    'background:rgba(11,6,20,0.82);backdrop-filter:blur(6px);';

  const card = document.createElement('div');
  card.style.cssText = `background:${CSS.panel};border:1px solid ${CSS.border};border-radius:12px;` +
    `padding:20px 24px;display:flex;flex-direction:column;gap:8px;min-width:280px;` +
    'max-height:70vh;overflow:auto;';\n\n  const title = document.createElement('div');\n  title.textContent = 'LOAD SKILL';\n  title.style.cssText = `color:${CSS.cyan};font-size:13px;letter-spacing:0.15em;margin-bottom:4px;`;\n  card.appendChild(title);\n\n  if (!entries.length) {\n    const empty = document.createElement('div');\n    empty.textContent = 'No saved skills yet -- click Save Skill first.';\n    empty.style.cssText = `color:${CSS.dim};font-size:11px;`;\n    card.appendChild(empty);\n  }\n\n  for (const entry of entries) {\n    const btn = document.createElement('button');\n    const when = new Date(entry.savedAt).toLocaleString();\n    btn.innerHTML = `<div style=\"font-size:12px\">${entry.filename}</div>` +\n      `<div style=\"font-size:10px;color:${CSS.dim};margin-top:2px\">${when}</div>`;\n    btn.style.cssText = `background:transparent;color:${CSS.bone};border:1px solid ${CSS.border};` +\n      `border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font:12px ${CSS.font}`;\n    btn.onmouseenter = () => { btn.style.borderColor = CSS.cyan; };\n    btn.onmouseleave = () => { btn.style.borderColor = CSS.border; };\n    btn.onclick = () => { onPick(entry); overlay.remove(); };\n    card.appendChild(btn);\n  }\n\n  const cancel = document.createElement('button');\n  cancel.textContent = 'Cancel';\n  cancel.style.cssText = `margin-top:8px;background:transparent;color:${CSS.dim};` +\n    `border:1px solid ${CSS.border};border-radius:8px;padding:6px 12px;cursor:pointer;`;\n  cancel.onclick = () => overlay.remove();\n  card.appendChild(cancel);\n\n  overlay.appendChild(card);\n  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };\n  document.body.appendChild(overlay);\n}\n\nexport function enter<pascalcase:name>(lab, opts = {}) {\n  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');\n\n  const hud = new TrainingHUD().mount();\n\n  const task = new <pascalcase:name>Task();\n  const loop = new TrainingLoop(lab.brain, task, <uppercase:name>_FEATURE_CHANNELS, {\n    alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15, tickHz: lab.brainHz,\n  });\n  \n  // Resume with a previously-learned readout instead of a fresh random one\n  if (opts.initialQ) loop.q = opts.initialQ;\n\n  // Starts stopped -- entering the room shouldn't silently start spending\n  // training rounds before anyone's watching.\n  let running = false;\n  let awaitingNextHand = true;\n\n  const tickOnce = () => {\n    if (!running) return;\n    if (awaitingNextHand) {\n      awaitingNextHand = !loop.startEpisode(); // true if it resolved instantly (natural)\n      if (!awaitingNextHand) {\n        // A decision is needed; fall through to take it below on this same tick\n      } else {\n        finishAndRedraw(null);\n        return;\n      }\n    }\n\n    const result = loop.step();\n    // Scripted leg gesture -- not brain-driven (see LegRig's honesty note)\n    lab.legRig?.play('right', result.action === 'hit' ? 'vertical' : 'horizontal');\n\n    finishAndRedraw(result.action);\n    if (result.done) {\n      awaitingNextHand = true;\n      // Training (not eval) has hit the round cap -- stop rather than run forever\n      if (!loop.evaluating && loop.q.trials >= TRAINING_EPISODE_CAP) {\n        running = false;\n        hud.flash(`Training complete: ${TRAINING_EPISODE_CAP} rounds. Click Play to test it.`);\n      }\n    }\n  }\n\n  function finishAndRedraw(action) {\n    // No episode has started yet -- draw the idle placeholder\n    const state = task.trial ? task.state() : { /* initial state */ };\n    const q = loop.q.qValues(loop.readFeatures());\n    \n    const meta = {\n      trials: loop.q.trials,\n      successRate: loop.q.successRate,\n      wins: loop.q.wins,\n      losses: loop.q.losses,\n      evaluating: loop.evaluating,\n      evalStats: loop.evalStats,\n      running,\n      cap: TRAINING_EPISODE_CAP,\n    };\n    \n    // Drive the sensory input to the brain\n    driveState(lab.brain, state);\n    \n    // Update HUD with neural readings\n    hud.sample({\n      pam11: lab.brain.readCalibrated('PAM11'),\n      ppl1: lab.brain.readCalibrated('PPL1'),\n      qHit: q.hit, qStand: q.stand,\n    });\n    hud.setBadge({ ...meta, decisionState: loop.decisionState });\n    hud.update();\n  }\n\n  // Draw the initial IDLE frame immediately\n  finishAndRedraw(null);\n\n  let speedIdx = opts.speedIndex ?? 0; // default 'Slow'\n  let interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);\n  const speedBtn = hud.addButton(`Speed: ${SPEEDS[speedIdx].label}`, () => {\n    speedIdx = (speedIdx + 1) % SPEEDS.length;\n    clearInterval(interval);\n    interval = setInterval(tickOnce, SPEEDS[speedIdx].ms);\n    speedBtn.textContent = `Speed: ${SPEEDS[speedIdx].label}`;\n  }, 'secondary');\n\n  // Buttons: direct, always-available state changes\n  hud.addButton('Stop', () => { running = false; finishAndRedraw(null); });\n  hud.addButton('Resume Training', () => { running = true; loop.stopEvaluating(); }, 'secondary');\n  hud.addButton('Play', () => { running = true; loop.startEvaluating(); }, 'secondary');\n  \n  // Vision toggle (relevant for experiences that can benefit from blinded trials)\n  let eyesCovered = false;\n  const eyesBtn = hud.addButton('Cover Eyes', () => {\n    eyesCovered = !eyesCovered;\n    lab.visionEnabled = !eyesCovered;\n    eyesBtn.textContent = eyesCovered ? 'Uncover Eyes' : 'Cover Eyes';\n    hud.flash(eyesCovered\n      ? 'Eyes covered — decisions now come only from odor-driven DN reads'\n      : 'Eyes uncovered — vision is back on');\n  }, 'secondary');\n  \n  // Skill persistence\n  hud.addButton('Save Skill', async () => {\n    try {\n      const res = await fetch('/api/skills', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ task: '<lowercase:name>', data: JSON.parse(loop.q.save()) }),\n      });\n      const result = await res.json();\n      hud.flash(result.error ? `Save failed: ${result.error}` : `Saved training/skills/${result.filename}`);\n    } catch (err) {\n      hud.flash(`Save failed: ${err.message}`);\n    }\n  }, 'secondary');\n  \n  hud.addButton('Load Skill', async () => {\n    try {\n      const res = await fetch('/api/skills?task=<lowercase:name>');\n      const entries = await res.json();\n      showSkillPicker(entries, async (entry) => {\n        try {\n          const fileRes = await fetch(`/api/skills/${encodeURIComponent(entry.filename)}`);\n          const saved = await fileRes.json();\n          loop.q = QReadout.load(JSON.stringify(saved.data));\n          loop.stopEvaluating();\n          finishAndRedraw(null);\n          hud.flash(`Loaded ${entry.filename}`);\n        } catch (err) {\n          hud.flash(`Load failed: ${err.message}`);\n        }\n      });\n    } catch (err) {\n      hud.flash(`Could not list saved skills: ${err.message}`);\n    }\n  }, 'secondary');\n  \n  hud.addButton('Reset Training', () => {\n    loop.q = new QReadout(<uppercase:name>_FEATURE_CHANNELS.length, {\n      alpha: 0.05, gamma: 0.95, epsilon: opts.epsilon ?? 0.15,\n    });\n    loop.stopEvaluating();\n    awaitingNextHand = true;\n    running = true;\n    finishAndRedraw(null);\n  }, 'secondary');\n\n  return {\n    loop, hud,\n    /** Save the learned Q-readout weights as a JSON string. */\n    saveSkill() { return loop.q.save(); },\n    /** Load a previously saved skill into this loop's Q-readout. */\n    loadSkill(json) { loop.q = QReadout.load(json); },\n    /** Pause training. */\n    pause() { running = false; };\n    /** Resume training. */\n    resume() { running = true; };\n    /** Clean up resources. */\n    dispose() {\n      clearInterval(interval);\n      hud.dispose();\n    },\n  };\n}\n\n// Experience info for dynamic menu loading\n/** @type {{label: string, description: string}} */\nexport const experienceInfo = {\n  label: '<Name>',\n  description: 'Brief description of what this experience does.'\n};
```

## Verification
After creating an experience with this skill:
1. Verify the folder structure: `experiences/<name>/` with the three files
2. Check that all imports use correct relative paths (e.g., `../../src/index.js`)
3. Ensure no framework core files were modified
4. Verify the experience automatically appears in the room menu (no manual updates needed!)
5. Test that the experience loads and basic controls work in the MadFly Lab interface

## Notes
- This skill creates templates that need customization for your specific task
- Replace placeholder logic in the templates with your actual task implementation
- The sensory encoding should map to real neuron channels appropriate for your stimulus modality
- Feature channels should be chosen based on what neurons provide relevant decision information
- Follow honesty rules: never invent neurons, never present engineered signals as measured, etc.
- The experienceInfo export enables automatic discovery by the dynamic room menu system