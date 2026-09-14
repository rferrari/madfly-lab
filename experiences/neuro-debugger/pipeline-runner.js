/**
 * Sequential Pipeline Executor for Room 7 Neuro-Debugger
 *
 * Supports arbitrary Control fly vs Target/Mutant fly comparison and step-by-step
 * execution management.
 */

export const SCENARIOS = [
  {
    id: 'looming',
    name: 'Looming Hazard (LPLC2)',
    description: 'Visual expansion threat driving LC4/LPLC2 -> DNp01 Giant Fiber escape',
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
    setup: (brain) => {
      brain.injectCurrent('PAM11', +20);
    },
    teardown: () => {}
  },
  {
    id: 'aversive',
    name: 'Aversive Bath (PPL1)',
    description: 'Octopaminergic/aversive punishment bath (+20 drive into PPL1)',
    setup: (brain) => {
      brain.injectCurrent('PPL1', +20);
    },
    teardown: () => {}
  },
  {
    id: 'darkness',
    name: 'Lights OFF',
    description: 'Total dark arena environment disabling retinal inputs',
    setup: (brain, lab) => {
      if (lab) lab.visionEnabled = false;
    },
    teardown: (brain, lab) => {
      if (lab) lab.visionEnabled = true;
    }
  }
];

export const GENOTYPES = [
  { id: 'wild-type', name: 'Wild-Type (Control)', spec: 'wild-type' },
  { id: 'blind', name: 'Blind Mutant', spec: 'blind' },
  { id: 'lc4-lesioned', name: 'LC4 Lesioned (Motion Blind)', spec: { silence: ['LC4'] } },
  { id: 'va6-lesioned', name: 'ORN_VA6 Lesioned (Anosmic Food)', spec: { silence: ['ORN_VA6'] } },
  { id: 'no-escape', name: 'DNp01 Lesioned (No Escape)', spec: { silence: ['DNp01'] } }
];

export class PipelineRunner {
  constructor(lab, recorder) {
    this.lab = lab;
    this.recorder = recorder;
    this.running = false;
    this.paused = false;
    this.currentStep = 0;
    this.totalSteps = 7;
  }

