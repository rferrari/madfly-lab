"""Mode A runtime -- the full 176k-neuron connectome behind a WebSocket.

Architecture follows the one already proven in fly_drone_delivery and
fly_speed_dating: Python owns the neural state, the browser is a thin client.
The difference is that this server owns ONLY the brain. Scene state (stations,
avatar pose, scoring) stays in the browser, because in MadFly Lab the scene is
the developer's code and the brain is the framework's.

That split is what lets `LabBrain` present one API for both modes: a scene
calls `brain.injectCurrent(...)` / `brain.read(...)` identically whether the
tanh step is running in a JS typed-array loop over a 7,922-neuron pack or here
over all 176,422 real neurons.

Protocol (JSON text frames, one message per line-ish; see brain/remote-runtime.js
for the client half):

  client -> server
    {op:"hello", circuit, scope, tickHz}     open a session
    {op:"input",  channel, intensity}        sustained drive
    {op:"inject", channel, amount, decayTicks}  one-shot pulse
    {op:"clear"}                             drop all inputs
    {op:"reset", noise}                      re-initialize activations
    {op:"subscribe", channels:[...], cloud:bool}  what to stream back

  server -> client
    {op:"ready", nNeurons, nEdges, channels:{name:count}, dataset, source}
    {op:"tick", t, readings:{name:value}, population, cloud?:{idx:[],act:[]}}
    {op:"error", message}

Run:
    uv run python -m madfly_lab.server --cache-dir ../fly_simulation/.cache
"""

import argparse
import asyncio
import base64
import json
import os
import time

import numpy as np

from madfly_lab import calibrate, circuits
from madfly_lab.device import select as select_device
from madfly_lab.brain import LabBrainRuntime
from madfly_lab.connectome import _normalize_weight_matrix, is_normalized, load_or_build_connectome

DEFAULT_TICK_HZ = 60.0


class LabSession:
    """One connected client's brain. Activations are per-session; the heavy,
    read-only pieces (adjacency, channel index) are shared across sessions --
    a 176k x 176k sparse matrix is ~300MB and must never be copied per client.
    """

    def __init__(self, shared, tick_hz: float):
        self.shared = shared
        self.runtime = LabBrainRuntime(
            shared["adjacency"], shared["channels"], backend=shared["backend"],
        )
        self.tick_hz = tick_hz
        self.subscribed = list(shared["channels"].keys())
        self.cloud = False
        self.t = 0.0
        self.achieved_hz = 0.0

    def apply(self, msg: dict) -> None:
        op = msg.get("op")
        if op == "input":
            self.runtime.set_input(msg["channel"], float(msg.get("intensity", 0.0)))
        elif op == "inject":
            self.runtime.inject_current(
                msg["channel"], float(msg.get("amount", 0.0)),
                float(msg.get("decaySeconds", msg.get("decayTicks", 0.15))),
            )
        elif op == "clear":
            self.runtime.clear_inputs()
        elif op == "reset":
            self.runtime.reset(noise_scale=float(msg.get("noise", 0.0)))
            self.t = 0.0
        elif op == "subscribe":
            requested = msg.get("channels")
            if requested is not None:
                self.subscribed = [c for c in requested if c in self.shared["channels"]]
            self.cloud = bool(msg.get("cloud", False))

    def tick(self, dt: float) -> dict:
        started = time.perf_counter()
        self.runtime.step(dt)
        self.t += dt
        out = {
            "op": "tick",
            "t": round(self.t, 4),
            # Simulated seconds per tick, and the rate actually achieved. A
            # client that only saw `t` would believe the brain is keeping up
            # even when the host cannot step 25.7M edges fast enough -- the HUD
            # shows `achievedHz` next to the requested rate for that reason.
            "dt": dt,
            "achievedHz": round(self.achieved_hz, 2),
            "readings": {c: round(self.runtime.read(c), 8) for c in self.subscribed},
            "population": round(self.runtime.population_activity(), 8),
            "peak": round(float(np.abs(self.runtime.activations).max()), 8),
        }
        if self.cloud:
            idx, act = self.runtime.active_indices()
            # Normalized to the current peak: see LabBrainRuntime.active_indices
            # for why an absolute scale cannot serve both runtimes.
            peak = out["peak"] or 1.0
            out["cloud"] = {
                "idx": idx.tolist(),
                "act": np.round(np.abs(act) / peak, 4).tolist(),
            }
        self._last_step_s = time.perf_counter() - started
        return out


