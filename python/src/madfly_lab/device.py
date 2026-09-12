"""CPU / GPU backend selection for the Mode A neural runtime.

Mode A steps one sparse mat-vec over 25.7M real edges per tick. On CPU that is
scipy's single-threaded CSR kernel -- measured at 37-83 ms on an i7-9750H, which
caps the server near 12-20 Hz. SpMV is memory-bandwidth-bound, and a discrete
GPU has several times the bandwidth plus far more parallelism, so this is the
one part of the framework where a GPU genuinely changes what is possible.

CuPy is the backend: `cupyx.scipy.sparse.csr_matrix` is API-compatible with
scipy's, so `W @ a` and `cp.tanh` need no separate code path -- only the array
module differs. CuPy's `cupy-cuda12x` wheel bundles the CUDA runtime, so a
recent NVIDIA driver is the only system requirement.

DEFAULT IS "auto", NOT "gpu", deliberately. A hard "gpu" default turns a missing
driver, a busy GPU, or too little VRAM into a crash on a machine where the CPU
path would have worked fine. "auto" prefers the GPU, says loudly which one it
chose and why, and falls back. Pass device="gpu" to make GPU a hard requirement
(it then raises rather than silently running slow), or device="cpu" to force it.
"""

import numpy as np
import scipy.sparse as sp

DEVICES = ("auto", "gpu", "cpu")


class Backend:
    """Array-module wrapper. `xp` is numpy or cupy; `sparse` is the matching
    sparse module. Everything else in the runtime is written against these."""

    def __init__(self, name: str, xp, sparse_mod, detail: str = ""):
        self.name = name          # "cpu" | "gpu"
        self.xp = xp
        self.sparse = sparse_mod
        self.detail = detail

    @property
    def is_gpu(self) -> bool:
        return self.name == "gpu"

    def is_on_device(self, array) -> bool:
        """True if `array` already lives on this backend."""
        if not self.is_gpu:
            return not hasattr(array, "get")      # cupy arrays expose .get()
        return type(array).__module__.startswith(("cupy", "cupyx"))

    def to_device(self, array):
        """Move a numpy array (or scipy sparse matrix) onto this backend.

        Returns an array that is ALREADY on this device untouched. That check is
        load-bearing, not defensive: the Mode A server builds one runtime per
        connected client over the same shared adjacency, and without it every
        new session re-uploaded the full 206MB CSR matrix to the GPU. The
        upload blocked the event loop long enough that a client's handshake
        took 13.6 seconds, `mode: auto` timed out, and the browser fell back to
        a pruned pack with a perfectly healthy GPU server running. It also
        capped concurrent sessions at whatever fraction of VRAM 206MB divides
        into.
        """
        if self.is_on_device(array):
            return array
        if not self.is_gpu:
            return array
        if sp.issparse(array):
            return self.sparse.csr_matrix(array.tocsr())
        return self.xp.asarray(array)

    def to_host(self, array) -> np.ndarray:
        """Bring a result back to numpy, for JSON serialization."""
        if self.is_gpu and hasattr(array, "get"):
            return array.get()
        return np.asarray(array)

    def sync(self) -> None:
        """Block until queued GPU work finishes -- required before timing
        anything, since CuPy kernel launches are asynchronous and an unsynced
        benchmark measures only the launch."""
        if self.is_gpu:
            self.xp.cuda.runtime.deviceSynchronize()

    def __repr__(self) -> str:
        return f"<Backend {self.name}{' ' + self.detail if self.detail else ''}>"


