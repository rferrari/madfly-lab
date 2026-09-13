/**
 * TrainingHUD -- Room 2's overlay: a live sparkline for PAM11 dopamine / PPL1
 * aversive / the two Q-values, plus a diagnostics badge (success rate, trial
 * count, current decision).
 *
 * Deliberately separate from `Telemetry` (the free-roaming HUD's brain-channel
 * sparkline): Q-values are not brain channels, they live in a QReadout, so
 * this panel is fed explicit samples rather than reading `brain.read()` itself.
 */

import { CSS } from '../core/theme.js';

const HISTORY = 160;

export class TrainingHUD {
  constructor(container = document.body) {
    this.container = container;
    this.root = null;
    this.traces = [
      { key: 'pam11', label: 'PAM11 dopamine', color: CSS.magenta, history: new Float32Array(HISTORY) },
      { key: 'ppl1', label: 'PPL1 aversive', color: CSS.red, history: new Float32Array(HISTORY) },
      { key: 'qHit', label: 'Q(Hit)', color: CSS.cyan, history: new Float32Array(HISTORY), signed: true },
      { key: 'qStand', label: 'Q(Stand)', color: CSS.lime, history: new Float32Array(HISTORY), signed: true },
    ];
    this.head = 0;
    this.badge = { trials: 0, successRate: 0, decisionState: 'IDLE' };
  }

  mount() {
    const root = document.createElement('div');
    root.className = 'madfly-training-hud';
    Object.assign(root.style, {
      position: 'fixed', bottom: '0', left: '0', width: '260px',
      padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px',
      font: `11px ${CSS.font}`, color: CSS.bone, pointerEvents: 'none', zIndex: '10',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: CSS.panel, border: `1px solid ${CSS.border}`, borderRadius: '8px',
      padding: '8px 10px', backdropFilter: 'blur(8px)',
    });
    const title = document.createElement('div');
    title.textContent = 'TETHERED TRAINING';
    Object.assign(title.style, { color: CSS.violet, fontSize: '9px', letterSpacing: '0.14em', marginBottom: '6px' });
    panel.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 236;
    this.canvas.height = 130;
    Object.assign(this.canvas.style, { width: '100%', display: 'block', borderRadius: '4px' });
    panel.appendChild(this.canvas);

    this.badgeEl = document.createElement('div');
    this.badgeEl.style.cssText = `margin-top:6px;font-size:10px;line-height:1.6;color:${CSS.dim}`;
    panel.appendChild(this.badgeEl);

    root.appendChild(panel);
    this.container.appendChild(root);
    this.root = root;
    this.ctx = this.canvas.getContext('2d');
    return this;
  }

  /** @param {{pam11?:number, ppl1?:number, qHit?:number, qStand?:number}} sample */
  sample(sample) {
    for (const t of this.traces) {
      t.history[this.head] = sample[t.key] ?? 0;
    }
    this.head = (this.head + 1) % HISTORY;
  }

  setBadge({ trials, successRate, decisionState }) {
    this.badge = { trials, successRate, decisionState };
  }

  update() {
    if (!this.ctx) return;
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
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      // Q-values are signed and can be any scale; scale each trace to its own
      // recent peak rather than a fixed dial, since a linear readout's range
      // depends entirely on training and has no natural units.
      let peak = 1e-6;
      for (let i = 0; i < HISTORY; i++) peak = Math.max(peak, Math.abs(t.history[i]));
      const scale = (rowH / 2 - 3) / peak;

      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < HISTORY; i++) {
        const v = t.history[(this.head + i) % HISTORY];
        const x = (i / (HISTORY - 1)) * w;
        const y = mid - v * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const latest = t.history[(this.head - 1 + HISTORY) % HISTORY];
      ctx.fillStyle = CSS.dim;
      ctx.font = `9px ${CSS.font}`;
      ctx.fillText(t.label, 4, y0 + 10);
      ctx.fillStyle = t.color;
      ctx.textAlign = 'right';
      const label = t.key === 'pam11' || t.key === 'ppl1'
        ? `${(Math.abs(latest) * HZ_PER_ACTIVATION).toFixed(0)} Hz`
        : latest.toFixed(3);
      ctx.fillText(label, w - 4, y0 + 10);
      ctx.textAlign = 'left';
    });

    if (this.badgeEl) {
      const b = this.badge;
      this.badgeEl.innerHTML = [
        `<span style="color:${CSS.dim}">success</span> ${(b.successRate * 100).toFixed(1)}%`,
        `<span style="color:${CSS.dim}">trials</span> ${b.trials}`,
        `<span style="color:${CSS.amber}">${b.decisionState}</span>`,
      ].join('<br>');
    }
  }

  dispose() { this.root?.remove(); this.root = null; }
}

// Display-only convention, matching Telemetry's -- see LabBrain for why.
const HZ_PER_ACTIVATION = 200;
