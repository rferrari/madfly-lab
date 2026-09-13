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

/**
 * Distance between the two antennae, in arena units.
 *
 * Small on purpose: it is the fly's real problem. A Drosophila's antennae are
 * a fraction of a millimetre apart and it still lateralises odour with them
 * (Gaudry/Hong/Wilson 2013) -- the concentration difference across that gap is
 * genuinely tiny, and the animal amplifies it. So does this: see `lateral()`,
 * which reports the difference as a scale-free RATIO rather than a raw
 * subtraction, exactly as LabBrain.readSteering does for the DNa01 pair.
 */
export const ANTENNA_SPAN = 0.3;

export class OlfactoryReceptors {
  constructor({ channels = OLFACTORY_CHANNELS, gain = 1.5, antennaSpan = ANTENNA_SPAN } = {}) {
    this.channels = [...channels];
    this.gain = gain;
    this.antennaSpan = antennaSpan;
    this.intensities = new Map(this.channels.map((c) => [c, 0]));
    // Previous sample per channel, so a scene can read whether the avatar is
    // moving up or down a gradient without tracking it itself.
    this.deltas = new Map(this.channels.map((c) => [c, 0]));
    // Per-antenna concentrations, filled in only when `sample` is given a
    // heading (see below). The whole point of keeping them apart is `lateral()`.
    this.left = new Map(this.channels.map((c) => [c, 0]));
    this.right = new Map(this.channels.map((c) => [c, 0]));
    this.bilateral = false;
  }

  /**
   * @param {ScentField} field  the lab's gradient field
   * @param {THREE.Vector3} position  avatar position
   * @param {{x:number, z:number}} [rightVector]  unit vector pointing to the
   *   fly's RIGHT (see Arena.renderEyes for the heading convention). Supply it
   *   and each channel is ALSO sampled at the two antenna positions, which is
   *   what makes directional smell possible. Omit it and this behaves exactly
   *   as it always did -- one sample, at one point, with no direction in it.
   */
  sample(field, position, rightVector = null) {
    const half = this.antennaSpan / 2;
    this.bilateral = !!rightVector;
    for (const channel of this.channels) {
      const value = field.sampleAt(channel, position) * this.gain;
      this.deltas.set(channel, value - this.intensities.get(channel));
      this.intensities.set(channel, value);

      if (rightVector) {
        // ScentField.sampleAt only reads .x/.y/.z, so a plain object is fine
        // here and saves allocating two Vector3s per channel per frame.
        this.left.set(channel, field.sampleAt(channel, {
          x: position.x - rightVector.x * half,
          y: position.y,
          z: position.z - rightVector.z * half,
        }) * this.gain);
        this.right.set(channel, field.sampleAt(channel, {
          x: position.x + rightVector.x * half,
          y: position.y,
          z: position.z + rightVector.z * half,
        }) * this.gain);
      }
    }
    return this.intensities;
  }

  /**
   * Directional smell, in [-1, 1]. POSITIVE MEANS TURN LEFT, matching the sign
   * convention of LabBrain.readSteering and of `yaw` itself (increasing yaw
   * turns left -- see Arena.renderEyes).
   *
   * Two things are deliberately kept separate here rather than summed into one
   * number the way `valence()` does it:
   *
   *   - the strongest ATTRACTIVE channel, which the fly should steer TOWARD
   *   - the strongest AVERSIVE channel, which it should lean AWAY from
   *
   * `valence()` adds them, and that is fine for "is anything worth reacting to
   * nearby", but it is actively wrong for steering: a sugar cube and a rot cube
   * whose plumes overlap cancel to zero, so the fly gets a dead patch exactly
   * where it most needs to make a choice. Handled as two separate terms it
   * instead does the sensible thing -- walk to the sugar, veering off the rot.
   *
   * The ratio (difference over sum) is what carries the direction; the raw
   * difference does not, because it scales with how close the source is.
   */
  lateral() {
    if (!this.bilateral) return 0;

    let attractive = null;
    let attractiveValue = 0;
    let aversive = null;
    let aversiveValue = 0;
    for (const [channel, value] of this.intensities) {
      if (AVERSIVE_CHANNELS.has(channel)) {
        if (value > aversiveValue) { aversiveValue = value; aversive = channel; }
      } else if (value > attractiveValue) { attractiveValue = value; attractive = channel; }
    }

    const ratio = (channel) => {
      if (!channel) return 0;
      const l = this.left.get(channel) ?? 0;
      const r = this.right.get(channel) ?? 0;
      const sum = l + r;
      return sum > 1e-9 ? (l - r) / sum : 0;
    };

    // Toward the good smell, away from the bad one -- hence the subtraction.
    const turn = ratio(attractive) - ratio(aversive);
    return turn < -1 ? -1 : turn > 1 ? 1 : turn;
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
