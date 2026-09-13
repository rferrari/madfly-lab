/**
 * CardTable -- Room 2's equipment dock for the blackjack task: just a
 * floating screen directly in front of the fly, with a canvas-textured
 * display showing the current hand, the fly's decision, and the live
 * Q-values (no desk, no stand -- earlier versions had both, removed as
 * unnecessary set dressing). This is a plain `Station` (framework base
 * class), so it plugs into the same `addStation()` / label / lifecycle
 * machinery as any Room 1 station -- only the drawing on its screen is
 * blackjack-specific.
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

    // Hidden for now (position/angle kept tuned, just not shown -- flip this
    // back to `true` to bring the in-world screen back). The canvas/texture
    // still get built and `_render()` still runs every tick either way, so
    // re-enabling is exactly this one flag, nothing else to wire back up.
    const SHOW_SCREEN = false;

    // No desk, no stand -- just the screen, floating directly in front of
    // the fly.
    const SCREEN_Y = 1.05;

    const { canvas, ctx, texture } = makeScreenTexture(480, 300);
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = texture;

    // Tilted up and back, like a console angled toward whoever's standing
    // over it -- not a flat-vertical monitor. (`90` was left here from an
    // in-browser experiment -- three.js rotations are radians, so that was
    // an accidental ~14.3 turns, not "90 degrees.") Bezel and panel MUST
    // share this exact value, not just similar-looking literals: tilting a
    // plane about X shifts its world Z by roughly halfHeight * sin(tilt)
    // between its top and bottom edge (~0.3 * sin(0.5) ~= 0.14 at this
    // angle). Two surfaces tilted by DIFFERENT amounts (or opposite signs)
    // diverge in Z across their own height, so a clearance measured only at
    // their centres can still have them crossing/overlapping near one edge --
    // which is exactly what silently broke this before: the two used to tilt
    // by +0.25/-0.25 (opposite signs), which was fine at the very centre but
    // let the bezel's opaque front face swing in front of the screen for
    // most of its height, hiding all but a thin sliver of text. Verified
    // empirically at this specific angle+clearance combo (headless-render):
    // full canvas content visible, no occlusion.
    const SCREEN_TILT = 0.5;

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.68, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x140a24, roughness: 0.4, metalness: 0.6 }),
    );
    bezel.position.set(0, SCREEN_Y, -0.35);
    bezel.rotation.x = SCREEN_TILT;
    if (SHOW_SCREEN) group.add(bezel);

    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.98, 0.6),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    // 0.12+ clear of the bezel's own front face, on whichever side the whole
    // group's local +Z ends up facing once placed (see tethered-scene.js --
    // it rotates this group to face the viewer, not a fixed world direction,
    // so "front" here means +Z, not a hardcoded -Z as an earlier version
    // assumed). A mere 0.02 -- measured only at the centre, ignoring the
    // tilt-driven divergence noted above -- let the bezel win the depth test
    // over ~85% of the screen's height. Verified empirically (headless-render
    // A/B: hiding the bezel outright revealed the full, correctly-drawn
    // canvas; matching the tilt with only 0.02 clearance still rendered solid
    // black; this clearance is what actually cleared it).
    this.panel.position.set(0, SCREEN_Y, -0.21);
    // A PlaneGeometry's default normal faces local +Z -- deliberately left
    // alone here (no rotation.y) so this whole group's local +Z is "the
    // direction the screen faces." Whoever places this station (see
    // examples/blackjack/tethered-scene.js) rotates the GROUP to aim that at
    // whichever real-world direction it wants the screen readable from (the
    // viewer, not the fly -- see that file for why), rather than this file
    // hardcoding an assumption about where the camera/fly will be.
    this.panel.rotation.x = SCREEN_TILT;
    if (SHOW_SCREEN) group.add(this.panel);

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
