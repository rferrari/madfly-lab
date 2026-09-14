/**
 * Scientist Workbench & Mission-Control 3D Dashboard UI for Room 7 Neuro-Debugger
 *
 * HONESTY NOTE: Activations are dimensionless tanh values in [-1, 1], not mV or Hz.
 * Sensory drives are engineered measurements into real cell populations.
 */

import { CSS } from '../../src/core/theme.js';
import { SCENARIOS, GENOTYPES } from './pipeline-runner.js';
import { evaluateAssertions, generateMarkdownReport, exportReportBrowser } from './report-writer.js';

export class DebuggerHUD {
  constructor(lab, runner, recorder) {
    this.lab = lab;
    this.runner = runner;
    this.recorder = recorder;

    this.container = document.createElement('div');
    this.container.id = 'neuro-debugger-workbench';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 100;
      font-family: ${CSS.font};
      color: ${CSS.bone};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 12px;
      box-sizing: border-box;
    `;

    this.selectedScenario = SCENARIOS[0].id;
    this.selectedControlGenotype = GENOTYPES[0].spec; // default Wild-Type
    this.selectedMutantGenotype = GENOTYPES[2].spec;  // default LC4 lesioned
    this.pipelineTicks = 300;
    this.lastPipelineResults = null;
    this.notes = [];
    this.isPlayingReplay = false;
    this.replayTimer = null;
    this.halo = null;
    this.autoDiscover = null;

    this._buildUI();
  }

  _buildUI() {
    this.container.innerHTML = `
      <!-- TOP CONTROL & PIPELINE MANAGER BAR (Restricted to safe area left of LabObserver) -->
      <div style="display: flex; flex-direction: column; gap: 6px; pointer-events: auto; margin-right: 268px;">
        <!-- Top Marquee Banner -->
        <div style="
          background: rgba(18, 10, 34, 0.92);
          border: 1px solid ${CSS.border};
          border-radius: 8px;
          padding: 6px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 0 15px rgba(0, 229, 255, 0.15);
        ">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: ${CSS.cyan}; font-weight: bold; letter-spacing: 0.12em; font-size: 12px;">🔬 NEURO-DEBUGGER</span>
            <span id="debugger-ticker" style="color: ${CSS.bone}; font-size: 11px;">Select scenario, control & target fly to manage pipeline.</span>
          </div>
          <div style="font-size: 10px; color: ${CSS.dim};">ROOM 7 · CONNECTOMICS AGENT</div>
        </div>

        <!-- Glassmorphic Toolbar Controls -->
        <div style="
          background: ${CSS.panel};
          border: 1px solid ${CSS.border};
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
        ">
          <!-- Scenario Selector Group -->
          <div class="hud-control-group" style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(0, 229, 255, 0.2);
            padding: 4px 8px;
            border-radius: 6px;
          ">
            <label style="font-size: 10px; color: ${CSS.dim}; text-transform: uppercase;">Scenario:</label>
            <select id="scenario-select" style="
              background: rgba(11, 6, 20, 0.9);
              color: ${CSS.cyan};
              border: 1px solid ${CSS.border};
              border-radius: 4px;
              padding: 3px 6px;
              font-family: ${CSS.font};
              font-size: 11px;
              cursor: pointer;
              outline: none;
            ">
              ${SCENARIOS.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>

          <!-- Control Fly Selector Group -->
          <div class="hud-control-group" style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(57, 255, 136, 0.2);
            padding: 4px 8px;
            border-radius: 6px;
          ">
            <label style="font-size: 10px; color: ${CSS.lime}; text-transform: uppercase;">Control:</label>
            <select id="control-select" style="
              background: rgba(11, 6, 20, 0.9);
              color: ${CSS.lime};
              border: 1px solid ${CSS.border};
              border-radius: 4px;
              padding: 3px 6px;
              font-family: ${CSS.font};
              font-size: 11px;
              cursor: pointer;
              outline: none;
            ">
              ${GENOTYPES.map((g, idx) => `<option value="${g.id}" ${idx === 0 ? 'selected' : ''}>${g.name}</option>`).join('')}
            </select>
          </div>

          <!-- Target Fly Selector Group -->
          <div class="hud-control-group" style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 43, 214, 0.2);
            padding: 4px 8px;
            border-radius: 6px;
          ">
            <label style="font-size: 10px; color: ${CSS.magenta}; text-transform: uppercase;">Target:</label>
            <select id="genotype-select" style="
              background: rgba(11, 6, 20, 0.9);
              color: ${CSS.magenta};
              border: 1px solid ${CSS.border};
              border-radius: 4px;
              padding: 3px 6px;
              font-family: ${CSS.font};
              font-size: 11px;
              cursor: pointer;
              outline: none;
            ">
              ${GENOTYPES.map((g, idx) => `<option value="${g.id}" ${idx === 2 ? 'selected' : ''}>${g.name}</option>`).join('')}
            </select>
          </div>

          <!-- Ticks Input Group -->
          <div class="hud-control-group" style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 4px 8px;
            border-radius: 6px;
          ">
            <label style="font-size: 10px; color: ${CSS.dim}; text-transform: uppercase;">Ticks:</label>
            <input type="number" id="ticks-input" value="300" min="100" max="1000" step="50" style="
              background: rgba(11, 6, 20, 0.9);
              color: ${CSS.bone};
              border: 1px solid ${CSS.border};
              border-radius: 4px;
              padding: 3px 6px;
              font-family: ${CSS.font};
              font-size: 11px;
              width: 48px;
              outline: none;
            "/>
          </div>

          <!-- Action Buttons -->
          <button id="btn-run-pipeline" style="
            background: linear-gradient(135deg, rgba(0, 229, 255, 0.3), rgba(154, 92, 255, 0.3));
            border: 1px solid ${CSS.cyan};
            color: ${CSS.cyan};
            border-radius: 6px;
            padding: 5px 12px;
            font-family: ${CSS.font};
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
          ">▶ LAUNCH PIPELINE</button>

          <button id="btn-auto-discover" style="
            background: linear-gradient(135deg, rgba(255, 43, 214, 0.25), rgba(0, 229, 255, 0.25));
            border: 1px solid ${CSS.magenta};
            color: ${CSS.magenta};
            border-radius: 6px;
            padding: 5px 12px;
            font-family: ${CSS.font};
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
          ">⚡ AUTO-DISCOVER SWEEPER</button>

          <button id="btn-export-discoveries" style="
            background: rgba(255, 43, 214, 0.15);
            border: 1px solid ${CSS.magenta};
            color: ${CSS.magenta};
            border-radius: 6px;
            padding: 5px 10px;
            font-family: ${CSS.font};
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
          ">💾 EXPORT JSON</button>

          <button id="btn-pause-pipeline" style="
            background: rgba(255, 138, 61, 0.15);
            border: 1px solid ${CSS.amber};
            color: ${CSS.amber};
            border-radius: 6px;
            padding: 5px 10px;
            font-family: ${CSS.font};
            font-size: 11px;
            cursor: pointer;
            display: none;
          ">⏸ PAUSE PIPELINE</button>

          <button id="btn-export-report" style="
            background: rgba(57, 255, 136, 0.15);
            border: 1px solid ${CSS.lime};
            color: ${CSS.lime};
            border-radius: 6px;
            padding: 5px 12px;
            font-family: ${CSS.font};
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
          ">📝 EXPORT REPORT</button>

          <button id="btn-cheatsheet" style="
            background: rgba(0, 229, 255, 0.15);
            border: 1px solid ${CSS.cyan};
            color: ${CSS.cyan};
            border-radius: 6px;
            padding: 5px 10px;
            font-family: ${CSS.font};
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
          ">🧠 CHEATSHEET</button>
        </div>

        <!-- Custom Panels Container -->
        <div id="hud-custom-panels" style="display: flex; flex-direction: column; gap: 6px;"></div>

        <!-- PIPELINE STUDIO STEP VISUALIZER WIDGET -->
        <div id="pipeline-studio-bar" style="
          background: rgba(18, 10, 34, 0.85);
          border: 1px solid ${CSS.border};
          border-radius: 6px;
          padding: 6px 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          overflow-x: auto;
        ">
          <span style="font-size: 10px; color: ${CSS.cyan}; font-weight: bold; min-width: 95px;">PIPELINE STEPS:</span>
          <div id="pipeline-step-pills" style="display: flex; gap: 4px; flex: 1; align-items: center;">
            <span class="step-pill" data-step="1" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">1. Mint Control</span>
            <span class="step-pill" data-step="2" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">2. Stimulus (Ctrl)</span>
            <span class="step-pill" data-step="3" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">3. Record Ctrl</span>
            <span class="step-pill" data-step="4" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">4. Mint Target</span>
            <span class="step-pill" data-step="5" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">5. Stimulus (Target)</span>
            <span class="step-pill" data-step="6" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">6. Record Target</span>
            <span class="step-pill" data-step="7" style="background: rgba(255,255,255,0.05); border: 1px solid ${CSS.border}; color: ${CSS.dim}; font-size: 9px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;">7. Deltas & Assertions</span>
          </div>
        </div>
      </div>

      <!-- MIDDLE PANEL: LIVE / REPLAY TELEMETRY METRICS & ASSERTIONS -->
      <div style="
        display: flex;
        justify-content: space-between;
        gap: 12px;
        pointer-events: none;
        margin: 6px 0;
        flex: 1;
        max-height: calc(100vh - 230px);
      ">
        <!-- Telemetry Metrics & Deltas (Docked Left, Collapsible) -->
        <div id="hud-left-panel" style="
          width: 310px;
          flex-shrink: 0;
          pointer-events: auto;
          background: ${CSS.panel};
          border: 1px solid ${CSS.border};
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          transition: all 0.25s ease-in-out;
          max-height: calc(100vh - 230px);
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${CSS.border}; padding-bottom: 4px;">
            <span style="font-size: 11px; color: ${CSS.cyan}; font-weight: bold; letter-spacing: 0.05em;">📊 TELEMETRY & MOTORS</span>
            <button id="toggle-left-btn" style="background: transparent; border: none; color: ${CSS.dim}; cursor: pointer; font-size: 10px;" title="Collapse Left Panel">◀</button>
          </div>

          <div id="left-panel-content" style="display: flex; flex-direction: column; gap: 6px;">
            <div id="telemetry-rows" style="display: flex; flex-direction: column; gap: 6px;">
              <!-- Rendered dynamically with glowing gauges -->
            </div>

            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed ${CSS.border}; display: flex; justify-content: space-between; font-size: 10px;">
              <span>Leg Gesture: <b id="leg-gesture-val" style="color: ${CSS.amber};">idle</b></span>
              <span>Vision: <b id="vision-state-val" style="color: ${CSS.lime};">ON</b></span>
            </div>
          </div>
        </div>

        <!-- Center Open Viewport Area (100% transparent for 3D camera mouse interaction) -->
        <div style="flex: 1; pointer-events: none;"></div>

        <!-- AI Lab Notes & Unit Test Assertions (Docked Right, Clearance 268px from right edge so LabObserver sits safely to its right!) -->
        <div id="hud-right-panel" style="
          width: 320px;
          flex-shrink: 0;
          pointer-events: auto;
          margin-right: 268px;
          background: ${CSS.panel};
          border: 1px solid ${CSS.border};
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          transition: all 0.25s ease-in-out;
          max-height: calc(100vh - 230px);
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${CSS.border}; padding-bottom: 4px;">
            <span style="font-size: 11px; color: ${CSS.violet}; font-weight: bold; letter-spacing: 0.05em;">🧪 ASSERTIONS & LOGS</span>
            <button id="toggle-right-btn" style="background: transparent; border: none; color: ${CSS.dim}; cursor: pointer; font-size: 10px;" title="Collapse Right Panel">▶</button>
          </div>

          <div id="right-panel-content" style="display: flex; flex-direction: column; gap: 6px;">
            <div id="assertions-container" style="display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
              <div style="color: ${CSS.dim};">Run a pipeline sweep to execute unit test assertions.</div>
            </div>

            <div style="font-size: 10px; color: ${CSS.cyan}; font-weight: bold; margin-top: 4px; border-top: 1px solid ${CSS.border}; padding-top: 4px;">
              📝 LIVE LOG NOTES
            </div>
            <div id="log-notes-container" style="
              flex: 1;
              font-size: 10px;
              color: ${CSS.bone};
              overflow-y: auto;
              display: flex;
              flex-direction: column;
              gap: 4px;
              max-height: 140px;
            ">
              <div><span style="color:${CSS.dim}">[00:00:00]</span> 🧪 Initialized Neuro-Debugger Workbench</div>
            </div>
          </div>
        </div>
      </div>

      <!-- BOTTOM SCRUBBER & TIMELINE CONTROLS (Restricted to safe area left of LabObserver) -->
      <div style="
        background: ${CSS.panel};
        border: 1px solid ${CSS.border};
        border-radius: 8px;
        padding: 8px 14px;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        margin-right: 268px;
      ">
        <button id="btn-replay-play" style="
          background: rgba(0, 229, 255, 0.15);
          border: 1px solid ${CSS.cyan};
          color: ${CSS.cyan};
          border-radius: 4px;
          padding: 3px 8px;
          font-family: ${CSS.font};
          font-size: 10px;
          cursor: pointer;
        ">▶ REPLAY</button>

        <span style="font-size: 10px; color: ${CSS.dim};">TIMELINE:</span>

        <input type="range" id="timeline-scrubber" min="0" max="0" value="0" style="
          flex: 1;
          cursor: pointer;
          accent-color: ${CSS.cyan};
        "/>

        <span id="timeline-counter" style="font-size: 10px; color: ${CSS.cyan}; font-weight: bold; min-width: 80px; text-align: right;">FRAME 0/0</span>
      </div>
    `;

    // Attach event handlers
    const scenarioSelect = this.container.querySelector('#scenario-select');
    const controlSelect = this.container.querySelector('#control-select');
    const genotypeSelect = this.container.querySelector('#genotype-select');
    const ticksInput = this.container.querySelector('#ticks-input');

    const runBtn = this.container.querySelector('#btn-run-pipeline');
    const pauseBtn = this.container.querySelector('#btn-pause-pipeline');
    const exportBtn = this.container.querySelector('#btn-export-report');
    const cheatsheetBtn = this.container.querySelector('#btn-cheatsheet');
    const exportDiscBtn = this.container.querySelector('#btn-export-discoveries');

    const playBtn = this.container.querySelector('#btn-replay-play');
    const scrubber = this.container.querySelector('#timeline-scrubber');

    scenarioSelect.addEventListener('change', (e) => {
      this.selectedScenario = e.target.value;
    });

    controlSelect.addEventListener('change', (e) => {
      const g = GENOTYPES.find(item => item.id === e.target.value);
      if (g) this.selectedControlGenotype = g.spec;
    });

    genotypeSelect.addEventListener('change', (e) => {
      const g = GENOTYPES.find(item => item.id === e.target.value);
      if (g) this.selectedMutantGenotype = g.spec;
    });

    ticksInput.addEventListener('change', (e) => {
      this.pipelineTicks = Math.max(100, Math.min(1000, parseInt(e.target.value, 10) || 300));
    });

    runBtn.addEventListener('click', () => this.runPipelineSweep());
    pauseBtn.addEventListener('click', () => this.togglePausePipeline());
    exportBtn.addEventListener('click', () => this.exportReport());
    cheatsheetBtn?.addEventListener('click', () => this.showCheatsheetModal());
    exportDiscBtn?.addEventListener('click', () => {
      if (this.autoDiscover) {
        this.autoDiscover.exportFindingsJSON();
        this.logNote(`Exported ${this.autoDiscover.findings.length} findings to JSON`, 'success');
      } else {
        this.logNote('No auto-discover engine attached.', 'warning');
      }
    });

    const autoDiscoverBtn = this.container.querySelector('#btn-auto-discover');
    autoDiscoverBtn?.addEventListener('click', async () => {
      if (this.autoDiscover) {
        if (this.autoDiscover.isScanning) {
          this.autoDiscover.stopScan();
          this.setTicker('⏸ Auto-Discover scan stopped.');
          this.logNote('Auto-Discover scan stopped by user.', 'info');
        } else {
          const currentScenario = SCENARIOS.find(s => s.id === this.selectedScenario) || SCENARIOS[0];
          await this.autoDiscover.startScan(currentScenario);
        }
      } else {
        this.logNote('Auto-Discover Engine not initialized.', 'warning');
      }
    });

    playBtn.addEventListener('click', () => this.toggleReplay());
    scrubber.addEventListener('input', (e) => {
      const frameIdx = parseInt(e.target.value, 10);
      const frame = this.recorder.seek(frameIdx);
      if (frame) this.updateFromReplayFrame(frame);
    });

    // Panel collapse toggles
    const toggleLeftBtn = this.container.querySelector('#toggle-left-btn');
    const leftContent = this.container.querySelector('#left-panel-content');
    let leftCollapsed = false;
    toggleLeftBtn?.addEventListener('click', () => {
      leftCollapsed = !leftCollapsed;
      leftContent.style.display = leftCollapsed ? 'none' : 'flex';
      toggleLeftBtn.textContent = leftCollapsed ? '▶' : '◀';
    });

    const toggleRightBtn = this.container.querySelector('#toggle-right-btn');
    const rightContent = this.container.querySelector('#right-panel-content');
    let rightCollapsed = false;
    toggleRightBtn?.addEventListener('click', () => {
      rightCollapsed = !rightCollapsed;
      rightContent.style.display = rightCollapsed ? 'none' : 'flex';
      toggleRightBtn.textContent = rightCollapsed ? '◀' : '▶';
    });
  }

  mount() {
    document.body.appendChild(this.container);
    this.updateLiveTelemetry();
    this._setupCustomPanel();
  }

  showCheatsheetModal() {
    const existing = document.getElementById('neuro-cheatsheet-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'neuro-cheatsheet-modal';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(8, 4, 16, 0.85);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      font-family: ${CSS.font};
      padding: 16px;
    `;

    overlay.innerHTML = `
      <div style="
        background: rgba(18, 10, 34, 0.96);
        border: 1px solid ${CSS.cyan};
        box-shadow: 0 0 30px rgba(0, 229, 255, 0.25);
        border-radius: 12px;
        width: 540px;
        max-width: 95vw;
        max-height: 85vh;
        overflow-y: auto;
        padding: 20px 24px;
        color: ${CSS.bone};
        display: flex;
        flex-direction: column;
        gap: 16px;
        position: relative;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${CSS.border}; padding-bottom: 10px;">
          <h3 style="margin: 0; font-size: 15px; color: ${CSS.cyan}; letter-spacing: 0.05em; display: flex; align-items: center; gap: 8px;">
            <span>🧠 Quick Cheatsheet: What the Buttons Mean</span>
          </h3>
          <button id="close-cheatsheet-btn" style="
            background: transparent;
            border: none;
            color: ${CSS.dim};
            font-size: 18px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
          ">&times;</button>
        </div>

        <div style="font-size: 12px; line-height: 1.6; display: flex; flex-direction: column; gap: 14px;">
          <div>
            <div style="font-weight: bold; color: ${CSS.lime}; text-transform: uppercase; font-size: 11px; margin-bottom: 6px; letter-spacing: 0.05em;">
              ⚡ Sensory Drives (Inputs):
            </div>
            <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px;">
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">LPLC2</code> &amp; <code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">LC4</code> = <b>Visual Looming Threat</b> (expanding shadow / approaching predator).</li>
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">ORN_VA6</code> = <b>Food Scent</b> (fruit odor).</li>
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">ORN_DM1</code> = <b>Sugar Scent</b> (vinegar / attractive smell).</li>
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">ORN_DA1</code> = <b>Courtship Pheromone</b> (mating signal).</li>
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">PAM11</code> = <b>Dopamine Bath</b> (reward / excitement).</li>
              <li><code style="color: ${CSS.cyan}; background: rgba(0,229,255,0.1); padding: 1px 5px; border-radius: 3px;">PPL1</code> = <b>Octopamine / Threat Bath</b> (aversive / punishment).</li>
            </ul>
          </div>

          <div>
            <div style="font-weight: bold; color: ${CSS.magenta}; text-transform: uppercase; font-size: 11px; margin-bottom: 6px; letter-spacing: 0.05em;">
              🎯 Motor Readouts (Outputs):
            </div>
            <ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px;">
              <li><code style="color: ${CSS.magenta}; background: rgba(255,43,214,0.1); padding: 1px 5px; border-radius: 3px;">DNa01</code> = Steering balance (left/right turn).</li>
              <li><code style="color: ${CSS.magenta}; background: rgba(255,43,214,0.1); padding: 1px 5px; border-radius: 3px;">DNp09</code> = Forward walking speed.</li>
              <li><code style="color: ${CSS.magenta}; background: rgba(255,43,214,0.1); padding: 1px 5px; border-radius: 3px;">DNp01</code> = <b>Giant Fiber Escape Jump</b> (explosive takeoff).</li>
              <li><code style="color: ${CSS.magenta}; background: rgba(255,43,214,0.1); padding: 1px 5px; border-radius: 3px;">DNp13</code> = Courtship Acceptance Drive.</li>
              <li><code style="color: ${CSS.magenta}; background: rgba(255,43,214,0.1); padding: 1px 5px; border-radius: 3px;">DNp06</code> = Feeding Drive.</li>
            </ul>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; border-top: 1px solid ${CSS.border}; padding-top: 12px; margin-top: 4px;">
          <button id="close-cheatsheet-bottom" style="
            background: rgba(0, 229, 255, 0.2);
            border: 1px solid ${CSS.cyan};
            color: ${CSS.cyan};
            border-radius: 6px;
            padding: 6px 16px;
            font-family: ${CSS.font};
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
          ">Close Cheatsheet</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('#close-cheatsheet-btn');
    const closeBottomBtn = overlay.querySelector('#close-cheatsheet-bottom');
    const closeFn = () => overlay.remove();

    closeBtn.addEventListener('click', closeFn);
    closeBottomBtn.addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFn();
    });
  }

  logNote(msg, type = 'info') {
    this.addNote(msg, type);
  }

  triggerAlert(msg) {
    this.setTicker(msg, true);
    this.addNote(msg, 'alert');
  }

  updateProgress(current, total, msg) {
    this.setTicker(`[${current}/${total}] ${msg}`);
  }

  createPanel(title) {
    const panel = document.createElement('div');
    panel.style.cssText = `
      background: ${CSS.panel};
      border: 1px solid ${CSS.border};
      border-radius: 8px;
      padding: 8px 14px;
      margin-right: 268px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      pointer-events: auto;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    `;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
      font-size: 11px;
      font-weight: bold;
      color: ${CSS.cyan};
      border-bottom: 1px solid ${CSS.border};
      padding-bottom: 4px;
      letter-spacing: 0.05em;
    `;
    titleEl.textContent = title;
    panel.appendChild(titleEl);

    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    `;
    panel.appendChild(controlsContainer);

    const targetContainer = this.container.querySelector('#hud-custom-panels') || this.container.children[0];
    if (targetContainer) targetContainer.appendChild(panel);

    return {
      element: panel,
      addSelect: (label, options, onChange) => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 6px;';
        wrapper.innerHTML = `
          <label style="font-size: 10px; color: ${CSS.dim}; text-transform: uppercase;">${label}:</label>
          <select style="
            background: rgba(11, 6, 20, 0.9);
            color: ${CSS.cyan};
            border: 1px solid ${CSS.border};
            border-radius: 4px;
            padding: 3px 6px;
            font-family: ${CSS.font};
            font-size: 11px;
            cursor: pointer;
          ">
            ${options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
          </select>
        `;
        const select = wrapper.querySelector('select');
        select.addEventListener('change', (e) => onChange(e.target.value));
        controlsContainer.appendChild(wrapper);
        return wrapper;
      },
      addSlider: (label, min, max, defaultVal, onChange) => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 6px;';
        wrapper.innerHTML = `
          <label style="font-size: 10px; color: ${CSS.dim}; text-transform: uppercase;">${label}:</label>
          <input type="range" min="${min}" max="${max}" value="${defaultVal}" step="0.5" style="accent-color: ${CSS.cyan}; width: 80px; cursor: pointer;"/>
          <span style="font-size: 10px; color: ${CSS.cyan}; min-width: 25px;">${defaultVal}</span>
        `;
        const slider = wrapper.querySelector('input');
        const valDisp = wrapper.querySelector('span');
        slider.addEventListener('input', (e) => {
          const v = parseFloat(e.target.value);
          valDisp.textContent = v;
          onChange(v);
        });
        controlsContainer.appendChild(wrapper);
        return wrapper;
      },
      addInput: (label, defaultVal, onChange) => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 6px;';
        wrapper.innerHTML = `
          <label style="font-size: 10px; color: ${CSS.dim}; text-transform: uppercase;">${label}:</label>
          <input type="text" value="${defaultVal}" style="
            background: rgba(11, 6, 20, 0.9);
            color: ${CSS.magenta};
            border: 1px solid ${CSS.border};
            border-radius: 4px;
            padding: 3px 6px;
            font-family: ${CSS.font};
            font-size: 11px;
            width: 100px;
          "/>
        `;
        const input = wrapper.querySelector('input');
        input.addEventListener('change', (e) => onChange(e.target.value));
        controlsContainer.appendChild(wrapper);
        return wrapper;
      },
      addButton: (label, onClick) => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          background: linear-gradient(135deg, rgba(0, 229, 255, 0.25), rgba(154, 92, 255, 0.25));
          border: 1px solid ${CSS.cyan};
          color: ${CSS.cyan};
          border-radius: 6px;
          padding: 4px 10px;
          font-family: ${CSS.font};
          font-size: 11px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.2s;
        `;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        controlsContainer.appendChild(btn);
        return btn;
      }
    };
  }

  _setupCustomPanel() {
    if (this._customPanelMounted) return;
    this._customPanelMounted = true;

    this.selectedInput = 'LPLC2';
    this.inputValue = 5.0;
    this.customMutantSpec = { silence: ['LC4'] };

    const customPanel = this.createPanel('🔬 Custom Circuit Discovery');

    // 1. Pick Sensory Drive
    customPanel.addSelect('Sensory Drive', ['LPLC2', 'LC4', 'ORN_VA6', 'ORN_DM1', 'PAM11', 'PPL1'], (channel) => {
      this.selectedInput = channel;
    });

    customPanel.addSlider('Drive Level', 0, 20, 5.0, (val) => {
      this.inputValue = val;
    });

    // 2. Select Mutant or Unmapped Prefix (supports comma or + separated multi-gene knockout, e.g. LC4, LPLC2)
    customPanel.addInput('Lesion Target (Prefix / List)', 'LC4', (targetStr) => {
      const targets = targetStr.split(/[,+]/).map(s => s.trim()).filter(Boolean);
      this.customMutantSpec = { silence: targets };

      // Highlight target cluster(s) in floating 3D brain orb
      if (this.lab.brain && this.lab.brain.pack && this.halo) {
        let combinedIndices = [];
        for (const t of targets) {
          const idx = this.lab.brain.pack.indicesOfPrefix?.(t) || this.lab.brain.pack.indicesOf?.(t) || [];
          for (let i = 0; i < idx.length; i++) combinedIndices.push(idx[i]);
        }
        if (combinedIndices.length) {
          this.halo.setCluster(new Int32Array(combinedIndices));
        }
      }
    });

    // 3. Launch Discovery Run
    customPanel.addButton('🚀 Run Custom Discovery Sweep', async () => {
      const customScenario = {
        id: 'custom',
        name: `Custom Drive (${this.selectedInput}=${this.inputValue})`,
        inputSummary: `${this.selectedInput}=${this.inputValue}`,
        setup: (brain) => brain.setInput(this.selectedInput, this.inputValue),
        teardown: (brain) => brain.setInput(this.selectedInput, 0)
      };
      await this.runner.runCustomPipeline(customScenario, 'wild-type', this.customMutantSpec);
    });
  }

  setTicker(msg, isAlert = false) {
    const el = this.container.querySelector('#debugger-ticker');
    if (el) {
      el.textContent = msg;
      el.style.color = isAlert ? CSS.red : CSS.bone;
    }
  }

  updatePipelineStepHighlight(stepIndex) {
    const pills = this.container.querySelectorAll('.step-pill');
    pills.forEach(pill => {
      const stepNum = parseInt(pill.getAttribute('data-step'), 10);
      if (stepNum === stepIndex) {
        pill.style.background = 'rgba(0, 229, 255, 0.25)';
        pill.style.borderColor = CSS.cyan;
        pill.style.color = CSS.cyan;
        pill.style.fontWeight = 'bold';
        pill.style.boxShadow = '0 0 8px rgba(0, 229, 255, 0.4)';
      } else if (stepNum < stepIndex) {
        pill.style.background = 'rgba(57, 255, 136, 0.15)';
        pill.style.borderColor = CSS.lime;
        pill.style.color = CSS.lime;
        pill.style.fontWeight = 'normal';
        pill.style.boxShadow = 'none';
      } else {
        pill.style.background = 'rgba(255, 255, 255, 0.05)';
        pill.style.borderColor = CSS.border;
        pill.style.color = CSS.dim;
        pill.style.fontWeight = 'normal';
        pill.style.boxShadow = 'none';
      }
    });
  }

  addNote(msg, type = 'info') {
    const now = new Date().toTimeString().slice(0, 8);
    const container = this.container.querySelector('#log-notes-container');
    if (!container) return;

    const typeStyles = {
      info:      { icon: '🧪', color: CSS.cyan },
      stimulus:  { icon: '⚡', color: CSS.amber },
      mint:      { icon: msg.includes('Target') || msg.includes('Mutant') ? '🧬' : (msg.includes('Restored') ? '🔄' : '🪰'), color: msg.includes('Target') || msg.includes('Mutant') ? CSS.magenta : CSS.lime },
      discovery: { icon: '🔍', color: '#ff2bd6' },
      alert:     { icon: '🚨', color: CSS.red },
      success:   { icon: '✅', color: CSS.lime },
      warning:   { icon: '⚠️', color: CSS.amber },
      error:     { icon: '❌', color: CSS.red }
    };

    const conf = typeStyles[type] || typeStyles.info;

    const div = document.createElement('div');
    div.style.cssText = `line-height: 1.35; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.03);`;
    div.innerHTML = `<span style="color:${CSS.dim}; font-size: 9px;">[${now}]</span> <span style="color:${conf.color}; font-weight:bold;">${conf.icon}</span> <span style="color:${conf.color};">${msg}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    this.notes.push(`[${now}] ${conf.icon} ${msg}`);
  }

  togglePausePipeline() {
    const pauseBtn = this.container.querySelector('#btn-pause-pipeline');
    if (this.runner.paused) {
      this.runner.resume();
      if (pauseBtn) pauseBtn.textContent = '⏸ PAUSE PIPELINE';
      this.addNote('Resumed pipeline execution', 'info');
    } else {
      this.runner.pause();
      if (pauseBtn) pauseBtn.textContent = '▶ RESUME PIPELINE';
      this.addNote('Paused pipeline execution', 'warning');
    }
  }

  async runPipelineSweep() {
    const pauseBtn = this.container.querySelector('#btn-pause-pipeline');
    if (pauseBtn) pauseBtn.style.display = 'inline-block';

    this.setTicker('🚀 Launching Pipeline Sweep...');
    this.addNote(`Launching pipeline sweep: Scenario=${this.selectedScenario}`, 'info');

    const ctrlObj = GENOTYPES.find(item => item.spec === this.selectedControlGenotype || item.id === this.selectedControlGenotype);
    const mutObj = GENOTYPES.find(item => item.spec === this.selectedMutantGenotype || item.id === this.selectedMutantGenotype);

    const ctrlSpec = ctrlObj ? ctrlObj.spec : this.selectedControlGenotype;
    const mutSpec = mutObj ? mutObj.spec : this.selectedMutantGenotype;

    const results = await this.runner.runPipeline(
      this.selectedScenario,
      ctrlSpec,
      mutSpec,
      this.pipelineTicks,
      (prog) => {
        this.setTicker(prog.message);
        if (prog.step) this.updatePipelineStepHighlight(prog.step);
        if (prog.log) this.addNote(prog.log.msg, prog.log.type);
      }
    );

    if (pauseBtn) pauseBtn.style.display = 'none';

    if (results) {
      this.lastPipelineResults = results;
      this.setTicker('✅ Pipeline complete! Control & Target traces recorded.', false);

      const maxF = this.recorder.maxFrames;
      const scrubber = this.container.querySelector('#timeline-scrubber');
      if (scrubber) {
        scrubber.max = Math.max(0, maxF - 1);
        scrubber.value = maxF - 1;
      }

      this.updateTelemetryDeltas(results.peakMetrics || results.metrics, results.controlName, results.mutantName);
      this.updateAssertions(results);
    }
  }

  updateLiveTelemetry() {
    if (!this.lab || !this.lab.brain || !this.lab.brain.ready) return;
    if (this.recorder.isReplaying) return;

    const brain = this.lab.brain;
    const readings = {
      DNa01: { control: brain.readSteering('DNa01'), mutant: 0, delta: 0 },
      DNp09: { control: brain.readCalibrated('DNp09'), mutant: 0, delta: 0 },
      DNp01: { control: brain.readPhasic('DNp01'), mutant: 0, delta: 0 },
      DNp13: { control: brain.readCalibrated('DNp13'), mutant: 0, delta: 0 },
      DNp06: { control: brain.readPhasic('DNp06'), mutant: 0, delta: 0 },
    };

    this.renderTelemetryRows(readings, false);

    const legVal = this.container.querySelector('#leg-gesture-val');
    const visVal = this.container.querySelector('#vision-state-val');
    if (legVal) legVal.textContent = this.lab.legRig?.currentGesture || 'idle';
    if (visVal) visVal.textContent = this.lab.visionEnabled ? 'ON' : 'OFF';
  }

  updateTelemetryDeltas(metrics, ctrlName = 'Control', mutName = 'Target') {
    this.renderTelemetryRows(metrics, true, ctrlName, mutName);
  }

  renderTelemetryRows(metrics, showMutant = true, ctrlName = 'Ctrl', mutName = 'Target') {
    const container = this.container.querySelector('#telemetry-rows');
    if (!container) return;

    const list = [
      { key: 'DNa01', label: 'DNa01 (Steering)', val: metrics.DNa01 },
      { key: 'DNp09', label: 'DNp09 (Speed)',    val: metrics.DNp09 },
      { key: 'DNp01', label: 'DNp01 (Escape)',   val: metrics.DNp01 },
      { key: 'DNp13', label: 'DNp13 (Courtship)', val: metrics.DNp13 },
      { key: 'DNp06', label: 'DNp06 (Feeding)',  val: metrics.DNp06 },
    ];

    container.innerHTML = list.map(item => {
      const ctrlNum = item.val.control;
      const mutNum = item.val.mutant;
      const deltaNum = item.val.delta;
      const absDelta = Math.abs(deltaNum);

      const ctrlPct = Math.min(100, Math.max(0, Math.abs(ctrlNum) * 100));
      const mutPct = Math.min(100, Math.max(0, Math.abs(mutNum) * 100));

      const isAnomaly = showMutant && absDelta > 0.3;
      const alertBadge = isAnomaly
        ? `<span style="background: rgba(255, 43, 214, 0.2); border: 1px solid ${CSS.magenta}; color: ${CSS.magenta}; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: bold; animation: pulse 1s infinite;">⚡ Δ>${absDelta.toFixed(2)}</span>`
        : '';

      return `
        <div style="
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid ${isAnomaly ? CSS.magenta : 'rgba(0, 229, 255, 0.12)'};
          border-radius: 6px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
            <span style="color: ${CSS.cyan}; font-weight: bold;">${item.label}</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              ${alertBadge}
              ${showMutant ? `<span style="font-size: 9px; color: ${absDelta > 0.3 ? CSS.magenta : (absDelta > 0.1 ? CSS.amber : CSS.bone)}; font-weight:bold;">Δ ${deltaNum > 0 ? '+' : ''}${deltaNum.toFixed(3)}</span>` : ''}
            </div>
          </div>

          <!-- Dual Glowing Bar Gauges -->
          <div style="display: flex; flex-direction: column; gap: 3px;">
            <!-- Control bar (Neon Lime) -->
            <div style="display: flex; align-items: center; gap: 6px; font-size: 9px;">
              <span style="color: ${CSS.lime}; width: 42px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${ctrlName}">${ctrlName.slice(0, 6)}</span>
              <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; position: relative;">
                <div style="
                  width: ${ctrlPct}%;
                  height: 100%;
                  background: #39ff88;
                  box-shadow: 0 0 8px #39ff88;
                  border-radius: 3px;
                  transition: width 0.2s ease-out;
                "></div>
              </div>
              <span style="color: ${CSS.bone}; width: 34px; text-align: right;">${ctrlNum.toFixed(3)}</span>
            </div>

            <!-- Target bar (Neon Magenta) -->
            ${showMutant ? `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 9px;">
              <span style="color: ${CSS.magenta}; width: 42px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${mutName}">${mutName.slice(0, 6)}</span>
              <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; position: relative;">
                <div style="
                  width: ${mutPct}%;
                  height: 100%;
                  background: #ff2bd6;
                  box-shadow: 0 0 8px #ff2bd6;
                  border-radius: 3px;
                  transition: width 0.2s ease-out;
                "></div>
              </div>
              <span style="color: ${CSS.bone}; width: 34px; text-align: right;">${mutNum.toFixed(3)}</span>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  updateAssertions(pipelineResults) {
    const container = this.container.querySelector('#assertions-container');
    if (!container) return;

    const assertions = evaluateAssertions(pipelineResults);
    container.innerHTML = assertions.map(a => `
      <div style="
        background: rgba(0,0,0,0.25);
        border-left: 3px solid ${a.passed ? CSS.lime : CSS.red};
        padding: 4px 6px;
        border-radius: 2px;
        margin-bottom: 2px;
      ">
        <div style="font-weight: bold; color: ${a.passed ? CSS.lime : CSS.red}; font-size: 10px;">${a.passed ? '✅ PASSED' : '❌ FAILED'}: ${a.title}</div>
        <div style="color: ${CSS.bone}; font-size: 9px; margin-top: 1px;">${a.detail}</div>
        ${a.biologicalReason ? `<div style="color: ${CSS.dim}; font-size: 9px; font-style: italic; margin-top: 1px;">${a.biologicalReason}</div>` : ''}
      </div>
    `).join('');
  }

  updateFromReplayFrame(frame) {
    if (!frame) return;

    const counter = this.container.querySelector('#timeline-counter');
    const scrubber = this.container.querySelector('#timeline-scrubber');

    if (counter) counter.textContent = `FRAME ${frame.tick}/${this.recorder.maxFrames}`;
    if (scrubber) scrubber.value = frame.tick;

    const readings = {
      DNa01: { control: frame.steer || 0, mutant: 0, delta: 0 },
      DNp09: { control: frame.DNp09 || 0, mutant: 0, delta: 0 },
      DNp01: { control: frame.DNp01 || 0, mutant: 0, delta: 0 },
      DNp13: { control: frame.DNp13 || 0, mutant: 0, delta: 0 },
      DNp06: { control: frame.DNp06 || 0, mutant: 0, delta: 0 },
    };

    this.renderTelemetryRows(readings, false);

    const legVal = this.container.querySelector('#leg-gesture-val');
    if (legVal) legVal.textContent = frame.legGesture || 'idle';
  }

  toggleReplay() {
    const playBtn = this.container.querySelector('#btn-replay-play');
    if (this.isPlayingReplay) {
      this.isPlayingReplay = false;
      if (this.replayTimer) clearInterval(this.replayTimer);
      if (playBtn) playBtn.textContent = '▶ REPLAY';
      this.recorder.stopReplay();
    } else {
      if (!this.recorder.maxFrames) {
        this.addNote('No recorded frames to replay. Run a pipeline first.', 'warning');
        return;
      }
      this.isPlayingReplay = true;
      if (playBtn) playBtn.textContent = '⏸ PAUSE';

      let idx = 0;
      this.replayTimer = setInterval(() => {
        if (!this.isPlayingReplay) return;
        const frame = this.recorder.seek(idx);
        if (frame) this.updateFromReplayFrame(frame);
        idx++;
        if (idx >= this.recorder.maxFrames) {
          idx = 0; // loop
        }
      }, 50);
    }
  }

  exportReport() {
    if (!this.lastPipelineResults) {
      this.addNote('No pipeline results available to export. Run pipeline first.', 'warning');
      return;
    }
    const discoveries = this.autoDiscover?.findings || [];
    const content = generateMarkdownReport(this.lastPipelineResults, this.notes, discoveries);
    exportReportBrowser(content);
    this.addNote(`Exported discovery report: neuro_discovery_report.md (${discoveries.length} discoveries included)`, 'success');
  }

  dispose() {
    if (this.replayTimer) clearInterval(this.replayTimer);
    this.container.remove();
  }
}
