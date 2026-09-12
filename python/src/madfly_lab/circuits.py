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
#
# These populations DO carry a real somaSide annotation in male-cns:v1.0
# (LPLC1 68L/66R, LPLC2 94L/91R, LC4 71L/55R), and that bilateral structure is
# functional, not decorative: driving only the left LPLC2 cells yields a DNa01
# steering signal of 1.1e-4, driving only the right yields 1.5e-3 -- a 13x
# asymmetry. Summing both eyes into one channel throws that away and leaves the
# fly walking in a straight line no matter what it sees. So each eye gets its
# own channel and the avatar drives them from its own compound eye.
_LOOMING = {
    "LC4": "LC4*", "LPLC2": "LPLC2", "LPLC1": "LPLC1",
    "LC4_L": {"prefix": "LC4", "side": "L"}, "LC4_R": {"prefix": "LC4", "side": "R"},
    "LPLC2_L": {"type": "LPLC2", "side": "L"}, "LPLC2_R": {"type": "LPLC2", "side": "R"},
    "LPLC1_L": {"type": "LPLC1", "side": "L"}, "LPLC1_R": {"type": "LPLC1", "side": "R"},
}

# Real mechanosensory neurons -- what a scene drives when something TOUCHES the
# fly. These are resolved by NeuPrint `class` rather than by type, because the
# tactile population is spread across ~40 real SNta* subtypes (SNta02/09 241
# cells, SNta29 235, SNta37 228, ...) with no single umbrella type name.
# Present only at scope="full", which is what the packs are built from.
# Only the tactile class is a declared channel. male-cns also annotates 1,733
# `mechanosensory` and 1,454 `mechanosensory_proprioceptive` cells, but seeding
# those adds 3,187 neurons and pushes every pack out of the spec's 300-8,600
# Mode B band for no scene-facing gain -- a click on the fly is touch, not
# proprioception. They remain reachable at scope="full" (Mode A) and via
# `indices_of_class` for anyone who wants them.
_TOUCH = {"touch": {"cls": "mechanosensory_tactile"}}

# Real contact chemosensation (taste), and the feeding decision it drives.
#
# This is what makes a fly STOP at food rather than merely walk toward it.
# Smell (ORN) is a distance sense and drives approach; the decision to stop and
# eat is gated by taste, which requires contact. Without this channel nothing in
# the arena could ever tell the fly it had arrived.
#
# DNp06 was identified in this lineage by tracing the graph, not assumed: it is
# the strongest real 2-hop downstream target of `gustatory`-class neurons in
# male-cns:v1.0 (~480k total synaptic weight through 127 intermediates), and it
# comes as a clean L/R pair.
_TASTE = {"taste": {"cls": "gustatory"}}
_FEEDING = {
    "DNp06": "DNp06",
    "DNp06_L": {"type": "DNp06", "side": "L"},
    "DNp06_R": {"type": "DNp06", "side": "R"},
}

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


# ---------------------------------------------------------------------------
# The CORE every circuit gets.
#
# A circuit that omits part of this produces a fly that cannot function, and
# the failure is silent and baffling: the dopamine circuit originally had no
# visual channels at all, so the avatar's eyes drove nothing, no forward
# command was ever produced, and the fly just stood still on the spot. Nothing
# reported an error -- the channels simply did not exist.
#
# So the core is not a convention, it is a floor. Every circuit is a whole fly:
# two eyes, four glomeruli, taste, touch, and the full descending motor set
# including feeding. Circuits then differ by what they add DEPTH to, not by
# what they are missing.
_CORE_INPUTS = {**_LOOMING, **_ORN, **_TOUCH, **_TASTE}
_CORE_OUTPUTS = {**_MOTOR, **_FEEDING}


