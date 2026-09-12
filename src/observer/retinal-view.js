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

  /**
   * Lay the panel out in the eye's ACTUAL angular coordinates.
   *
   * This must match retina.js exactly:
   *     azimuth   = spacing * (u + v/2)
   *     elevation = spacing * (sqrt(3)/2) * v
   *
   * It previously used `x ~ u, y ~ (v + u/2)`, a different shear -- so the
   * panel drew a transposed picture of the visual field, and screen-down was
   * also up. A broad band on the ground showed as a diagonal strip floating in
   * the field, which looked exactly like a phantom object in front of the fly.
   * The panel is a map of what the eye sees; it has to use the eye's own axes.
   */
  _layout() {
    const { width, height } = this.canvas;
    const radius = this.eye.radius;
    const columns = this.sides.length;
    const fieldW = width / columns;

    // Extent of the map in angular units, in the same shape the optics use.
    const halfAz = radius;                       // max |u + v/2|
    const halfEl = (Math.sqrt(3) / 2) * radius;  // max |(sqrt3/2) v|
    const cell = Math.min(
      (fieldW * 0.92) / (2 * halfAz + 2),
      (height * 0.92) / (2 * halfEl + 1.2),
    );
    this.cell = cell;
    this.fieldW = fieldW;
    this.cx = fieldW / 2;
    this.cy = height / 2;

    // Pointy-top hexagon, which is the cell shape that tiles this packing.
    this.hex = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const x = Math.cos(a) * cell * 0.62;
      const y = Math.sin(a) * cell * 0.62;
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
        // Same axes as the optics. Screen y is negated so POSITIVE elevation
        // (looking up) draws upward, which it did not before.
        const x = originX + cell * (c.u + c.v / 2);
        const y = cy - cell * (Math.sqrt(3) / 2) * c.v;
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
      // Horizon line: everything below it is ground. Makes it obvious at a
      // glance whether the field is the right way up.
      ctx.strokeStyle = 'rgba(154, 92, 255, 0.20)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(i * fieldW + 6, cy);
      ctx.lineTo((i + 1) * fieldW - 6, cy);
      ctx.stroke();
      ctx.setLineDash([]);
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
