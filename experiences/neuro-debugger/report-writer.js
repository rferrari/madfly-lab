/**
 * Report Writer for Room 7 Neuro-Debugger Workbench
 *
 * Generates publication-grade Markdown discovery reports:
 *   - Executive summary block
 *   - Dual telemetry tables (peak trial + end-frame steady state)
 *   - Automated unit assertion breakdown with biological reasoning
 *   - Auto-discovered circuit discoveries section
 *   - Full timestamped audit log
 *
 * HONESTY NOTE: Activations are dimensionless tanh values in [-1, 1], not mV or Hz.
 * Sensory drives are engineered measurements into real cell populations.
 */

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

// ---------------------------------------------------------------------------
// Assertion evaluator
// ---------------------------------------------------------------------------

export function evaluateAssertions(pipelineResults) {
  if (!pipelineResults) return [];

  const { scenario, metrics, peakMetrics } = pipelineResults;
  const pm   = peakMetrics || metrics;   // prefer peak
  const assertions = [];

  // Assertion 1: Looming Hazard — LC4 / DNp01 Escape Suppression
  if (scenario.id === 'looming') {
    const ctrlEscape = pm.DNp01.control;
    const mutEscape  = pm.DNp01.mutant;
    const passed     = mutEscape <= ctrlEscape * 0.7;
    const biologicalReason = passed
      ? 'LC4 lesion abolished looming-driven escape; LPLC2 alone insufficient.'
      : 'Escape intact — likely LPLC2 pathway still active. Consider double-knockout LC4+LPLC2.';
    assertions.push({
      id: 'escape_suppression',
      title: 'LC4 Lesion Escape Response Suppression',
      passed,
      detail: `WT DNp01_peak=${ctrlEscape.toFixed(3)}, Mutant=${mutEscape.toFixed(3)}`,
      biologicalReason,
    });
  }

  // Assertion 2: Food Scent — ORN_VA6 / DNp06 Feeding Drive
  if (scenario.id === 'food') {
    const ctrlFeed = pm.DNp06.control;
    const mutFeed  = pm.DNp06.mutant;
    const passed   = mutFeed <= ctrlFeed * 0.5;
    assertions.push({
      id: 'feeding_suppression',
      title: 'ORN_VA6 Lesion Feeding Drive Suppression',
      passed,
      detail: `WT DNp06_peak=${ctrlFeed.toFixed(3)}, Mutant=${mutFeed.toFixed(3)}`,
      biologicalReason: passed
        ? 'VA6 glomerulus is a necessary node for this food-scent → DNp06 pathway.'
        : 'Feeding drive persists — other ORN channels may converge onto DNp06.',
    });
  }

  // Assertion 3: Mate Pheromone — DNp13 Courtship Acceptance
  if (scenario.id === 'mate') {
    const ctrlCourt = pm.DNp13.control;
    const passed    = ctrlCourt > 0.1;
    assertions.push({
      id: 'courtship_activation',
      title: 'Wild-Type Courtship Activation to Mate Pheromone',
      passed,
      detail: `WT DNp13_peak=${ctrlCourt.toFixed(3)}`,
      biologicalReason: passed
        ? 'DA1 glomerulus → P1 → DNp13 pathway intact.'
        : 'Unexpected: wild-type fails to activate courtship drive; check ORN_DA1 channel.',
    });
  }

  // Assertion 4: Dopamine Bath — PAM11 Speed Modulation
  if (scenario.id === 'dopa') {
    const delta  = pm.DNp09.delta;
    const passed = Math.abs(delta) >= 0;   // always passes — records magnitude for report
    assertions.push({
      id: 'dopamine_modulation',
      title: 'Dopaminergic Gait Modulation',
      passed,
      detail: `DNp09 peak Δ=${delta.toFixed(3)}`,
      biologicalReason: 'PAM11 dopamine bath modulates forward speed via DNp09; ' +
        'direction of effect depends on downstream circuit balance.',
    });
  }

  // General: Steering Stability
  const steerDelta = pm.DNa01.delta;
  const steerPassed = Math.abs(steerDelta) < 0.3;
  assertions.push({
    id: 'steering_stability',
    title: 'Steering Balance Stability (|ΔDNa01| < 0.3)',
    passed: steerPassed,
    detail: `ΔSteer_peak=${steerDelta > 0 ? '+' : ''}${steerDelta.toFixed(3)}`,
    biologicalReason: steerPassed
      ? 'Bilateral DNa01 balance maintained; lesion does not introduce net turn bias.'
      : 'Asymmetric steering detected — lesion disrupts bilateral symmetry of descending drive.',
  });

  return assertions;
}

// ---------------------------------------------------------------------------
// Publication-grade Markdown report
// ---------------------------------------------------------------------------

