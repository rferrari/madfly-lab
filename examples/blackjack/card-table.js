/**
 * CardTable -- Room 2's equipment dock for the blackjack task: a small
 * fly-sized table with a canvas-textured display showing the current hand,
 * the fly's decision, and the live Q-values. This is a plain `Station`
 * (framework base class), so it plugs into the same `addStation()` / label /
 * lifecycle machinery as any Room 1 station -- only the drawing on its screen
 * is blackjack-specific.
 *
 * Sized to sit at `DOCK_POSITION` from rooms/tethered-rig.js, in front of the
 * tethered platform.
 */

import * as THREE from 'three';
import { Station } from '../../src/core/station.js';
import { makeScreenTexture } from '../../src/core/label.js';
import { THEME, CSS } from '../../src/core/theme.js';

export class CardTable extends Station {
  constructor(opts = {}) {
    super({
      name: 'Card Table', kickRadius: 0, collisionRadius: 0, // decorative; not walked to
      label: 'BLACKJACK', sublabel: 'ORN_DM1 / ORN_VA6 / ORN_DA1 -> Q-readout',
      labelColor: '#e8e0f5',
      ...opts,
    });
  }

  build() {
    const group = new THREE.Group();

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.06, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x0d3d24, roughness: 0.8 }),
    );
    top.position.y = 0.75;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    for (const [x, z] of [[-0.65, 0.4], [0.65, 0.4], [-0.65, -0.4], [0.65, -0.4]]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.5 }),
      );
      leg.position.set(x, 0.375, z);
      group.add(leg);
    }

    const { canvas, ctx, texture } = makeScreenTexture(480, 300);
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = texture;

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.55, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x140a24, roughness: 0.4, metalness: 0.6 }),
    );
    bezel.position.set(0, 1.3, -0.35);
    bezel.rotation.x = -0.25;
    group.add(bezel);

    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.48),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    // 0.02 clear of the bezel's own front face (centre -0.35, half-depth 0.02
    // -> front face at -0.33): the two used to sit EXACTLY coplanar, so the
    // opaque bezel z-fought with (and won against) the screen, rendering as a
    // solid near-black rectangle no matter what was drawn on the canvas.
    this.panel.position.set(0, 1.3, -0.31);
    // A PlaneGeometry's default normal faces local +Z. This screen sits on
    // the NEGATIVE-z side of the table (closer to the platform, which the fly
    // occupies at smaller world z), so its front face needs to look back
    // toward -Z, not the default +Z -- otherwise the fly sees the plane's
    // culled BACK (invisible) with the dark, opaque bezel box showing through
    // behind it, which looks identical to "the texture is black" even though
    // the canvas itself was always painting correctly.
    this.panel.rotation.y = Math.PI;
    this.panel.rotation.x = 0.25;
    group.add(this.panel);

    this._render({ playerTotal: 0, dealerUpcard: 0, usableAce: false }, null, 'IDLE', {});
    return group;
  }

  /**
   * Redraw the table's screen. Called by the example's training loop, not by
   * the framework -- this is the same pattern Screen's `onDraw` uses.
   */
  _render(state, action, decisionState, q) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0b0614';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = CSS.cyan;
    ctx.font = `600 26px ${CSS.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Player ${state.playerTotal}${state.usableAce ? ' (soft)' : ''}`, w / 2, 56);
    ctx.fillStyle = CSS.dim;
    ctx.font = `18px ${CSS.font}`;
    ctx.fillText(`Dealer shows ${state.dealerUpcard}`, w / 2, 88);

    if (action) {
      ctx.fillStyle = action === 'hit' ? CSS.lime : CSS.amber;
      ctx.font = `700 40px ${CSS.font}`;
      ctx.fillText(action.toUpperCase(), w / 2, 160);
    }

    ctx.font = `14px ${CSS.font}`;
    ctx.fillStyle = CSS.dim;
    ctx.fillText(`Q(hit) ${(q.hit ?? 0).toFixed(3)}   Q(stand) ${(q.stand ?? 0).toFixed(3)}`, w / 2, 200);

    ctx.font = `11px ${CSS.font}`;
    ctx.fillStyle = CSS.violet;
    ctx.fillText(decisionState, w / 2, h - 20);
    ctx.textAlign = 'left';
    this.texture.needsUpdate = true;
  }
}