def _try_gpu() -> tuple:
    """Returns (Backend, None) on success or (None, reason) on failure."""
    try:
        import cupy as cp
        import cupyx.scipy.sparse as cusp
    except ImportError:
        return None, (
            "cupy is not installed. Install the wheel matching your CUDA driver, "
            "e.g. `uv pip install cupy-cuda12x` (it bundles the CUDA runtime; only "
            "an NVIDIA driver is needed)."
        )
    try:
        count = cp.cuda.runtime.getDeviceCount()
        if count == 0:
            return None, "cupy is installed but reports no CUDA device."
        props = cp.cuda.runtime.getDeviceProperties(0)
        name = props["name"].decode() if isinstance(props["name"], bytes) else str(props["name"])
        free, total = cp.cuda.runtime.memGetInfo()

        # Probe with the operation this runtime ACTUALLY performs: a sparse
        # mat-vec plus tanh. A dense `cp.zeros(8).sum()` is not good enough --
        # it exercises only core CUDA, so a cupy install missing libcusparse
        # passes it and then throws on the first real step. That happened here:
        # `auto` selected the GPU and crashed rather than falling back, which
        # defeats the entire point of having a fallback. Probe what you use.
        probe = cusp.csr_matrix(
            (cp.asarray([0.5, 0.5], dtype=cp.float32),
             cp.asarray([0, 1], dtype=cp.int32),
             cp.asarray([0, 1, 2], dtype=cp.int32)),
            shape=(2, 2),
        )
        v = cp.asarray([1.0, -1.0], dtype=cp.float32)
        result = cp.tanh(probe @ v)
        cp.cuda.runtime.deviceSynchronize()
        if not bool(cp.isfinite(result).all()):
            return None, "GPU sparse probe returned non-finite values."

        detail = f"{name}, {free / 1e9:.1f}GB free of {total / 1e9:.1f}GB"
        return Backend("gpu", cp, cusp, detail), None
    except Exception as e:
        # ImportError here almost always means the cupy wheel is present but its
        # CUDA libraries are not; name the fix rather than the symptom.
        hint = ""
        if isinstance(e, ImportError) and "lib" in str(e):
            hint = (" -- the cupy wheel is missing its CUDA libraries; install them with "
                    "`uv pip install nvidia-cusparse-cu12 nvidia-cublas-cu12 "
                    "nvidia-nvjitlink-cu12 nvidia-cuda-runtime-cu12`")
        return None, f"cupy is installed but the device is unusable: {type(e).__name__}: {e}{hint}"


def cpu_backend() -> Backend:
    import platform
    return Backend("cpu", np, sp, f"{platform.processor() or platform.machine()}")


def fits_on_device(backend: Backend, adjacency, safety: float = 1.6) -> tuple:
    """Would this graph fit in free VRAM? Returns (ok, message).

    The CSR arrays alone are data + indices + indptr; cuSPARSE also needs
    scratch, and the activation vectors are small but not free -- hence the
    safety factor. Checking up front turns a mid-run CUDA OOM into a clean
    fallback decision.
    """
    if not backend.is_gpu:
        return True, ""
    W = adjacency.tocsr()
    need = (W.data.nbytes + W.indices.nbytes + W.indptr.nbytes) * safety
    free, _total = backend.xp.cuda.runtime.memGetInfo()
    if need > free:
        return False, (f"graph needs ~{need / 1e9:.1f}GB with headroom but only "
                       f"{free / 1e9:.1f}GB is free on the device")
    return True, f"{need / 1e9:.2f}GB of {free / 1e9:.1f}GB free"


def select(device: str = "auto", *, adjacency=None, verbose: bool = True) -> Backend:
    """Resolve a device request to a concrete Backend.

    "auto" prefers GPU and falls back to CPU with a printed reason.
    "gpu" raises if unavailable -- use when slow is worse than failing.
    "cpu" never touches CUDA.
    """
    if device not in DEVICES:
        raise ValueError(f"device must be one of {DEVICES}, got {device!r}")

    if device == "cpu":
        b = cpu_backend()
        if verbose:
            print(f"  device: CPU ({b.detail}) -- requested explicitly.")
        return b

    gpu, reason = _try_gpu()
    if gpu is not None and adjacency is not None:
        ok, msg = fits_on_device(gpu, adjacency)
        if not ok:
            gpu, reason = None, msg
        elif verbose and msg:
            gpu.detail += f"; graph {msg}"
    if gpu is not None:
        if verbose:
            print(f"  device: GPU ({gpu.detail}).")
        return gpu

    if device == "gpu":
        raise RuntimeError(
            f"device='gpu' was requested but no usable GPU is available: {reason}\n"
            "Pass device='auto' to fall back to CPU, or device='cpu' to skip the check."
        )

    b = cpu_backend()
    if verbose:
        print(f"  device: CPU ({b.detail}) -- no GPU available: {reason}")
    return b


def benchmark(backend: Backend, adjacency, n_steps: int = 10) -> float:
    """Seconds per step on this backend. Synchronizes, and discards a warm-up
    step so CuPy's first-call JIT/allocation does not land in the average."""
    import time
    xp = backend.xp
    W = backend.to_device(adjacency)
    a = xp.zeros(W.shape[0], dtype=xp.float32)
    a = xp.tanh(W @ a)          # warm-up
    backend.sync()
    t0 = time.perf_counter()
    for _ in range(n_steps):
        a = xp.tanh(W @ a)
    backend.sync()
    return (time.perf_counter() - t0) / n_steps
