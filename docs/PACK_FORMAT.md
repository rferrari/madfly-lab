# `.mflpack` — the browser pack format

One pruned real subgraph in a single binary file. Written by
`python/src/madfly_lab/pack.py`, read by `src/brain/pack-loader.js`.

## Layout

```
offset  size        contents
0       8           magic, ASCII "MFLPACK1"
8       4           uint32 LE headerLen
12      headerLen   UTF-8 JSON header
…       pad         zeros to the next 8-byte boundary
…       rest        typed-array blobs, located by header.arrays
```

Everything numeric lives in the blob region as native little-endian typed
arrays, so the browser hands them straight to `new Float32Array(buffer, off, n)`
with zero parsing and zero copying. The JSON header holds only genuinely
string-shaped data: cell-type names, channel membership, provenance, dynamics
constants.

Arrays are 8-byte aligned so a `Float64Array` view stays legal if the format
ever grows one.

## Blobs

| Name | dtype | Length | Meaning |
|---|---|--:|---|
| `adj_indptr` | int32 | n+1 | CSR row pointers |
| `adj_indices` | int32 | nnz | CSR column indices (sources) |
| `adj_data` | float32 | nnz | synaptic weights, **pre-normalized** |
| `soma_xyz` | float32 | 3n | soma position, centred + unit-scaled |
| `soma_valid` | uint8 | n | 0 where the dataset has no soma coordinate |
| `type_idx` | int32 | n | index into `header.typeNames` |
| `side_idx` | uint8 | n | index into `header.sideNames` (`L`/`R`/`M`/`?`) |
| `body_ids` | float64 | n | real NeuPrint body IDs |
| `ch:<name>` | int32 | varies | one array per channel: neuron indices |

Rows are targets and columns are sources, matching `W @ activations`.

`body_ids` is float64 rather than int64 because NeuPrint body IDs (~7.2e17)
exceed `Number.MAX_SAFE_INTEGER`. float64 holds them exactly up to 2^53 and
approximately above it; they are carried for provenance and lookup against
NeuPrint, never used as array indices. Use `BigInt64Array` if you need exact
round-tripping.

## Header

```jsonc
{
  "format": "mflpack", "version": 1, "built": "2026-09-12T…Z",
  "dataset": "male-cns:v1.0", "source": "real_full",
  "license": "CC BY 4.0", "citation": "MaleCNS v1.0 …",
  "circuit": { "name": "courtship-and-foraging", "description": "…",
               "hops": 2, "topK": 5 },
  "nNeurons": 7922, "nEdges": 1383699,
  "dynamics": { "activation": "tanh", "selfInhibition": -0.2,
                "targetSpectralRadius": 0.9, "preNormalized": true },
  "soma": { "units": "normalized",
            "inverse": { "center": [x,y,z], "scale": s },
            "note": "original = normalized * scale + center, in male-cns units" },
  "typeNames": ["DNa01", "LC4a", "LPLC2", …],
  "sideNames": ["?", "L", "M", "R"],
  "channels": { "PAM11": { "array": "ch:PAM11", "count": 15,
                           "kind": ["input", "output"] }, … },
  "arrays": { "adj_data": { "dtype": "float32", "offset": …, "count": … }, … }
}
```

## `dynamics.preNormalized` is load-bearing

Weights ship already scaled for stable `tanh` dynamics: spectral radius ≤ 0.9,
diagonal self-inhibition −0.2. **A runtime must not normalize again.** The raw
real adjacency has a radius near 2.7, where every neuron saturates to ±1 within
a few ticks and the readouts stop responding to input at all — alive-looking and
completely deaf. A second normalization pass over already-scaled weights
re-amplifies them and produces a different network.

Measured radii of the shipped packs: `minimal` 0.71, `escape-and-steering` 0.82,
`dopamine-mushroom-body` 0.79, `courtship-and-foraging` 0.86 — against 0.81 for
the full graph.

## Serving

`build_pack.py` writes both `NAME.mflpack` and `NAME.mflpack.gz`. Serve the
plain file, or the `.gz` with `Content-Encoding: gzip` — the loader rejects a
raw gzip stream with a message saying exactly that, rather than failing on a
confusing magic mismatch.

## Reading one outside the browser

```js
import { parsePack } from 'mad-fly-lab/brain';
import { readFileSync } from 'node:fs';

const b = readFileSync('packs/minimal.mflpack');
const pack = parsePack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
console.log(pack.describe());               // "minimal: 715 real neurons, …"
console.log(pack.typeOf(0), pack.sideOf(0)); // real NeuPrint annotations
```
