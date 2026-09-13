/**
 * Screen -- a display the fly can actually look at, with a dopamine payout.
 *
 * Replaces the bare slot machine with something general. The screen's surface
 * is a canvas texture, so a scene can draw ANYTHING onto it: a pattern, a
 * video frame, a game, a chart. Whatever is on it becomes real visual input,
 * because the fly's compound eyes sample the rendered scene through the normal
 * path -- there is no special case for screen content.
 *
 *     const screen = new Station.Screen({
 *       onDraw: (ctx, w, h, t) => { ... },      // your content, per frame
 *       payoutChannel: 'PAM11', payout: 20,
 *     });
 *
 * To play video, draw a <video> element into the context:
 *     onDraw: (ctx, w, h) => ctx.drawImage(videoEl, 0, 0, w, h)
 *
 * The default content is a blinking test pattern at `blinkHz`, which is a real
 * temporal frequency the retina can resolve -- deliberately a square wave, not
 * a fade, so the motion detector has edges to work with.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { makeScreenTexture } from '../core/label.js';
import { THEME, CSS } from '../core/theme.js';

export class Screen extends Station {
  constructor(opts = {}) {
    super({
      name: 'Screen', kickRadius: 1.8, collisionRadius: 0.7,
      label: 'SCREEN', sublabel: 'reward → PAM11 · 15 real dopaminergic neurons',
      labelColor: '#ff2bd6', ...opts,
    });
    this.blinkHz = opts.blinkHz ?? 6;
    this.payoutChannel = opts.payoutChannel ?? 'PAM11';
    this.payout = opts.payout ?? 20;
    this.payoutChance = opts.payoutChance ?? 1;
    this.onDraw = opts.onDraw ?? null;
    this.screenWidth = opts.screenWidth ?? 2.2;
    this.screenHeight = opts.screenHeight ?? 1.4;
    // Panel CENTRE height, and it is a VISIBILITY constraint, not decoration.
    //
    // The fly's eye sits at EYE_HEIGHT = 0.35 (arena.js) with a 63 degree
    // vertical field -- a half-field of ~31.7 degrees. A panel centred `m`
    // above the eye sits at atan((m - 0.35) / d) degrees up, and that angle
    // GROWS as she approaches, so mounting a screen high makes it climb out of
    // her view exactly when it should be filling it. What she sees instead is
    // whatever dark furniture is underneath.
    //
    // Measured, facing each station head-on at 6 / 3 / 1.8 units, mean frame
    // brightness: this screen at mount 0.85 goes 0.036 -> 0.047 -> 0.074, and
    // the Mate 0.029 -> 0.040 -> 0.076 -- both brighten as she closes in, which
    // is what gives vision anything to steer on. The Workstation at mount 1.2
    // went 0.0152 -> 0.0178 -> 0.0149: flat, and the dimmest thing in the room.
    // Keep this at or below ~0.9 unless the panel is also small.
    this.mount = opts.mount ?? 0.85;
    this.views = 0;
    this.payouts = 0;
    this._flash = 0;
  }

  build() {
    const group = new THREE.Group();
    const w = this.screenWidth;
    const h = this.screenHeight;

    // Stand
    const postH = Math.max(0.12, this.mount - h / 2);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.16, postH, 12),
      new THREE.MeshStandardMaterial({ color: 0x241238, roughness: 0.5, metalness: 0.6 }),
    );
    post.position.y = postH / 2;
    post.castShadow = true;
    group.add(post);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.55, 0.09, 20),
      new THREE.MeshStandardMaterial({ color: 0x1b0f2b, roughness: 0.6, metalness: 0.5 }),
    );
    base.position.y = 0.05;
    group.add(base);

    // Bezel + panel. Local +Z is the front, matching the station convention, so
    // arrangeInRing() turns the screen to face the arena centre.
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x140a24, roughness: 0.4, metalness: 0.7 }),
    );
    bezel.position.set(0, this.mount, 0);
    bezel.castShadow = true;
    group.add(bezel);

    const { canvas, ctx, texture } = makeScreenTexture(512, Math.round(512 * (h / w)));
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = texture;

    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    this.panel.position.set(0, this.mount, 0.056);
    group.add(this.panel);

    this.glow = new THREE.PointLight(THEME.magenta, 6, 9, 2);
    this.glow.position.set(0, this.mount, 0.7);
    group.add(this.glow);

    this._render(0);
    return group;
  }

  _render(t) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    if (this.onDraw) {
      this.onDraw(ctx, w, h, t);
    } else {
      // Default: square-wave blink between two high-contrast fields, plus a
      // moving bar so there is coherent motion as well as flicker.
      const on = Math.sin(t * this.blinkHz * Math.PI * 2) > 0;
      ctx.fillStyle = on ? '#ff2bd6' : '#160a26';
      ctx.fillRect(0, 0, w, h);
      const barX = ((t * 0.35) % 1) * w;
      ctx.fillStyle = on ? '#160a26' : '#00e5ff';
      ctx.fillRect(barX - w * 0.08, 0, w * 0.16, h);

      ctx.fillStyle = on ? '#160a26' : '#e8e0f5';
      ctx.font = `600 ${Math.round(h * 0.16)}px ${CSS.font}`;
      ctx.textAlign = 'center';
      ctx.fillText('MADFLY', w / 2, h * 0.56);
    }

    if (this._flash > 0.01) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this._flash * 0.7})`;
      ctx.fillRect(0, 0, w, h);
      this._flash *= 0.88;
    }
    this.texture.needsUpdate = true;
  }

  update(dt) {
    this._render(this.elapsed);
    if (this.glow) {
      const on = Math.sin(this.elapsed * this.blinkHz * Math.PI * 2) > 0 ? 1 : 0.15;
      this.glow.intensity = 2 + on * 9 + this._flash * 14;
    }
  }

  attach(lab) {
    super.attach(lab);
    const userHandler = this.onKick;
    this.onKick = (distance, station) => {
      this.views++;
      if (Math.random() < this.payoutChance) {
        this.payouts++;
        this._flash = 1;
        lab.brain.injectCurrent(this.payoutChannel, this.payout);
      }
      userHandler?.(distance, station);
    };
  }
}
