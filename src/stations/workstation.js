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

/** Seconds between bursts of fly-typing. See `onBump`. */
const TRAMPLE_COOLDOWN = 0.28;

export class Workstation extends Screen {
  constructor(opts = {}) {
    super({
      name: 'Workstation', kickRadius: 2.4, collisionRadius: 1.1,
      label: 'WORKSTATION', sublabel: 'type — the fly sees the screen',
      labelColor: '#00e5ff',
      screenWidth: 2.0, screenHeight: 1.25, blinkHz: 0,
      // Was 1.2 ("raise the screen above the desk"), which put the display
      // 0.85 above the fly's eye -- so it climbed past her 31.7 degree
      // half-field as she approached and she arrived staring at the black
      // desk. Measured, it was the only station in the room that did not get
      // brighter as she walked at it. See Screen's `mount` note. 0.9 still
      // clears the desk (top 0.12) and the keys (~0.25) with the panel's
      // bottom edge at 0.275, so it reads as a monitor standing on the desk.
      mount: 0.9,
      ...opts,
    });
    this.onKey = opts.onKey ?? null;
    this.text = opts.text ?? '';
    this.caret = true;
    this._caretT = 0;
    this._bound = false;
    this._lastTrample = -Infinity;
  }

  build() {
    const group = super.build();

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.12, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x1d1030, roughness: 0.6, metalness: 0.4 }),
    );
    desk.position.set(0, 0.06, 0.75);
    desk.castShadow = true;
    desk.receiveShadow = true;
    group.add(desk);

    // Keyboard: a slab plus a grid of keys, angled slightly toward the user.
    const kb = new THREE.Group();
    kb.position.set(0, 0.18, 0.82);
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

    // A LIT panel, not a black rectangle with text on it. This used to fill
    // with #0b0614 -- so dark that, measured head-on at 1.8 units, the whole
    // workstation came back at 0.019 mean frame brightness against the plain
    // Screen's 0.074. Vision steers her by comparing how bright each eye's view
    // is (LPLC1/LPLC2 -> DNa01), so an unlit display gives her nothing to turn
    // toward, and this is the only station whose pull on her is visual at all:
    // it emits no scent.
    const glow = ctx.createLinearGradient(0, 0, 0, h);
    glow.addColorStop(0, '#123048');
    glow.addColorStop(0.5, '#0d2236');
    glow.addColorStop(1, '#0a1626');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
    ctx.lineWidth = 3;
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

      this._flashKey();
      this.onKey?.(e.key, this.text, this);
    });
  }

  /** Light one key up, so typing shows on the model and not just the screen. */
  _flashKey() {
    const key = this.keyMeshes?.[Math.floor(Math.random() * this.keyMeshes.length)];
    if (key) key.material.emissiveIntensity = 1.6;
  }

  /**
   * The fly walking across the keyboard types. Purely cosmetic -- but it is
   * cosmetic that changes what she SEES, since the screen is a live canvas
   * feeding her eyes, so a fly blundering over the keys makes the display
   * flicker and change, which is real visual input on the real pathway.
   */
  trample() {
    const glyphs = 'abcdefghijklmnopqrstuvwxyz0123456789 ./;[]-=';
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.text += glyphs[Math.floor(Math.random() * glyphs.length)];
      this._flashKey();
    }
    // Keep the buffer from growing without bound over a long session; the
    // renderer only shows the last six lines anyway.
    if (this.text.length > 400) this.text = this.text.slice(-200);
    this.onKey?.(null, this.text, this);
    return this.text;
  }

  /**
   * Bumping the desk is enough contact to mash a few keys. Throttled: collision
   * resolution runs every brain tick (60Hz), so an unguarded version typed a
   * few thousand characters per second of contact.
   */
  onBump() {
    if (this.elapsed - this._lastTrample < TRAMPLE_COOLDOWN) return;
    this._lastTrample = this.elapsed;
    this.trample();
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
