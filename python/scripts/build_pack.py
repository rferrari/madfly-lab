"""Build a browser `.mflpack` for one named circuit from the real connectome.

    uv run python scripts/build_pack.py --circuit escape-and-steering
    uv run python scripts/build_pack.py --all --cache-dir ../../fly_simulation/.cache

Reads the full male-cns:v1.0 cache (176,422 neurons / 25.7M edges). That cache
is ~80MB and is NOT vendored into this repo -- point --cache-dir at an existing
one from a sibling project, or let connectome.py fetch it from NeuPrint with a
token (slow, minutes). With neither, it falls back to the mock graph and says so
loudly, which is enough to exercise the pipeline but is not real data.
"""

import argparse
import os
import sys

from madfly_lab import circuits
from madfly_lab.connectome import load_or_build_connectome
from madfly_lab.pack import write_pack
from madfly_lab.prune import normalized_adjacency, prune_for_circuit

SELF_INHIBITION = -0.2
TARGET_SPECTRAL_RADIUS = 0.9


def build_one(c, name: str, out_dir: str) -> dict:
    circuit = circuits.get(name)
    print(f"\n=== {name} ===\n{circuit.description}\n")
    pruned, channels = prune_for_circuit(c, circuit)

    print("Normalizing pruned adjacency for stable tanh dynamics...")
    W = normalized_adjacency(
        pruned,
        self_inhibition=SELF_INHIBITION,
        target_spectral_radius=TARGET_SPECTRAL_RADIUS,
    )

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.mflpack")
    header = write_pack(
        path, pruned, channels, circuit,
        adjacency=W,
        self_inhibition=SELF_INHIBITION,
        target_spectral_radius=TARGET_SPECTRAL_RADIUS,
    )
    raw = os.path.getsize(path) / 1e6
    gz = os.path.getsize(path + ".gz") / 1e6
    print(f"Wrote {path}  ({header['nNeurons']} neurons, {header['nEdges']} edges, "
          f"{raw:.1f}MB raw / {gz:.1f}MB gzipped)")
    print("  channels: " + ", ".join(
        f"{n}({m['count']})" for n, m in sorted(header["channels"].items())))
    return header


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--circuit", action="append", default=[],
                    help="circuit name (repeatable). Default: all.")
    ap.add_argument("--all", action="store_true", help="build every known circuit")
    ap.add_argument("--cache-dir", default=".cache",
                    help="directory holding connectome_<dataset>_full.npz")
    ap.add_argument("--out-dir", default="../packs", help="where to write .mflpack files")
    ap.add_argument("--dataset", default="male-cns:v1.0")
    args = ap.parse_args()

    names = args.circuit or (sorted(circuits.CIRCUITS) if args.all else None)
    if not names:
        ap.error("pass --circuit NAME (repeatable) or --all")
    for n in names:
        circuits.get(n)  # fail fast on a typo, before the slow load

    print(f"Loading full connectome from {args.cache_dir} ...")
    c = load_or_build_connectome(
        token=os.environ.get("NEUPRINT_TOKEN"),
        dataset=args.dataset,
        cache_dir=args.cache_dir,
        scope="full",
    )
    print(f"Loaded: {c.n_sm} neurons, {c.sm_adjacency.nnz} edges, source={c.source!r}")
    if c.source == "mock":
        print("\n!! This is the MOCK graph, not real connectivity. Packs built from it\n"
              "!! are structurally valid and useless scientifically. Point --cache-dir\n"
              "!! at a real full-connectome cache, or set NEUPRINT_TOKEN.\n", file=sys.stderr)

    for n in names:
        build_one(c, n, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
