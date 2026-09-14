/**
 * Auto-Discover Engine for Room 7 Neuro-Debugger
 *
 * Iterates through cell-type prefixes in the pack, runs quick
 * Control vs. Mutant (silenced) trials, and streams anomalies
 * to the HUD. All findings are retained in memory for JSON export.
 */

export class AutoDiscoverEngine {
  constructor(lab, runner, hud) {
    this.lab      = lab;
    this.runner   = runner;
    this.hud      = hud;
    this.isScanning = false;
    this.findings   = [];          // persistent memory bank of discoveries
  }

  async startScan(scenario) {
    this.isScanning = true;
    const prefixes  = this.getUnmappedPrefixes();
    const sessionFindings = [];

    this.hud.logNote(`🔍 Starting Auto-Discover scan across ${prefixes.length} unmapped clusters...`, 'discovery');

    for (let i = 0; i < prefixes.length; i++) {
      if (!this.isScanning) break;

      const prefix     = prefixes[i];
      const targetSpec = { silence: [prefix] };

      // Real-time progress in the marquee ticker
      this.hud.updateProgress(i + 1, prefixes.length, `Testing prefix: ${prefix}`);

      // 200-tick comparative trial using peak metrics
      const result = await this.runner.runCustomPipeline(scenario, 'wild-type', targetSpec, 200);

      if (!result || !result.deltas) continue;

      const maxDelta = Math.max(
        Math.abs(result.deltas.DNa01 || 0),
        Math.abs(result.deltas.DNp09 || 0),
        Math.abs(result.deltas.DNp01 || 0),
        Math.abs(result.deltas.DNp13 || 0),
        Math.abs(result.deltas.DNp06 || 0)
      );

      if (maxDelta > 0.25) {
        const affectedMotor = this.getPrimaryMotor(result.deltas);
        const anomaly = {
          prefix,
          scenario: scenario.name,
          deltas:   result.deltas,
          peakDeltas: result.peakMetrics ? {
            DNa01: result.peakMetrics.DNa01?.delta ?? 0,
            DNp09: result.peakMetrics.DNp09?.delta ?? 0,
            DNp01: result.peakMetrics.DNp01?.delta ?? 0,
            DNp13: result.peakMetrics.DNp13?.delta ?? 0,
            DNp06: result.peakMetrics.DNp06?.delta ?? 0,
          } : result.deltas,
          affectedMotor,
          maxDelta,
          timestamp: new Date().toISOString(),
        };
        sessionFindings.push(anomaly);
        this.findings.push(anomaly);        // append to persistent bank

        this.hud.triggerAlert(
          `⚡ DISCOVERY: ${prefix} altered ${affectedMotor} by ${(maxDelta * 100).toFixed(0)}%!`
        );
        this.hud.logNote(
          `[DISCOVERY #${this.findings.length}] ${prefix} → ${affectedMotor} Δ=${maxDelta.toFixed(3)}`,
          'discovery'
        );
      }
    }

    this.hud.logNote(
      `✅ Scan complete! Found ${sessionFindings.length} anomalies (${this.findings.length} total in bank).`,
      'info'
    );
    this.isScanning = false;
    return sessionFindings;
  }

  stopScan() {
    this.isScanning = false;
  }

  clearFindings() {
    this.findings = [];
  }

  /** Export findings memory bank as a downloadable JSON file. */
  exportFindingsJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      totalFindings: this.findings.length,
      findings: this.findings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `auto-discover-findings-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  getUnmappedPrefixes() {
    const all      = this.lab.brain?.pack?.prefixes || [];
    const unmapped = all.filter(p =>
      p.startsWith('UNMAPPED') || p.startsWith('CENTRAL') || p.startsWith('OPTIC')
    );
    if (unmapped.length > 0) return unmapped;

    // Fallback: derive unique root prefixes from typeNames
    const typeNames       = this.lab.brain?.pack?.typeNames || [];
    const fallbackPrefixes = Array.from(
      new Set(typeNames.map(name => name.split('_')[0]).filter(Boolean))
    );
    return fallbackPrefixes.length > 0 ? fallbackPrefixes : ['LC4', 'LPLC2', 'ORN_VA6'];
  }

  getPrimaryMotor(deltas) {
    const keys = Object.keys(deltas);
    if (!keys.length) return 'DNa01';
    return keys.reduce(
      (maxKey, key) => Math.abs(deltas[key]) > Math.abs(deltas[maxKey] || 0) ? key : maxKey,
      keys[0]
    );
  }
}
