"""Named circuit definitions -- the framework's catalogue of real cell-type sets.

A *circuit* is what `MadFlyLab({circuit: '...'})` names in the JS SDK. It is
purely a declaration of which real NeuPrint cell types a scene intends to talk
to; it never invents connectivity. Building a browser pack for a circuit means:
take that circuit's seed types, find them in the real male-cns:v1.0 graph, walk
the real strongest-weight edges outward (prune.py), and ship the induced real
subgraph.

Every type name below was verified present in male-cns:v1.0 (see
scripts/build_pack.py's --verify, which fails loudly on a missing type rather
than silently shipping a dead channel).

`inputs` are channels a scene may drive with `brain.injectCurrent(name, ...)`;
`outputs` are channels it may read with `brain.read(name)` / `onSignal`. Both
are only *conventions* -- the runtime resolves any real type name on demand --
but listing them here is what lets the pack ship a precomputed index and what
makes `lab.brain.channels()` self-documenting in a scene.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Circuit:
    name: str
    description: str
    # Channel name -> spec understood by ConnectomeData.resolve_channel:
    # "PAM11" (exact type), "LC4*" (prefix family), or {"type"/"prefix", "side"}.
    inputs: dict = field(default_factory=dict)
    outputs: dict = field(default_factory=dict)
    # Extra types pulled into the pruned graph as pathway substrate -- not
    # directly addressable channels, but real cells the signal must travel
    # through for an input to reach an output.
    substrate: tuple = ()
    hops: int = 3
    top_k: int = 10


# Real olfactory receptor populations, one per glomerulus, verified upstream in
# connectome.py's OLFACTORY_CHANNELS (DM1 74 cells, VA6 63, DA1 204, DA2 48).
_ORN = {
    "ORN_DM1": "ORN_DM1",
    "ORN_VA6": "ORN_VA6",
    "ORN_DA1": "ORN_DA1",
    "ORN_DA2": "ORN_DA2",
}

# Real visual projection neurons the framework's looming detector drives.
# LC4 ships as 6 real subtypes in this dataset and LPLC2 as 1, so LC4 is
# addressed by prefix and LPLC2 exactly -- see indices_of_prefix's docstring.
_LOOMING = {"LC4": "LC4*", "LPLC2": "LPLC2", "LPLC1": "LPLC1"}

# Real descending motor neurons. Each is a clean L/R pair in male-cns:v1.0
# (verified: exact==2 for every one of these), which is why steering can be
# read as a genuine left-minus-right difference rather than a fabricated one.
_MOTOR = {
    "DNa01_L": {"type": "DNa01", "side": "L"},
    "DNa01_R": {"type": "DNa01", "side": "R"},
    "DNp03_L": {"type": "DNp03", "side": "L"},
    "DNp03_R": {"type": "DNp03", "side": "R"},
    "DNp09_L": {"type": "DNp09", "side": "L"},
    "DNp09_R": {"type": "DNp09", "side": "R"},
    "DNp01_L": {"type": "DNp01", "side": "L"},  # Giant Fiber, escape jump
    "DNp01_R": {"type": "DNp01", "side": "R"},
    "DNp01": "DNp01",
    "DNa01": "DNa01",
    "DNp03": "DNp03",
    "DNp09": "DNp09",
}

# Real dopaminergic / mushroom-body populations. PAM ships as 15 real subtypes,
# PPL1 as 8, MBON as 37, KC as 15 -- all addressed by prefix except PAM11,
# which the spec names explicitly and which is a real 15-neuron type.
_DOPAMINE = {
    "PAM11": "PAM11",
    "PAM": "PAM*",
    "PPL1": "PPL1*",
}
_MB = {"KC": "KC*", "MBON": "MBON*"}


CIRCUITS = {
    "escape-and-steering": Circuit(
        name="escape-and-steering",
        description=(
            "Looming vision to escape/steering motor output: LC4/LPLC2/LPLC1 -> "
            "DNp01 (Giant Fiber), DNp03, DNa01, DNp09. The smallest useful "
            "circuit -- what a scene needs to make a fly dodge and walk."
        ),
        inputs={**_LOOMING, **_ORN},
        outputs=_MOTOR,
        substrate=("CT1",),
        hops=2,
    ),
    "dopamine-mushroom-body": Circuit(
        name="dopamine-mushroom-body",
        description=(
            "Reward/punishment learning substrate: ORN glomeruli -> KC -> MBON, "
            "modulated by real PAM (reward) and PPL1 (aversive) dopaminergic "
            "neurons. For scenes that care about what the fly learns, not just "
            "where it walks."
        ),
        inputs={**_ORN, **_DOPAMINE},
        outputs={**_MB, **_DOPAMINE, **_MOTOR},
        hops=2,
    ),
    "courtship-and-foraging": Circuit(
        name="courtship-and-foraging",
        description=(
            "The spec's default: pheromone (DA1/DA2) and food-odor (DM1/VA6) "
            "input into the pC1/aSP courtship hub and the mushroom body, out to "
            "DNp13 (copulation attempt), DNa01 (steering) and DNp09 (forward "
            "walking), with the looming escape pathway kept alive alongside."
        ),
        inputs={**_ORN, **_LOOMING, **_DOPAMINE},
        outputs={
            **_MOTOR,
            **_DOPAMINE,
            "DNp13": "DNp13",
            "DNp13_L": {"type": "DNp13", "side": "L"},
            "DNp13_R": {"type": "DNp13", "side": "R"},
            "courtship_hub": {"prefix": ("pC1", "aSP")},
            **_MB,
        },
        substrate=("CT1", "DNp06"),
        # hops=2/top_k=5 measured at 7,922 real neurons / 1.38M real edges --
        # inside the spec's 300-8,600 browser band, and the same order as the
        # 8,598-neuron courtship pack already proven to run in a browser tab in
        # fly_speed_dating. hops=3 with the default top_k=10 pulls in 23,560
        # neurons (13% of the whole brain), which is a 34MB pack: correct, but
        # no longer a browser artifact. Mode A is the right runtime above this.
        hops=2,
        top_k=5,
    ),
    "minimal": Circuit(
        name="minimal",
        description=(
            "Smallest pack the framework ships (~300 real neurons): looming in, "
            "steering out, nothing else. For smoke tests and for embedding a "
            "brain in something that is not a fly (see the CityDriver preset "
            "idea in the spec)."
        ),
        inputs=_LOOMING,
        outputs={k: v for k, v in _MOTOR.items() if "DNa01" in k or "DNp03" in k},
        hops=1,
        top_k=4,
    ),
}


def get(name: str) -> Circuit:
    if name not in CIRCUITS:
        raise KeyError(
            f"Unknown circuit {name!r}. Known circuits: {', '.join(sorted(CIRCUITS))}"
        )
    return CIRCUITS[name]
