# Room 2 blackjack training — findings (2026-09-12)

Baseline data point, so a future run (different feature set, different reward
shaping, a different task entirely) has something concrete to compare against.
Raw run data: `blackjack-run-2026-09-12.json` (same folder).

## Setup

- Real pack: `courtship.mflpack` (7,337 real neurons, 430,441 real synaptic
  edges, male-cns:v1.0), driven headlessly through the exact production
  `TrainingLoop`/`QReadout`/`BlackjackTask` code (`src/training/`,
  `experiences/blackjack/`) — no browser, no scene, just the real connectome
  dynamics and the real game rules.
- Feature channels (the Q-readout's only inputs): `DNa01_L`, `DNa01_R`,
  `DNp03`, `DNp13` — all real, calibrated DN reads.
- Reward pulses: `PAM11` on a win, `PPL1` on a loss (the framework's default,
  `TrainingLoop`'s `rewardChannels`).
- Hyperparameters: `alpha=0.05, gamma=0.95, epsilon=0.15` (the same defaults
  `experiences/blackjack/tethered-scene.js` ships with).
- 1,500 episodes/seed, 2 seeds (1, 2). Short run — enough to see whether the
  policy converges and to what, not a rigorous statistical sweep.

## Honest baselines (measured, not textbook), 5,000-episode Monte Carlo
against the framework's own `Hand` rules (infinite deck, dealer stands ≥17):

| policy | win rate |
|---|---|
| always hit until bust/21 | 16.1% |
| **always stand** | **38.1%** |
| simple basic strategy (hit hard <17, hit soft <18) | 41.5% |

## What the Q-readout learned

| seed | episode 75 | 375 | 675 | 975 | 1275 | final (1500) |
|---|---|---|---|---|---|---|
| 1 | 29.3% | 38.9% | 37.2% | 36.3% | 35.9% | 36.1% |
| 2 | 34.7% | 38.9% | 39.1% | 36.9% | 37.1% | 37.5% |

Both seeds rise quickly in the first ~300-400 episodes, peak around 38-39%,
then drift slightly *down* and flatten around 36-37% for the remaining
~1,100 episodes — no further improvement, and if anything a mild decline off
the early peak.

Greedy policy at 5 canonical states, sampled at the end of training (both
seeds agree on every one):

| state | textbook action | learned (greedy) |
|---|---|---|
| hard 16 vs dealer 10 | HIT | **STAND** |
| hard 12 vs dealer 4 | STAND | STAND |
| soft 18 vs dealer 6 | STAND/double | STAND |
| hard 20 vs dealer 10 | STAND | STAND |
| hard 8 vs dealer 5 | HIT | **STAND** |

The readout converged to **always stand, regardless of state** — it never
learned to distinguish "hard 8" from "hard 20." Its final success rate
(36-37%) sits almost exactly on the measured always-stand baseline (38.1%),
not anywhere near basic strategy (41.5%).

## Reading this honestly

This matches what `src/training/training-loop.js`'s own header comment
already says up front: this connectome has no synaptic plasticity, so it is a
fixed, real feature extractor, not something that learns the task. The
`DNa01`/`DNp03`/`DNp13` reads apparently don't carry enough
state-discriminating signal (player total, dealer upcard, soft/hard) for a
linear TD readout to beat "always stand" — it found a locally-good degenerate
policy and stuck there. This mirrors the NeuroMechFly blackjack demo this
room was modeled on, which reported the same outcome with its own connectome.

Not a bug: the pipeline (real DN reads → TD update → epsilon-greedy action →
real dopamine/aversive pulse) all worked exactly as designed and is unit-
tested (`tests/blackjack.test.js`, `tests/q-learning.test.js`). This is a
finding about what these four real channels do and don't carry, not a defect
in the loop.

## Ideas for a comparison run later

- Different/more feature channels (the current four are a small, somewhat
  arbitrary slice; a wider or differently-chosen set might carry more signal).
- Longer run + a decaying epsilon, to rule out "still exploring" as the cause
  of the post-peak dip.
- A non-linear or wider function approximator in place of the single linear
  `QReadout`, to see if the ceiling is the readout, not the features.
- The same harness against a *different* circuit's descending neurons, to see
  if some other real DN set happens to carry more task-relevant signal than
  `DNa01`/`DNp03`/`DNp13` do.