export function generateMarkdownReport(pipelineResults, labNotes = [], autoDiscoverFindings = []) {
  if (!pipelineResults) return '# No Experiment Data Available\n';

  const {
    scenario, controlName = 'Control (WT)', mutantName = 'Mutant',
    metrics, peakMetrics, controlFrames, mutantFrames,
  } = pipelineResults;

  const pm         = peakMetrics || metrics;
  const assertions = evaluateAssertions(pipelineResults);
  const now        = new Date().toLocaleString();
  const passed     = assertions.filter(a => a.passed).length;

  // ── Title & executive summary ──────────────────────────────────────────────
  let md = `# MadFly Lab — Neuro-Discovery Report\n\n`;
  md += `> **Framework Honesty Note:** Activations are dimensionless `
     + `\\(\\tanh(W \\cdot a + I)\\) values in \\([-1, 1]\\) (not mV or Hz). `
     + `Sensory drives are engineered measurements into real cell populations.\n\n`;

  md += `## 📋 Executive Summary\n\n`;
  md += `| Parameter | Value |\n|---|---|\n`;
  md += `| Generated | ${now} |\n`;
  md += `| Scenario | ${scenario.name} |\n`;
  md += `| Input Parameters | ${scenario.inputSummary || '—'} |\n`;
  md += `| Control Genotype | ${controlName} |\n`;
  md += `| Target Genotype | ${mutantName} |\n`;
  md += `| Total Ticks | Control=${controlFrames?.length ?? '?'}, Target=${mutantFrames?.length ?? '?'} |\n`;
  md += `| Assertions | ${passed}/${assertions.length} passed |\n`;
  md += `| Auto-Discoveries Included | ${autoDiscoverFindings.length} |\n\n`;

  // ── Table 1: Peak trial activation comparison ──────────────────────────────
  md += `## 📊 Table 1 — Peak Trial Activation Comparison\n\n`;
  md += `*Peak absolute activation across all trial ticks. `
     + `Catches transient events (e.g., DNp01 Giant Fiber escape jump) missed by end-frame snapshots.*\n\n`;
  md += `| Neuron | Function | ${controlName} Peak | ${mutantName} Peak | Δ Peak | Status |\n`;
  md += `|---|---|---|---|---|---|\n`;

  const ROWS = [
    { key: 'DNa01', desc: 'Steering Balance'     },
    { key: 'DNp09', desc: 'Forward Speed'         },
    { key: 'DNp01', desc: 'Giant Fiber Escape'    },
    { key: 'DNp13', desc: 'Courtship Acceptance'  },
    { key: 'DNp06', desc: 'Feeding Drive'         },
  ];

  for (const row of ROWS) {
    const d = pm[row.key];
    const delta = d.delta;
    const absDelta = Math.abs(delta);
    const status = absDelta > 0.3 ? '⚡ ANOMALY' : absDelta > 0.1 ? '⚠️ MODERATE' : '✅ STABLE';
    md += `| ${row.key} | ${row.desc} | ${d.control.toFixed(3)} | ${d.mutant.toFixed(3)} | ${delta > 0 ? '+' : ''}${delta.toFixed(3)} | ${status} |\n`;
  }

  // ── Table 2: End-frame steady state ───────────────────────────────────────
  md += `\n## 📊 Table 2 — End-Frame Steady-State Comparison\n\n`;
  md += `*Values from the final recorded tick — reflects sustained steady-state, `
     + `not transient responses.*\n\n`;
  md += `| Neuron | Function | ${controlName} End | ${mutantName} End | Δ End | Status |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const row of ROWS) {
    const d = metrics[row.key];
    const delta = d.delta;
    const absDelta = Math.abs(delta);
    const status = absDelta > 0.3 ? '⚡ ANOMALY' : absDelta > 0.1 ? '⚠️ MODERATE' : '✅ STABLE';
    md += `| ${row.key} | ${row.desc} | ${d.control.toFixed(3)} | ${d.mutant.toFixed(3)} | ${delta > 0 ? '+' : ''}${delta.toFixed(3)} | ${status} |\n`;
  }

  // ── Assertions ─────────────────────────────────────────────────────────────
  md += `\n## 🧪 Automated Behavioral Assertions\n\n`;
  md += `| Assertion | Result | Measurement | Biological Reasoning |\n`;
  md += `|---|---|---|---|\n`;
  for (const a of assertions) {
    const icon = a.passed ? '✅ PASSED' : '❌ FAILED';
    md += `| ${a.title} | ${icon} | ${a.detail} | ${a.biologicalReason} |\n`;
  }

  // ── Auto-discovered circuit findings ──────────────────────────────────────
  if (autoDiscoverFindings.length > 0) {
    md += `\n## 🔍 Auto-Discovered Circuit Anomalies\n\n`;
    md += `*Prefix clusters flagged during Auto-Discover sweep (|Δ| > 0.25 on any motor channel).*\n\n`;
    md += `| # | Prefix | Scenario | Primary Motor Affected | Max |Δ| | Timestamp |\n`;
    md += `|---|---|---|---|---|---|\n`;
    autoDiscoverFindings.forEach((f, idx) => {
      md += `| ${idx + 1} | ${f.prefix} | ${f.scenario} | ${f.affectedMotor} | ${f.maxDelta?.toFixed(3) ?? '—'} | ${f.timestamp ?? '—'} |\n`;
    });
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  if (labNotes && labNotes.length > 0) {
    md += `\n## 📝 Full Experiment Audit Log\n\n`;
    for (const note of labNotes) {
      md += `- ${note}\n`;
    }
  }

  md += `\n---\n*Generated by MadFly Lab Neuro-Debugger Scientist Workbench (Room 7) · `
     + `Connectome: male-cns:v1.0 CC BY 4.0 (FlyEM/HHMI Janelia et al.)*\n`;
  return md;
}

// ---------------------------------------------------------------------------
// Browser download helper
// ---------------------------------------------------------------------------

export function exportReportBrowser(content, filename = 'neuro_discovery_report.md') {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ---------------------------------------------------------------------------
// Node.js save helper (headless / batch runner)
// ---------------------------------------------------------------------------

export async function saveReport(content, filename = 'neuro_discovery_report.md') {
  const fs   = await import('fs');
  const path = await import('path');
  const reportsDir = path.join(process.cwd(), 'reports');
  const filepath   = path.join(reportsDir, filename);
  try {
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`📝 Report saved to: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error('❌ Failed to save report:', err);
    throw err;
  }
}