async def _handle(ws, shared):
    import websockets

    session = None
    try:
        raw = await ws.recv()
        hello = json.loads(raw)
        if hello.get("op") != "hello":
            await ws.send(json.dumps({"op": "error", "message": "expected hello"}))
            return
        tick_hz = float(hello.get("tickHz") or DEFAULT_TICK_HZ)
        session = LabSession(shared, tick_hz)
        await ws.send(json.dumps({
            "op": "ready",
            "mode": "full-connectome",
            "device": shared["backend"].name,
            "deviceDetail": shared["backend"].detail,
            "nNeurons": shared["n"],
            "nEdges": shared["nnz"],
            "dataset": shared["dataset"],
            "source": shared["source"],
            "channels": {k: int(len(v)) for k, v in shared["channels"].items()},
            "reference": shared["reference"],
            "somaB64": shared["soma_b64"],
            "somaQuant": shared["soma_quant"],
        }))

        dt = 1.0 / tick_hz
        next_tick = time.perf_counter()
        rate_window_started = next_tick
        ticks_in_window = 0

        async def pump():
            async for raw_msg in ws:
                try:
                    session.apply(json.loads(raw_msg))
                except Exception as e:  # one bad frame must not kill the session
                    await ws.send(json.dumps({"op": "error", "message": str(e)}))

        pump_task = asyncio.create_task(pump())
        try:
            while not pump_task.done():
                await ws.send(json.dumps(session.tick(dt)))

                ticks_in_window += 1
                now = time.perf_counter()
                elapsed = now - rate_window_started
                if elapsed >= 1.0:
                    session.achieved_hz = ticks_in_window / elapsed
                    ticks_in_window = 0
                    rate_window_started = now

                next_tick += dt
                # If a step took longer than its budget, resynchronize to the
                # wall clock instead of accumulating a deficit. Without this the
                # deadline drifts unboundedly behind, sleep is permanently zero,
                # and the reported simulated time `t` races ahead of real time
                # while the client has no way to tell.
                if next_tick < now:
                    next_tick = now
                # Always yield, so an input frame is never starved by a tick
                # loop that is already running at full tilt.
                await asyncio.sleep(max(0.0, next_tick - time.perf_counter()))
        finally:
            pump_task.cancel()
    except Exception:
        pass


