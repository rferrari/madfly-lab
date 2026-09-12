/**
 * Fly genotypes -- build a fly to spec before spawning it.
 *
 * A genotype says what this fly IS, as opposed to `mintFly`'s identity, which
 * says only what it looks like. The distinction is load-bearing: colours must
 * never imply a different brain, so anything that changes behaviour lives here
 * and nothing here is cosmetic.
 *
 *     lab.mintNewFly({ preset: 'blind' })
 *     lab.mintNewFly({ vision: false, silence: ['LC4'] })
 *     lab.mintNewFly({ circuit: 'escape-and-steering' })
 *
 * WHAT A LESION MEANS HERE. `silence` holds a population's activation at zero
 * every tick. The cells stay in the graph and stay wired to everything they are
 * really wired to; they simply stop contributing. That is the computational
 * analogue of a null mutant or an optogenetic silencer, and it is why a
 * lesioned fly still behaves like a fly with a real brain missing one part,
 * rather than like a fly with a hole cut out of its connectome.
 *
 * Deleting the neurons would be a different and wrong experiment: it would also
 * remove every path that merely travels through them.
 */

/** Named genotypes. Each is a plain spec -- nothing magic. */
export const PRESETS = {
  'wild-type': {
    label: 'Wild type',
    description: 'Everything intact.',
    spec: {},
  },
  blind: {
    label: 'Blind',
    description: 'No eyes at all. Olfaction and touch only.',
    spec: { vision: false },
  },
  'motion-blind': {
    label: 'Motion blind',
    description: 'Eyes work, looming detectors lesioned — sees, cannot dodge.',
    spec: { silence: ['LC4', 'LC4_L', 'LC4_R'] },
  },
  'left-eye-only': {
    label: 'Left eye only',
    description: 'Right visual populations lesioned. Expect a turning bias.',
    spec: { silence: ['LPLC1_R', 'LPLC2_R', 'LC4_R'] },
  },
  anosmic: {
    label: 'Anosmic',
    description: 'No sense of smell — every ORN glomerulus lesioned.',
    spec: { silence: ['ORN_DM1', 'ORN_VA6', 'ORN_DA1', 'ORN_DA2'] },
  },
  numb: {
    label: 'Numb',
    description: 'Tactile population lesioned. Poking does nothing.',
    spec: { silence: ['touch'] },
  },
  'no-escape': {
    label: 'No escape',
    description: 'Giant Fiber lesioned — sees the threat, will not flee.',
    spec: { silence: ['DNp01', 'DNp01_L', 'DNp01_R'] },
  },
  paralysed: {
    label: 'Paralysed',
    description: 'All descending motor neurons lesioned. Brain runs, body does not.',
    spec: { silence: ['DNp09', 'DNa01', 'DNa01_L', 'DNa01_R', 'DNp03'] },
  },
  'whole-brain': {
    label: 'Whole brain',
    description: 'All 176,422 real neurons via the Mode A server.',
    spec: { mode: 'full-connectome' },
  },
};

/**
 * Normalize a spec. Accepts a preset name, a preset key in `preset`, or a raw
 * object; returns a complete genotype.
 */
export function resolveGenotype(spec = {}) {
  if (typeof spec === 'string') spec = { preset: spec };
  const preset = spec.preset ? PRESETS[spec.preset] : null;
  if (spec.preset && !preset) {
    throw new Error(`[MadFlyLab] unknown genotype preset "${spec.preset}". `
      + `Known: ${Object.keys(PRESETS).join(', ')}`);
  }
  const base = preset ? preset.spec : {};
  const merged = { ...base, ...spec };

  return {
    preset: spec.preset ?? null,
    label: preset?.label ?? (spec.label ?? 'Custom'),
    vision: merged.vision !== false,
    silence: [...new Set(merged.silence ?? [])],
    circuit: merged.circuit ?? null,
    mode: merged.mode ?? null,
    noise: merged.noise,
    seed: merged.seed ?? null,
  };
}

/** One-line human summary, for the HUD. */
export function describeGenotype(g) {
  const parts = [];
  if (!g.vision) parts.push('blind');
  if (g.silence.length) parts.push(`lesion: ${g.silence.join(', ')}`);
  if (g.circuit) parts.push(g.circuit);
  if (g.mode) parts.push(g.mode);
  return parts.length ? parts.join(' · ') : 'wild type';
}
