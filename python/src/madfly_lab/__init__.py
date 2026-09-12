"""mad-fly-lab -- Python side: connectome access, circuit pruning, browser pack
export, and the Mode A (full 176k-neuron) WebSocket runtime.

The JS SDK in ../../src is the primary developer surface; this package exists so
that (a) browser packs can be built offline from the real connectome and (b)
scenes that need the whole graph can run it behind the same LabBrain API.
"""

__version__ = "0.1.0"

from madfly_lab.circuits import CIRCUITS, Circuit, get as get_circuit

__all__ = ["CIRCUITS", "Circuit", "get_circuit", "__version__"]
