/**
 * Math Class -> real olfactory receptor neurons (smell-based input).
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
 *   ORN_DM1  <- left dot count   (higher count -> higher drive)
 *   ORN_VA6  <- right dot count  (higher count -> higher drive)
 *   ORN_DA1  <- even side indicator (right side = 1, left side = 0)
 *
 * BE CLEAR ABOUT WHAT THIS IS: there is no real biology in which ORN_DM1/ORN_VA6
 * count discrete objects -- these are genuine male-cns:v1.0 cell populations,
 * genuinely propagated through their real downstream wiring, but the MEANING
 * assigned to "dot count -> drive" is ours, exactly as arbitrary as
 * blackjack-sensory.js's own card-value encoding, and for the same reason:
 * this framework's connectome has no synaptic plasticity (see
 * src/training/q-learning.js's header) -- it's a fixed, real feature
 * reservoir that a `QReadout` learns a linear boundary over, not something
 * that itself learns to "see" dots.
 */

export const SENSORY_CHANNELS = { leftCount: 'ORN_DM1', rightCount: 'ORN_VA6', evenSide: 'ORN_DA1' };

/** Reference drive the pack's channels were calibrated against (see LabBrain). */
const REFERENCE_DRIVE = 1.0;

/** Dot counts run 1..9 (see math-task.js) -- this is the normalizing max. */
const MAX_DOTS = 9;

/**
 * @param {{leftDots:number, rightDots:number, evenSide:string}} state
 * @returns {{ORN_DM1:number, ORN_VA6:number, ORN_DA1:number}} drive per channel
 */
export function encodeState(state) {
  return {
    [SENSORY_CHANNELS.leftCount]: clamp01(state.leftDots / MAX_DOTS) * REFERENCE_DRIVE,
    [SENSORY_CHANNELS.rightCount]: clamp01(state.rightDots / MAX_DOTS) * REFERENCE_DRIVE,
    [SENSORY_CHANNELS.evenSide]: (state.evenSide === 'right' ? 1 : 0) * REFERENCE_DRIVE,
  };
}

/** Drive every sensory channel into the brain (sustained, held until changed). */
export function driveState(brain, state) {
  const drives = encodeState(state);
  for (const [channel, value] of Object.entries(drives)) brain.setInput(channel, value);
  return drives;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }