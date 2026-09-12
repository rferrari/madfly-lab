# Guidelines for AI Agents working on `mad-fly-lab`

This framework exists so that you do not have to rebuild WebGL viewports, camera
rigs, compound retinas or brain visualizers to make something out of a real fly
connectome. Read this before changing anything.

---

## The one rule

**Build experiences in `scenes/`. Do not touch the infrastructure.**

| Layer | Path | May an agent edit it? |
|---|---|---|
| Scenes & experiences | `scenes/`, `examples/` | **Yes — this is the work.** |
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

## Working with connectome data

Packs are **not committed** — they are multi-megabyte binaries rebuilt from the
real connectome:

```bash
cd python
uv run python scripts/build_pack.py --all --cache-dir ../../fly_simulation/.cache
```

The `--cache-dir` points at the ~80MB full-connectome `.npz`, which also is not
committed. Any sibling project in this repo family has one; otherwise set
`NEUPRINT_TOKEN` and let `connectome.py` fetch it (slow — minutes).

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

## Before you call it done

```bash
npm test                      # 36 tests: pack format, dynamics, sensors, stations
npx vite build                # whole module graph compiles
```

Tests run against **real generated packs**, not fixtures. If packs are missing
the suite skips with a message rather than passing vacuously — a green run that
tested nothing is worse than a red one. Keep that property.

---

## Data provenance

Packs derive from the **MaleCNS v1.0** connectome, **CC BY 4.0** — FlyEM/HHMI
Janelia, University of Cambridge, MRC Laboratory of Molecular Biology, and
Google Research. Attribution ships inside every `.mflpack` header
(`license`, `citation`).

Deliberately *not* used: the FlyWire-derived assets in the sibling `duckfly`
project, which are CC BY-NC 4.0. Keeping to MaleCNS means nothing this framework
generates carries a non-commercial restriction. Do not introduce FlyWire-derived
data without flagging the license change.
