// Automated AI Neuro-Debugger: Report Writer
// Generates Markdown discovery reports from behavioral test results

import { writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Formats a timestamp for lab notes
 * @returns {string} HH:MM:SS format
 */
function formatTimestamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/**
 * Creates a markdown report from test results
 * @param {Object} results - Test results object
 * @param {Array} scenarios - List of scenarios tested
 * @returns {string} Markdown content
 */
function generateMarkdownReport(results, scenarios) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  let md = `# MadFly Lab Neuro-Discovery Report\n\n`;
  md += `**Generated:** ${new Date().toLocaleString()}\n\n`;
  
  md += `## Test Summary\n\n`;
  md += `| Scenario | Genotype | Status |\n|----------|----------|--------|\n`;
  
  for (const [key, result] of Object.entries(results)) {
    const [scenario, genotype] = key.split('::');
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    md += `| ${scenario} | ${genotype} | ${status} |\n`;
  }
  
  md += `\n## Detailed Findings\n\n`;
  
  for (const [key, result] of Object.entries(results)) {
    const [scenario, genotype] = key.split('::');
    md += `### ${scenario} - ${genotype}\n\n`;
    
    if (result.notes && result.notes.length > 0) {
      md += `**Lab Notes:**\n\n`;
      for (const note of result.notes) {
        md += `- [${formatTimestamp()}] ${note}\n`;
      }
      md += `\n`;
    }
    
    if (result.anomalies && result.anomalies.length > 0) {
      md += `**Detected Anomalies:**\n\n`;
      for (const anomaly of result.anomalies) {
        md += `- ${anomaly}\n`;
      }
      md += `\n`;
    }
    
    if (result.metrics) {
      md += `**Key Metrics:**\n\n`;
      md += `| Neuron | Control | Mutant | Delta |\n|--------|---------|--------|-------|\n`;
      for (const [neuron, values] of Object.entries(result.metrics)) {
        md += `| ${neuron} | ${values.control.toFixed(3)} | ${values.mutant.toFixed(3)} | ${(values.mutant - values.control).toFixed(3)} |\n`;
      }
      md += `\n`;
    }
    
    md += `---\n\n`;
  }
  
  md += `## Conclusion\n\n`;
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r.passed).length;
  md += `**Summary:** ${passedTests}/${totalTests} tests passed.\n\n`;
  
  if (passedTests === totalTests) {
    md += `All behavioral tests passed. No significant anomalies detected in the tested neural circuits.\n`;
  } else {
    md += `Some tests failed, indicating potential circuit disruptions or unexpected behavioral phenotypes.\n`;
    md += `Further investigation recommended for failed test cases.\n`;
  }
  
  return md;
}

/**
 * Saves the markdown report to a file
 * @param {string} content - Markdown content
 * @param {string} filename - Output filename (default: neuro_discovery_report.md)
 */
function saveReport(content, filename = 'neuro_discovery_report.md') {
  const reportsDir = join(process.cwd(), 'reports');
  const filepath = join(reportsDir, filename);
  
  // Ensure reports directory exists
  try {
    writeFileSync(filepath, content, 'utf8');
    console.log(`📝 Report saved to: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error(`❌ Failed to save report:`, err);
    throw err;
  }
}

/**
 * Exports the report as a downloadable blob (for browser use)
 * @param {string} content - Markdown content
 * @param {string} filename - Output filename
 */
function exportReportBrowser(content, filename = 'neuro_discovery_report.md') {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  
  // Clean up
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 100);
}

export { generateMarkdownReport, saveReport, exportReportBrowser };