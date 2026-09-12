/**
 * HUD panel 3 -- Telemetry sparklines (spec 3.3).
 *
 * Live traces for whatever channels a scene cares about. The spec names PAM11
 * dopamine firing, PPL1 aversive drive and motor output; those are the
 * defaults, but any real channel in the pack can be traced.
 *
 * UNITS: traces are labelled in Hz because a dopamine readout in Hz is what a
 * neuroscientist expects to see, but the underlying value is a dimensionless
 * tanh activation scaled by HZ_PER_ACTIVATION. That scaling is a display
 * convention this framework invented (see lab-brain.js). The connectivity
 * driving the trace is real; the Hz label on the axis is not a measurement.
 */

import { CSS } from '../core/theme.js';
import { HZ_PER_ACTIVATION } from '../brain/lab-brain.js';

const HISTORY = 160;

export class Telemetry {
  constructor(canvas, traces) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.traces = traces.map((t) => ({
      channel: t.channel,
      label: t.label ?? t.channel,
      color: t.color ?? CSS.cyan,
      signed: t.signed ?? false,
      history: new Float32Array(HISTORY),
      head: 0,
    }));
  }

  sample(brain) {
    for (const t of this.traces) {
      // CALIBRATED, not raw. Raw activations on a pruned pack run around 3e-5,
      // which renders as a flat "0 Hz" line on every trace -- a diagnostics
      // panel that always reads zero is worse than no panel. Calibration puts
      // every channel on a comparable ~[-1,1] scale first. See LabBrain.
      const v = brain.readCalibrated(t.channel);
      t.history[t.head] = t.signed ? v : Math.abs(v);
      t.head = (t.head + 1) % HISTORY;
    }
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const rowH = h / this.traces.length;
    this.traces.forEach((t, row) => {
      const y0 = row * rowH;
      const mid = y0 + rowH / 2;

      ctx.strokeStyle = 'rgba(154, 92, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, t.signed ? mid : y0 + rowH - 2);
      ctx.lineTo(w, t.signed ? mid : y0 + rowH - 2);
      ctx.stroke();

      // Scale traces to a fixed 0-200 Hz dial so panels stay comparable frame
      // to frame; an autoscaling sparkline hides exactly the change you want.
      const scale = (rowH / 2 - 3) / 1.0;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < HISTORY; i++) {
        const v = t.history[(t.head + i) % HISTORY];
        const x = (i / (HISTORY - 1)) * w;
        const y = t.signed ? mid - v * scale : y0 + rowH - 2 - Math.min(1, v) * (rowH - 5);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const latest = t.history[(t.head - 1 + HISTORY) % HISTORY];
      ctx.fillStyle = CSS.dim;
      ctx.font = `9px ${CSS.font}`;
      ctx.fillText(t.label, 4, y0 + 10);
      ctx.fillStyle = t.color;
      ctx.textAlign = 'right';
      ctx.fillText(`${(Math.abs(latest) * HZ_PER_ACTIVATION).toFixed(0)} Hz`, w - 4, y0 + 10);
      ctx.textAlign = 'left';
    });
  }
}
