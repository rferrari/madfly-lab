# Guidelines for AI Agents working on `mad-fly-lab`

This framework exists so that you do not have to rebuild WebGL viewports, camera
rigs, compound retinas or brain visualizers to make something out of a real fly
connectome. Read this before changing anything.

---

## The one rule

**Build experiences in `scenes/`. Do not touch the infrastructure.**

| Layer | Path | May an agent edit it? |
|---|---|---|
| Scenes & experiences | `scenes/`, `experiences/` | **Yes — this is the work.** |
| Stations | `src/stations/` | Yes, to add new station types |
| Sensor math | `src/avatar/retina.js`, `motion.js` | Only when adding a new *hardware sensor* |
| WebGL pipeline | `src/core/arena.js`, `src/observer/` | **No** |
| Neural runtimes | `src/brain/` | **No** |
| Connectome access | `python/src/madfly_lab/connectome.py` | **No** — vendored, keep in sync upstream |

A new experience needs no framework changes at all. If you believe it does,
that is a signal the station API is missing something — say so rather than
reaching into `arena.js`.

---

## Writing a scene

```javascript
import { MadFlyLab, Station, Triggers } from 'mad-fly-lab';

const lab = new MadFlyLab({
  mode: 'pruned-subgraph',        // or 'full-connectome', or 'auto'
  canvas: '#app-canvas',
  circuit: 'courtship-and-foraging',
});

lab.addStation(new Station.SlotMachine({
  position: [3, 0, -2],
  lightBlinkHz: 12,
  onKick: () => lab.brain.injectCurrent('PAM11', +20),
}));

lab.brain.onSignal('DNp01', () => console.log('Giant Fiber — escape'));

await lab.start();
```

You get the arena, the avatar, both brain runtimes and the 3-panel HUD for free.

### Custom stations

Subclass `Station`. Return geometry from `build()`, animate in `update(dt, ctx)`.
Never reach into `ctx.lab.arena`; never touch `brain.runtime` directly.

```javascript
class MirrorBall extends Station {
  build() { return new THREE.Mesh(geo, mat); }         // your geometry
  update(dt, ctx) { this.object3D.rotation.y += dt; }  // your animation
}
```

Declare `scentType` / `scentRadius` in the constructor options and the framework
registers the gradient for you.

---

## Honesty rules — these are not negotiable

This project sits on real published connectome data. Overclaiming is the one
failure mode that makes the whole thing worthless.

1. **Never invent a neuron.** Every cell type you name must exist in
   `male-cns:v1.0`. `python/scripts/build_pack.py` fails the build if a declared
   channel resolves to zero real neurons — do not work around that check, fix
   the name. To find real types: `ConnectomeData.indices_of_type()` /
   `.indices_of_prefix()`.

2. **Never present engineered signals as measured ones.** The retina, the
   motion-opponency looming detector and the scent falloff are engineered image
   and geometry measurements. They *drive* real neurons; they are not models of
   phototransduction, LC4 physiology or receptor binding. Say so in comments
   where a reader might assume otherwise.

3. **Units.** Activations are dimensionless `tanh` values in `[-1, 1]`. They are
   not millivolts and not Hz. `injectCurrent('PAM11', +20)` keeps the spec's
   ergonomics but +20 is input current in this model's own scale. The HUD's
   "Hz" axis is a display convention this framework invented (see
   `HZ_PER_ACTIVATION`). Never write a comment or a label implying otherwise.

4. **Dynamics.** `a ← tanh(W·a + I)` is a rate model, not spiking neurons.
   There is no plasticity unless a scene adds it explicitly.

   Note the missing `dt` on the input term. The vendored lineage computes
   `tanh(W·a + I·dt)`, which makes a sustained input's steady state a function
   of the tick rate — measured, one drive gave DNp09 4.94e-3 at 20 Hz and
   8.41e-4 at 120 Hz. Those projects each ran one fixed rate so it never showed.
   Mode A ticks near 20 Hz and Mode B at 60 behind one API, so this framework
   drops the `dt` and decays pulses over a duration in seconds. Do not
   reintroduce it.

6. **Threshold on calibrated reads, never raw.** Raw activations span ~1,900×
   across channels of one pack and differ by orders of magnitude between Mode A
   and Mode B. `brain.readCalibrated()` divides by a per-channel reference
   **measured** at pack build time in the network's linear regime. `read()` is
   still there and still honest — just not comparable. If you add a channel,
   rebuild the pack so it gets calibrated; `build_pack.py` fails loudly if the
   reference drive has drifted out of the linear regime.

5. **Mock fallback must be loud.** `connectome.py` falls back to a synthetic
   mock graph without a NeuPrint token. Packs built from it are structurally
   valid and scientifically useless; `build_pack.py` prints a loud warning.
   Keep it loud.

---

## Heading convention — get this wrong and nothing tells you

```
forward = ( sin yaw, 0,  cos yaw)     // LabAvatar.velocity
right   = (-cos yaw, 0,  sin yaw)     // forward x up
```

A `THREE.PerspectiveCamera` looks down its **local −Z**, so `camera.rotation.y =
yaw` aims it at **−forward**. The eye cameras shipped that way, and the fly's
eyes faced backwards for the entire first implementation — nothing in the HUD,
the telemetry or the behaviour made it obvious. Eye cameras therefore use
`yaw + Math.PI + splay`.

A mesh's **local +Z** does map to forward under `rotation.y = yaw`, so station
and avatar front-faces are +Z. But mesh **local +X** maps to `−right`, i.e. the
fly's LEFT — the eye meshes were mirrored for the same reason.

If you touch any of this, verify numerically: `camera.getWorldDirection(v)`
dotted with forward must be positive. It was exactly `−1.00` before the fix.

## Two eyes, and why channel sides matter

Visual populations carry a real `somaSide` annotation and respond asymmetrically
(13×, measured). The avatar renders **two** eye cameras, splayed ±40°, each with
its own retina and looming detector, each driving its own real side
(`LPLC2_L` / `LPLC2_R`, `LC4_L` / `LC4_R`).

Do not "simplify" this back to one eye summed into both sides. That was the
original implementation and it made the fly walk in a straight line regardless
of what was in front of it, because the steering signal became a constant.

When you add a sensory channel, ask whether the real population has sides. If it
does, give each side its own channel. If it does not — the ORN glomeruli are all
annotated `?` in this dataset — inject symmetrically and say so.

## Working with connectome data

Packs are **not committed** — they are multi-megabyte binaries rebuilt from the
real connectome:

```bash
make packs                              # CACHE defaults to repo-local ./.cache
cd python && uv run python scripts/build_pack.py --all --cache-dir /path/to/connectome-cache
```