CIRCUITS = {
    "escape": Circuit(
        name="escape",
        description=(
            "Looming vision to escape/steering motor output: LC4/LPLC2/LPLC1 -> "
            "DNp01 (Giant Fiber), DNp03, DNa01, DNp09. The smallest useful "
            "circuit -- what a scene needs to make a fly dodge and walk."
        ),
        inputs=_CORE_INPUTS,
        outputs=_CORE_OUTPUTS,
        substrate=("CT1",),
        # The 2,558 tactile seeds raise the floor considerably; hops=2/top_k=10
        # reached 12,453 neurons, well past the Mode B band. Measured at
        # hops=1/top_k=3: 4,167 neurons -- comfortably in band with the whole
        # looming-to-escape pathway intact.
        hops=1,
        top_k=3,
    ),
    "dopamine": Circuit(
        name="dopamine",
        description=(
            "Reward/punishment learning substrate: ORN glomeruli -> KC -> MBON, "
            "modulated by real PAM (reward) and PPL1 (aversive) dopaminergic "
            "neurons. For scenes that care about what the fly learns, not just "
            "where it walks."
        ),
        # Vision and touch are included even though this circuit is "about"
        # learning. Without them the avatar's eyes drive nothing, no forward
        # command is produced, and the fly simply stands still -- a circuit
        # that cannot move is not a useful place to study reward.
        inputs={**_CORE_INPUTS, **_DOPAMINE},
        outputs={**_CORE_OUTPUTS, "MBON": "MBON*", **_DOPAMINE},
        # KC is 4,064 real cells -- most of a pack's budget if seeded. It stays
        # in the graph as substrate (the ORN -> KC -> MBON path is intact) and
        # is still resolvable by name; it is just not a seed.
        substrate=("KC",),
        hops=1,
        top_k=3,
    ),
    "courtship": Circuit(
        name="courtship",
        description=(
            "The spec's default: pheromone (DA1/DA2) and food-odor (DM1/VA6) "
            "input into the pC1/aSP courtship hub and the mushroom body, out to "
            "DNp13 (copulation attempt), DNa01 (steering) and DNp09 (forward "
            "walking), with the looming escape pathway kept alive alongside."
        ),
        inputs={**_CORE_INPUTS, **_DOPAMINE},
        outputs={
            **_CORE_OUTPUTS,
            **_DOPAMINE,
            "DNp13": "DNp13",
            "DNp13_L": {"type": "DNp13", "side": "L"},
            "DNp13_R": {"type": "DNp13", "side": "R"},
            "courtship_hub": {"prefix": ("pC1", "aSP")},
            "MBON": "MBON*",
            **_FEEDING,
        },
        # KC (4,064 real Kenyon cells) is substrate here rather than a declared
        # channel: it is the single largest population in the graph and seeding
        # it costs ~4,000 neurons of pack budget. Scenes that want to address
        # Kenyon cells directly should use the dopamine-mushroom-body circuit,
        # where they are the point. They remain resolvable by name either way.
        substrate=("CT1", "KC"),
        # hops=2/top_k=5 measured at 7,922 real neurons / 1.38M real edges --
        # inside the spec's 300-8,600 browser band, and the same order as the
        # 8,598-neuron courtship pack already proven to run in a browser tab in
        # fly_speed_dating. hops=3 with the default top_k=10 pulls in 23,560
        # neurons (13% of the whole brain), which is a 34MB pack: correct, but
        # no longer a browser artifact. Mode A is the right runtime above this.
        hops=1,
        top_k=3,
    ),
    "minimal": Circuit(
        name="minimal",
        description=(
            "The smallest COMPLETE fly: the full sensory and motor core and "
            "nothing else. It sees, smells, tastes, feels, walks, turns, "
            "escapes and feeds -- it just has no mushroom body, no dopamine "
            "and no courtship hub, so it cannot learn or court. Use it when you "
            "want the cheapest brain that still behaves like an animal."
        ),
        inputs=_CORE_INPUTS,
        outputs=_CORE_OUTPUTS,
        hops=1,
        top_k=2,
    ),
}


def get(name: str) -> Circuit:
    if name not in CIRCUITS:
        raise KeyError(
            f"Unknown circuit {name!r}. Known circuits: {', '.join(sorted(CIRCUITS))}"
        )
    return CIRCUITS[name]
