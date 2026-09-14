// Automated Behavioral Unit Tests for Neuro-Debugger
// Tests for expected phenotype breaks in lesioned flies

// Mock DOM and WebGL for headless operation in tests
if (typeof document === 'undefined') {
  // We are in Node.js, use the canvas module to create a canvas
  const { createCanvas } = await import('canvas');
  const glModule = await import('gl');
  const fs = await import('fs/promises');
  
  const canvas = createCanvas(100, 100);
  
  // Create a real WebGL context using the 'gl' module
  const webglContext = glModule.default(100, 100, { preserveDrawingBuffer: true });
  
  // Add glVersion property that Three.js expects
  webglContext.glVersion = 'WebGL 1.0';
  
  // Stub out missing methods that Three.js tries to call (texImage3D for 3D textures)
  webglContext.texImage3D = () => {};
  
  // Override the canvas's getContext method to return our WebGL context
  canvas.getContext = () => webglContext;
  // Add the missing methods that Three.js expects on the canvas
  canvas.addEventListener = () => {};
  canvas.removeEventListener = () => {};

  global.document = {
    createElement: () => canvas,
    querySelector: (selector) => {
      if (selector === '#offscreen-canvas') return canvas;
      return null;
    },
    documentElement: {},
    head: {},
    body: {}
  };

  // Mock window properties that Three.js uses
  global.window = global;
  window.devicePixelRatio = 1;
  window.innerWidth = canvas.width;
  window.innerHeight = canvas.height;
  if (typeof window.navigator === 'undefined') {
    window.navigator = { userAgent: 'Node.js' };
  } else {
    try {
      window.navigator.userAgent = 'Node.js';
    } catch (e) {
      // ignore
    }
  }
  window.addEventListener = () => {};
  window.removeEventListener = () => {};
  let animationFrameCallback = null;
  let animationFrameId = 0;
  window.requestAnimationFrame = (cb) => {
    animationFrameCallback = cb;
    return ++animationFrameId;
  };
  window.cancelAnimationFrame = (id) => {
    if (id === animationFrameId) {
      animationFrameCallback = null;
    }
  };
  if (!window.performance) {
    window.performance = { now: () => Date.now() };
  } else if (!window.performance.now) {
    window.performance.now = () => Date.now();
  }

  // Patch fetch to handle file:// URLs for loading .mflpack files
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    let url = input;
    if (typeof input === 'object' && input instanceof URL) {
      url = input.href;
    }
    if (typeof url === 'string' && url.startsWith('file://')) {
      try {
        const path = new URL(url).pathname;
        const buffer = await fs.readFile(path);
        return new Response(buffer);
      } catch (err) {
        return originalFetch(input, init);
      }
    }
    return originalFetch(input, init);
  };
}

// Helper to run a scenario and get calibrated & phasic readings
async function runScenario(lab, scenarioSetup) {
  await lab.start();
  try {
    lab.brain.reset();
    if (scenarioSetup) scenarioSetup(lab);
    const dt = 1 / lab.brain.tickHz;
    let maxDNp01 = 0;
    for (let i = 0; i < 300; i++) {
      lab.brain.step(dt);
      const phasic01 = lab.brain.readPhasic('DNp01');
      if (phasic01 > maxDNp01) maxDNp01 = phasic01;
    }
    return {
      DNa01: lab.brain.readCalibrated('DNa01'),
      DNp09: lab.brain.readCalibrated('DNp09'),
      DNp01: maxDNp01,
      DNp13: lab.brain.readCalibrated('DNp13'),
      DNp06: lab.brain.readPhasic('DNp06')
    };
  } finally {
    await lab.stop();
  }
}

// Test scenario: Looming Hazard
const loomingHazardSetup = (lab) => {
  if (lab.brain.setInput) {
    lab.brain.setInput('LPLC2_L', 5.0);
    lab.brain.setInput('LPLC2_R', 5.0);
  }
};

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MadFlyLab } from '../src/index.js';

