"""LabBrain's Python side -- the Mode A (full-connectome) neural runtime.

Generalized from the NeuralBridge lineage running in fly_simulation_3d ->
fly_drone_delivery -> fly_speed_dating. The dynamics are unchanged from all
three:

    a <- tanh(W @ a + I * dt)

What changes here is the interface. Those three each hardcoded their own game's
input and readout neurons into the bridge itself (steer_l/steer_r/forward_drive,
or accept_l/turn_r). A framework can't do that: a scene names its own channels,
so injection and readout are both dictionary-driven against the circuit's
resolved channel index.

Honesty note on units, carried over from those projects: `a` is a dimensionless
tanh activation in [-1, 1], not a membrane voltage and not a firing rate. The
SDK's `injectCurrent('PAM11', +20)` keeps the spec's ergonomics, but +20 is
input-current units in this model's own scale -- it is NOT +20 mV, and nothing
here simulates millivolts. The HUD converts activation to an indicative "Hz"
for display only (see observer/telemetry.js), which is a presentation choice,
not a measurement.
"""

from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp


@dataclass
class LabBrainRuntime:
    """Channel-driven tanh dynamics over a real weighted adjacency matrix.

    `adjacency` must already be stability-normalized (connectome._normalize_
    weight_matrix / prune.normalized_adjacency). `channels` maps a scene-facing
    name to that channel's neuron indices in this graph.
    """

    adjacency: sp.csr_matrix
    channels: dict
    activations: np.ndarray = field(init=False)
    _external: np.ndarray = field(init=False)
    _decay: dict = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        # Activations MUST share the adjacency's dtype. scipy upcasts a float32
        # matrix times a float64 vector on every call, and on the full 25.7M-edge
        # graph that mismatch costs 180ms per step instead of 37ms -- a 4.8x
        # penalty that silently caps the Mode A server at ~5Hz. Measured, not
        # guessed; see the dtype benchmark in the build notes.
        self.dtype = self.adjacency.dtype if self.adjacency.dtype.kind == "f" else np.float32
        self.reset()

    @property
    def n(self) -> int:
        return self.adjacency.shape[0]

    def reset(self, noise_scale: float = 0.0, rng: np.random.Generator | None = None) -> None:
        """Zero (or slightly randomize) the network. Noise is still the same real
        weight matrix -- just a different real initial condition, so repeated
        runs of a scene aren't bit-identical.
        """
        if noise_scale > 0.0:
            rng = rng or np.random.default_rng()
            self.activations = rng.uniform(-noise_scale, noise_scale, size=self.n).astype(self.dtype)
        else:
            self.activations = np.zeros(self.n, dtype=self.dtype)
        self._external = np.zeros(self.n, dtype=self.dtype)
        self._decay = {}

    # ---- input -----------------------------------------------------------

    def set_input(self, channel: str, intensity: float) -> None:
        """Sustained drive on a channel, held until changed. Intensity is split
        across the channel's real neurons (not applied per-neuron), so a
        204-neuron ORN population and a 2-neuron DN pair are driven comparably
        -- the same convention the three upstream bridges used.
        """
        idx = self.channels.get(channel)
        if idx is None or not len(idx):
            return
        self._external[idx] = intensity / len(idx)

    def inject_current(self, channel: str, amount: float, decay_ticks: int = 8) -> None:
        """One-shot pulse that fades over `decay_ticks` -- what the SDK's
        `brain.injectCurrent()` calls. Additive on top of any sustained
        `set_input` on the same channel.
        """
        idx = self.channels.get(channel)
        if idx is None or not len(idx):
            return
        self._decay[channel] = {
            "idx": idx,
            "per_neuron": amount / len(idx),
            "remaining": max(1, int(decay_ticks)),
            "total": max(1, int(decay_ticks)),
        }

    def clear_inputs(self) -> None:
        self._external[:] = 0.0
        self._decay.clear()

    # ---- step / readout --------------------------------------------------

    def step(self, dt: float) -> None:
        I = self._external.copy()  # already self.dtype -- do not let this widen
        for channel, pulse in list(self._decay.items()):
            frac = pulse["remaining"] / pulse["total"]
            I[pulse["idx"]] += pulse["per_neuron"] * frac
            pulse["remaining"] -= 1
            if pulse["remaining"] <= 0:
                del self._decay[channel]
        self.activations = np.tanh(
            self.adjacency @ self.activations + I * np.asarray(dt, dtype=self.dtype),
            dtype=self.dtype,
        )

    def read(self, channel: str) -> float:
        """Mean activation over a channel's real neurons, in [-1, 1]."""
        idx = self.channels.get(channel)
        if idx is None or not len(idx):
            return 0.0
        return float(np.mean(self.activations[idx]))

    def read_all(self, names=None) -> dict:
        names = names if names is not None else self.channels.keys()
        return {name: self.read(name) for name in names}

    def population_activity(self) -> float:
        """Mean |activation| over the whole graph -- the HUD's 'arousal' trace."""
        return float(np.mean(np.abs(self.activations)))

    def active_indices(self, threshold: float = 0.02, limit: int = 4000):
        """Indices of the most-active neurons, for the 3D soma point cloud.
        Capped so the Mode A server never streams 176k values per tick.

        `threshold` is RELATIVE to the current peak, not absolute. An absolute
        cut does not work across both runtimes: the same real input spread over
        the full 176k-neuron graph produces activations around 1e-5, where a
        pruned 7.9k pack reaches 1e-1 for the same drive, simply because the
        signal is diluted over 22x more neurons. An absolute 0.05 cut leaves the
        Mode A cloud permanently empty -- which it was, before this changed.
        """
        mag = np.abs(self.activations)
        peak = float(mag.max()) if len(mag) else 0.0
        if peak <= 0.0:
            return np.array([], dtype=np.int64), np.array([], dtype=self.dtype)
        hits = np.flatnonzero(mag >= peak * threshold)
        if len(hits) > limit:
            hits = hits[np.argpartition(mag[hits], -limit)[-limit:]]
        return hits, self.activations[hits]

    def normalized_activity(self) -> np.ndarray:
        """Activations rescaled so the current peak is 1.0 -- what a display
        wants, given the dilution effect described in `active_indices`."""
        mag = np.abs(self.activations)
        peak = float(mag.max()) if len(mag) else 0.0
        return mag / peak if peak > 0 else mag
