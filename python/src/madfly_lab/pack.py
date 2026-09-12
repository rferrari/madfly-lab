"""`.mflpack` writer -- the browser-side binary form of a pruned real subgraph.

One self-contained file per circuit, so the JS runtime needs no server, no
NeuPrint token and no numpy:

    magic      8 bytes   b"MFLPACK1"
    headerLen  uint32 LE
    header     headerLen bytes of UTF-8 JSON (see below)
    padding    to the next 8-byte boundary
    blobs      concatenated typed arrays, each located by header["arrays"]

Everything numeric lives in the blob region as native little-endian typed
arrays so the browser can hand them straight to `new Float32Array(buffer, off,
n)` with zero parsing. The JSON header holds only what is genuinely
string-shaped: cell-type names, channel membership, provenance, and the
dynamics constants the runtime must match.

Gzip the result for serving (`build_pack.py` writes both): the CSR weight data
compresses well, and every static host serves .gz transparently.
"""

import gzip
import json
import struct
import time

import numpy as np
import scipy.sparse as sp

MAGIC = b"MFLPACK1"
FORMAT_VERSION = 1

# male-cns:v1.0 is CC BY 4.0 -- deliberately chosen over the FlyWire-derived
# assets used elsewhere in this repo family, which are CC BY-NC 4.0. Packs built
# by this file therefore carry no non-commercial restriction.
LICENSE = "CC BY 4.0"
CITATION = (
    "MaleCNS v1.0 connectome (FlyEM/HHMI Janelia, University of Cambridge, "
    "MRC Laboratory of Molecular Biology, and Google Research). "
    "https://male-cns.janelia.org/"
)


class _BlobWriter:
    """Accumulates typed arrays into one contiguous buffer, recording offsets."""

    def __init__(self):
        self.chunks = []
        self.arrays = {}
        self.offset = 0

    def add(self, name: str, values, dtype: str) -> None:
        a = np.ascontiguousarray(values, dtype=dtype)
        if a.dtype.byteorder not in ("<", "=", "|"):
            a = a.astype(a.dtype.newbyteorder("<"))
        # 8-byte-align every array so Float64Array views stay legal if the
        # format ever grows one; Float32Array/Int32Array only need 4.
        pad = (-self.offset) % 8
        if pad:
            self.chunks.append(b"\x00" * pad)
            self.offset += pad
        self.arrays[name] = {"dtype": dtype, "offset": self.offset, "count": int(a.size)}
        raw = a.tobytes()
        self.chunks.append(raw)
        self.offset += len(raw)

    def buffer(self) -> bytes:
        return b"".join(self.chunks)


def _soma_transform(xyz: np.ndarray):
    """Center and unit-scale real soma coordinates for rendering.

    Source coordinates are male-cns voxel/nm coordinates spanning tens of
    thousands of units. The renderer wants something around unit size, so the
    pack ships centered/scaled float32 plus the exact inverse transform --
    a scene that needs real coordinates back can always recover them, and the
    point cloud never has to guess a scale factor.
    """
    valid = np.isfinite(xyz).all(axis=1) & (xyz != 0).any(axis=1)
    if not valid.any():
        return np.zeros_like(xyz, dtype=np.float32), valid, [0.0, 0.0, 0.0], 1.0
    good = xyz[valid]
    center = good.mean(axis=0)
    scale = float(np.abs(good - center).max()) or 1.0
    out = np.zeros_like(xyz, dtype=np.float32)
    out[valid] = ((good - center) / scale).astype(np.float32)
    return out, valid, [float(v) for v in center], scale


def write_pack(path: str, pruned, channels: dict, circuit, *,
               adjacency: sp.csr_matrix, self_inhibition: float,
               target_spectral_radius: float, also_gzip: bool = True) -> dict:
    """Serialize one pruned circuit to `path`. Returns the header dict."""
    W = adjacency.tocsr().astype(np.float32)
    n = W.shape[0]

    type_names, type_idx = np.unique(np.asarray(pruned.sm_types).astype(str), return_inverse=True)
    side_names, side_idx = np.unique(np.asarray(pruned.sm_sides).astype(str), return_inverse=True)

    soma, soma_valid, center, scale = _soma_transform(np.asarray(pruned.sm_soma_xyz, dtype=np.float64))

    blobs = _BlobWriter()
    blobs.add("adj_indptr", W.indptr, "int32")
    blobs.add("adj_indices", W.indices, "int32")
    blobs.add("adj_data", W.data, "float32")
    blobs.add("soma_xyz", soma.reshape(-1), "float32")
    blobs.add("soma_valid", soma_valid, "uint8")
    blobs.add("type_idx", type_idx, "int32")
    blobs.add("side_idx", side_idx, "uint8")
    blobs.add("body_ids", np.asarray(pruned.sm_body_ids, dtype=np.float64), "float64")

    channel_meta = {}
    for name, idx in channels.items():
        key = f"ch:{name}"
        blobs.add(key, idx, "int32")
        kind = []
        if name in circuit.inputs:
            kind.append("input")
        if name in circuit.outputs:
            kind.append("output")
        channel_meta[name] = {"array": key, "count": int(len(idx)), "kind": kind}

    header = {
        "format": "mflpack",
        "version": FORMAT_VERSION,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": str(pruned.dataset),
        "source": str(pruned.source),
        "license": LICENSE,
        "citation": CITATION,
        "circuit": {
            "name": circuit.name,
            "description": circuit.description,
            "hops": circuit.hops,
            "topK": circuit.top_k,
        },
        "nNeurons": int(n),
        "nEdges": int(W.nnz),
        # The runtime MUST use these: the pack ships weights already scaled for
        # stable tanh dynamics (see prune.normalized_adjacency), so a runtime
        # that re-normalized would double-scale them.
        "dynamics": {
            "activation": "tanh",
            "selfInhibition": self_inhibition,
            "targetSpectralRadius": target_spectral_radius,
            "preNormalized": True,
        },
        "soma": {
            "units": "normalized",
            "inverse": {"center": center, "scale": scale},
            "note": "original = normalized * scale + center, in male-cns source units",
        },
        "typeNames": [str(t) for t in type_names],
        "sideNames": [str(s) for s in side_names],
        "channels": channel_meta,
        "arrays": blobs.arrays,
    }

    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    prefix = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes
    prefix += b"\x00" * ((-len(prefix)) % 8)

    payload = prefix + blobs.buffer()
    with open(path, "wb") as f:
        f.write(payload)
    if also_gzip:
        with gzip.open(path + ".gz", "wb", compresslevel=9) as f:
            f.write(payload)
    return header
