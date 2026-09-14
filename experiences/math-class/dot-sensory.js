/**
 * Math Class -> real visual interneurons.
 *
 * This framework's compound eye is a real hexagonal ommatidial sampler (see
 * src/avatar/retina.js), but each eye ultimately reduces to ONE averaged
 * luminance value per frame (`hemifields()` -> `(left+right)/2` in
 * lab-avatar.js's `sense()`) -- there is no per-object counting anywhere in
 * the pipeline. So a fly literally "seeing dots and counting them" isn't
 * something this vision model can do, exactly the same limitation
 * experiences/blackjack/blackjack-sensory.js ran into with cards.
 *
 * This module takes the same honest approach that file did: rather than
 * fake a rendered dot pattern through the real (frame-rate-coupled) vision
 * pipeline, it drives each eye's REAL visual interneurons directly with a
 * "more dots this side -> more drive on that side's cells" signal --
 *
 *   LPLC1_L / LPLC1_R <- left/right dot count   (contrast-sensitive)
 *   LPLC2_L / LPLC2_R <- left/right dot count   (loom-sensitive)
 *
 * BE CLEAR ABOUT WHAT THIS IS: there is no real biology in which LPLC1/LPLC2
 * count discrete objects -- these are genuine male-cns:v1.0 cell populations,
 * genuinely propagated through their real downstream wiring, but the MEANING
 * assigned to "dot count -> drive" is ours, exactly as arbitrary as
 * blackjack-sensory.js's own card-value encoding, and for the same reason:
 * this framework's connectome has no synaptic plasticity (see
 * src/training/q-learning.js's header) -- it's a fixed, real feature
 * reservoir that a `QReadout` learns a linear boundary over, not something
 * that itself learns to "see" dots.
 */

export const SENSORY_CHANNELS = {
  left: ['LPLC1_L', 'LPLC2_L'],
  right: ['LPLC1_R', 'LPLC2_R'],
};

/** Reference drive the pack's channels were calibrated against (see LabBrain). */
const REFERENCE_DRIVE = 1.0;

/** Dot counts run 1..9 (see math-task.js) -- this is the normalizing max. */
const MAX_DOTS = 9;

/**
 * @param {{leftDots:number, rightDots:number}} state
 * @returns {{LPLC1_L:number, LPLC2_L:number, LPLC1_R:number, LPLC2_R:number}}
 */
export function encodeState(state) {
  const left = clamp01(state.leftDots / MAX_DOTS) * REFERENCE_DRIVE;
  const right = clamp01(state.rightDots / MAX_DOTS) * REFERENCE_DRIVE;
  return {
    LPLC1_L: left, LPLC2_L: left,
    LPLC1_R: right, LPLC2_R: right,
  };
}

/** Drive every sensory channel into the brain (sustained, held until changed). */
export function driveState(brain, state) {
  const drives = encodeState(state);
  for (const [channel, value] of Object.entries(drives)) brain.setInput(channel, value);
  return drives;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
