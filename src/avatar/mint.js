/**
 * Mint a fly -- a deterministic cosmetic identity from a seed.
 *
 * Purely appearance: colours, a name, a pattern. It does NOT vary the
 * connectome, the weights, or any parameter that affects behaviour. Two flies
 * minted from different seeds run exactly the same real neurons. That line
 * matters -- a "different fly" that looked like it might think differently
 * would be a lie about what this framework does.
 *
 * The one genuinely non-cosmetic knob is `noise`, which a scene may pass to the
 * brain separately: the same real weight matrix started from a different real
 * initial condition. That is a real difference, and it is deliberately not
 * bundled in here.
 */

import { THEME } from '../core/theme.js';

const GENUS = ['Musca', 'Drosophila', 'Calliphora', 'Sarcophaga', 'Lucilia', 'Eristalis'];
const EPITHET = [
  'insanis', 'neon', 'volt', 'turbo', 'gremlin', 'havoc', 'jitter', 'spark',
  'quasar', 'fuzz', 'static', 'rascal', 'zap', 'mayhem', 'vortex', 'bandit',
];
const TITLE = ['Prof.', 'Dr.', 'Lab-', 'Sgt.', 'Capt.', 'Mx.'];

// Hue anchors drawn from the lab's own palette, so a minted fly always looks
// like it belongs in this lab rather than like a random hue.
const PALETTE = [THEME.cyan, THEME.magenta, THEME.amber, THEME.lime, THEME.violet, 0xff5edb, 0x5effd0];

/** Small deterministic PRNG (FNV-1a seed + LCG), so a seed always mints the
 *  same fly -- shareable, reproducible, and testable. */
function seeded(label) {
  let state = 2166136261;
  for (const ch of String(label)) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function mintFly(seed = Date.now().toString(36)) {
  const rand = seeded(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const body = pick(PALETTE);
  let accent = pick(PALETTE);
  if (accent === body) accent = PALETTE[(PALETTE.indexOf(body) + 3) % PALETTE.length];

  return {
    seed,
    name: `${pick(TITLE)} ${pick(GENUS).slice(0, 4)}. ${pick(EPITHET)}`,
    body,
    accent,
    eye: pick([THEME.amber, 0xff4d4d, 0xffd23d, 0xff7ad9]),
    // Cosmetic scale wobble, deliberately tiny: big enough to tell two flies
    // apart at a glance, small enough not to change how it reads the arena
    // (the eye cameras and retina map are untouched).
    scale: 0.9 + rand() * 0.25,
    glow: 0.5 + rand() * 1.4,
  };
}
