/**
 * "I Know Blackjack" -> real olfactory receptor neurons.
 *
 * Standalone copy for the iknow-blackjack experience (see iknow-game.js) --
 * not shared with experiences/blackjack/.
 *
 * The fly cannot read a card. NeuroMechFly's own blackjack demo (the
 * inspiration for this encoding) fed the hand in as firing rates on three
 * olfactory receptor types instead of showing it a picture -- visual input
 * was tried first and did not reach the central brain. This module does the
 * same thing with three REAL glomeruli from male-cns:v1.0:
 *
 *   ORN_DM1  <- player total       (4..21, higher total -> higher drive)
 *   ORN_VA6  <- dealer upcard      (1..10, higher card -> higher drive)
 *   ORN_DA1  <- usable ace         (present/absent -> on/off drive)
 *
 * BE CLEAR ABOUT WHAT THIS IS: there is no real biology in which these three
 * glomeruli encode card values -- this is an arbitrary, engineered mapping,
 * exactly as arbitrary as the reference demo's own encoding. What is real is
 * that these are genuine male-cns cell populations and the drive genuinely
 * propagates through their real downstream wiring; the MEANING assigned to
 * the input is ours, the same way it was the original demo's.
 *
 * ORN_DA2 is deliberately NOT used for the ace bit: this framework already
 * tags ORN_DA2 as an aversive channel (see avatar/olfaction.js) for the CO2
 * cube, and a usable ace is a good thing for the player -- reusing an
 * aversive-tagged channel for a positive signal would be a confusing clash.
 */

export const SENSORY_CHANNELS = { total: 'ORN_DM1', dealerCard: 'ORN_VA6', usableAce: 'ORN_DA1' };

/** Reference drive the pack's channels were calibrated against (see LabBrain). */
const REFERENCE_DRIVE = 1.0;

/**
 * @param {{playerTotal:number, dealerUpcard:number, usableAce:boolean}} state
 * @returns {{ORN_DM1:number, ORN_VA6:number, ORN_DA1:number}} drive per channel
 */
export function encodeState(state) {
  return {
    [SENSORY_CHANNELS.total]: clamp01(state.playerTotal / 21) * REFERENCE_DRIVE,
    [SENSORY_CHANNELS.dealerCard]: clamp01(state.dealerUpcard / 10) * REFERENCE_DRIVE,
    [SENSORY_CHANNELS.usableAce]: (state.usableAce ? 1 : 0) * REFERENCE_DRIVE,
  };
}

/** Drive every sensory channel into the brain (sustained, held until changed). */
export function driveState(brain, state) {
  const drives = encodeState(state);
  for (const [channel, value] of Object.entries(drives)) brain.setInput(channel, value);
  return drives;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
