/**
 * Workstation -- a screen with a keyboard, for scenes where a person types or
 * plays and the fly watches.
 *
 * It is a Screen with a desk and keys, so everything Screen does applies: the
 * display is a canvas the scene draws into, and whatever appears there is real
 * visual input to the fly's eyes. `onKey` receives keystrokes while the fly is
 * within `kickRadius`, which is the hook for "type something and the fly sees
 * it" experiences.
 */

import * as THREE from 'three';
import { Screen } from './screen.js';
import { THEME, CSS } from '../core/theme.js';

export class Workstation extends Screen {
  constructor(opts = {}) {
    super({
      name: 'Workstation', kickRadius: 2.4, collisionRadius: 1.1,
      label: 'WORKSTATION', sublabel: 'type — the fly sees the screen',
      labelColor: '#00e5ff',
      screenWidth: 2.4, screenHeight: 1.5, blinkHz: 0, ...opts,
    });
    this.onKey = opts.onKey ?? null;
    this.text = opts.text ?? '';
    this.caret = true;
    this._caretT = 0;
    this._bound = false;
  }

  build() {
    const group = super.build();

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.12, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x1d1030, roughness: 0.6, metalness: 0.4 }),
    );
    desk.position.set(0, 0.86, 0.75);
    desk.castShadow = true;
    desk.receiveShadow = true;
    group.add(desk);

    // Keyboard: a slab plus a grid of keys, angled slightly toward the user.
    const kb = new THREE.Group();
    kb.position.set(0, 0.94, 0.95);
    kb.rotation.x = -0.12;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.06, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x120a1f, roughness: 0.5, metalness: 0.6 }),
    );
    kb.add(slab);

    this.keyMeshes = [];
    const keyMat = new THREE.MeshStandardMaterial({
      color: 0x2a1b44, emissive: THEME.cyan, emissiveIntensity: 0.12, roughness: 0.45,
    });
    for (let row = 0; row < 4; row++) {
      const cols = row === 3 ? 5 : 12;
      for (let col = 0; col < cols; col++) {
        const key = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.1), keyMat.clone());
        const spread = row === 3 ? 0.26 : 0.145;
        key.position.set((col - (cols - 1) / 2) * spread, 0.045, (row - 1.5) * 0.14);
        kb.add(key);
        this.keyMeshes.push(key);
      }
    }
    group.add(kb);
    return group;
  }

  /** Draw the typed text, unless the scene supplied its own `onDraw`. */
  _render(t) {
    if (this.onDraw) return super._render(t);
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0b0614';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = CSS.cyan;
    ctx.font = `${Math.round(h * 0.1)}px ${CSS.font}`;
    ctx.textAlign = 'left';
    ctx.fillText('madfly@lab:~$', 22, h * 0.2);

    ctx.fillStyle = '#e8e0f5';
    const lines = String(this.text).split('\n').slice(-6);
    lines.forEach((line, i) => {
      ctx.fillText(line.slice(-34), 22, h * 0.36 + i * h * 0.12);
    });

    this._caretT += 1 / 60;
    if (Math.floor(this._caretT * 2) % 2 === 0) {
      const last = (lines[lines.length - 1] ?? '').slice(-34);
      ctx.fillStyle = CSS.cyan;
      ctx.fillRect(
        22 + ctx.measureText(last).width + 3,
        h * 0.36 + (lines.length - 1) * h * 0.12 - h * 0.085,
        Math.round(h * 0.055), Math.round(h * 0.1),
      );
    }
    this.texture.needsUpdate = true;
  }

  attach(lab) {
    super.attach(lab);
    if (this._bound) return;
    this._bound = true;

    // Only capture keys while the fly is actually near the workstation, so the
    // scene's own shortcuts keep working everywhere else.
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (this.distanceTo(lab.avatar.position) > this.kickRadius) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Backspace') this.text = this.text.slice(0, -1);
      else if (e.key === 'Enter') this.text += '\n';
      else if (e.key.length === 1) this.text += e.key;
      else return;
      e.preventDefault();

      // Light a random key so typing is visible on the model too.
      const key = this.keyMeshes?.[Math.floor(Math.random() * this.keyMeshes.length)];
      if (key) key.material.emissiveIntensity = 1.6;
      this.onKey?.(e.key, this.text, this);
    });
  }

  update(dt, ctx) {
    super.update(dt, ctx);
    for (const key of this.keyMeshes ?? []) {
      if (key.material.emissiveIntensity > 0.12) {
        key.material.emissiveIntensity = Math.max(0.12, key.material.emissiveIntensity - dt * 4);
      }
    }
  }
}
