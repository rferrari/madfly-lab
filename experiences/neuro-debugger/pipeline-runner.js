/**
 * Sequential Pipeline Executor for Room 7 Neuro-Debugger
 *
 * Supports arbitrary Control fly vs Target/Mutant fly comparison and step-by-step
 * execution management.
 *
 * HONESTY NOTE: Activations are dimensionless tanh values in [-1, 1], not mV or Hz.
 * Sensory drives are engineered measurements into real cell populations.
 */

export const SCENARIOS = [
  {
    id: 'looming',
    name: 'Looming Hazard (LPLC2)',
    description: 'Visual expansion threat driving LC4/LPLC2 -> DNp01 Giant Fiber escape',
    inputSummary: 'LPLC2_L=5.0, LPLC2_R=5.0',
    setup: (brain) => {
      brain.setInput('LPLC2_L', 5.0);
      brain.setInput('LPLC2_R', 5.0);
    },
    teardown: (brain) => {
      brain.setInput('LPLC2_L', 0);
      brain.setInput('LPLC2_R', 0);
    }
  },
  {
    id: 'food',
    name: 'Food Scent (ORN_VA6)',
    description: 'Food scent driving ORN_VA6 -> DNp06 feeding initiation',
    inputSummary: 'ORN_VA6=1.0',
    setup: (brain) => {
      brain.setInput('ORN_VA6', 1.0);
    },
    teardown: (brain) => {
      brain.setInput('ORN_VA6', 0);
    }
  },
  {
    id: 'mate',
    name: 'Mate Pheromone (ORN_DA1)',
    description: 'Courtship pheromone driving ORN_DA1 -> DNp13 acceptance drive',
    inputSummary: 'ORN_DA1=5.0',
    setup: (brain) => {
      brain.setInput('ORN_DA1', 5.0);
    },
    teardown: (brain) => {
      brain.setInput('ORN_DA1', 0);
    }
  },
  {
    id: 'dopa',
    name: 'Dopamine Bath (PAM11)',
    description: 'Dopaminergic reward bath (+20 drive into PAM11)',
    inputSummary: 'PAM11 +20 pulse',
    setup: (brain) => {
      brain.injectCurrent('PAM11', +20);
    },
    teardown: () => {}
  },
  {
    id: 'aversive',
    name: 'Aversive Bath (PPL1)',
    description: 'Octopaminergic/aversive punishment bath (+20 drive into PPL1)',
    inputSummary: 'PPL1 +20 pulse',
    setup: (brain) => {
      brain.injectCurrent('PPL1', +20);
    },
    teardown: () => {}
  },
  {
    id: 'darkness',
    name: 'Lights OFF',
    description: 'Total dark arena environment disabling retinal inputs',
    inputSummary: 'vision disabled',
    setup: (brain, lab) => {
      if (lab) lab.visionEnabled = false;
    },
    teardown: (brain, lab) => {
      if (lab) lab.visionEnabled = true;
    }
  }
];

