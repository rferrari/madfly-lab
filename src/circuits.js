/**
 * Circuits the framework ships browser packs for.
 *
 * Mirrors python/src/madfly_lab/circuits.py -- that file is the source of
 * truth for what each circuit CONTAINS; this one exists so the JS side can
 * enumerate and describe them without loading every pack.
 *
 * A circuit is just a declaration of which real cell populations get pruned
 * into a pack. Swapping circuits swaps which parts of the fly's brain are
 * present, not how any of them work.
 */
export const CIRCUITS = {
  'courtship-and-foraging': {
    label: 'Courtship & foraging',
    neurons: 6748,
    description: 'The default, and the broadest: pheromone (DA1/DA2) and food '
      + 'odour (DM1/VA6) in, plus vision, taste, touch and dopamine; out to '
      + 'DNp13 (copulation), DNa01 (steering), DNp09 (walking), DNp06 (feeding).',
  },
  'escape-and-steering': {
    label: 'Escape & steering',
    neurons: 4173,
    description: 'Looming vision to escape: LC4/LPLC1/LPLC2 -> DNp01 (Giant '
      + 'Fiber), DNp03, DNa01, DNp09. The smallest circuit that dodges and walks.',
  },
  'dopamine-mushroom-body': {
    label: 'Dopamine & mushroom body',
    neurons: 7638,
    description: 'The learning substrate: ORN -> Kenyon cells -> MBON, modulated '
      + 'by real PAM (reward) and PPL1 (punishment) dopaminergic neurons.',
  },
  minimal: {
    label: 'Minimal',
    neurons: 715,
    description: 'Looming in, steering out, nothing else. Smoke tests, and '
      + 'embedding a fly brain in something that is not a fly.',
  },
};
