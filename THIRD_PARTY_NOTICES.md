# Third-party notices

## Connectome data — MaleCNS v1.0

Every `.mflpack` this project generates is derived from the **MaleCNS v1.0**
public connectome, licensed **CC BY 4.0**.

Attribute the MaleCNS collaboration: FlyEM/HHMI Janelia, University of
Cambridge, MRC Laboratory of Molecular Biology, and Google Research.
<https://male-cns.janelia.org/>

Every pack carries `license` and `citation` fields in its header, so
attribution travels with the data rather than only with this repository.

**Deliberately not used:** the FlyWire-derived assets (`circuit.json`,
`brain_points.json`) in the sibling `duckfly` project, which are CC BY-NC 4.0.
Sticking to MaleCNS means nothing this framework generates carries a
non-commercial restriction. Do not introduce FlyWire-derived data without
flagging the license change.

## Vendored code

### `duckfly` — Apache-2.0

`src/avatar/retina.js` is ported from duckfly's `shared/vision/retina.js`
(hexagonal ommatidial map and bilinear frame sampler). `src/avatar/motion.js` is
ported from `shared/vision/motion.js` (Lucas-Kanade normal flow with four-sector
radial expansion opponency). Both were generalized off duckfly's fixed 96×64
radius-15 configuration into constructor parameters, and `retina.js` gained
precomputed projection taps and `fovForRetina`.

### `fly_speed_dating` / `fly_simulation` — same repo family

`python/src/madfly_lab/connectome.py` is vendored from
`fly_speed_dating/backend/src/fly_speed_dating_backend/connectome.py`, itself
vendored from `fly_simulation/connectome.py`. Framework additions are marked
`# madfly-lab:` in that file: generic cell-type lookup (`indices_of_type`,
`indices_of_prefix`, `resolve_channel`), induced-subgraph extraction
(`subgraph`), and the `is_normalized` guard.

`python/src/madfly_lab/prune.py` generalizes
`fly_speed_dating/backend/scripts/build_pruned_cache.py` from one hardcoded
courtship seed set to any circuit.

`python/src/madfly_lab/brain.py` generalizes the `NeuralBridge` lineage running
in `fly_simulation_3d` → `fly_drone_delivery` → `fly_speed_dating`. The
`tanh(W·a + I·dt)` dynamics are unchanged; input and readout became
dictionary-driven so a scene can name its own channels.

Keep vendored files in sync with upstream manually. They are copies, not
dependencies, so that this project installs and deploys standalone — the same
reason those projects vendored from each other.

## Runtime dependencies

**Three.js** 0.176.x (MIT) — bundled; versions locked in `package-lock.json`.
**NumPy**, **SciPy**, **pandas**, **websockets**, **python-dotenv** — see
`python/pyproject.toml`. **neuprint-python** (optional) is needed only to *fetch*
a connectome; building packs from an existing cache does not require it.

## Citations

- Dorkenwald, S. et al. *Neuronal wiring diagram of an adult brain.*
  Nature **634**, 124–138 (2024). <https://doi.org/10.1038/s41586-024-07558-y>
- Schlegel, P. et al. *Whole-brain annotation and multi-connectome cell typing of
  Drosophila.* Nature **634**, 139–152 (2024).
  <https://doi.org/10.1038/s41586-024-07686-5>
- Bidaye, S. S. et al. *Two brain pathways initiate distinct forward walking
  programs in Drosophila.* Neuron **108**, 469–485 (2020) — `DNp09`.
