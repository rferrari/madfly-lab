"""Per-channel response calibration.

The problem this solves, measured on the courtship pack: driving the visual
input channels at one common intensity produces steady-state activations of
7.1e-1 at DNp01 and 1.8e-5 at PAM11 -- a spread of 38,500x across output
channels of the same graph.

That spread is real. It is how far each population sits from the input, in
synapses and in total weight, and it is a property of the connectome rather
than a defect. But it means a RAW activation is not a usable control signal: no
single gain can put steering and the Giant Fiber in the same range at once, and
a threshold tuned on one channel is meaningless on another.

So each pack ships a measured reference response per output channel. The
runtime divides by it, giving `readCalibrated()` where ~1.0 means "as active as
this channel gets under reference drive". Raw `read()` stays untouched and
honest; calibration is a separate, clearly-labelled view.

This is a measurement of the shipped network, not a tuned constant. Rebuild the
pack and the calibration is re-measured with it.
"""

import numpy as np

# Drive applied to every input channel during calibration. Must keep the network
# in its LINEAR regime, where tanh(x) ~= x and the ratios between channels are
# scale-free -- that is what makes a calibration well-defined rather than an
# artefact of the drive that happened to be chosen.
#
# Measured on the courtship pack, doubling the drive multiplies every response by:
#
#     drive 0.5 -> 1     x1.998      linear
#     drive   1 -> 2     x1.994      linear
#     drive   5 -> 10    x1.867      departing
#     drive  25 -> 50    x1.113      saturated
#     drive  50 -> 100   x1.005      hard clipped
#
# and the PPL1/DNp01 ratio drifts from 8.93 at drive 1 to 3.36 at drive 50 as
# channels clip against tanh's ceiling at 1.0. An earlier version of this file
# used 100.0 and measured PPL1 at exactly 1.000 -- a saturated reference, which
# silently compressed the whole ranking.
REFERENCE_DRIVE = 1.0

# Doubling the drive must multiply every response by ~2 (within this tolerance)
# or the calibration was not taken in the linear regime and is meaningless.
LINEARITY_TOLERANCE = 0.05
SETTLE_SECONDS = 4.0
CALIBRATION_DT = 1.0 / 60.0

# Floor for a reference response. A channel quieter than this is genuinely
# disconnected from the pack's inputs; dividing by it would turn numerical noise
# into a control signal reading 1.0.
MIN_RESPONSE = 1e-9


def _settle(adjacency, channels, input_names, output_names, drive, backend=None) -> dict:
    from madfly_lab.brain import LabBrainRuntime

    rt = LabBrainRuntime(adjacency, channels, backend=backend)
    for name in input_names:
        rt.set_input(name, drive)
    for _ in range(int(SETTLE_SECONDS / CALIBRATION_DT)):
        rt.step(CALIBRATION_DT)

    out = {}
    acts = rt.backend.to_host(rt.activations)
    for name in output_names:
        idx = channels.get(name)
        if idx is None or not len(idx):
            continue
        out[name] = max(float(np.mean(np.abs(acts[idx]))), MIN_RESPONSE)
    return out


def measure(adjacency, channels: dict, input_names, output_names, *,
            strict: bool = True, backend=None) -> dict:
    """Steady-state |activation| of each output channel under reference drive on
    all inputs at once. Returns {channel: reference_response}.

    Driving every input together (rather than one at a time) is deliberate: it
    measures each output's response to the pack's full sensory surface, which is
    the condition a running scene is actually in.

    Also verifies the measurement was taken in the linear regime by repeating it
    at half drive: every response must halve. If it does not, the reference
    drive is saturating this graph and the calibration would be an artefact --
    raise rather than ship it.
    """
    full = _settle(adjacency, channels, input_names, output_names, REFERENCE_DRIVE, backend)
    half = _settle(adjacency, channels, input_names, output_names, REFERENCE_DRIVE / 2, backend)

    if strict and full:
        # Check only channels comfortably above the noise floor; a channel
        # sitting at MIN_RESPONSE has no meaningful ratio to test.
        offenders = []
        for name, v in full.items():
            h = half.get(name, MIN_RESPONSE)
            if v <= MIN_RESPONSE * 10 or h <= MIN_RESPONSE * 10:
                continue
            ratio = v / h
            if abs(ratio - 2.0) > LINEARITY_TOLERANCE * 2.0:
                offenders.append(f"{name} x{ratio:.3f}")
        if offenders:
            raise ValueError(
                f"Calibration drive {REFERENCE_DRIVE} is outside this graph's linear regime "
                f"(doubling it should double every response; got {', '.join(offenders[:6])}). "
                "Lower REFERENCE_DRIVE in calibrate.py -- a saturated reference silently "
                "compresses the channel ranking."
            )
    return full


def report(reference: dict) -> str:
    if not reference:
        return "    (no output channels to calibrate)"
    peak = max(reference.values())
    lines = []
    for name, v in sorted(reference.items(), key=lambda kv: -kv[1]):
        lines.append(f"    {name:16s} {v:.3e}  ({peak / v:>9,.0f}x below peak)")
    return "\n".join(lines)
