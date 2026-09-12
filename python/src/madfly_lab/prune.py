"""Generalized connectome pruning: full 176k real graph -> a circuit-sized
real subgraph small enough to run in a browser tab.

Method (generalized from fly_speed_dating/scripts/build_pruned_cache.py, which
hardcoded one courtship seed set): grow outward from the circuit's seed neurons
along each neuron's top-K strongest outgoing edges, for N hops. Once the node
set is fixed, the induced subgraph keeps EVERY real edge between kept nodes at
its original weight -- top-K only decides which nodes matter, never which edges
survive among them.

Why not plain N-hop reachability: male-cns is a small-world graph. Two
unweighted hops from almost any seed already covers ~75% of all 176k neurons,
so unweighted reachability produces no pruning at all. Weighting by real
synaptic strength is what makes the subgraph both small and meaningful.
"""

import numpy as np
import scipy.sparse as sp

from madfly_lab.circuits import Circuit


def seed_indices(c, circuit: Circuit) -> dict:
    """Resolve every channel + substrate type in `circuit` against the real
    graph. Returns {channel_name: indices}; raises if a declared *channel*
    resolves to nothing, since that means the pack would ship a dead channel a
    scene is documented to be able to drive or read.
    """
    resolved = {}
    missing = []
    for name, spec in {**circuit.inputs, **circuit.outputs}.items():
        idx = c.resolve_channel(spec)
        if len(idx) == 0:
            missing.append(f"{name} ({spec})")
        resolved[name] = idx
    if missing:
        raise ValueError(
            f"Circuit {circuit.name!r} declares channels absent from dataset "
            f"{c.dataset!r}: {', '.join(missing)}. Fix circuits.py rather than "
            "shipping a channel that silently does nothing."
        )
    for t in circuit.substrate:
        idx = c.indices_of_type(t)
        if len(idx):
            resolved[f"_substrate_{t}"] = idx
    return resolved


def grow(c, seeds: np.ndarray, hops: int, top_k: int, verbose: bool = True) -> np.ndarray:
    """Top-K weighted N-hop expansion from `seeds`. Returns sorted kept indices."""
    W_csc = c.sm_adjacency.tocsc()  # a column holds one source neuron's outgoing edges
    visited = set(int(i) for i in seeds)
    frontier = set(visited)
    for hop in range(1, hops + 1):
        new_nodes = set()
        for node in frontier:
            start, end = W_csc.indptr[node], W_csc.indptr[node + 1]
            cols_idx = W_csc.indices[start:end]
            cols_w = np.abs(W_csc.data[start:end])
            if len(cols_w) > top_k:
                cols_idx = cols_idx[np.argpartition(cols_w, -top_k)[-top_k:]]
            new_nodes.update(int(i) for i in cols_idx)
        frontier = new_nodes - visited
        visited |= frontier
        if verbose:
            print(f"  hop {hop}: +{len(frontier)} new, {len(visited)} total")
    return np.array(sorted(visited), dtype=np.int64)


def prune_for_circuit(c, circuit: Circuit, verbose: bool = True):
    """Returns (pruned ConnectomeData, {channel_name: indices in the PRUNED graph})."""
    resolved = seed_indices(c, circuit)
    seeds = np.unique(np.concatenate([v for v in resolved.values() if len(v)]))
    if verbose:
        print(f"Circuit {circuit.name!r}: {len(seeds)} seed neurons across "
              f"{len(resolved)} resolved channel/substrate sets.")

    keep = grow(c, seeds, circuit.hops, circuit.top_k, verbose=verbose)
    if verbose:
        print(f"Pruned node set: {len(keep)} neurons "
              f"({100 * len(keep) / c.n_sm:.2f}% of the full {c.n_sm}-neuron graph).")

    pruned = c.subgraph(keep)
    if verbose:
        print(f"Pruned subgraph: {pruned.sm_adjacency.nnz} edges "
              f"({100 * pruned.sm_adjacency.nnz / c.sm_adjacency.nnz:.3f}% of full).")

    # Re-resolve channels against the pruned graph rather than remapping indices.
    # Same result, and it double-checks that the seed neurons really did survive:
    # a channel that came back empty here would be a pruning bug, not a dataset gap
    # (seed_indices already proved every channel exists upstream).
    channels = {}
    for name, spec in {**circuit.inputs, **circuit.outputs}.items():
        idx = pruned.resolve_channel(spec)
        assert len(idx) > 0, f"channel {name!r} did not survive pruning -- pruning bug"
        channels[name] = idx
    return pruned, channels


def normalized_adjacency(pruned, self_inhibition: float = -0.2,
                         target_spectral_radius: float = 0.9) -> sp.csr_matrix:
    """Stability-normalize the pruned graph for tanh dynamics.

    Reuses the vendored `_normalize_weight_matrix` rather than reimplementing
    it, so the browser pack and the Mode A Python server run identically scaled
    weights. Pruning changes which real edges are reachable, so the spectral
    radius must be recomputed per pack -- normalizing the full graph and then
    slicing it would leave the subgraph mis-scaled.
    """
    from madfly_lab.connectome import _normalize_weight_matrix
    return _normalize_weight_matrix(
        pruned.sm_adjacency,
        self_inhibition=self_inhibition,
        target_spectral_radius=target_spectral_radius,
    )
