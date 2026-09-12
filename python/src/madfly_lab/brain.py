"""LabBrain's Python side -- the Mode A (full-connectome) neural runtime.

Generalized from the NeuralBridge lineage in this author's earlier, unreleased
simulations:

    a <- tanh(W @ a + I)

ONE DELIBERATE DIVERGENCE from those three, which compute `tanh(W @ a + I*dt)`:
scaling a *sustained* input by dt makes the steady state depend on the tick
rate. Measured on the courtship pack, one unchanged sensory drive gave DNp09
4.94e-3 at 20 Hz and 8.41e-4 at 120 Hz -- a 5.9x spread. Each of those projects
ran at a single fixed rate so it never mattered. This server ticks at ~20 Hz
while the browser packs run at 60, behind an API that promises a scene need not
care which runtime it got, so sustained input contributes I directly and one-
shot pulses decay over a duration in seconds rather than a tick count. Mode A
and Mode B now agree to 5 significant figures on the same input.

What else changes here is the interface. Those three each hardcoded their own game's
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

from madfly_lab.device import Backend, cpu_backend


@dataclass
class LabBrainRuntime:
    """Channel-driven tanh dynamics over a real weighted adjacency matrix.

    `adjacency` must already be stability-normalized (connectome._normalize_
    weight_matrix / prune.normalized_adjacency). `channels` maps a scene-facing
    name to that channel's neuron indices in this graph.

    Runs on CPU (numpy/scipy) or GPU (cupy) -- see device.py. The dynamics are
    written once against `self.backend.xp`, since cupy's sparse matrices are
    API-compatible with scipy's, so there is no second code path to keep in
    sync. Channel indices stay on the host: they are only used to build the
    input vector and to gather readouts, and shuttling them per tick would cost
    more than it saves.
    """

    adjacency: sp.csr_matrix
    channels: dict
    backend: Backend = None
    activations: object = field(init=False)
    _external: object = field(init=False)
    _decay: dict = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        if self.backend is None:
            self.backend = cpu_backend()
        self.adjacency = self.backend.to_device(self.adjacency)
        # Activations MUST share the adjacency's dtype. scipy upcasts a float32
        # matrix times a float64 vector on every call, and on the full 25.7M-edge
        # graph that mismatch costs 180ms per step instead of 37ms -- a 4.8x
        # penalty that silently caps the Mode A server at ~5Hz. Measured, not
        # guessed; see the dtype benchmark in the build notes.
        self.dtype = self.adjacency.dtype if self.adjacency.dtype.kind == "f" else np.float32
        # Channel index arrays must live on the same device as the activations,
        # or cupy refuses the fancy-index gather in read()/set_input().
        # to_device() returns already-resident arrays untouched, so when the
        # server hands over a shared device-side channel index this is free.
        self._dev_channels = {k: self.backend.to_device(v) for k, v in self.channels.items()}
        self.reset()

    @property
    def n(self) -> int:
        return self.adjacency.shape[0]

    def reset(self, noise_scale: float = 0.0, rng: np.random.Generator | None = None) -> None:
        """Zero (or slightly randomize) the network. Noise is still the same real
        weight matrix -- just a different real initial condition, so repeated
        runs of a scene aren't bit-identical.
        """
        xp = self.backend.xp
        if noise_scale > 0.0:
            rng = rng or np.random.default_rng()
            host = rng.uniform(-noise_scale, noise_scale, size=self.n).astype(self.dtype)
            self.activations = xp.asarray(host)
        else:
            self.activations = xp.zeros(self.n, dtype=self.dtype)
        self._external = xp.zeros(self.n, dtype=self.dtype)
        self._decay = {}

    # ---- input -----------------------------------------------------------

    def set_input(self, channel: str, intensity: float) -> None:
        """Sustained drive on a channel, held until changed. Intensity is split
        across the channel's real neurons (not applied per-neuron), so a
        204-neuron ORN population and a 2-neuron DN pair are driven comparably
        -- the same convention the three upstream bridges used.
        """
        idx = self._dev_channels.get(channel)
        if idx is None or not len(idx):
            return
        self._external[idx] = intensity / len(idx)

    def inject_current(self, channel: str, amount: float, decay_seconds: float = 0.15) -> None:
        """One-shot pulse that fades over `decay_seconds` of simulated time --
        what the SDK's `brain.injectCurrent()` calls. Additive on top of any
        sustained `set_input` on the same channel. Duration rather than a tick
        count, so a pulse lasts the same wall time at any tick rate.
        """
        idx = self._dev_channels.get(channel)
        if idx is None or not len(idx):
            return
        life = max(1e-6, float(decay_seconds))
        self._decay[channel] = {
            "idx": idx, "per_neuron": amount / len(idx), "remaining": life, "total": life,
        }

    def clear_inputs(self) -> None:
        self._external[:] = 0.0
        self._decay.clear()

    # ---- step / readout --------------------------------------------------

    def step(self, dt: float) -> None:
        I = self._external.copy()  # already self.dtype -- do not let this widen
        for channel, pulse in list(self._decay.items()):
            I[pulse["idx"]] += pulse["per_neuron"] * (pulse["remaining"] / pulse["total"])
            pulse["remaining"] -= dt
            if pulse["remaining"] <= 0:
                del self._decay[channel]
        self.activations = self.backend.xp.tanh(
            self.adjacency @ self.activations + I, dtype=self.dtype,
        )

    def read(self, channel: str) -> float:
        """Mean activation over a channel's real neurons, in [-1, 1]."""
        idx = self._dev_channels.get(channel)
        if idx is None or not len(idx):
            return 0.0
        return float(self.backend.xp.mean(self.activations[idx]))

    def read_all(self, names=None) -> dict:
        names = names if names is not None else self.channels.keys()
        return {name: self.read(name) for name in names}

    def population_activity(self) -> float:
        """Mean |activation| over the whole graph -- the HUD's 'arousal' trace."""
        xp = self.backend.xp
        return float(xp.mean(xp.abs(self.activations)))

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
        xp = self.backend.xp
        mag = xp.abs(self.activations)
        peak = float(mag.max()) if len(mag) else 0.0
        if peak <= 0.0:
            return np.array([], dtype=np.int64), np.array([], dtype=self.dtype)
        hits = xp.flatnonzero(mag >= peak * threshold)
        if len(hits) > limit:
            hits = hits[xp.argpartition(mag[hits], -limit)[-limit:]]
        # Back to host: these are about to be JSON-serialized for the client.
        return self.backend.to_host(hits), self.backend.to_host(self.activations[hits])

    def normalized_activity(self) -> np.ndarray:
        """Activations rescaled so the current peak is 1.0 -- what a display
        wants, given the dilution effect described in `active_indices`."""
        xp = self.backend.xp
        mag = xp.abs(self.activations)
        peak = float(mag.max()) if len(mag) else 0.0
        return self.backend.to_host(mag / peak if peak > 0 else mag)
