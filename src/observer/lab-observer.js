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
      alignItems: 'stretch',
    });
    this.container.appendChild(root);
    this.root = root;

    this.header = this._panel(root, 'MADFLY LAB', 32);
    this.headerBody = document.createElement('div');
    this.headerBody.style.lineHeight = '1.6';
    this.header.appendChild(this.headerBody);

    if (this.enabledPanels.includes('retina') && lab.avatar.eyes) {
      const panel = this._panel(root, 'RETINAL VISION', 130);
      this.retinaCanvas = this._canvas(panel, PANEL_W, 110);
      this.retinaView = new RetinalView(this.retinaCanvas, {
        L: lab.avatar.eyes.L.retina, R: lab.avatar.eyes.R.retina,
      });
    }

    if (this.enabledPanels.includes('cloud')) {
      const panel = this._panel(root, 'BRAIN SOMA CLOUD', 220);
      this.cloudPanel = panel;
      this.cloudCanvas = this._canvas(panel, PANEL_W, 190);
      // Mode B supplies a pack; Mode A supplies decoded soma positions.
      this.somaCloud = new SomaCloud(
        this.cloudCanvas, lab.brain.pack ?? lab.brain.runtime,
      );
      // Mode A fetches soma coordinates after the handshake, so the cloud may
      // be built empty and has to be rebuilt when they land.
      if (!lab.brain.pack && lab.brain.runtime) {
        lab.brain.runtime.onSoma = (rt) => {
          this.somaCloud = new SomaCloud(this.cloudCanvas, rt);
          this.setCloudView(this.somaCloud.view);
        };
      }
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
      const panel = this._panel(root, 'TELEMETRY', 170);
      this.telemetryCanvas = this._canvas(panel, PANEL_W, 150);
      const traces = this.requestedTraces ?? this._autoTraces(lab);
      this.telemetry = new Telemetry(this.telemetryCanvas, traces);
    }

    // Store lab reference for button callbacks
    this.lab = lab;

    // Dynamic state panel (feeding, genome circuits, etc)
    const statePanel = this._panel(root, 'STATE', 40);
    this.statePanel = statePanel;
    this.stateContent = document.createElement('div');
    this.stateContent.style.cssText = 'font-size:10px;line-height:1.4;color:' + CSS.dim;
    statePanel.appendChild(this.stateContent);

    // Recording controls panel
    const recPanel = this._panel(root, 'RECORDING', 90);
    
    // Add recording indicator to title
    const recTitle = recPanel.querySelector('div');
    this.recordingIndicator = document.createElement('span');
    this.recordingIndicator.textContent = ' ●';
    this.recordingIndicator.style.cssText = `color:${CSS.dim};margin-left:6px;animation:none;`;
    recTitle.appendChild(this.recordingIndicator);

    const recButtonsDiv = document.createElement('div');
    recButtonsDiv.style.cssText = 'display:flex;flex-direction:row;gap:4px;flex-wrap:wrap;';

    const mkRecBtn = (text, title, onClick, bgColor = CSS.panel) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.title = title;
      btn.style.cssText = `background:${bgColor};color:${CSS.bone};`
        + `border:1px solid ${CSS.border};border-radius:4px;font:9px ${CSS.font};`
        + `cursor:pointer;padding:4px 6px;white-space:nowrap;transition:all 0.2s;flex:1;min-width:50px;`;
      btn.onmouseover = () => {
        btn.style.borderColor = CSS.cyan;
        btn.style.color = CSS.cyan;
      };
      btn.onmouseout = () => {
        btn.style.borderColor = CSS.border;
        btn.style.color = CSS.bone;
      };
      btn.onclick = onClick;
      return btn;
    };

    // Record button (toggles)
    this.recordBtn = mkRecBtn(
      '● Record',
      'Start/stop recording',
      () => this.lab.toggleRecording(),
      'rgba(200, 50, 50, 0.3)'
    );
    recButtonsDiv.appendChild(this.recordBtn);

    // Replay button
    const replayBtn = mkRecBtn(
      '▶ Replay',
      'Open replay modal',
      () => this.lab.screenRecorder.openReplayModal(),
      'rgba(50, 100, 200, 0.3)'
    );
    recButtonsDiv.appendChild(replayBtn);

    // Export MP4 button
    const exportVideoBtn = mkRecBtn(
      '💾 MP4',
      'Export as MP4 video',
      () => this.lab.screenRecorder.exportVideo(),
      'rgba(50, 150, 50, 0.3)'
    );
    recButtonsDiv.appendChild(exportVideoBtn);

    // Export JSON button
    const exportJsonBtn = mkRecBtn(
      '📊 JSON',
      'Export telemetry as JSON',
      () => this.lab.screenRecorder.exportTelemetry(),
      'rgba(150, 100, 50, 0.3)'
    );
    recButtonsDiv.appendChild(exportJsonBtn);

    // Clear button
    const clearBtn = mkRecBtn(
      '🗑 Clear',
      'Clear recording (cannot undo)',
      () => {
        if (confirm('Clear recording? This cannot be undone.')) {
          this.lab.screenRecorder.clear();
        }
      },
      'rgba(100, 50, 100, 0.3)'
    );
    recButtonsDiv.appendChild(clearBtn);

    recPanel.appendChild(recButtonsDiv);

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

  _panel(root, title, minHeight = null) {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: CSS.panel, border: `1px solid ${CSS.border}`, borderRadius: '8px',
      padding: '8px 10px', backdropFilter: 'blur(8px)',
      flexShrink: '0',  // Reserve space, don't collapse
      ...(minHeight && { minHeight: `${minHeight}px` }),  // Set minimum height if provided
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

    // Update record button and indicator state
    if (this.recordBtn && this.recordingIndicator && lab.screenRecorder) {
      if (lab.screenRecorder.isRecording) {
        this.recordBtn.textContent = '⏹ Stop';
        this.recordBtn.style.background = 'rgba(255, 50, 50, 0.6)';
        this.recordBtn.style.color = '#ff3333';
        
        // Blinking indicator
        this.recordingIndicator.textContent = ' ●';
        this.recordingIndicator.style.color = '#ff3333';
        this.recordingIndicator.style.animation = 'blink 0.6s infinite';
      } else {
        this.recordBtn.textContent = '● Record';
        this.recordBtn.style.background = 'rgba(200, 50, 50, 0.3)';
        this.recordBtn.style.color = CSS.bone;
        
        // Dim indicator
        this.recordingIndicator.textContent = ' ●';
        this.recordingIndicator.style.color = CSS.dim;
        this.recordingIndicator.style.animation = 'none';
      }
    }

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
        `<span style="color:${CSS.dim}">neurons</span> ${brain.nNeurons.toLocaleString()}`,

        `<span style="color:${CSS.dim}">speed</span> ${avatar.speed.toFixed(2)} u/s`,
        `<span style="color:${CSS.dim}">loom</span> <span style="color:${avatar.sensors.loom > 0.1 ? CSS.red : CSS.bone}">L ${avatar.sensors.loomL.toFixed(2)} R ${avatar.sensors.loomR.toFixed(2)}</span>`,
        avatar.sensors.wind > 0.02
          ? `<span style="color:${CSS.dim}">wind</span> <span style="color:${CSS.cyan}">${avatar.sensors.wind.toFixed(2)}</span>`
          : '',
        `<span style="color:${CSS.dim}">poke</span> <span style="color:${avatar.sensors.touch > 0.05 ? CSS.amber : CSS.bone}">${avatar.sensors.touch.toFixed(2)}</span>`,
        scent.channel
          ? `<span style="color:${CSS.dim}">scent</span> ${scent.channel} ${scent.intensity.toFixed(2)}`
          : `<span style="color:${CSS.dim}">scent</span> —`,
        // `<span style="color:${CSS.dim}">H to hide</span>`, //duplicated.
      ].filter(Boolean).join('<br>');
    }

    // Update STATE panel with genotype and feeding info
    if (this.stateContent) {
      const stateItems = [
        lab.genotype
          ? `<span style="color:${CSS.dim}">genotype</span> <span style="color:${CSS.amber}">${describeGenotype(lab.genotype)}</span>`
          : '',
        // "Feeding" is a Room 1 concept (it suppresses locomotion at a food
        // bowl); a tethered fly isn't at a bowl, so showing it in Room 2 would
        // just be confusing cross-talk from whatever else is driving DNp06.
        avatar.feeding && lab.room !== 'tethered-rig'
          ? `<span style="color:${CSS.lime}">FEEDING · DNp06 ${avatar.motor.feeding.toFixed(2)}</span>`
          : '',
      ];
      const stateHTML = stateItems.filter(Boolean).join('<br>');
      // Always reserve space with at least a space character to prevent flicker
      this.stateContent.innerHTML = stateHTML || '&nbsp;';
    }
  }

  /** Set STATE panel content (e.g., feeding mode, genome info).
   *  Pass null to clear. Content stays at bottom, reserved space prevents flicker. */
  setState(content) {
    if (!this.stateContent) return;
    if (content === null || content === undefined) {
      this.stateContent.innerHTML = '';
    } else if (typeof content === 'string') {
      this.stateContent.textContent = content;
    } else if (content instanceof HTMLElement) {
      this.stateContent.innerHTML = '';
      this.stateContent.appendChild(content);
    }
  }

  /** Set STATE panel HTML content directly */
  setStateHTML(html) {
    if (!this.stateContent) return;
    this.stateContent.innerHTML = html;
  }

  /** Clear STATE panel content */
  clearState() {
    this.setState(null);
  }

  toggle() {
    this.visible = !this.visible;
    if (this.root) this.root.style.display = this.visible ? 'flex' : 'none';
  }

  dispose() { this.root?.remove(); }
}