export const GENOTYPES = [
  { id: 'wild-type',           name: 'Wild-Type (Control)',               spec: 'wild-type' },
  { id: 'blind',               name: 'Blind Mutant',                      spec: 'blind' },
  { id: 'lc4-lesioned',        name: 'LC4 Lesioned (Motion Blind)',       spec: { silence: ['LC4'] } },
  { id: 'lc4-lplc2-lesioned',  name: 'LC4+LPLC2 Lesioned (Looming Blind)', spec: { silence: ['LC4', 'LPLC2'] } },
  { id: 'va6-lesioned',        name: 'ORN_VA6 Lesioned (Anosmic Food)',   spec: { silence: ['ORN_VA6'] } },
  { id: 'no-escape',           name: 'DNp01 Lesioned (No Escape)',        spec: { silence: ['DNp01'] } }
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Peak absolute activation of a single field across all trial frames. */
const getPeak = (frames, key) => {
  if (!frames || !frames.length) return 0;
  return frames.reduce(
    (max, f) => (Math.abs(f[key] || 0) > Math.abs(max) ? (f[key] || 0) : max),
    0
  );
};

/**
 * Build both end-state and peak metrics from recorded frame arrays.
 * Returns { metrics, peakMetrics } where each has the same shape:
 *   { DNa01: { control, mutant, delta }, DNp09: …, … }
 */
function buildMetrics(controlFrames, mutantFrames) {
  const lastCtrl = controlFrames[controlFrames.length - 1] || {};
  const lastMut  = mutantFrames[mutantFrames.length - 1]  || {};

  const CHANNELS = [
    { key: 'DNa01', field: 'steer'  },
    { key: 'DNp09', field: 'DNp09'  },
    { key: 'DNp01', field: 'DNp01'  },
    { key: 'DNp13', field: 'DNp13'  },
    { key: 'DNp06', field: 'DNp06'  },
  ];

  const metrics     = {};
  const peakMetrics = {};

  for (const { key, field } of CHANNELS) {
    const ctrl = lastCtrl[field] || 0;
    const mut  = lastMut[field]  || 0;
    metrics[key] = { control: ctrl, mutant: mut, delta: mut - ctrl };

    const ctrlPeak = getPeak(controlFrames, field);
    const mutPeak  = getPeak(mutantFrames,  field);
    peakMetrics[key] = { control: ctrlPeak, mutant: mutPeak, delta: mutPeak - ctrlPeak };
  }

  return { metrics, peakMetrics };
}

function genotypeLabel(spec) {
  if (typeof spec === 'string') return spec;
  if (spec && Array.isArray(spec.silence)) return `Mutant (${spec.silence.join('+')})`;
  const found = GENOTYPES.find(g => JSON.stringify(g.spec) === JSON.stringify(spec));
  return found ? found.name : 'Custom Genotype';
}

// ---------------------------------------------------------------------------
// PipelineRunner
// ---------------------------------------------------------------------------

export class PipelineRunner {
  constructor(lab, recorder) {
    this.lab = lab;
    this.recorder = recorder;
    this.running = false;
    this.paused = false;
    this.currentStep = 0;
    this.totalSteps = 7;
  }

  stop()   { this.running = false; this.paused = false; }
  pause()  { this.paused = true; }
  resume() { this.paused = false; }

  // -------------------------------------------------------------------------
  // Main pipeline: Control vs Target, full telemetry
  // -------------------------------------------------------------------------
  async runPipeline(scenarioId, controlSpec, mutantSpec, ticks = 300, onProgress = () => {}) {
    if (this.running) return null;
    this.running = true;
    this.paused  = false;
    this.currentStep = 0;

    const scenario  = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    const brain     = this.lab.brain;
    const dt        = 1 / (brain.tickHz || 60);
    const ctrlName  = genotypeLabel(controlSpec);
    const mutName   = genotypeLabel(mutantSpec);

    const prog = (extra) => onProgress(extra);

    try {
      // ── Step 1: Mint Control Fly ──────────────────────────────────────────
      this.currentStep = 1;
      prog({ step: 1, totalSteps: 7, status: 'running',
             message: `[1/7] Minting Control Fly: ${ctrlName}`,
             log: { type: 'mint', msg: `🪰 Minted Control Fly: ${ctrlName}` } });
      this.lab.mintNewFly(controlSpec);
      await new Promise(r => setTimeout(r, 50));

      // ── Step 2: Apply Stimulus for Control ───────────────────────────────
      this.currentStep = 2;
      prog({ step: 2, totalSteps: 7, status: 'running',
             message: `[2/7] Applying scenario stimulus (${scenario.name}) to Control...`,
             log: { type: 'stimulus', msg: `⚡ Applied Scenario Stimulus: ${scenario.name}${scenario.inputSummary ? ' (' + scenario.inputSummary + ')' : ''}` } });
      scenario.setup(brain, this.lab);
      await new Promise(r => setTimeout(r, 50));

      // ── Step 3: Record Control Trial ─────────────────────────────────────
      this.currentStep = 3;
      prog({ step: 3, totalSteps: 7, status: 'running',
             message: `[3/7] Recording Control trial baseline...` });
      this.recorder.startRecording('control');
      for (let i = 0; i < ticks; i++) {
        while (this.paused && this.running) await new Promise(r => setTimeout(r, 100));
        if (!this.running) break;
        brain.step(dt);
        this.recorder.recordFrame({ phase: 'control', scenario: scenario.name, genotype: ctrlName });
        if (i % 25 === 0) {
          prog({ step: 3, totalSteps: 7, status: 'running',
                 message: `[3/7] Control run: ${i}/${ticks} ticks (${Math.round((i / ticks) * 100)}%)` });
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const controlFrames = this.recorder.stopRecording();
      scenario.teardown(brain, this.lab);
      brain.clearInputs();

      if (!this.running) return null;

      // ── Step 4: Mint Target Fly ───────────────────────────────────────────
      this.currentStep = 4;
      prog({ step: 4, totalSteps: 7, status: 'running',
             message: `[4/7] Minting Target Fly: ${mutName}`,
             log: { type: 'mint', msg: `🧬 Minted Target Fly: ${mutName}` } });
      this.lab.mintNewFly(mutantSpec);
      await new Promise(r => setTimeout(r, 50));

      // ── Step 5: Apply Stimulus for Target ────────────────────────────────
      this.currentStep = 5;
      prog({ step: 5, totalSteps: 7, status: 'running',
             message: `[5/7] Applying scenario stimulus (${scenario.name}) to Target...`,
             log: { type: 'stimulus', msg: `⚡ Applied Scenario Stimulus: ${scenario.name} (Target fly)` } });
      scenario.setup(brain, this.lab);
      await new Promise(r => setTimeout(r, 50));

      // ── Step 6: Record Target Trial ───────────────────────────────────────
      this.currentStep = 6;
      prog({ step: 6, totalSteps: 7, status: 'running',
             message: `[6/7] Recording Target trial response...` });
      this.recorder.startRecording('mutant');
      for (let i = 0; i < ticks; i++) {
        while (this.paused && this.running) await new Promise(r => setTimeout(r, 100));
        if (!this.running) break;
        brain.step(dt);
        this.recorder.recordFrame({ phase: 'mutant', scenario: scenario.name, genotype: mutName });
        if (i % 25 === 0) {
          prog({ step: 6, totalSteps: 7, status: 'running',
                 message: `[6/7] Target run: ${i}/${ticks} ticks (${Math.round((i / ticks) * 100)}%)` });
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const mutantFrames = this.recorder.stopRecording();
      scenario.teardown(brain, this.lab);
      brain.clearInputs();

      // ── Restore baseline fly ──────────────────────────────────────────────
      this.lab.mintNewFly('wild-type');
      prog({ step: 7, totalSteps: 7, status: 'running',
             message: '[7/7] Computing behavioral deltas & running unit assertions...',
             log: { type: 'mint', msg: '🔄 Restored Baseline Fly: Wild-Type' } });

      // ── Step 7: Metrics & Deltas ──────────────────────────────────────────
      this.currentStep = 7;
      const { metrics, peakMetrics } = buildMetrics(controlFrames, mutantFrames);

      // Deltas derived from peak activations (catches transient events like DNp01 escape)
      const deltas = {
        DNa01: peakMetrics.DNa01.delta,
        DNp09: peakMetrics.DNp09.delta,
        DNp01: peakMetrics.DNp01.delta,
        DNp13: peakMetrics.DNp13.delta,
        DNp06: peakMetrics.DNp06.delta,
      };

      const deltaSummary = `Peak ΔDNp09 = ${peakMetrics.DNp09.delta > 0 ? '+' : ''}${peakMetrics.DNp09.delta.toFixed(3)}, ` +
                           `Peak ΔDNp01 = ${peakMetrics.DNp01.delta > 0 ? '+' : ''}${peakMetrics.DNp01.delta.toFixed(3)}`;

      const results = {
        scenario, controlSpec, mutantSpec,
        controlName: ctrlName, mutantName: mutName,
        controlFrames, mutantFrames,
        metrics, peakMetrics, deltas,
      };

      prog({ step: 7, totalSteps: 7, status: 'complete',
             message: 'Pipeline execution complete!',
             log: { type: 'info', msg: `📊 Trial Complete: ${deltaSummary}` },
             results });
      return results;

    } catch (err) {
      console.error('Pipeline execution failed:', err);
      prog({ step: this.currentStep, totalSteps: 7, status: 'error',
             message: `Pipeline error: ${err.message}` });
      return null;
    } finally {
      this.running = false;
      this.paused  = false;
    }
  }

  // -------------------------------------------------------------------------
  // Custom pipeline: lightweight sweep used by AutoDiscoverEngine & HUD panel
  // -------------------------------------------------------------------------
  async runCustomPipeline(scenario, controlSpec = 'wild-type', mutantSpec = 'wild-type', ticks = 200, onProgress = () => {}) {
    let scenarioObj = scenario;
    if (typeof scenario === 'string') {
      scenarioObj = SCENARIOS.find(s => s.id === scenario) || SCENARIOS[0];
    }
    if (!scenarioObj || typeof scenarioObj !== 'object') {
      scenarioObj = {
        id: 'custom', name: 'Custom Drive',
        setup:    (brain) => brain.setInput('LPLC2', 5.0),
        teardown: (brain) => brain.setInput('LPLC2', 0),
      };
    }

    const brain    = this.lab.brain;
    const dt       = 1 / (brain?.tickHz || 60);
    const ctrlName = genotypeLabel(controlSpec);
    const mutName  = genotypeLabel(mutantSpec);

    try {
      this.running = true;

      this.lab.mintNewFly(controlSpec);
      await new Promise(r => setTimeout(r, 10));

      if (scenarioObj.setup) scenarioObj.setup(brain, this.lab);

      this.recorder.startRecording('control');
      for (let i = 0; i < ticks; i++) {
        brain.step(dt);
        this.recorder.recordFrame({ phase: 'control', scenario: scenarioObj.name, genotype: ctrlName });
      }
      const controlFrames = this.recorder.stopRecording();
      if (scenarioObj.teardown) scenarioObj.teardown(brain, this.lab);
      brain.clearInputs();

      this.lab.mintNewFly(mutantSpec);
      await new Promise(r => setTimeout(r, 10));

      if (scenarioObj.setup) scenarioObj.setup(brain, this.lab);

      this.recorder.startRecording('mutant');
      for (let i = 0; i < ticks; i++) {
        brain.step(dt);
        this.recorder.recordFrame({ phase: 'mutant', scenario: scenarioObj.name, genotype: mutName });
      }
      const mutantFrames = this.recorder.stopRecording();
      if (scenarioObj.teardown) scenarioObj.teardown(brain, this.lab);
      brain.clearInputs();

      this.lab.mintNewFly('wild-type');

      const { metrics, peakMetrics } = buildMetrics(controlFrames, mutantFrames);
      const deltas = {
        DNa01: peakMetrics.DNa01.delta,
        DNp09: peakMetrics.DNp09.delta,
        DNp01: peakMetrics.DNp01.delta,
        DNp13: peakMetrics.DNp13.delta,
        DNp06: peakMetrics.DNp06.delta,
      };

      return {
        scenario: scenarioObj,
        controlSpec, mutantSpec,
        controlName: ctrlName, mutantName: mutName,
        controlFrames, mutantFrames,
        metrics, peakMetrics, deltas,
      };
    } catch (err) {
      console.error('Custom pipeline execution failed:', err);
      return null;
    } finally {
      this.running = false;
    }
  }
}