def build_shared(cache_dir: str, dataset: str, circuit_name: str,
                 device: str = "auto") -> dict:
    print(f"Loading FULL connectome ({dataset}) from {cache_dir} ...")
    c = load_or_build_connectome(
        token=os.environ.get("NEUPRINT_TOKEN"),
        dataset=dataset, cache_dir=cache_dir, scope="full",
    )
    print(f"  {c.n_sm} neurons, {c.sm_adjacency.nnz} edges, source={c.source!r}")

    circuit = circuits.get(circuit_name)
    channels = {}
    for name, spec in {**circuit.inputs, **circuit.outputs}.items():
        idx = c.resolve_channel(spec)
        if len(idx):
            channels[name] = idx
    print(f"  circuit {circuit_name!r}: {len(channels)} channels resolved against the full graph")

    # The cached full connectome is normalized at fetch time, so normally this
    # is a no-op check. Re-normalizing an already-normalized matrix would leave
    # Mode A running different dynamics from the Mode B packs -- see
    # connectome.is_normalized for the numbers.
    # Device selection happens before anything heavy, so a GPU that will not
    # work is reported now rather than after a minute of setup. "auto" prefers
    # the GPU and falls back to CPU with the reason printed; see device.py.
    backend = select_device(device, adjacency=c.sm_adjacency)

    print("  checking adjacency normalization...")
    if is_normalized(c.sm_adjacency):
        print("  already normalized (spectral radius <= 0.9, diagonal -0.2); using as-is.")
        W = c.sm_adjacency.tocsr()
    else:
        print("  normalizing for stable tanh dynamics (slow, once at startup)...")
        W = _normalize_weight_matrix(c.sm_adjacency)
    # Tell the operator up front what this machine can actually sustain, rather
    # than letting them discover it as silent lag in a scene.
    probe = LabBrainRuntime(W, channels, backend=backend)
    probe.reset(noise_scale=0.01)
    probe.step(1 / 60)                 # warm-up: CuPy's first call compiles/allocates
    backend.sync()
    t0 = time.perf_counter()
    for _ in range(5):
        probe.step(1 / 60)
    backend.sync()                     # CuPy launches are async -- an unsynced
    per_step = (time.perf_counter() - t0) / 5   # timing measures only the launch
    print(f"  step cost: {per_step * 1000:.1f} ms -> max ~{1 / per_step:.0f} Hz "
          f"on {backend.name.upper()} (dtype={probe.dtype}).")
    if per_step > 1 / 30:
        print("  NOTE: below 30 Hz. Scenes needing a faster brain should use a Mode B pack"
              + ("." if backend.is_gpu else ", or install the GPU extra: uv pip install -e '.[gpu]'."))

    # Same measurement the packs ship, run against the FULL graph. Without it a
    # calibrated read means nothing in Mode A -- and raw activations here are
    # orders of magnitude quieter than on a pruned pack for identical input,
    # purely because the signal spreads over 22x more neurons. Calibration is
    # what makes one scene's thresholds work in both runtimes.
    print("  calibrating per-channel response over the full graph...")
    reference = calibrate.measure(
        W, channels, list(circuit.inputs), list(circuit.outputs),
        strict=False, backend=backend,
    )
    print(calibrate.report(reference))
    # Soma coordinates for the client's 3D point cloud. Mode B reads these from
    # the pack; Mode A has no pack, so without this the brain panel is empty --
    # which is the one panel you most want when running the whole connectome.
    #
    # Quantized to int16 over a normalized cube: 176k x 3 x 2 bytes = 1.0MB,
    # sent once at handshake. Float32 would be 2.1MB for precision no point
    # cloud can display.
    xyz = np.asarray(c.sm_soma_xyz, dtype=np.float64)
    valid = np.isfinite(xyz).all(axis=1) & (xyz != 0).any(axis=1)
    center = np.median(xyz[valid], axis=0) if valid.any() else np.zeros(3)
    radii = np.linalg.norm(xyz[valid] - center, axis=1) if valid.any() else np.array([1.0])
    scale = float(np.percentile(radii, 98.0)) or 1.0
    norm = np.zeros_like(xyz, dtype=np.float32)
    norm[valid] = ((xyz[valid] - center) / scale).astype(np.float32)
    quant = np.clip(norm * 8192.0, -32767, 32767).astype("<i2")
    soma_b64 = base64.b64encode(quant.tobytes()).decode("ascii")
    print(f"  soma cloud: {int(valid.sum())} positioned neurons, "
          f"{len(soma_b64) / 1e6:.1f}MB base64 at handshake.")

    print("  ready.")
    return {
        "adjacency": W, "channels": channels, "n": c.n_sm,
        "soma_b64": soma_b64, "soma_quant": 8192.0,
        "nnz": int(c.sm_adjacency.nnz), "dataset": c.dataset, "source": c.source,
        "reference": reference, "backend": backend,
    }


def main() -> int:
    import websockets

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--cache-dir", default=".cache")
    ap.add_argument("--dataset", default="male-cns:v1.0")
    ap.add_argument("--circuit", default="courtship-and-foraging",
                    help="which channel set to expose; the GRAPH is always full")
    ap.add_argument("--device", default="auto", choices=("auto", "gpu", "cpu"),
                    help="auto (default): use the GPU if one works, else CPU. "
                         "gpu: require a GPU, fail loudly if absent. cpu: force CPU.")
    args = ap.parse_args()

    shared = build_shared(args.cache_dir, args.dataset, args.circuit, args.device)

    async def run():
        async with websockets.serve(lambda ws: _handle(ws, shared), args.host, args.port,
                                    max_size=8 * 1024 * 1024):
            print(f"MadFly Lab Mode A server on ws://{args.host}:{args.port}")
            await asyncio.Future()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nstopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
