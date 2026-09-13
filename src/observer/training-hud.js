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
    this.badge = { trials: 0, successRate: 0, decisionState: 'IDLE', wins: 0, losses: 0 };
  }

  mount() {
    const root = document.createElement('div');
    root.className = 'madfly-training-hud';
    Object.assign(root.style, {
      // `bottom: 64px`, not `0` -- this panel grew a control-button row taller
      // than the free-standing `#log` toast (examples/hello-lab.js, fixed at
      // bottom:16px/left:16px) expects to share the corner with; flush-bottom
      // made the two visually collide (buttons overlapped by the log text).
      position: 'fixed', bottom: '64px', left: '0', width: '320px',
      padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px',
      font: `11px ${CSS.font}`, color: CSS.bone, zIndex: '10',
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

    // A big, always-visible mode pill -- LEARNING vs FROZEN/PLAYING was
    // previously only in the badge text below the graphs (small, easy to
    // miss, and the one place it's genuinely ambiguous whether "success X%"
    // means training or eval). This is the same `evaluating` flag, just
    // impossible not to notice.
    if (!document.getElementById('training-hud-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'training-hud-pulse-style';
      style.textContent = '@keyframes training-hud-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }';
      document.head.appendChild(style);
    }
    this.stateEl = document.createElement('div');
    this.stateEl.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:0.08em;'
      + 'padding:5px 8px;border-radius:5px;margin-bottom:8px;text-align:center;';
    panel.appendChild(this.stateEl);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 274;
    this.canvas.height = 130;
    Object.assign(this.canvas.style, { width: '100%', display: 'block', borderRadius: '4px' });
    panel.appendChild(this.canvas);

    this.badgeEl = document.createElement('div');
    this.badgeEl.style.cssText = `margin-top:6px;font-size:10px;line-height:1.6;color:${CSS.dim}`;
    panel.appendChild(this.badgeEl);

    // A one-line, non-wrapping status flash (see `flash()`) -- separate from
    // badgeEl so a transient "Skill copied" message can't itself change the
    // panel's height.
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = `margin-top:4px;font-size:10px;color:${CSS.cyan};height:14px;`
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    panel.appendChild(this.flashEl);

    // Control buttons -- a real grid, not flex-wrap: flex-wrap's row count
    // (and therefore the panel's total height) depends on exact pixel widths
    // and silently reflows when a browser's font metrics differ by a pixel; a
    // fixed 3-column grid gives every button the same row/height regardless.
    this.btnRow = document.createElement('div');
    this.btnRow.style.cssText = 'display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-top:8px;';
    panel.appendChild(this.btnRow);

    root.appendChild(panel);
    this.container.appendChild(root);
    this.root = root;
    this.ctx = this.canvas.getContext('2d');
    return this;
  }

  /** Add a control button. Returns the button element. */
  addButton(label, onClick, variant = 'primary') {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding:6px 4px;font:9px ${CSS.font};line-height:1.3;border-radius:4px;cursor:pointer;
      background:${variant === 'primary' ? CSS.violet : CSS.panel};
      color:${variant === 'primary' ? '#fff' : CSS.bone};
      border:${variant === 'primary' ? 'none' : `1px solid ${CSS.border}`};
    `;
    btn.onclick = onClick;
    this.btnRow.appendChild(btn);
    return btn;
  }

  /** Remove all control buttons. */
  clearButtons() {
    this.btnRow.innerHTML = '';
  }

  /** A brief, non-blocking status message (replaces alert()/confirm(), which
   * would freeze the render loop -- it and this panel share one JS thread). */
  flash(message, ms = 2400) {
    if (!this.flashEl) return;
    this.flashEl.textContent = message;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this.flashEl.textContent = ''; }, ms);
  }

  /** @param {{pam11?:number, ppl1?:number, qHit?:number, qStand?:number}} sample */
  sample(sample) {
    for (const t of this.traces) {
      t.history[this.head] = sample[t.key] ?? 0;
    }
    this.head = (this.head + 1) % HISTORY;
  }

  setBadge({ trials, successRate, decisionState, wins, losses, evaluating, evalStats, running, cap }) {
    this.badge = { trials, successRate, decisionState, wins, losses, evaluating, evalStats, running, cap };
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

    if (this.stateEl) {
      const evaluating = !!this.badge.evaluating;
      // `running` defaults to true for any caller that doesn't pass it
      // (back-compat), so a room without a Stop/Start gate keeps showing
      // LEARNING/PLAYING exactly as before -- IDLE only appears where a
      // scene actually starts stopped and passes `running: false`.
      const running = this.badge.running !== false;
      let text; let bg; let color; let pulse;
      if (!running) {
        text = '○ IDLE'; bg = 'rgba(232, 224, 245, 0.08)'; color = CSS.dim; pulse = false;
      } else if (evaluating) {
        text = '▶ PLAYING'; bg = 'rgba(0, 229, 255, 0.16)'; color = CSS.cyan; pulse = false;
      } else {
        text = '● LEARNING'; bg = 'rgba(154, 92, 255, 0.22)'; color = CSS.violet; pulse = true;
      }
      this.stateEl.textContent = text;
      this.stateEl.style.background = bg;
      this.stateEl.style.color = color;
      // Only the LEARNING state pulses -- it's the one where something is
      // actively changing every tick; frozen/idle are, honestly, not.
      this.stateEl.style.animation = pulse ? 'training-hud-pulse 1.6s ease-in-out infinite' : 'none';
    }

    if (this.badgeEl) {
      const b = this.badge;
      const lines = [
        `<span style="color:${CSS.dim}">success</span> ${(b.successRate * 100).toFixed(1)}%`
          + (b.wins != null ? ` <span style="color:${CSS.dim}">(${b.wins}W/${b.losses ?? 0}L)</span>` : ''),
        `<span style="color:${CSS.dim}">trials</span> ${b.trials}`
          + (b.cap ? ` <span style="color:${CSS.dim}">/ ${b.cap}</span>` : ''),
      ];
      if (b.evaluating) {
        const evalPct = (b.evalStats?.trials ? (b.evalStats.wins / b.evalStats.trials) * 100 : 0).toFixed(1);
        lines.push(`<span style="color:${CSS.cyan}">▶ PLAYING</span> — `
          + `${evalPct}% <span style="color:${CSS.dim}">(${b.evalStats?.trials ?? 0} hands, weights frozen)</span>`);
      }
      // Its own non-wrapping, height-fixed line: `decisionState`'s text length
      // varies every ~350ms tick ("IDLE" vs a full "[Q-LEARNING] total=18
      // dealer=6 soft -> STAND"), and letting THAT reflow inside a variable-
      // height block was what made the whole panel (and the button row below
      // it) visibly jitter tick to tick -- ellipsis-truncate it instead of
      // letting it change how tall anything is.
      lines.push(`<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${CSS.amber}">`
        + `${b.decisionState}</div>`);
      this.badgeEl.innerHTML = lines.join('<br>');
    }
  }

  dispose() { this.root?.remove(); this.root = null; }
}

// Display-only convention, matching Telemetry's -- see LabBrain for why.
const HZ_PER_ACTIVATION = 200;
