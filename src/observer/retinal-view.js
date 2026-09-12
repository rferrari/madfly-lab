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
  constructor(canvas, eye) {
    this.canvas = canvas;
    this.eye = eye;
    this.ctx = canvas.getContext('2d');
    this._layout();
  }

  _layout() {
    const { width, height } = this.canvas;
    const radius = this.eye.radius;
    // Flat-top hex packing: column pitch 1.5r, row pitch sqrt(3)r.
    const cell = Math.min(width / ((radius * 2 + 2) * 1.5), height / ((radius * 2 + 2) * Math.sqrt(3)));
    this.cell = cell;
    this.cx = width / 2;
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

  draw(response, { loom = 0 } = {}) {
    const { ctx, canvas, cell, cx, cy } = this;
    ctx.fillStyle = CSS.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const c of this.eye.cells) {
      const v = response ? response[c.index] : 0;
      const x = cx + cell * 1.5 * c.u;
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

    // Loom overlay: the escape pathway is the one thing you want to see fire
    // without reading a number.
    if (loom > 0.02) {
      ctx.strokeStyle = `rgba(255, 51, 85, ${Math.min(1, loom * 1.5)})`;
      ctx.lineWidth = 3 + loom * 6;
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
  }
}
