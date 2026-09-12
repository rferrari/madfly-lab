/**
 * Circuits the framework ships browser packs for.
 *
 * Mirrors python/src/madfly_lab/circuits.py -- that file is the source of
 * truth for what each circuit CONTAINS; this one exists so the JS side can
 * enumerate and describe them without loading every pack.
 *
 * EVERY circuit contains the same sensory and motor CORE -- two eyes, four
 * glomeruli, taste, touch, and the full descending motor set including
 * feeding. Circuits differ by what they add DEPTH to, never by what they are
 * missing, because a circuit missing part of the core produces a fly that
 * cannot function and fails silently: the dopamine circuit originally had no
 * visual channels, so the fly simply stood still with no error anywhere.
 */
export const CIRCUITS = {
  'courtship-and-foraging': {
    label: 'Courtship & foraging',
    neurons: 6748,
    description: 'The default. Core plus the pC1/aSP courtship hub, DNp13 '
      + '(copulation attempt) and the dopaminergic populations.',
  },
  'escape-and-steering': {
    label: 'Escape & steering',
    neurons: 5833,
    description: 'Core with depth on the looming-to-escape pathway: '
      + 'LC4/LPLC1/LPLC2 into DNp01 (Giant Fiber) and DNp03.',
  },
  'dopamine-mushroom-body': {
    label: 'Dopamine & mushroom body',
    neurons: 6378,
    description: 'Core plus the learning substrate: ORN into Kenyon cells into '
      + 'MBON, modulated by real PAM (reward) and PPL1 (punishment) neurons.',
  },
  full: {
    label: 'Full connectome',
    neurons: 176422,
    // Not a pack: Mode A. Measured, a browser pack of the whole graph would be
    // ~58MB gzipped and step in ~186ms (5.4 Hz) -- the JS CSR runtime costs
    // ~7.2 ns per edge and there are 25,739,518 of them. The same graph on a
    // GTX 1650 through the Mode A server steps in 3.23ms (309 Hz).
    modeA: true,
    description: 'Every real neuron: 176,422 cells and 25.7M synapses, run by '
      + 'the Mode A server (GPU if available). Needs `npm run brain:full`.',
  },
  minimal: {
    label: 'Minimal',
    neurons: 5422,
    description: 'The smallest COMPLETE fly: the full sensory and motor core '
      + 'and nothing else. Sees, smells, tastes, feels, walks, escapes and '
      + 'feeds -- but has no mushroom body or courtship hub, so it cannot '
      + 'learn or court.',
  },
};