The `--cache-dir` (`CACHE=` for `make`) points at the ~80MB full-connectome
`.npz`, which also is not committed. Point it at an existing one (a sibling
project in this repo family, a teammate's) and it is used as-is, no fetch. With
nothing there yet, `connectome.py` fetches it live from NeuPrint instead, given
`NEUPRINT_TOKEN` — read from `.env` (see `.env.example`) or the shell
environment, loaded once by `connectome.py` itself via `python-dotenv`. Slow —
several minutes — and one-time; it caches to that directory for every run
after. No token and no cache: a loud mock-graph fallback, real enough to
exercise the pipeline, not real data.

### Adding a circuit

Edit `python/src/madfly_lab/circuits.py`, then rebuild. Keep Mode B packs inside
the spec's **300–8,600 neuron** band — tune `hops` / `top_k` rather than
shipping a 30MB pack. Above that band, the honest answer is Mode A, not a
bigger download. Mirror the new circuit in `CIRCUITS` in `src/index.js`.

### Why pruning is weighted

`male-cns` is a small-world graph: two *unweighted* hops from almost any seed
reaches ~75% of all 176k neurons, so naive N-hop reachability prunes nothing.
`prune.py` walks each neuron's top-K strongest real edges instead. Once the node
set is fixed, **every** real edge between kept nodes survives at its original
weight — top-K picks nodes, never drops edges.

### Why normalization is load-bearing

The raw real adjacency has a spectral radius near 2.7. At that value every
neuron saturates to ±1 within a few ticks and the readouts stop responding to
input entirely — the network looks alive and is actually deaf. Everything is
normalized to radius ≤ 0.9 with a −0.2 self-inhibition diagonal.

The cached **full** connectome is already normalized at fetch time. Never
normalize it twice: the second pass re-amplifies the weights and leaves Mode A
running measurably different dynamics from the Mode B packs. `is_normalized()`
in `connectome.py` guards this. Pruned subgraphs *are* renormalized, on purpose
— a slice is a different network and needs its own scaling.

---

## CPU and GPU

Mode A runs on CPU (scipy) or GPU (cupy). `LabBrainRuntime` is written once
against `backend.xp`, since cupy's sparse API matches scipy's — there is no
second code path, and there should not be one.

`device="auto"` is the default and the right one. Do **not** make `"gpu"` the
default: a missing driver, a busy device or too little VRAM would become a crash
on a machine where CPU would have worked.

Two rules if you touch `device.py`:

1. **Probe with the operation you actually use.** The GPU probe runs a real
   sparse mat-vec plus `tanh`. A dense `cp.zeros(8).sum()` is not enough — a
   cupy install missing `libcusparse` passes that and then throws on the first
   real step, so `auto` selects the GPU and crashes instead of falling back.
   That happened; the probe exists because of it.
2. **Synchronize before timing.** CuPy launches are asynchronous, so an unsynced
   benchmark measures the launch, not the work.

## Behavioural gates: phasic, never absolute

No channel in this network is ever silent — every sensory population is being
driven by something, so everything has a nonzero resting level. An absolute
threshold on a real channel is therefore a bug waiting to happen, and it has
already happened twice here:

- `DNa01` rests asymmetric (0.1369 / 0.1530), so a raw left-minus-right curved
  the fly permanently in one direction.
- `DNp06` rests around 0.37, so a 0.36 "is it feeding?" gate froze the fly in a
  permanent meal in an empty arena at zero speed.

Use `brain.readSteering()` and `brain.readPhasic()` for anything that drives
behaviour. Both subtract a slowly-adapting baseline, so the question becomes
*"did this go up"* rather than *"is this big"*. `readCalibrated()` is right for
display and for comparing channels; raw `read()` is right when you want the
honest number and nothing else.

## Genotypes and lesions

`lab.mintNewFly(spec)` builds a fly to order — see `src/avatar/genotype.js`.

A lesion holds a population's activation at zero while leaving it wired in
place. That is deliberate and it is the whole point: deleting the neurons would
also delete every path that merely travels THROUGH them, which is a different
and wrong experiment. Everything downstream then responds to the absence through
the real connectivity.

`mintFly()` (colours, name, scale) must stay strictly cosmetic. Never let an
appearance knob change behaviour — a "different fly" that might also think
differently would be a lie about what this framework does. The knob that
genuinely varies a run is `noise`, and it is kept separate for that reason.

## Where engineered behaviour is allowed to live

Two behaviours are NOT read from the connectome, and both are placed at the
body rather than in the brain, on purpose:

- **Chemotaxis** (klinokinesis). The ORN populations carry no left/right soma
  annotation, so no bilateral odour comparison exists to read.
- **Spontaneous locomotion.** Real flies walk in the dark; this graph has no
  central pattern generator, and vision supplies essentially all of DNp09's
  drive (0.428 vs 0.005 for smell), so a blind fly would otherwise stand still.

Do not "fix" either by injecting a tonic current into the readout neuron.
DNp09 is two neurons wide with a tiny calibration reference — a drive of 0.05
saturates it to 50x — so driving it directly does not compute an answer, it
SETS one, and every downstream reading becomes meaningless. Engineered
behaviour belongs after the brain, where it is visible as engineering.

Anything engineered must also respect lesions: spontaneous drive is suppressed
when DNp09 is silenced, or `paralysed` would still walk.

A third: **Room 2's leg gestures** (`src/avatar/leg-rig.js`). A tap/sweep/kick
is a scripted animation triggered by whatever decided the action (a QReadout,
in the blackjack example) -- this framework has no nerve cord, so there is
nothing downstream of a descending neuron to animate a joint from. Same rule
as the other two: don't fake it by wiring a leg to a motor neuron directly.

## Room 2 (tethered rig): keep the loop task-agnostic

`src/training/training-loop.js` must stay ignorant of any specific task. It
takes a plain `{start, step, state, encodeState, describe}` object (see the
file's own docstring) and knows nothing about cards, mazes, or anything else.
If you add a new tethered task, its game rules and its stimulus→real-ORN
encoding belong in `experiences/<task>/`, not in `src/training/`, the same way
`experiences/blackjack/` is entirely blackjack and `src/training/q-learning.js`
has never heard of a card. A generalization that leaks task-specific logic
into `TrainingLoop` defeats the point of having it be a framework primitive.

`QReadout`'s features come from real, calibrated DN channels, chosen per task
(blackjack reads `DNa01_L/R`, `DNp03`, `DNp13`). Pick channels for what a
scene's decision is actually downstream of; there's no fixed "correct" set.

## Before you call it done

```bash
make check                    # 43 tests + production build
```

Tests cover pack format, dynamics, calibration, sensors and stations — and
assert that every circuit ships the complete sensory/motor core, so a circuit
can never again silently produce a fly that cannot move.

Tests run against **real generated packs**, not fixtures. If packs are missing
the suite skips with a message rather than passing vacuously — a green run that
tested nothing is worse than a red one. Keep that property.

---

## Attribution — one hard requirement

`src/avatar/retina.js` and `src/avatar/motion.js` are ports of **duckfly**
(Apache-2.0, third-party, original author Anoop). Apache-2.0 §4(b)/(d) requires
retaining that attribution in derivative works, so the duckfly entry in
THIRD_PARTY_NOTICES.md is a **licence obligation, not a courtesy**. Do not
remove it while that code is here.

Everything else with a lineage came from this author's own earlier, unreleased
simulations. Those are private, so they are referred to generically rather than
by repository name — a public reader cannot follow a link to them anyway.

## Data provenance

Packs derive from the **MaleCNS v1.0** connectome, **CC BY 4.0** — FlyEM/HHMI
Janelia, University of Cambridge, MRC Laboratory of Molecular Biology, and
Google Research. Attribution ships inside every `.mflpack` header
(`license`, `citation`).
