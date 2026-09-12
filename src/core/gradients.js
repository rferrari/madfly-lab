/**
 * Spatial Gradients -- the arena's 3D scent field (spec 2, "Spatial Gradients").
 *
 * Stations emit; the avatar's olfactory receptors sample. Emitters are keyed by
 * ORN channel name, so a FoodBowl emitting on 'ORN_VA6' and a mate emitting on
 * 'ORN_DA1' drive genuinely different real glomerulus populations rather than
 * one generic "smell" scalar.
 *
 * Falloff is 1/(1 + d/attenuation) clipped at the emitter's radius -- the same
 * attenuation curve the sibling projects' sensing code uses, kept identical so
 * a scene ported between them behaves the same way.
 */

export class ScentField {
  constructor() {
    /** @type {Map<string, Set<object>>} channel -> emitters */
    this.emitters = new Map();
  }

  /**
   * @param {string} channel  an ORN channel, e.g. 'ORN_VA6'
   * @param {object} emitter  { position: Vector3-like, radius, strength }
   * @returns {Function} removal handle
   */
  emit(channel, emitter) {
    if (!this.emitters.has(channel)) this.emitters.set(channel, new Set());
    this.emitters.get(channel).add(emitter);
    return () => this.emitters.get(channel)?.delete(emitter);
  }

  /** Summed, saturating concentration of `channel` at `position`, in [0, 1]. */
  sampleAt(channel, position) {
    const set = this.emitters.get(channel);
    if (!set || set.size === 0) return 0;
    let total = 0;
    for (const e of set) {
      if (e.enabled === false) continue;
      const p = e.position;
      const d = Math.hypot(position.x - p.x, position.y - p.y, position.z - p.z);
      const radius = e.radius ?? 5;
      if (d > radius) continue;
      const attenuation = radius / 3;
      total += (e.strength ?? 1) * (1 / (1 + d / attenuation)) * (1 - d / radius);
    }
    // Saturating rather than clipping: two overlapping bowls smell stronger
    // than one, but never unboundedly so.
    return total <= 0 ? 0 : total / (1 + total);
  }

  channels() { return [...this.emitters.keys()]; }

  clear() { this.emitters.clear(); }
}