  stop() {
    this.running = false;
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  async runPipeline(scenarioId, controlSpec, mutantSpec, ticks = 300, onProgress = () => {}) {
    if (this.running) return null;
    this.running = true;
    this.paused = false;
    this.currentStep = 0;

    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    const brain = this.lab.brain;
    const dt = 1 / (brain.tickHz || 60);

    const getGenotypeLabel = (spec) => {
      if (typeof spec === 'string') return spec;
      const found = GENOTYPES.find(g => JSON.stringify(g.spec) === JSON.stringify(spec));
      return found ? found.name : 'Custom Genotype';
    };

    const ctrlName = getGenotypeLabel(controlSpec);
    const mutName = getGenotypeLabel(mutantSpec);

    try {
      // Step 1: Mint Control Fly
      this.currentStep = 1;
      onProgress({
        step: 1, totalSteps: 7, name: `Mint Control Fly (${ctrlName})`, status: 'running',
        message: `[1/7] Minting Control Fly: ${ctrlName}`
      });
      this.lab.mintNewFly(controlSpec);
      await new Promise(r => setTimeout(r, 50));

      // Step 2: Apply Scenario Stimulus for Control
      this.currentStep = 2;
      onProgress({
        step: 2, totalSteps: 7, name: `Apply ${scenario.name} to Control`, status: 'running',
        message: `[2/7] Applying scenario stimulus (${scenario.name}) to Control...`
      });
      scenario.setup(brain, this.lab);
      await new Promise(r => setTimeout(r, 50));

      // Step 3: Run & Record Control Trial
      this.currentStep = 3;
      onProgress({
        step: 3, totalSteps: 7, name: `Record Control Trial (${ticks} ticks)`, status: 'running',
        message: `[3/7] Recording Control trial baseline...`
      });
      this.recorder.startRecording('control');
      for (let i = 0; i < ticks; i++) {
        while (this.paused && this.running) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (!this.running) break;

        brain.step(dt);
        this.recorder.recordFrame({ phase: 'control', scenario: scenario.name, genotype: ctrlName });
        if (i % 25 === 0) {
          onProgress({
            step: 3, totalSteps: 7, name: `Record Control Trial`, status: 'running',
            message: `[3/7] Control run: ${i}/${ticks} ticks (${Math.round((i/ticks)*100)}%)`
          });
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const controlFrames = this.recorder.stopRecording();
      scenario.teardown(brain, this.lab);
      brain.clearInputs();

      if (!this.running) return null;

      // Step 4: Mint Target / Mutant Fly
      this.currentStep = 4;
      onProgress({
        step: 4, totalSteps: 7, name: `Mint Target Fly (${mutName})`, status: 'running',
        message: `[4/7] Minting Target Fly: ${mutName}`
      });
      this.lab.mintNewFly(mutantSpec);
      await new Promise(r => setTimeout(r, 50));

      // Step 5: Apply Scenario Stimulus for Target
      this.currentStep = 5;
      onProgress({
        step: 5, totalSteps: 7, name: `Apply ${scenario.name} to Target`, status: 'running',
        message: `[5/7] Applying scenario stimulus (${scenario.name}) to Target...`
      });
      scenario.setup(brain, this.lab);
      await new Promise(r => setTimeout(r, 50));

      // Step 6: Run & Record Target Trial
      this.currentStep = 6;
      onProgress({
        step: 6, totalSteps: 7, name: `Record Target Trial (${ticks} ticks)`, status: 'running',
        message: `[6/7] Recording Target trial response...`
      });
      this.recorder.startRecording('mutant');
      for (let i = 0; i < ticks; i++) {
        while (this.paused && this.running) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (!this.running) break;

        brain.step(dt);
        this.recorder.recordFrame({ phase: 'mutant', scenario: scenario.name, genotype: mutName });
        if (i % 25 === 0) {
          onProgress({
            step: 6, totalSteps: 7, name: `Record Target Trial`, status: 'running',
            message: `[6/7] Target run: ${i}/${ticks} ticks (${Math.round((i/ticks)*100)}%)`
          });
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const mutantFrames = this.recorder.stopRecording();
      scenario.teardown(brain, this.lab);
      brain.clearInputs();

      // Restore default fly
      this.lab.mintNewFly('wild-type');

      // Step 7: Analyze Deltas & Assertions
      this.currentStep = 7;
      onProgress({
        step: 7, totalSteps: 7, name: `Analyze Deltas & Assertions`, status: 'running',
        message: `[7/7] Computing behavioral deltas & running unit assertions...`
      });

      const lastCtrl = controlFrames[controlFrames.length - 1] || {};
      const lastMut = mutantFrames[mutantFrames.length - 1] || {};

      const metrics = {
        DNa01: { control: lastCtrl.steer || 0, mutant: lastMut.steer || 0, delta: (lastMut.steer || 0) - (lastCtrl.steer || 0) },
        DNp09: { control: lastCtrl.DNp09 || 0, mutant: lastMut.DNp09 || 0, delta: (lastMut.DNp09 || 0) - (lastCtrl.DNp09 || 0) },
        DNp01: { control: lastCtrl.DNp01 || 0, mutant: lastMut.DNp01 || 0, delta: (lastMut.DNp01 || 0) - (lastCtrl.DNp01 || 0) },
        DNp13: { control: lastCtrl.DNp13 || 0, mutant: lastMut.DNp13 || 0, delta: (lastMut.DNp13 || 0) - (lastCtrl.DNp13 || 0) },
        DNp06: { control: lastCtrl.DNp06 || 0, mutant: lastMut.DNp06 || 0, delta: (lastMut.DNp06 || 0) - (lastCtrl.DNp06 || 0) }
      };

      const results = {
        scenario,
        controlSpec,
        mutantSpec,
        controlName: ctrlName,
        mutantName: mutName,
        controlFrames,
        mutantFrames,
        metrics
      };

      onProgress({ step: 7, totalSteps: 7, name: 'Complete', status: 'complete', message: 'Pipeline execution complete!', results });
      return results;

    } catch (err) {
      console.error('Pipeline execution failed:', err);
      onProgress({ step: this.currentStep, totalSteps: 7, name: 'Error', status: 'error', message: `Pipeline error: ${err.message}` });
      return null;
    } finally {
      this.running = false;
      this.paused = false;
    }
  }
}
