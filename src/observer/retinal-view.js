/**
 * HUD panel 1 -- Fly Retinal Vision (spec 3.3).
 *
 * Draws the 721 hexagonal ommatidial columns as actual hexagons in axial
 * coordinates, so the panel shows the fly's sampling geometry rather than a
 * rectangle of pixels. Luminance maps onto the lab's amber, matching the eye
 * colour on the avatar and in the lab art.
 */

import { CSS } from '../core/theme.js';

export class RetinalView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} eyes  {L: CompoundEye, R: CompoundEye} -- or a single eye,
   *   which is drawn alone (back-compat with the one-eye API).
   */
  constructor(canvas, eyes) {
    this.canvas = canvas;
    this.eyes = eyes.L ? eyes : { L: eyes };
    this.sides = Object.keys(this.eyes);
    this.eye = this.eyes.L;           // representative, for geometry
    this.ctx = canvas.getContext('2d');
    this._layout();
  }

  _layout() {
    const { width, height } = this.canvas;
    const radius = this.eye.radius;
    // Two fields side by side, so the panel shows what each eye sees
    // separately -- which is the thing that actually drives steering.
    const columns = this.sides.length;
    const fieldW = width / columns;
    // Flat-top hex packing: column pitch 1.5r, row pitch sqrt(3)r.
    const cell = Math.min(
      fieldW / ((radius * 2 + 2) * 1.5),
      height / ((radius * 2 + 2) * Math.sqrt(3)),
    );
    this.cell = cell;
    this.fieldW = fieldW;
    this.cx = fieldW / 2;
    this.cy = height / 2;

    this.hex = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = Math.cos(a) * cell * 0.95;
      const y = Math.sin(a) * cell * 0.95;
      if (i === 0) this.hex.moveTo(x, y); else this.hex.lineTo(x, y);
    }
    this.hex.closePath();
  }

  /**
   * @param {object} responses  {L: Float32Array, R: Float32Array}
   * @param {object} loom       {L: number, R: number} per-eye loom, 0..1
   */
  draw(responses = {}, loom = {}) {
    const { ctx, canvas, cell, cy, fieldW } = this;
    ctx.fillStyle = CSS.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.sides.forEach((side, i) => {
      const eye = this.eyes[side];
      const response = responses[side];
      const originX = i * fieldW + fieldW / 2;

      for (const c of eye.cells) {
        const v = response ? response[c.index] : 0;
        const x = originX + cell * 1.5 * c.u;
        const y = cy + cell * Math.sqrt(3) * (c.v + c.u / 2);
        // Amber ramp: dark violet at 0, hot amber at 1.
        const r = Math.round(30 + v * 225);
        const g = Math.round(12 + v * 126);
        const b = Math.round(46 + v * 15);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.save();
        ctx.translate(x, y);
        ctx.fill(this.hex);
        ctx.restore();
      }

      // Per-eye loom ring: which eye saw the threat is the signal that steers.
      const l = loom[side] ?? 0;
      if (l > 0.02) {
        ctx.strokeStyle = `rgba(255, 51, 85, ${Math.min(1, l * 1.5)})`;
        ctx.lineWidth = 2 + l * 5;
        ctx.strokeRect(i * fieldW + 2, 2, fieldW - 4, canvas.height - 4);
      }

      ctx.fillStyle = CSS.dim;
      ctx.font = `9px ${CSS.font}`;
      ctx.fillText(side, i * fieldW + 5, canvas.height - 5);
    });

    if (this.sides.length > 1) {
      ctx.strokeStyle = 'rgba(154, 92, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fieldW, 6);
      ctx.lineTo(fieldW, canvas.height - 6);
      ctx.stroke();
    }
  }
}
