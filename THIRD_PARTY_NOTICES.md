# Third-party notices

## Connectome data — MaleCNS v1.0

Every `.mflpack` this project generates is derived from the **MaleCNS v1.0**
public connectome, licensed **CC BY 4.0**.

Attribute the MaleCNS collaboration: FlyEM/HHMI Janelia, University of
Cambridge, MRC Laboratory of Molecular Biology, and Google Research.
<https://male-cns.janelia.org/>

Every pack carries `license` and `citation` fields in its header, so
attribution travels with the data rather than only with this repository.

**Deliberately not used:** FlyWire-derived connectome assets, which are
CC BY-NC 4.0. Sticking to MaleCNS means nothing this framework generates
carries a non-commercial restriction. Do not introduce FlyWire-derived data
without flagging the license change.

## Vendored code

### `duckfly` — Apache-2.0 — ATTRIBUTION REQUIRED, DO NOT REMOVE

This one is a licence obligation, not a courtesy. duckfly is a third-party
Apache-2.0 project (original author Anoop; the checkout here is a fork), and
Apache-2.0 §4(b)/(d) requires retaining attribution in derivative works. The
two files below are ports of duckfly's own source, not of anything duckfly
itself vendored.

`src/avatar/retina.js` is ported from duckfly's `shared/vision/retina.js`
(hexagonal ommatidial map and bilinear frame sampler). `src/avatar/motion.js` is
ported from `shared/vision/motion.js` (Lucas-Kanade normal flow with four-sector
radial expansion opponency). Both were generalized off duckfly's fixed 96×64
radius-15 configuration into constructor parameters, and `retina.js` gained
precomputed projection taps and `fovForRetina`.

### Earlier in-house simulations — unpublished, same author

`python/src/madfly_lab/connectome.py`, `prune.py` and `brain.py` began as code
from this author's earlier, unreleased Drosophila simulations. Those are not
public repositories, so they are not cited by name and nothing here depends on
them — the files are copies, and this project installs and deploys standalone.

Framework additions to `connectome.py` are marked `# madfly-lab:` in the file
itself: generic cell-type lookup (`indices_of_type`, `indices_of_prefix`,
`resolve_channel`, `indices_of_class`), induced-subgraph extraction
(`subgraph`), and the `is_normalized` guard.

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
