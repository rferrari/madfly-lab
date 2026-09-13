/**
 * The 4 optogenetics tool definitions -- entirely task-specific (this is
 * where "which real population, which color, which named reaction" lives),
 * plugged into the framework-generic BrainRaycaster/BrainHalo from
 * src/observer/. Nothing here is reusable for a different tool set.
 *
 * `pC1`/`aSP` are NOT individually addressable channels in the shipped packs
 * (they only exist combined as `courtship_hub`, per
 * python/src/madfly_lab/circuits.py) -- the Courtship Probe targets
 * `courtship_hub`, not the literal strings "pC1"/"aSP".
 *
 * `requiredChannels` is what gates a tool's availability against whichever
 * circuit is currently loaded (see optogenetics-palette.js) -- distinct from
 * `channel`/`channelFor`, which is what actually gets injected into.
 */

import { THEME, CSS } from '../../src/index.js';

const CLICK_DECAY_SECONDS = 0.4; // see lab-brain.js: the injectCurrent default
// (8) is forwarded as SECONDS in Mode B, not ticks -- always pass this explicitly.
const CLICK_AMOUNT = 20; // the spec's "+20 mV" ergonomic convention (see lab-brain.js header)
const HOLD_INTENSITY = 12; // deliberately lower than a click's peak -- sustained
// drive reaches a true steady state, and several of these populations are only
// 2 neurons wide (easy to saturate; see AGENTS.md's DNp09-saturation note).

const YAW_KICK_RADIANS = 0.9; // scripted visualization amplitude, see steering tool
const YAW_KICK_DURATION = 0.6; // seconds

export const TOOLS = [
  {
    id: 'dopamine',
    emoji: '🧪',
    label: 'Dopamine Electrode',
    sublabel: 'PAM11 · reward',
    channel: 'PAM11',
    requiredChannels: ['PAM11'],
    color: THEME.lime,
    cssColor: CSS.lime,
    inject: { amount: CLICK_AMOUNT, decaySeconds: CLICK_DECAY_SECONDS, holdIntensity: HOLD_INTENSITY },
    reactionMode: 'direct',
    react(lab) { lab.legRig?.play('right', 'kick'); }, // LegRig has only left/right now, no front
  },
  {
    id: 'looming',
    emoji: '🚨',
    label: 'Looming Laser',
    sublabel: 'LC4/LPLC2 · threat',
    channel: 'LC4',
    requiredChannels: ['LC4', 'DNp01'],
    color: THEME.red,
    cssColor: CSS.red,
    inject: { amount: CLICK_AMOUNT, decaySeconds: CLICK_DECAY_SECONDS, holdIntensity: HOLD_INTENSITY },
    // The one reaction registered as a real DNp01 threshold crossing (see
    // optogenetics-palette.js's mount-time onSignal registration) rather than
    // fired synchronously with the click -- this is meant to feel emergent,
    // not scripted-to-a-click, and it also fires correctly if something else
    // in the scene independently drives DNp01 past threshold.
    reactionMode: 'signal',
    signalChannel: 'DNp01',
    signalThreshold: 0.5,
    react(lab) { lab.legRig?.play('body', 'jump'); },
  },
  {
    id: 'steering',
    emoji: '🧲',
    label: 'Steering Magnet',
    sublabel: 'DNa01 L/R · steer',
    sides: ['L', 'R'],
    channelFor(side) { return `DNa01_${side}`; },
    requiredChannels: ['DNa01_L', 'DNa01_R'],
    color: THEME.cyan,
    cssColor: CSS.cyan,
    inject: { amount: CLICK_AMOUNT, decaySeconds: CLICK_DECAY_SECONDS, holdIntensity: HOLD_INTENSITY },
    reactionMode: 'direct',
    /**
     * A forced sharp turn -- CLEARLY SCRIPTED, not something the connectome
     * computed. Room 2's `LabAvatar.act()` deliberately zeroes locomotion
     * while tethered but never touches `this.yaw` itself, and syncs
     * `object3D.rotation.y = this.yaw` unconditionally every tick -- so a
     * kick applied directly to `object3D.rotation.y` would be stomped on the
     * very next tick. Animating `avatar.yaw` is the only value that survives,
     * and it is safe to do so here specifically because the tethered branch
     * never writes it itself.
     */
    react(lab, { side, api }) {
      const sign = side === 'L' ? -1 : 1;
      api.applyYawKick(sign * YAW_KICK_RADIANS, YAW_KICK_DURATION);
    },
  },
  {
    id: 'courtship',
    emoji: '💖',
    label: 'Courtship Probe',
    sublabel: 'courtship_hub · display',
    channel: 'courtship_hub',
    requiredChannels: ['courtship_hub', 'DNp13'],
    color: THEME.magenta,
    cssColor: CSS.magenta,
    inject: { amount: CLICK_AMOUNT, decaySeconds: CLICK_DECAY_SECONDS, holdIntensity: HOLD_INTENSITY },
    reactionMode: 'direct',
    react(lab, { api }) {
      lab.legRig?.play('left', 'shimmer');
      lab.legRig?.play('right', 'shimmer');
      // DNp13 is a rate-model readout, not a discrete "accepted" decision --
      // report it as a labeled value, never as a boolean.
      setTimeout(() => {
        const v = lab.brain.readCalibrated('DNp13');
        api.toast(`courtship_hub → DNp13 readout ${v.toFixed(2)}`, THEME.magenta);
      }, 150);
    },
  },
];
