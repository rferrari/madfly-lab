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

/**
 * Plain-language gloss for every population a genotype can silence.
 *
 * The HUD used to report a lesion as its raw cell names -- "lesion: LC4, LC4_L,
 * LC4_R" -- which says nothing at all unless you already know the fly visual
 * system. These are deliberately written for someone who does not: what the
 * cells DO, in behavioural terms, so "what does this lesion actually change?"
 * is answerable from the screen.
 *
 * Where a real cell type is driven here in a specific way, that is said plainly
 * rather than glossed over -- LPLC1/LPLC2 are genuinely loom-sensitive cells in
 * the animal, but this sim feeds them each eye's brightness, and pretending
 * otherwise would be teaching the wrong thing.
 */
export const CHANNEL_GLOSSARY = {
  LC4: 'looming detector — fires when something rushes at her',
  LPLC1: 'visual projection neuron — fed this eye\'s brightness here',
  LPLC2: 'visual projection neuron — the real loom path to the Giant Fiber',
  DNp01: 'the Giant Fiber — one command neuron; when it fires, she flees',
  DNp03: 'a descending turn-and-escape command neuron',
  DNp09: 'the "walk forward" command neuron',
  DNa01: 'the steering command neuron — left minus right is which way she turns',
  DNp06: 'the "stop and eat" command neuron',
  DNp13: 'the copulation-attempt command neuron',
  ORN_DM1: 'smell receptor for one food odour',
  ORN_VA6: 'smell receptor for a second, different food odour',
  ORN_DA1: 'smell receptor for cVA, the pheromone she finds a mate by',
  ORN_DA2: 'smell receptor for geosmin — the mould smell flies avoid',
  ORN_V: 'smell receptor for CO2, which is what rotting matter gives off',
  touch: 'the body-wide touch cells — what a poke drives',
  taste: 'the taste cells that tell her there is food in her mouth',
  wind: 'Johnston\'s organ, in the antenna — feels airflow',
  PAM11: 'dopamine cells carrying REWARD',
  PPL1: 'dopamine cells carrying PUNISHMENT',
};

/** One channel, explained. Falls back to the bare name for anything unlisted. */
export function explainChannel(name) {
  const side = name.endsWith('_L') ? ' (left side)' : name.endsWith('_R') ? ' (right side)' : '';
  const gloss = CHANNEL_GLOSSARY[name.replace(/_[LR]$/, '')];
  return gloss ? `${name}${side} — ${gloss}` : name;
}

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
    description: preset?.description ?? null,
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

/**
 * The same genotype, spelled out for someone who does not know the cell types
 * -- what has been switched off and what that means she can no longer do.
 *
 * `describeGenotype` stays the terse one-liner for logs and console output;
 * this is the version for anyone actually trying to read the experiment.
 *
 * @returns {{headline: string, effects: string[]}}
 */
export function explainGenotype(g) {
  if (!g) return { headline: 'wild type', effects: [] };
  const effects = [];
  if (!g.vision) effects.push('eyes removed entirely — she navigates on smell and touch alone');
  for (const channel of g.silence) effects.push(explainChannel(channel));
  if (g.circuit) effects.push(`running the ${g.circuit} circuit`);
  if (g.mode === 'full-connectome') effects.push('every neuron in the dataset, via the Mode A server');

  const headline = g.description
    ?? (effects.length ? `${effects.length} population${effects.length === 1 ? '' : 's'} silenced` : 'Everything intact.');
  return { headline, effects };
}
