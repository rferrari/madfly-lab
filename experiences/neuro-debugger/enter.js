/**
 * Room 7 — Automated AI Neuro-Debugger Scientist Workbench
 *
 * Entry point for the Neuro-Debugger experience.
 * Sets up the tethered rig, mounts the 3D dashboard HUD, attaches 3D soma halo
 * visualization to the brain orb, and manages pipeline execution & telemetry replay.
 */

import { BrainHalo } from '../../src/observer/brain-halo.js';
import { DebuggerHUD } from './debugger-hud.js';
import { PipelineRunner } from './pipeline-runner.js';
import { TelemetryRecorder } from './recorder.js';
import { AutoDiscoverEngine } from '../../examples/neuro-debugger/auto-discover.js';

export function enterDebugger(lab) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  const recorder = new TelemetryRecorder(lab);
  const runner = new PipelineRunner(lab, recorder);
  const hud = new DebuggerHUD(lab, runner, recorder);
  const autoDiscover = new AutoDiscoverEngine(lab, runner, hud);
  hud.autoDiscover = autoDiscover;

  hud.mount();

  // Attach 3D soma halo highlight overlay to the floating BrainOrb
  let halo = null;
  if (lab._tetheredRig && lab._tetheredRig.orb) {
    try {
      halo = new BrainHalo(lab._tetheredRig.orb, { color: 0xff2bd6 });
      halo.attach();
      // Highlight LC4 cluster if pack is available
      if (lab.brain && lab.brain.pack) {
        const lc4Indices = lab.brain.pack.indicesOf('LC4') || lab.brain.pack.indicesOfPrefix('LC4') || [];
        if (lc4Indices.length) halo.setCluster(lc4Indices);
      }
    } catch (err) {
      console.warn('BrainHalo initialization warning:', err);
    }
  }

  hud.halo = halo;

  // Periodic telemetry sampling ticker when not replaying
  const ticker = setInterval(() => {
    if (!lab.brain || !lab.brain.ready) return;
    if (recorder.isReplaying) {
      hud.updateFromReplayFrame(recorder.currentFrame);
    } else {
      hud.updateLiveTelemetry();
    }
  }, 50);

  console.log('🔬 Room 7: Neuro-Debugger Scientist Workbench ready!');

  return {
    hud,
    recorder,
    runner,
    autoDiscover,
    halo,
    dispose() {
      clearInterval(ticker);
      hud.dispose();
      recorder.dispose();
      if (halo && halo.dispose) halo.dispose();
      console.log('🔬 Room 7: Neuro-Debugger Scientist Workbench disposed');
    }
  };
}

// Experience metadata for dynamic room menu discovery
export const experienceInfo = {
  label: '🔬 Room 7 — Neuro-Debugger Lab',
  description: 'Automated AI connectomics workbench: Control vs Mutant pipeline & 3D telemetry dashboard'
};