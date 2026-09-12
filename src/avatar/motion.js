/**
 * Looming Threat Detector (spec 3.1) -- image-motion opponency feeding the real
 * LC4 / LPLC2 populations.
 *
 * Ported from duckfly's `shared/vision/motion.js` (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md), generalized off its hardcoded 96x64 frame.
 *
 * Method: Lucas-Kanade normal flow (which preserves both ON and OFF edges),
 * then radial expansion fitted at a grid of candidate receptive-field centers.
 * Four opposing sectors must all agree that the field is expanding before it
 * counts as loom -- that requirement is what makes a flash, or a whole-field
 * translation as the avatar turns, fail to trigger an escape. Persistence over
 * ~40ms is required on top, for the same reason.
 *
 * These are image measurements, not neurons. The output is the drive that gets
 * injected into the real LC4/LPLC2 cells; the detector itself is engineered.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class LoomingDetector {
  constructor({ width = 96, height = 64 } = {}) {
    this.width = width;
    this.height = height;
    this.gray = new Float32Array(width * height);
    this.previous = null;
    this.time = null;
    this.persistence = 0;
  }

  reset() {
    this.previous = null;
    this.time = null;
    this.persistence = 0;
  }

  /**
   * @param {Uint8Array} pixels RGBA frame, width*height*4
   * @param {number} time seconds
   * @returns {{loom:number, left:number, right:number, opponency:number, valid:boolean}}
   *   `loom` is 0..1 expansion evidence; `left`/`right` split it by which half
   *   of the visual field the expanding flow sat in, so a threat approaching
   *   from one side drives that side's real LC4 population harder.
   */
  step(pixels, time) {
    const w = this.width;
    const h = this.height;
    const gray = this.gray;
    for (let i = 0; i < gray.length; i++) {
      gray[i] = (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) / 255;
    }

    const dt = this.time === null ? 0 : time - this.time;
    const out = { loom: 0, left: 0, right: 0, opponency: 0, on: 0, off: 0, valid: false };

    if (this.previous && dt > 0 && dt <= 0.25) {
      const old = this.previous;
      const vectors = [];
      for (let y = 5; y < h - 5; y += 4) {
        for (let x = 5; x < w - 5; x += 4) {
          let xx = 0; let xy = 0; let yy = 0; let xt = 0; let yt = 0; let energy = 0;
          let on = 0; let off = 0;
          for (let py = -2; py <= 2; py++) {
            for (let px = -2; px <= 2; px++) {
              const i = (y + py) * w + x + px;
              const gx = (old[i + 1] - old[i - 1]) / 2;
              const gy = (old[i + w] - old[i - w]) / 2;
              const t = gray[i] - old[i];
              xx += gx * gx; xy += gx * gy; yy += gy * gy;
              xt += gx * t; yt += gy * t; energy += t * t;
              on += Math.max(0, t); off += Math.max(0, -t);
            }
          }
          if (xx + yy < 0.025 || energy < 0.0001) continue;
          const reg = 0.01 * (xx + yy);
          const det = (xx + reg) * (yy + reg) - xy * xy;
          const dx = clamp((-xt * (yy + reg) + yt * xy) / det, -4, 4);
          const dy = clamp((-yt * (xx + reg) + xt * xy) / det, -4, 4);
          if (!Number.isFinite(dx + dy) || Math.hypot(dx, dy) < 0.02) continue;
          vectors.push({ x, y, dx, dy, on: on / 25, off: off / 25 });
        }
      }

      // Fit expansion at a grid of receptive-field centers, so an off-axis
      // approach still registers while a global translation does not.
      let best = 0;
      let bestX = w / 2;
      for (let cy = Math.round(h * 0.25); cy <= Math.round(h * 0.75); cy += 8) {
        for (let cx = Math.round(w * 0.17); cx <= Math.round(w * 0.83); cx += 8) {
          const outward = [0, 0, 0, 0];
          const inward = [0, 0, 0, 0];
          const counts = [0, 0, 0, 0];
          for (const f of vectors) {
            const rx = f.x - cx;
            const ry = f.y - cy;
            const r = Math.hypot(rx, ry);
            if (r < 4 || r > 32) continue;
            const sector = Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? 0 : 1) : (ry > 0 ? 2 : 3);
            const radial = ((rx * f.dx + ry * f.dy) / r) / dt;
            outward[sector] += Math.max(0, radial);
            inward[sector] += Math.max(0, -radial);
            counts[sector]++;
          }
          const sectors = outward.map((v, i) => (counts[i] >= 2 ? (v - 1.5 * inward[i]) / counts[i] : 0));
          const response = Math.max(0, Math.min(...sectors));
          if (response > best) { best = response; bestX = cx; }
        }
      }

      this.persistence = best > 1 ? this.persistence + dt : 0;
      out.loom = this.persistence >= 0.04 ? clamp((best - 1) / 12, 0, 1) : 0;
      out.opponency = best;
      out.valid = true;

      // Attribute the loom to the hemifield its focus of expansion sat in.
      const bias = clamp((bestX / w - 0.5) * 2, -1, 1);
      out.right = out.loom * (0.5 + 0.5 * bias);
      out.left = out.loom * (0.5 - 0.5 * bias);

      const n = Math.max(1, vectors.length);
      for (const f of vectors) { out.on += f.on / n; out.off += f.off / n; }
    } else {
      this.persistence = 0;
    }

    this.previous = this.previous ?? new Float32Array(gray.length);
    this.previous.set(gray);
    this.time = time;
    return out;
  }
}
