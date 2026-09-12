/**
 * SlotMachine -- blinking visual station with a dopamine payout (spec 4).
 *
 * The blink is real visual input: it is geometry in the scene, so the avatar's
 * compound eye sees it through the same render-and-sample path as everything
 * else. The payout is an engineered current injected into the real PAM11
 * population -- 15 genuine dopaminergic neurons in male-cns:v1.0. What is real
 * is PAM11 and everything it is wired to downstream; what is invented is the
 * decision to pulse it when the fly arrives.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { THEME } from '../core/theme.js';

export class SlotMachine extends Station {
  constructor(opts = {}) {
    super({ name: 'Slot Machine', kickRadius: 1.6, ...opts });
    this.lightBlinkHz = opts.lightBlinkHz ?? 12;
    this.payoutChannel = opts.payoutChannel ?? 'PAM11';
    this.payout = opts.payout ?? 20;
    this.payoutChance = opts.payoutChance ?? 1;
    this.pulls = 0;
    this.wins = 0;
  }

  build() {
    const group = new THREE.Group();

    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.8, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x241238, roughness: 0.45, metalness: 0.55 }),
    );
    cabinet.position.y = 0.9;
    cabinet.castShadow = true;
    group.add(cabinet);

    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.6),
      new THREE.MeshStandardMaterial({
        color: THEME.magenta, emissive: THEME.magenta, emissiveIntensity: 1.5,
      }),
    );
    this.screen.position.set(0, 1.15, 0.46);
    group.add(this.screen);

    this.bulbs = [-0.42, 0, 0.42].map((x) => {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 10),
        new THREE.MeshStandardMaterial({
          color: THEME.amber, emissive: THEME.amber, emissiveIntensity: 2,
        }),
      );
      bulb.position.set(x, 1.78, 0.3);
      group.add(bulb);
      return bulb;
    });

    this.glow = new THREE.PointLight(THEME.magenta, 8, 7, 2);
    this.glow.position.set(0, 1.3, 0.7);
    group.add(this.glow);
    return group;
  }

  update(dt) {
    // Square-wave blink at the configured Hz -- a real temporal frequency the
    // retina can resolve, not a smooth fade the motion detector would ignore.
    const phase = Math.sin(this.elapsed * this.lightBlinkHz * Math.PI * 2) > 0 ? 1 : 0.08;
    if (this.screen) this.screen.material.emissiveIntensity = 0.2 + phase * 2.6;
    for (const [i, bulb] of (this.bulbs ?? []).entries()) {
      const p = Math.sin((this.elapsed * this.lightBlinkHz + i * 0.33) * Math.PI * 2) > 0 ? 1 : 0.05;
      bulb.material.emissiveIntensity = 0.2 + p * 2.4;
    }
    if (this.glow) this.glow.intensity = 3 + phase * 10;
  }

  /** Called by Station.tick when the avatar arrives. Base class fires onKick too. */
  attach(lab) {
    super.attach(lab);
    const userHandler = this.onKick;
    this.onKick = (distance, station) => {
      this.pulls++;
      if (Math.random() < this.payoutChance) {
        this.wins++;
        lab.brain.injectCurrent(this.payoutChannel, this.payout);
      }
      userHandler?.(distance, station);
    };
  }
}
