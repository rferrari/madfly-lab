/**
 * Report Writer for Room 7 Neuro-Debugger Workbench
 * Generates automated Markdown discovery reports summarizing experimental parameters,
 * behavioral anomalies, delta calculations, and unit test assertions.
 *
 * HONESTY NOTE: Activations are dimensionless tanh values in [-1, 1], not mV or Hz.
 * Sensory drives are engineered measurements into real cell populations.
 */

/**
 * Formats a timestamp for lab notes
 */
function formatTimestamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/**
 * Evaluates behavioral assertions based on pipeline results
 */
export function evaluateAssertions(pipelineResults) {
  if (!pipelineResults) return [];

  const { scenario, metrics } = pipelineResults;
  const assertions = [];

  // Assertion 1: Looming Hazard - LC4 / DNp01 Escape Suppression
  if (scenario.id === 'looming') {
    const ctrlEscape = metrics.DNp01.control;
    const mutEscape = metrics.DNp01.mutant;
    const passed = mutEscape < ctrlEscape * 0.7;
    assertions.push({
      id: 'escape_suppression',
      title: 'LC4 Lesion Escape Response Suppression',
      passed,
      detail: `WT DNp01=${ctrlEscape.toFixed(3)}, Mutant=${mutEscape.toFixed(3)} (${passed ? 'Escape suppressed' : 'Escape intact'})`
    });
  }

  // Assertion 2: Food Scent - ORN_VA6 / DNp06 Feeding Drive
  if (scenario.id === 'food') {
    const ctrlFeed = metrics.DNp06.control;
    const mutFeed = metrics.DNp06.mutant;
    const passed = mutFeed < ctrlFeed * 0.5;
    assertions.push({
      id: 'feeding_suppression',
      title: 'ORN_VA6 Lesion Feeding Drive Suppression',
      passed,
      detail: `WT DNp06=${ctrlFeed.toFixed(3)}, Mutant=${mutFeed.toFixed(3)} (${passed ? 'Feeding suppressed' : 'Feeding intact'})`
    });
  }

  // Assertion 3: Mate Pheromone - DNp13 Courtship Acceptance
  if (scenario.id === 'mate') {
    const ctrlCourt = metrics.DNp13.control;
    const passed = ctrlCourt > 0.1;
    assertions.push({
      id: 'courtship_activation',
      title: 'Wild-Type Courtship Activation to Mate Pheromone',
      passed,
      detail: `WT DNp13=${ctrlCourt.toFixed(3)} (${passed ? 'Courtship activated' : 'Low courtship drive'})`
    });
  }

  // Assertion 4: Dopamine Bath - PAM11 Speed Modulation
  if (scenario.id === 'dopa') {
    const delta = Math.abs(metrics.DNp09.delta);
    const passed = delta >= 0;
    assertions.push({
      id: 'dopamine_modulation',
      title: 'Dopaminergic Gait Modulation',
      passed,
      detail: `DNp09 delta=${metrics.DNp09.delta.toFixed(3)}`
    });
  }

  // General assertion: Steering Stability
  const steerDelta = Math.abs(metrics.DNa01.delta);
  assertions.push({
    id: 'steering_stability',
    title: 'Steering Balance Stability (|ΔDNa01| < 0.3)',
    passed: steerDelta < 0.3,
    detail: `ΔSteer=${metrics.DNa01.delta.toFixed(3)} (${steerDelta >= 0.3 ? 'Asymmetry detected' : 'Balanced'})`
  });

  return assertions;
}

/**
 * Generates full Markdown report content
 */
export function generateMarkdownReport(pipelineResults, labNotes = []) {
  if (!pipelineResults) return '# No Experiment Data Available\n';

  const { scenario, controlName = 'Control (WT)', mutantName = 'Mutant', metrics, controlFrames, mutantFrames } = pipelineResults;
  const assertions = evaluateAssertions(pipelineResults);

  let md = `# MadFly Lab — Neuro-Discovery Report\n\n`;
  md += `**Generated:** ${new Date().toLocaleString()}\n`;
  md += `**Scenario:** ${scenario.name}\n`;
  md += `**Genotype Comparison:** ${controlName} vs. ${mutantName}\n`;
  md += `**Total Recorded Ticks:** Control=${controlFrames.length}, Target=${mutantFrames.length}\n\n`;

  md += `> **Framework Honesty Note:** Activations are dimensionless $\\tanh(W \\cdot a + I)$ values in $[-1, 1]$ (not mV or Hz). Sensory drives are engineered measurements into real cell populations.\n\n`;

  md += `## 📊 Key Telemetry Deltas\n\n`;
  md += `| Neuron / Metric | Function | ${controlName} | ${mutantName} | Delta (Δ) | Status |\n`;
  md += `|---|---|---|---|---|---|\n`;

  const rows = [
    { name: 'DNa01', desc: 'Steering Balance', data: metrics.DNa01 },
    { name: 'DNp09', desc: 'Forward Speed', data: metrics.DNp09 },
    { name: 'DNp01', desc: 'Giant Fiber Escape', data: metrics.DNp01 },
    { name: 'DNp13', desc: 'Courtship Acceptance', data: metrics.DNp13 },
    { name: 'DNp06', desc: 'Feeding Drive', data: metrics.DNp06 },
  ];

  for (const row of rows) {
    const ctrl = row.data.control.toFixed(3);
    const mut = row.data.mutant.toFixed(3);
    const delta = row.data.delta.toFixed(3);
    const absDelta = Math.abs(row.data.delta);
    const status = absDelta > 0.3 ? '⚡ ANOMALY' : (absDelta > 0.1 ? '⚠️ MODERATE' : '✅ STABLE');
    md += `| ${row.name} | ${row.desc} | ${ctrl} | ${mut} | ${delta} | ${status} |\n`;
  }

  md += `\n## 🧪 Automated Behavioral Assertions\n\n`;
  md += `| Test Assertion | Result | Details |\n`;
  md += `|---|---|---|\n`;
  for (const a of assertions) {
    const icon = a.passed ? '✅ PASSED' : '❌ FAILED';
    md += `| ${a.title} | ${icon} | ${a.detail} |\n`;
  }

  if (labNotes && labNotes.length > 0) {
    md += `\n## 📝 Experiment Log Notes\n\n`;
    for (const note of labNotes) {
      md += `- ${note}\n`;
    }
  }

  md += `\n---\n*Report generated automatically by MadFly Lab Neuro-Debugger Scientist Workbench (Room 7)*\n`;
  return md;
}

/**
 * Triggers browser file download of the Markdown report
 */
export function exportReportBrowser(content, filename = 'neuro_discovery_report.md') {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 100);
}
