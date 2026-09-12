# Mode A — full-connectome WebSocket protocol

Server: `python/src/madfly_lab/server.py`. Client: `src/brain/remote-runtime.js`.

Python owns the neural state; the browser renders it and never waits for it.
This is the same thin-client split proven in `fly_drone_delivery` and
`fly_speed_dating`, with one difference: this server owns **only the brain**.
Scene state — stations, avatar pose, scoring — stays in the browser, because in
MadFly Lab the scene is the developer's code and the brain is the framework's.

```bash
npm run brain:full
# or
cd python && uv run python -m madfly_lab.server \
  --cache-dir ../../fly_simulation/.cache --circuit courtship-and-foraging
```

## Client → server

| Message | Effect |
|---|---|
| `{op:"hello", circuit, tickHz}` | open a session; must be first |
| `{op:"input", channel, intensity}` | sustained drive, held until changed |
| `{op:"inject", channel, amount, decayTicks}` | one-shot pulse, fades linearly |
| `{op:"clear"}` | drop all inputs |
| `{op:"reset", noise}` | re-initialize activations |
| `{op:"subscribe", channels, cloud}` | choose what streams back |

## Server → client

```jsonc
{ "op": "ready", "mode": "full-connectome",
  "nNeurons": 176422, "nEdges": 25739518,
  "dataset": "male-cns:v1.0", "source": "real_full",
  "channels": { "PAM11": 15, "DNp01": 2, "ORN_DA1": 204, … } }

{ "op": "tick", "t": 12.34, "dt": 0.0167, "achievedHz": 26.8,
  "readings": { "DNa01": -0.000011, … },
  "population": 0.00001, "peak": 0.0442,
  "cloud": { "idx": [...], "act": [...] } }   // only if subscribed

{ "op": "error", "message": "…" }             // one bad frame never kills a session
```

## Performance

A step is one sparse mat-vec over 25.7M real edges. Measured on a desktop
(Linux, float32): **~37 ms in isolation, ~45–55 ms under the server's own
serialization load, so roughly 20 Hz sustained**. The server probes this at
startup and prints the ceiling rather than letting you discover it as silent
lag:

```
step cost: 55.6 ms -> max ~18 Hz on this host (dtype=float32).
NOTE: below 30 Hz. Scenes needing a faster brain should use a Mode B pack.
```

For comparison, the 7,922-neuron Mode B pack steps in **2.7 ms** — Mode A buys
the whole brain, at roughly 20× the cost per step.

`achievedHz` in every tick reports what is actually being delivered against the
requested `tickHz`. If a step overruns its budget the loop resynchronizes to the
wall clock instead of accumulating a deficit — otherwise simulated time `t`
races ahead of real time with no way for the client to tell.

### The dtype trap

Activations must share the adjacency's dtype. scipy upcasts a float32 matrix
times a float64 vector on **every call**; on this graph that mismatch costs
**180 ms per step instead of 37 ms** — a 4.8× penalty that silently caps the
server near 5 Hz. `LabBrainRuntime` pins `self.dtype` from the matrix for this
reason.

## Mode A and Mode B are not numerically identical

The same real input produces much smaller activations on the full graph than on
a pruned pack — around `1e-5` versus `1e-1` — simply because the signal is
diluted across 22× more neurons. Both are the same real connectivity and the
same dynamics; the scale differs.

Consequences:

- **Thresholds do not port directly.** An `onSignal` threshold tuned in Mode B
  will rarely fire in Mode A. Scale by peak, or tune per mode.
- **The soma cloud uses a relative cut.** `active_indices` thresholds against
  the current peak, not an absolute value. An absolute 0.05 cut leaves the Mode
  A cloud permanently empty — it did, before this was fixed.
- **`peak` ships in every tick** so a client can normalize.

Mode A's value is that the signal travels through the *whole* real brain,
including every pathway pruning removed. Mode B's value is that it runs at 60 Hz
in a tab with no server. Pick per scene.
