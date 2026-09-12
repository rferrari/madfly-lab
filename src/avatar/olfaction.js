/**
 * Dual Olfactory Receptors (spec 3.1) -- samples the arena's 3D scent gradients
 * and drives the real ORN glomerulus populations.
 *
 * The framework ships four real glomeruli, each verified in male-cns:v1.0 with
 * a real ORN -> PN -> KC pathway (see connectome.py's OLFACTORY_CHANNELS):
 *
 *   ORN_DM1  74 cells   ORN_VA6  63 cells    food-odour channels
 *   ORN_DA1 204 cells   ORN_DA2  48 cells    the real cVA pheromone channel
 *
 * Real glomeruli are not labelled "this smells like sugar" -- DM1 and VA6 are
 * used as distinguishable food channels because they are well-connected, not
 * because of any odour realism. DA1 genuinely is the pheromone channel (Or67d).
 *
 * These populations carry no left/right soma annotation in this dataset (all
 * "?"), so scent is injected symmetrically -- a fly's odour signal here is an
 * intensity, not a direction. Directional behaviour comes from the avatar
 * sampling the gradient as it moves, which is closer to real chemotaxis anyway.
 */

export const OLFACTORY_CHANNELS = ['ORN_DM1', 'ORN_VA6', 'ORN_DA1', 'ORN_DA2', 'ORN_V'];

/**
 * Glomeruli a real fly finds AVERSIVE.
 *
 *   ORN_V   CO2 (Gr21a/Gr63a) -- what rotting and fermenting matter gives off
 *   ORN_DA2 geosmin (Or56a)   -- harmful mould
 *
 * Used to give odour a SIGN at the body. It has to be done here, because this
 * pruned rate model does not reproduce aversion on its own: measured, a CO2
 * drive shifts forward drive by +0.0021 -- weakly positive, the same direction
 * as food. The neurons carrying the signal are real and really are aversive in
 * the animal; what the body does about it is ours.
 */
export const AVERSIVE_CHANNELS = new Set(['ORN_V', 'ORN_DA2']);

export class OlfactoryReceptors {
  constructor({ channels = OLFACTORY_CHANNELS, gain = 1.5 } = {}) {
    this.channels = [...channels];
    this.gain = gain;
    this.intensities = new Map(this.channels.map((c) => [c, 0]));
    // Previous sample per channel, so a scene can read whether the avatar is
    // moving up or down a gradient without tracking it itself.
    this.deltas = new Map(this.channels.map((c) => [c, 0]));
  }

  /**
   * @param {ScentField} field  the lab's gradient field
   * @param {THREE.Vector3} position  avatar position
   */
  sample(field, position) {
    for (const channel of this.channels) {
      const value = field.sampleAt(channel, position) * this.gain;
      this.deltas.set(channel, value - this.intensities.get(channel));
      this.intensities.set(channel, value);
    }
    return this.intensities;
  }

  /** Push the current sample into the brain as sustained ORN drive. */
  drive(brain) {
    for (const [channel, intensity] of this.intensities) brain.setInput(channel, intensity);
  }

  /**
   * Net attractiveness of what the fly can currently smell: attractive odours
   * minus aversive ones. One number the body can climb, so approaching food
   * and fleeing rot are the same rule with opposite sign.
   */
  valence() {
    let v = 0;
    for (const [channel, intensity] of this.intensities) {
      v += AVERSIVE_CHANNELS.has(channel) ? -intensity : intensity;
    }
    return v;
  }

  strongest() {
    let best = null;
    let bestValue = 0;
    for (const [channel, value] of this.intensities) {
      if (value > bestValue) { bestValue = value; best = channel; }
    }
    return { channel: best, intensity: bestValue };
  }
}
