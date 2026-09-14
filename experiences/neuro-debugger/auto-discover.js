export class AutoDiscoverEngine {
  constructor(lab, runner, hud) {
    this.lab = lab;
    this.runner = runner;
    this.hud = hud;
    this.isScanning = false;
  }

  async startScan(scenario) {
    this.isScanning = true;
    const prefixes = this.getUnmappedPrefixes();
    const findings = [];

    this.hud.logNote(`🔍 Starting Auto-Discover scan across ${prefixes.length} unmapped clusters...`);

    for (let i = 0; i < prefixes.length; i++) {
      if (!this.isScanning) break;

      const prefix = prefixes[i];
      const targetSpec = { silence: [prefix] };

      this.hud.updateProgress(i + 1, prefixes.length, `Testing prefix: ${prefix}`);

      // Run 200-tick comparative trial
      const result = await this.runner.runCustomPipeline(scenario, 'wild-type', targetSpec, 200);
      
      if (!result || !result.deltas) continue;

      // Analyze motor deltas
      const maxDelta = Math.max(
        Math.abs(result.deltas.DNa01 || 0),
        Math.abs(result.deltas.DNp09 || 0),
        Math.abs(result.deltas.DNp01 || 0),
        Math.abs(result.deltas.DNp13 || 0),
        Math.abs(result.deltas.DNp06 || 0)
      );

      // Flag significant behavioral anomalies (|Δ| > 0.25)
      if (maxDelta > 0.25) {
        const anomaly = {
          prefix,
          scenario: scenario.name,
          deltas: result.deltas,
          affectedMotor: this.getPrimaryMotor(result.deltas)
        };
        findings.push(anomaly);
        
        // Trigger alert banner on HUD
        this.hud.triggerAlert(`⚡ DISCOVERY: ${prefix} altered ${anomaly.affectedMotor} by ${(maxDelta * 100).toFixed(0)}%!`);
        this.hud.logNote(`[DISCOVERY #${findings.length}] Prefix ${prefix} under ${scenario.name} -> ${anomaly.affectedMotor} delta = ${maxDelta.toFixed(3)}`);
      }
    }

    this.hud.logNote(`✅ Scan complete! Found ${findings.length} significant neural circuit anomalies.`);
    this.isScanning = false;
    return findings;
  }

  stopScan() {
    this.isScanning = false;
  }

  getUnmappedPrefixes() {
    // Extract unique cell prefixes from brain pack
    const all = this.lab.brain?.pack?.prefixes || [];
    const unmapped = all.filter(p => p.startsWith('UNMAPPED') || p.startsWith('CENTRAL') || p.startsWith('OPTIC'));
    if (unmapped.length > 0) return unmapped;

    // Fallback if pack does not have explicit UNMAPPED/CENTRAL/OPTIC prefix naming
    const typeNames = this.lab.brain?.pack?.typeNames || [];
    const fallbackPrefixes = Array.from(new Set(typeNames.map(name => name.split('_')[0]))).filter(Boolean);
    return fallbackPrefixes.length > 0 ? fallbackPrefixes : ['LC4', 'LPLC2', 'ORN_VA6'];
  }

  getPrimaryMotor(deltas) {
    const keys = Object.keys(deltas);
    if (!keys.length) return 'DNa01';
    return keys.reduce((maxKey, key) => Math.abs(deltas[key]) > Math.abs(deltas[maxKey] || 0) ? key : maxKey, keys[0]);
  }
}
