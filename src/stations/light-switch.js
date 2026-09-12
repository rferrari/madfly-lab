/**
 * LightSwitch -- turns the lab lights on and off.
 *
 * Genuinely a sensory intervention, not decoration. The compound eyes sample
 * the rendered frame, so darkness really does remove the fly's visual input;
 * the photoreceptor adaptation then re-adapts, which takes a moment and is
 * visible on the retinal panel. It is the cheapest way to show that the fly's
 * behaviour is driven by what it actually sees.
 *
 * Walk the fly into it, click it, or call `toggle()`.
 */

import * as THREE from 'three';
import { Station } from '../core/station.js';
import { THEME } from '../core/theme.js';

export class LightSwitch extends Station {
  constructor(opts = {}) {
    super({
      name: 'Light Switch', kickRadius: 1.5, collisionRadius: 0.45,
      label: 'LIGHTS', sublabel: 'kills all visual input',
      labelColor: '#ffd23d', ...opts,
    });
    this.autoToggleOnKick = opts.autoToggleOnKick ?? false;
    this.on = true;
  }

  build() {
    const group = new THREE.Group();

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.3, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x201232, roughness: 0.45, metalness: 0.65 }),
    );
    plate.position.y = 1.1;
    plate.castShadow = true;
    group.add(plate);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.11, 1.0, 10),
      new THREE.MeshStandardMaterial({ color: 0x1b1029, roughness: 0.6, metalness: 0.5 }),
    );
    post.position.y = 0.5;
    group.add(post);

    this.toggleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.5, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xffd23d, emissive: 0xffd23d, emissiveIntensity: 1.6, roughness: 0.3,
      }),
    );
    this.toggleMesh.position.set(0, 1.28, 0.13);
    group.add(this.toggleMesh);

    this.lamp = new THREE.PointLight(0xffd23d, 5, 5, 2);
    this.lamp.position.set(0, 1.5, 0.5);
    group.add(this.lamp);

    // Clicking the switch is the obvious interaction, so wire it directly.
    this.onPoke = () => this.toggle();
    return group;
  }

  toggle() { return this.set(!this.on); }

  set(on) {
    this.on = !!on;
    this.lab?.arena.setLights(this.on);
    if (this.toggleMesh) {
      this.toggleMesh.position.y = this.on ? 1.28 : 0.94;
      this.toggleMesh.material.emissiveIntensity = this.on ? 1.6 : 0.12;
      this.toggleMesh.material.color.setHex(this.on ? 0xffd23d : 0x4a3a12);
    }
    if (this.lamp) this.lamp.intensity = this.on ? 5 : 0.6;
    this.onToggle?.(this.on, this);
    return this.on;
  }

  attach(lab) {
    super.attach(lab);
    this.onToggle = this.options.onToggle ?? null;
    if (this.autoToggleOnKick) {
      const userHandler = this.onKick;
      this.onKick = (d, st) => { this.toggle(); userHandler?.(d, st); };
    }
  }
}
