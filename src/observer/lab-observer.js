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
import { describeGenotype } from '../avatar/genotype.js';
import { RetinalView } from './retinal-view.js';
import { SomaCloud } from './soma-cloud.js';
import { Telemetry } from './telemetry.js';

const PANEL_W = 230;

const DEFAULT_TRACES = [
  { channel: 'PAM11', label: 'PAM11 dopamine', color: CSS.magenta },
  { channel: 'PPL1', label: 'PPL1 aversive', color: CSS.red },
  { channel: 'DNp09', label: 'DNp09 forward', color: CSS.lime },
  { channel: 'DNa01', label: 'DNa01 steer', color: CSS.cyan, signed: true },
  { channel: 'touch', label: 'poke (tactile)', color: CSS.amber },
  { channel: 'DNp06', label: 'DNp06 feeding', color: CSS.lime },
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

    if (this.enabledPanels.includes('retina') && lab.avatar.eyes) {
      const panel = this._panel(root, 'RETINAL VISION');
      this.retinaCanvas = this._canvas(panel, PANEL_W, 110);
      this.retinaView = new RetinalView(this.retinaCanvas, {
        L: lab.avatar.eyes.L.retina, R: lab.avatar.eyes.R.retina,
      });
    }

    if (this.enabledPanels.includes('cloud')) {
      const panel = this._panel(root, 'BRAIN SOMA CLOUD');
      this.cloudPanel = panel;
      this.cloudCanvas = this._canvas(panel, PANEL_W, 190);
      // Mode B supplies a pack; Mode A supplies decoded soma positions.
      this.somaCloud = new SomaCloud(
        this.cloudCanvas, lab.brain.pack ?? lab.brain.runtime,
      );
      // View buttons: rotate / front / left / right / top.
      // Zoom sits top-right, overlaid on the canvas; view buttons run along the
      // bottom. Keeps the two kinds of control visually separate.
      panel.style.position = 'relative';
      const zoomBar = document.createElement('div');
      zoomBar.style.cssText = 'position:absolute;top:22px;right:10px;display:flex;'
        + 'flex-direction:column;gap:3px;pointer-events:auto;z-index:2';
      panel.appendChild(zoomBar);

      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:3px;margin-top:5px;pointer-events:auto';
      this.viewButtons = {};
      const mkBtn = (parent, text, title, onClick, style = '') => {
        const b = document.createElement('button');
        b.textContent = text;
        b.title = title;
        b.style.cssText = `background:${CSS.panel};color:${CSS.dim};`
          + `border:1px solid ${CSS.border};border-radius:3px;font:10px ${CSS.font};`
          + `cursor:pointer;${style}`;
        b.onclick = onClick;
        parent.appendChild(b);
        return b;
      };
      mkBtn(zoomBar, '+', 'zoom in', () => { this.somaCloud?.zoom(1.25); },
        'width:18px;height:18px;padding:0;line-height:1');
      mkBtn(zoomBar, '−', 'zoom out', () => { this.somaCloud?.zoom(1 / 1.25); },
        'width:18px;height:18px;padding:0;line-height:1');

      for (const v of ['rotate', 'front', 'left', 'right', 'top']) {
        this.viewButtons[v] = mkBtn(
          bar, v === 'rotate' ? '↻' : v[0].toUpperCase(), v,
          () => this.setCloudView(v), 'flex:1;padding:2px 0;font-size:9px',
        );
      }
      panel.appendChild(bar);
      this._highlightView('front');


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

  setCloudView(view) {
    this.somaCloud?.setView(view);
    this._highlightView(view);
    return view;
  }

  cycleCloudView() {
    const v = this.somaCloud?.cycleView();
    if (v) this._highlightView(v);
    return v;
  }

  _highlightView(active) {
    for (const [v, b] of Object.entries(this.viewButtons ?? {})) {
      const on = v === active;
      b.style.color = on ? CSS.cyan : CSS.dim;
      b.style.borderColor = on ? CSS.cyan : CSS.border;
    }
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

    if (this.retinaView && avatar.eyes) {
      this.retinaView.draw(
        { L: avatar.eyes.L.retina.response, R: avatar.eyes.R.retina.response },
        { L: avatar.sensors.loomL, R: avatar.sensors.loomR },
      );
    }

    if (this.somaCloud) {
      this.somaCloud.update(brain.runtime?.activationView?.(), dt, brain.runtime?.cloud);
      this.somaCloud.render();

    }

    if (this.telemetry) {
      this.telemetry.sample(brain);
      this.telemetry.draw();
    }

    if (this.headerBody) {
      const scent = avatar.olfaction.strongest();
      const remote = brain.runtime?.info;
      const modeLabel = brain.mode === 'full-connectome'
        ? `MODE A · full connectome${remote?.device ? ` · ${remote.device.toUpperCase()}` : ''}`
        : 'MODE B · pruned subgraph · CPU';
      this.headerBody.innerHTML = [
        `<span style="color:${CSS.cyan}">${modeLabel}</span>`,
        `<span style="color:${CSS.dim}">circuit</span> ${brain.circuit}`,
        lab.genotype
          ? `<span style="color:${CSS.dim}">genotype</span> <span style="color:${CSS.amber}">${describeGenotype(lab.genotype)}</span>`
          : '',
        `<span style="color:${CSS.dim}">neurons</span> ${brain.nNeurons.toLocaleString()}`,

        `<span style="color:${CSS.dim}">speed</span> ${avatar.speed.toFixed(2)} u/s`,
        `<span style="color:${CSS.dim}">loom</span> <span style="color:${avatar.sensors.loom > 0.1 ? CSS.red : CSS.bone}">L ${avatar.sensors.loomL.toFixed(2)} R ${avatar.sensors.loomR.toFixed(2)}</span>`,
        avatar.feeding
          ? `<span style="color:${CSS.lime}">FEEDING · DNp06 ${avatar.motor.feeding.toFixed(2)}</span>`
          : '',
        `<span style="color:${CSS.dim}">poke</span> <span style="color:${avatar.sensors.touch > 0.05 ? CSS.amber : CSS.bone}">${avatar.sensors.touch.toFixed(2)}</span>`,
        scent.channel
          ? `<span style="color:${CSS.dim}">scent</span> ${scent.channel} ${scent.intensity.toFixed(2)}`
          : `<span style="color:${CSS.dim}">scent</span> —`,
        `<span style="color:${CSS.dim}">H to hide</span>`,
      ].filter(Boolean).join('<br>');
    }
  }

  toggle() {
    this.visible = !this.visible;
    if (this.root) this.root.style.display = this.visible ? 'flex' : 'none';
  }

  dispose() { this.root?.remove(); }
}
