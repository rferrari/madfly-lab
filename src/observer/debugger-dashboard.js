// Futuristic Neuro-Debugger Dashboard UI
// Cyberpunk HUD overlay for automated behavioral anomaly detection

import { CSS } from '../core/theme.js';

export class DebuggerDashboard {
  constructor(lab) {
    this.lab = lab;
    this.container = document.createElement('div');
    this.container.className = 'debugger-dashboard';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      display: none;
    `;
    
    // Glassmorphic dark background with neon accents
    this.container.innerHTML = `
      <div style="
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(11, 6, 20, 0.88);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 255, 255, 0.1);
        box-shadow: 0 0 30px rgba(0, 255, 255, 0.2);
      "></div>
      
      <div style="
        position: absolute;
        top: 20px;
        left: 20px;
        right: 20px;
        height: 60px;
        background: rgba(0, 255, 255, 0.05);
        border: 1px solid rgba(0, 255, 255, 0.2);
        border-radius: 8px;
        overflow: hidden;
      ">
        <div id="alert-ticker" style="
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.1), transparent);
          animation: tickerMove 8s linear infinite;
          color: #00ffff;
          font-family: '${CSS.font}';
          font-size: 14px;
          padding: 0 20px;
          display: flex;
          align-items: center;
          white-space: nowrap;
        ">
          🚨 ALERT TICKER: Waiting for scan...
        </div>
      </div>
      
      <div style="
        position: absolute;
        top: 100px;
        left: 20px;
        right: 20px;
        bottom: 100px;
        display: flex;
        gap: 20px;
      ">
        <!-- Dual Telemetry Delta Panel -->
        <div style="
          flex: 1;
          background: rgba(0, 255, 255, 0.03);
          border: 1px solid rgba(0, 255, 255, 0.1);
          border-radius: 8px;
          padding: 15px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        ">
          <div style="
            color: #00ffff;
            font-size: 16px;
            font-weight: bold;
            border-bottom: 1px solid rgba(0, 255, 255, 0.2);
            padding-bottom: 5px;
          ">
            📊 LIVE TELEMETRY DELTAS
          </div>
          <div id="telemetry-wildtype" style="
            flex: 1;
            min-height: 80px;
            color: #00ff00;
            font-family: monospace;
            font-size: 13px;
            overflow-y: auto;
          ">
            Wild-Type (Control)<br>
            DNa01 (Steer) : ───/\─── [0.12]<br>
            DNp09 (Speed) : ─────── [0.42]<br>
          </div>
          <div id="telemetry-mutant" style="
            flex: 1;
            min-height: 80px;
            color: #ff00ff;
            font-family: monospace;
            font-size: 13px;
            overflow-y: auto;
          ">
            Lesioned Mutant<br>
            DNa01 (Steer) : ──/\/\── [0.38] ⚡<br>
            DNp09 (Speed) : ──────── [0.02] 🛑<br>
          </div>
        </div>
        
        <!-- 3D Soma Cloud Viewer -->
        <div style="
          flex: 1;
          position: relative;
        ">
          <div style="
            color: #00ffff;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 10px;
          ">
            🧠 3D SOMA CLOUD (MaleCNS v1.0)
          </div>
          <div id="soma-cloud-container" style="
            position: relative;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(0, 255, 255, 0.1);
            border-radius: 8px;
          ">
            <!-- Brain halo will be injected here -->
          </div>
        </div>
      </div>
      
      <div style="
        position: absolute;
        bottom: 20px;
        left: 20px;
        right: 20px;
        height: 80px;
        display: flex;
        gap: 20px;
      ">
        <!-- Live AI Lab Notes -->
        <div style="
          flex: 2;
          background: rgba(0, 255, 255, 0.03);
          border: 1px solid rgba(0, 255, 255, 0.1);
          border-radius: 8px;
          padding: 15px;
          display: flex;
          flex-direction: column;
        ">
          <div style="
            color: #00ffff;
            font-size: 16px;
            font-weight: bold;
            border-bottom: 1px solid rgba(0, 255, 255, 0.2);
            padding-bottom: 5px;
          ">
            📝 REAL-TIME AI LAB NOTES
          </div>
          <div id="lab-notes" style="
            flex: 1;
            overflow-y: auto;
            font-family: '${CSS.font}';
            font-size: 13px;
            color: #cccccc;
          ">
            [09:12:04] 🧪 SCENARIO 12: Lights OFF | PAM11 Bath (+20)<br>
            [09:12:05] ⚡ ANOMALY: DNp09 forward drive collapsed to 0.02 (-94% vs Control)<br>
            [09:12:06] 📝 HYPOTHESIS: Cluster_741 acts as a light-gated gait stabilizer.<br>
          </div>
        </div>
        
        <!-- Unit Tests & Controls -->
        <div style="
          flex: 1;
          display: flex;
          flex-direction: column;
        ">
          <div style="
            background: rgba(0, 255, 255, 0.03);
            border: 1px solid rgba(0, 255, 255, 0.1);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
          ">
            <div style="
              color: #00ffff;
              font-size: 16px;
              font-weight: bold;
              border-bottom: 1px solid rgba(0, 255, 255, 0.2);
              padding-bottom: 5px;
            ">
              🧪 UNIT TESTS
            </div>
            <div id="unit-tests" style="
              flex: 1;
              font-family: '${CSS.font}';
              font-size: 12px;
              color: #cccccc;
            ">
              ✅ test_escape_silencing PASSED<br>
              ✅ test_feeding_suppression PASSED<br>
              ⚠️ test_courtship_approach FAILED<br>
            </div>
          </div>
          
          <button id="export-report-btn" style="
            flex-shrink: 0;
            background: rgba(0, 255, 255, 0.2);
            border: 1px solid rgba(0, 255, 255, 0.3);
            border-radius: 6px;
            color: #00ffff;
            font-family: '${CSS.font}';
            font-size: 14px;
            padding: 10px 20px;
            cursor: pointer;
            transition: all 0.2s;
          ">
            EXPORT DISCOVERY REPORT
          </div>
        </div>
      </div>
      
      <style>
        @keyframes tickerMove {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        
        .debugger-dashboard button:hover {
          background: rgba(0, 255, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 255, 255, 0.3);
        }
        
        .debugger-dashboard button:active {
          transform: translateY(0);
        }
      </style>
    `;
    
    document.body.appendChild(this.container);
    
    // Initialize brain halo for 3D soma visualization
    this.initBrainHalo();
  }
  
  initBrainHalo() {
    try {
      // Import BrainHalo dynamically to avoid circular dependencies
      import('../observer/brain-halo.js').then(({ BrainHalo }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 300;
        canvas.style.position = 'absolute';
        canvas.style.top = '50%';
        canvas.style.left = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';
        canvas.style.pointerEvents = 'none';
        
        const somaCloudContainer = document.getElementById('soma-cloud-container');
        somaCloudContainer.appendChild(canvas);
        
        // Create brain halo with the lab's brain data
        this.brainHalo = new BrainHalo(canvas, this.lab.brain.pack ?? this.lab.brain.runtime);
        
        // Update halo periodically
        setInterval(() => {
          if (this.brainHalo && this.lab.brain.runtime) {
            const activationView = this.lab.brain.runtime.activationView?.();
            if (activationView) {
              this.brainHalo.update(activationView, 1/60, this.lab.brain.runtime.cloud);
              this.brainHalo.render();
            }
          }
        }, 16); // ~60 FPS
      }).catch(err => {
        console.warn('BrainHalo not available:', err);
        // Fallback: show simple message
        const somaCloudContainer = document.getElementById('soma-cloud-container');
        somaCloudContainer.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#888;">3D Soma Cloud<br>(BrainHalo loading)</div>';
      });
    } catch (err) {
      console.warn('Failed to initialize BrainHalo:', err);
    }
  }
  
  updateAlertTicker(message) {
    const ticker = document.getElementById('alert-ticker');
    if (ticker) {
      ticker.textContent = `🚨 ALERT TICKER: ${message}`;
    }
  }
  
  updateTelemetry(wildtypeData, mutantData) {
    const wtEl = document.getElementById('telemetry-wildtype');
    const mutEl = document.getElementById('telemetry-mutant');
    
    if (wtEl && wildtypeData) {
      wtEl.innerHTML = `
        Wild-Type (Control)<br>
        ${Object.entries(wildtypeData).map(([neuron, value]) => {
          const formatted = value.toFixed(3);
          return `${neuron.padEnd(8)} : ${'─'.repeat(Math.abs(value * 10))} [${formatted}]`;
        }).join('<br>')}
      `;
    }
    
    if (mutEl && mutantData) {
      mutEl.innerHTML = `
        Lesioned Mutant<br>
        ${Object.entries(mutantData).map(([neuron, value]) => {
          const formatted = value.toFixed(3);
          const anomalyMarker = Math.abs(value) > 0.3 ? ' ⚡' : '';
          return `${neuron.padEnd(8)} : ${'─'.repeat(Math.abs(value * 10))} [${formatted}]${anomalyMarker}`;
        }).join('<br>')}
      `;
    }
  }
  
  addLabNote(timestamp, message, type = 'info') {
    const notesEl = document.getElementById('lab-notes');
    if (!notesEl) return;
    
    const typeIcons = {
      info: '🧪',
      warning: '⚡',
      success: '✅',
      error: '❌'
    };
    
    const icon = typeIcons[type] || '🧪';
    const note = `[${timestamp}] ${icon} ${message}<br>`;
    notesEl.innerHTML += note;
    
    // Auto-scroll to bottom
    notesEl.scrollTop = notesEl.scrollHeight;
  }
  
  updateUnitTests(testResults) {
    const testsEl = document.getElementById('unit-tests');
    if (!testsEl) return;
    
    testsEl.innerHTML = Object.entries(testResults)
      .map(([testName, passed]) => {
        const icon = passed ? '✅' : '❌';
        return `${icon} ${testName} ${passed ? 'PASSED' : 'FAILED'}<br>`;
      })
      .join('');
  }
  
  show() {
    this.container.style.display = 'block';
  }
  
  hide() {
    this.container.style.display = 'none';
  }
  
  toggle() {
    const isVisible = this.container.style.display === 'block';
    this.container.style.display = isVisible ? 'none' : 'block';
  }
  
  dispose() {
    this.container.remove();
    if (this.brainHalo) {
      // Clean up brain halo if it has a dispose method
      if (this.brainHalo.dispose) {
        this.brainHalo.dispose();
      }
    }
  }
}