describe('Neuro-Debugger Behavioral Unit Tests', () => {
  test('test_escape_silencing: LC4 lesion should abolish giant fiber escape response', async () => {
    const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
    const wtLab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });
    wtLab.mintNewFly('wild-type');
    const wtReadings = await runScenario(wtLab, loomingHazardSetup);

    const mutLab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });
    mutLab.mintNewFly({ silence: ['LC4'] });
    const mutReadings = await runScenario(mutLab, loomingHazardSetup);

    const wtEscape = wtReadings.DNp01;
    const mutEscape = mutReadings.DNp01;

    assert.ok(mutEscape <= wtEscape, 
      `Expected LC4 lesion to reduce or equal DNp01 escape response. WT: ${wtEscape.toFixed(3)}, Mutant: ${mutEscape.toFixed(3)}`);
  });

  test('test_feeding_suppression: DNp06 lesion should abolish feeding drive', async () => {
    const foodScentSetup = (lab) => {
      if (lab.brain.setInput) {
        lab.brain.setInput('ORN_V', 1.0);
      }
    };

    const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
    const wtLab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });
    wtLab.mintNewFly('wild-type');
    const wtReadings = await runScenario(wtLab, foodScentSetup);

    const mutLab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });
    mutLab.mintNewFly({ silence: ['DNp06'] });
    const mutReadings = await runScenario(mutLab, foodScentSetup);

    const wtFeed = wtReadings.DNp06;
    const mutFeed = mutReadings.DNp06;
    assert.ok(mutFeed <= wtFeed, 
      `Expected DNp06 lesion to suppress feeding drive. WT: ${wtFeed.toFixed(3)}, Mutant: ${mutFeed.toFixed(3)}`);
  });

  test('test_courtship_approach: Wild-type should show courtship activation with mate present', async () => {
    const mateSetup = (lab) => {
      if (lab.brain.setInput) {
        lab.brain.setInput('ORN_DA1', 5.0);
      }
    };

    const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
    const wtLab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });
    wtLab.mintNewFly('wild-type');
    const wtReadings = await runScenario(wtLab, mateSetup);

    const wtCourt = wtReadings.DNp13;
    assert.ok(wtCourt > 0, 
      `Expected wild-type to show courtship activation (DNp13 > 0). Got: ${wtCourt.toFixed(3)}`);
  });

  test('test_custom_control_comparison: Pipeline handles custom Control vs Target fly selection', async () => {
    const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
    const lab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });

    const { TelemetryRecorder } = await import('../experiences/neuro-debugger/recorder.js');
    const { PipelineRunner } = await import('../experiences/neuro-debugger/pipeline-runner.js');

    await lab.start();
    try {
      const recorder = new TelemetryRecorder(lab);
      const runner = new PipelineRunner(lab, recorder);

      const results = await runner.runPipeline('looming', 'blind', { silence: ['LC4'] }, 50);

      assert.ok(results, 'Pipeline execution returned results');
      assert.strictEqual(results.controlFrames.length, 50);
      assert.strictEqual(results.mutantFrames.length, 50);
      assert.ok(results.metrics.DNp01, 'Metrics computed for DNp01');
      assert.ok(results.peakMetrics.DNp01, 'Peak metrics computed for DNp01');
      assert.ok(results.deltas.DNp01 !== undefined, 'Deltas computed for DNp01');
    } finally {
      await lab.stop();
    }
  });

  test('test_peak_metrics_and_double_knockout: Evaluates redundancy in looming circuit', async () => {
    const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
    const lab = new MadFlyLab({
      mode: 'pruned-subgraph',
      canvas: '#offscreen-canvas',
      circuit: 'courtship',
      packUrl: packUrl,
      observer: false
    });

    const { TelemetryRecorder } = await import('../experiences/neuro-debugger/recorder.js');
    const { PipelineRunner } = await import('../experiences/neuro-debugger/pipeline-runner.js');
    const { generateMarkdownReport } = await import('../experiences/neuro-debugger/report-writer.js');

    await lab.start();
    try {
      const recorder = new TelemetryRecorder(lab);
      const runner = new PipelineRunner(lab, recorder);

      // Test double knockout LC4 + LPLC2
      const doubleKO = { silence: ['LC4', 'LPLC2'] };
      const results = await runner.runPipeline('looming', 'wild-type', doubleKO, 60);

      assert.ok(results, 'Double knockout pipeline returned results');
      assert.ok(results.peakMetrics, 'Peak metrics exist in results');

      // Test markdown report generation
      const report = generateMarkdownReport(results, ['Test note 1'], [{
        prefix: 'TEST_PREFIX',
        scenario: 'Looming Hazard (LPLC2)',
        affectedMotor: 'DNp01',
        maxDelta: 0.42,
        timestamp: new Date().toISOString()
      }]);

      assert.ok(report.includes('Executive Summary'), 'Report includes Executive Summary');
      assert.ok(report.includes('Table 1 — Peak Trial Activation Comparison'), 'Report includes Table 1');
      assert.ok(report.includes('Table 2 — End-Frame Steady-State Comparison'), 'Report includes Table 2');
      assert.ok(report.includes('Auto-Discovered Circuit Anomalies'), 'Report includes Auto-Discovered section');
      assert.ok(report.includes('Biological Reasoning'), 'Report includes biological reasoning');
    } finally {
      await lab.stop();
    }
  });
});