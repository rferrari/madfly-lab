/**
 * SkillHUD -- Skill Downloader overlay UI positioned at bottom-left.
 *
 * Supports selecting saved skill files from the `/api/skills` storage endpoint
 * and animating neural weight download into the fly brain.
 */

import { CSS } from '../../src/index.js';

export class SkillHUD {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'madfly-skill-hud';
    Object.assign(this.root.style, {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      width: '320px',
      zIndex: '25',
      background: 'rgba(5, 15, 10, 0.92)',
      border: '1px solid rgba(0, 255, 102, 0.4)',
      boxShadow: '0 0 25px rgba(0, 255, 102, 0.15), inset 0 0 15px rgba(0, 255, 102, 0.05)',
      borderRadius: '10px',
      padding: '16px 18px',
      backdropFilter: 'blur(8px)',
      fontFamily: CSS.font,
      color: '#d0ffd8',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      boxSizing: 'border-box',
    });

    this.activeSkill = { id: 'untrained', name: 'Untrained (Blank)', compatible: false };
    this.onSelectSkill = null;
    this.renderHeader();
    this.renderSkillPicker();
    this.renderStatsBadge();
  }

  mount(parent = document.body) {
    parent.appendChild(this.root);
    return this;
  }

  renderHeader() {
    const header = document.createElement('div');
    header.style.cssText = 'border-bottom: 1px solid rgba(0, 255, 102, 0.25); padding-bottom: 8px;';

    const title = document.createElement('div');
    title.innerHTML = '🕶️ SKILL DOWNLOADER';
    title.style.cssText = 'color: #00ff66; font-size: 14px; font-weight: bold; letter-spacing: 0.15em; text-shadow: 0 0 8px rgba(0, 255, 102, 0.6);';

    const sub = document.createElement('div');
    sub.textContent = 'Upload neural readout weights into fly descending pathways';
    sub.style.cssText = 'color: rgba(0, 255, 102, 0.65); font-size: 10px; margin-top: 2px;';

    header.appendChild(title);
    header.appendChild(sub);
    this.root.appendChild(header);
  }

  renderSkillPicker() {
    const section = document.createElement('div');
    section.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    const label = document.createElement('div');
    label.textContent = 'SELECT SKILL CARTRIDGE:';
    label.style.cssText = 'color: #00f0ff; font-size: 10px; letter-spacing: 0.1em; font-weight: bold;';
    section.appendChild(label);

    const skills = [
      {
        id: 'file-picker',
        name: '📂 Browse Saved Skill Files...',
        desc: 'Open training/skills/ folder & select a file',
        compatible: true,
      },
      {
        id: 'trained',
        name: '🟢 Trained Blackjack Pro (Preset)',
        desc: 'Learned Q-readout basic strategy',
        compatible: true,
      },
      {
        id: 'flight-escape',
        name: '🔴 Martial Arts / Flight Escape',
        desc: 'INCOMPATIBLE: Inverted GF takeoff weights',
        compatible: false,
      },
      {
        id: 'chemotaxis',
        name: '🔴 Olfactory Chemotaxis',
        desc: 'INCOMPATIBLE: Plume navigation weights',
        compatible: false,
      },
      {
        id: 'untrained',
        name: '⚪ Untrained (Blank Mind)',
        desc: 'Zero prior training. Baseline random choices',
        compatible: false,
      },
    ];

    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    for (const skill of skills) {
      const btn = document.createElement('button');
      btn.className = `skill-btn-${skill.id}`;
      btn.style.cssText = `
        background: rgba(0, 20, 10, 0.6);
        border: 1px solid ${skill.id === this.activeSkill.id ? '#00ff66' : 'rgba(0, 255, 102, 0.25)'};
        border-radius: 6px;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
        color: #d0ffd8;
        font-family: ${CSS.font};
        transition: all 0.2s ease;
      `;

      btn.innerHTML = `
        <div style="font-size: 11px; font-weight: bold; color: ${skill.compatible ? '#00ff66' : skill.id === 'untrained' ? '#a0a0a0' : '#ff0055'};">
          ${skill.name}
        </div>
        <div style="font-size: 9px; color: rgba(208, 255, 216, 0.6); margin-top: 2px;">
          ${skill.desc}
        </div>
      `;

      btn.onmouseenter = () => {
        btn.style.borderColor = skill.compatible ? '#00ff66' : '#00f0ff';
        btn.style.background = 'rgba(0, 40, 20, 0.8)';
      };
      btn.onmouseleave = () => {
        btn.style.borderColor = skill.id === this.activeSkill.id ? '#00ff66' : 'rgba(0, 255, 102, 0.25)';
        btn.style.background = 'rgba(0, 20, 10, 0.6)';
      };

      btn.onclick = () => {
        if (skill.id === 'file-picker') {
          this.openSkillFileModal();
        } else {
          this.triggerDownloadAnimation(skill, () => {
            this.activeSkill = skill;
            this.updateActiveSkillUI();
            if (this.onSelectSkill) this.onSelectSkill(skill.id);
          });
        }
      };

      container.appendChild(btn);
    }

    section.appendChild(container);
    this.root.appendChild(section);
  }

  async openSkillFileModal() {
    try {
      const res = await fetch('/api/skills?task=blackjack');
      const entries = await res.json();

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 100;
        background: rgba(5, 15, 10, 0.88); backdrop-filter: blur(8px);
        display: grid; place-items: center; font-family: ${CSS.font};
      `;

      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(5, 20, 10, 0.95);
        border: 1px solid #00ff66;
        box-shadow: 0 0 35px rgba(0, 255, 102, 0.25);
        border-radius: 12px; padding: 20px 24px;
        display: flex; flex-direction: column; gap: 10px;
        min-width: 320px; max-width: 440px; max-height: 75vh; overflow: auto;
      `;

      const title = document.createElement('div');
      title.textContent = '📂 SELECT SAVED SKILL FILE (training/skills/)';
      title.style.cssText = 'color: #00ff66; font-size: 13px; font-weight: bold; letter-spacing: 0.12em;';
      card.appendChild(title);

      if (!entries || !entries.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No saved skill files found in training/skills/.';
        empty.style.cssText = 'color: rgba(255,255,255,0.6); font-size: 11px; margin: 8px 0;';
        card.appendChild(empty);
      } else {
        for (const entry of entries) {
          const btn = document.createElement('button');
          const when = new Date(entry.savedAt).toLocaleString();
          btn.innerHTML = `<div style="font-weight:bold;font-size:12px;color:#00ff66;">${entry.filename}</div>`
            + `<div style="font-size:10px;color:rgba(208,255,216,0.6);margin-top:2px;">Saved: ${when}</div>`;
          btn.style.cssText = `
            background: rgba(0,30,15,0.6); border: 1px solid rgba(0,255,102,0.3);
            border-radius: 8px; padding: 10px 12px; cursor: pointer; text-align: left;
            font-family: ${CSS.font}; transition: all 0.2s ease;
          `;
          btn.onmouseenter = () => { btn.style.borderColor = '#00ff66'; btn.style.background = 'rgba(0,50,25,0.8)'; };
          btn.onmouseleave = () => { btn.style.borderColor = 'rgba(0,255,102,0.3)'; btn.style.background = 'rgba(0,30,15,0.6)'; };

          btn.onclick = () => {
            overlay.remove();
            const skillObj = {
              id: 'file:' + entry.filename,
              name: `📂 ${entry.filename}`,
              desc: `File from training/skills/ (${when})`,
              compatible: true,
              filename: entry.filename,
            };

            this.triggerDownloadAnimation(skillObj, () => {
              this.activeSkill = skillObj;
              this.updateActiveSkillUI();
              if (this.onSelectSkill) this.onSelectSkill(skillObj.id, entry.filename);
            });
          };

          card.appendChild(btn);
        }
      }

      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.cssText = `
        margin-top: 6px; background: transparent; color: rgba(255,255,255,0.6);
        border: 1px solid rgba(0,255,102,0.3); border-radius: 6px; padding: 6px 12px; cursor: pointer;
      `;
      cancel.onclick = () => overlay.remove();
      card.appendChild(cancel);

      overlay.appendChild(card);
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);

    } catch (err) {
      alert(`Could not list skills from training/skills/: ${err.message}`);
    }
  }

  updateActiveSkillUI() {
    if (this.activeBadge) {
      this.activeBadge.innerHTML = `
        <div style="font-size: 10px; color: rgba(0, 255, 102, 0.7);">LOADED SKILL:</div>
        <div style="font-size: 12px; font-weight: bold; color: ${this.activeSkill.compatible ? '#00ff66' : this.activeSkill.id === 'untrained' ? '#a0a0a0' : '#ff0055'}; margin-top: 2px;">
          ${this.activeSkill.name}
        </div>
        <div style="font-size: 10px; margin-top: 4px; color: ${this.activeSkill.compatible ? '#00f0ff' : '#ff0055'};">
          STATUS: ${this.activeSkill.compatible ? '⚡ "I KNOW BLACKJACK"' : this.activeSkill.id === 'untrained' ? '⚠️ UNTRAINED / NO SKILL' : '❌ SKILL INCOMPATIBLE'}
        </div>
      `;
    }
  }

  triggerDownloadAnimation(skill, onComplete) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      background: rgba(3, 10, 5, 0.88);
      backdrop-filter: blur(8px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: ${CSS.font}; color: #00ff66;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(5, 20, 10, 0.95);
      border: 1px solid #00ff66;
      box-shadow: 0 0 40px rgba(0, 255, 102, 0.3);
      border-radius: 12px; padding: 24px 32px;
      text-align: center; max-width: 400px; width: 90%;
    `;

    card.innerHTML = `
      <div style="font-size: 18px; font-weight: bold; letter-spacing: 0.15em; text-shadow: 0 0 12px #00ff66;">
        ⚡ SKILL DOWNLOAD IN PROGRESS
      </div>
      <div style="font-size: 12px; color: #00f0ff; margin-top: 8px;">
        Target: Fly Descending Pathways (DNa01/DNp03/DNp13)
      </div>
      <div style="font-size: 11px; color: rgba(0, 255, 102, 0.7); margin-top: 4px;">
        Cartridge: ${skill.name}
      </div>
      <div style="margin-top: 16px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,102,0.3); border-radius: 6px; height: 12px; overflow: hidden; position: relative;">
        <div id="download-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #00ff66, #00f0ff); transition: width 0.1s linear;"></div>
      </div>
      <div id="download-log-text" style="font-size: 10px; color: #00ff66; margin-top: 10px; min-height: 1.2em; font-family: monospace;">
        READING FROM FILE SYSTEM...
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const fill = card.querySelector('#download-progress-fill');
    const log = card.querySelector('#download-log-text');

    const steps = [
      { pct: 25, text: 'SYNCHRONIZING DESCENDING CHANNELS...' },
      { pct: 60, text: 'OVERWRITING WEIGHT VECTORS...' },
      { pct: 90, text: 'VALIDATING SYNAPTIC SYNCHRONIZATION...' },
      { pct: 100, text: 'SKILL INSTALLED INTO FLY BRAIN!' },
    ];

    let stepIdx = 0;
    const interval = setInterval(() => {
      if (stepIdx < steps.length) {
        const s = steps[stepIdx];
        fill.style.width = `${s.pct}%`;
        log.textContent = s.text;
        stepIdx++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          overlay.remove();
          onComplete();
        }, 250);
      }
    }, 150);
  }

  renderStatsBadge() {
    this.activeBadge = document.createElement('div');
    this.activeBadge.style.cssText = `
      background: rgba(0, 20, 10, 0.7);
      border: 1px solid rgba(0, 255, 102, 0.3);
      border-radius: 6px;
      padding: 10px;
    `;
    this.updateActiveSkillUI();
    this.root.appendChild(this.activeBadge);

    this.statsContainer = document.createElement('div');
    this.statsContainer.style.cssText = `
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(0, 240, 255, 0.2);
      border-radius: 6px;
      padding: 10px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
    this.statsContainer.innerHTML = `
      <div style="color: #00f0ff; font-weight: bold; font-size: 10px; letter-spacing: 0.08em;">PERFORMANCE DIAGNOSTICS:</div>
      <div>Rounds Played: <span id="hud-trials" style="color:#fff;">0</span></div>
      <div>Win Rate: <span id="hud-winrate" style="color:#00ff66;">0.0%</span></div>
      <div>Wins / Losses: <span id="hud-wl" style="color:#d0ffd8;">0 / 0</span></div>
    `;
    this.root.appendChild(this.statsContainer);
  }

  updateStats(meta) {
    if (!meta) return;
    const trialsEl = this.root.querySelector('#hud-trials');
    const winrateEl = this.root.querySelector('#hud-winrate');
    const wlEl = this.root.querySelector('#hud-wl');

    if (trialsEl) trialsEl.textContent = meta.trials || 0;
    if (winrateEl) {
      const pct = ((meta.successRate || 0) * 100).toFixed(1);
      winrateEl.textContent = `${pct}%`;
      winrateEl.style.color = meta.successRate > 0.42 ? '#00ff66' : meta.successRate < 0.35 ? '#ff0055' : '#ffc857';
    }
    if (wlEl) wlEl.textContent = `${meta.wins || 0} / ${meta.losses || 0}`;
  }

  dispose() {
    this.root.remove();
  }
}
