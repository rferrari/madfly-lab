/**
 * Visual Diagnostics HUD (spec 3.3) -- the ready-to-use 3-panel overlay.
 *
 *   1. Fly Retinal Vision      what the 721-column compound eye sees
 *   2. 3D Brain Soma Cloud     real soma positions, glowing by activation
 *   3. Telemetry               PAM11 / PPL1 / motor sparklines + status
 *
 * The point of this class is that a scene never builds any of it. `new
 * MadFlyLab({...})` gives you the HUD; a scene adds stations and gets
 * diagnostics for free. Everything is created in the DOM over the canvas, so
 * there is no HTML for a developer to copy.
 */

import { CSS } from '../core/theme.js';
import { RetinalView } from './retinal-view.js';
import { SomaCloud } from './soma-cloud.js';
import { Telemetry } from './telemetry.js';

const PANEL_W = 230;

const DEFAULT_TRACES = [
  { channel: 'PAM11', label: 'PAM11 dopamine', color: CSS.magenta },
  { channel: 'PPL1', label: 'PPL1 aversive', color: CSS.red },
  { channel: 'DNp09', label: 'DNp09 forward', color: CSS.lime },
  { channel: 'DNa01', label: 'DNa01 steer', color: CSS.cyan, signed: true },
];

export class LabObserver {
  constructor({ traces = null, panels = ['retina', 'cloud', 'telemetry'], container = document.body } = {}) {
    this.enabledPanels = panels;
    this.requestedTraces = traces;
    this.container = container;
    this.root = null;
    this.visible = true;
  }

  mount(lab) {
    this.lab = lab;
    const root = document.createElement('div');
    root.className = 'madfly-hud';
    root.innerHTML = '';
    Object.assign(root.style, {
      position: 'fixed', top: '0', right: '0', width: `${PANEL_W + 24}px`,
      padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px',
      font: `11px ${CSS.font}`, color: CSS.bone, pointerEvents: 'none', zIndex: '10',
    });
    this.container.appendChild(root);
    this.root = root;

    this.header = this._panel(root, 'MADFLY LAB');
    this.headerBody = document.createElement('div');
    this.headerBody.style.lineHeight = '1.6';
    this.header.appendChild(this.headerBody);

    if (this.enabledPanels.includes('retina') && lab.avatar.retina) {
      const panel = this._panel(root, 'RETINAL VISION · R1–R6');
      this.retinaCanvas = this._canvas(panel, PANEL_W, 150);
      this.retinaView = new RetinalView(this.retinaCanvas, lab.avatar.retina);
    }

    if (this.enabledPanels.includes('cloud')) {
      const panel = this._panel(root, 'BRAIN SOMA CLOUD');
      this.cloudCanvas = this._canvas(panel, PANEL_W, 190);
      this.somaCloud = new SomaCloud(this.cloudCanvas, lab.brain.pack);
      this.cloudNote = document.createElement('div');
      this.cloudNote.style.cssText = `color:${CSS.dim};font-size:9px;margin-top:4px`;
      panel.appendChild(this.cloudNote);
      if (lab.brain.mode === 'full-connectome') lab.brain.runtime.enableCloud(true);
    }

    if (this.enabledPanels.includes('telemetry')) {
      const panel = this._panel(root, 'TELEMETRY');
      this.telemetryCanvas = this._canvas(panel, PANEL_W, 150);
      const traces = this.requestedTraces ?? this._autoTraces(lab);
      this.telemetry = new Telemetry(this.telemetryCanvas, traces);
    }

    // The one interactive affordance: H hides the whole overlay for screenshots.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') this.toggle();
    });
    return this;
  }

  /** Only trace channels this pack actually contains, so a smaller circuit
   *  does not render four flat lines labelled with neurons it never loaded. */
  _autoTraces(lab) {
    const available = new Set(lab.brain.channels());
    const kept = DEFAULT_TRACES.filter((t) => available.has(t.channel));
    if (kept.length) return kept;
    return lab.brain.channels('output').slice(0, 4)
      .map((channel, i) => ({ channel, color: [CSS.cyan, CSS.magenta, CSS.lime, CSS.amber][i % 4] }));
  }

  _panel(root, title) {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: CSS.panel, border: `1px solid ${CSS.border}`, borderRadius: '8px',
      padding: '8px 10px', backdropFilter: 'blur(8px)',
    });
    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, {
      color: CSS.violet, fontSize: '9px', letterSpacing: '0.14em', marginBottom: '6px',
    });
    panel.appendChild(h);
    root.appendChild(panel);
    return panel;
  }

  _canvas(panel, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    Object.assign(c.style, { width: '100%', display: 'block', borderRadius: '4px' });
    panel.appendChild(c);
    return c;
  }

  update(lab, dt) {
    if (!this.visible) return;
    const { brain, avatar } = lab;

    this.retinaView?.draw(avatar.retina?.response, { loom: avatar.sensors.loom });

    if (this.somaCloud) {
      this.somaCloud.update(brain.runtime?.activationView?.(), dt, brain.runtime?.cloud);
      this.somaCloud.render();
      if (this.cloudNote) {
        // Mean |activation| on a pruned pack sits around 2.5e-4, which renders
        // as "0.0%" at one decimal. Exponent notation keeps the panel
        // informative across both runtimes, where the scales differ by ~1e4.
        const pop = brain.populationActivity();
        this.cloudNote.textContent = `${brain.nNeurons.toLocaleString()} real neurons · `
          + `mean |a| ${pop > 0 ? pop.toExponential(2) : '0'}`;
      }
    }

    if (this.telemetry) {
      this.telemetry.sample(brain);
      this.telemetry.draw();
    }

    if (this.headerBody) {
      const scent = avatar.olfaction.strongest();
      const modeLabel = brain.mode === 'full-connectome' ? 'MODE A · full connectome' : 'MODE B · pruned subgraph';
      this.headerBody.innerHTML = [
        `<span style="color:${CSS.cyan}">${modeLabel}</span>`,
        `<span style="color:${CSS.dim}">circuit</span> ${brain.circuit}`,
        `<span style="color:${CSS.dim}">neurons</span> ${brain.nNeurons.toLocaleString()}`,
        `<span style="color:${CSS.dim}">stations</span> ${lab.stations.length}`,
        `<span style="color:${CSS.dim}">speed</span> ${avatar.speed.toFixed(2)} u/s`,
        `<span style="color:${CSS.dim}">loom</span> <span style="color:${avatar.sensors.loom > 0.1 ? CSS.red : CSS.bone}">${avatar.sensors.loom.toFixed(2)}</span>`,
        scent.channel
          ? `<span style="color:${CSS.dim}">scent</span> ${scent.channel} ${scent.intensity.toFixed(2)}`
          : `<span style="color:${CSS.dim}">scent</span> —`,
        `<span style="color:${CSS.dim}">H to hide</span>`,
      ].join('<br>');
    }
  }

  toggle() {
    this.visible = !this.visible;
    if (this.root) this.root.style.display = this.visible ? 'flex' : 'none';
  }

  dispose() { this.root?.remove(); }
}
