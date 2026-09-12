/**
 * HUD panel 2 -- 3D Brain Soma Point-Cloud (spec 3.3).
 *
 * Renders one point per real neuron at its real soma coordinate from
 * male-cns:v1.0, glowing by that neuron's current activation. In Mode B every
 * neuron in the pack is drawn and updated from the live activation array with
 * no copy; in Mode A the server streams only the most-active few thousand
 * (streaming 176k floats per tick would be the bottleneck), so the cloud shows
 * the pack's anatomy with those neurons lit.
 *
 * Coordinates come from the pack pre-centred and unit-scaled (pack.py's
 * `_soma_transform`); the inverse transform back to real male-cns units ships
 * in the header for anything that needs true coordinates.
 */

import * as THREE from 'three';
import { THEME } from '../core/theme.js';

const VERT = `
  attribute float activation;
  varying float vAct;
  uniform float uSize;
  void main() {
    vAct = activation;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 + vAct * 3.0) * (12.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying float vAct;
  uniform vec3 uCold;
  uniform vec3 uHot;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = smoothstep(0.25, 0.0, r);
    vec3 c = mix(uCold, uHot, clamp(vAct, 0.0, 1.0));
    gl_FragColor = vec4(c, a * (0.16 + clamp(vAct, 0.0, 1.0) * 0.84));
  }
`;

export class SomaCloud {
  constructor(canvas, pack) {
    this.canvas = canvas;
    this.pack = pack;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 0.01, 100);
    this.camera.position.set(0, 0, 3.2);

    this.n = pack ? pack.nNeurons : 0;
    this.activation = new Float32Array(this.n);

    if (this.n) {
      const geo = new THREE.BufferGeometry();
      // The pack stores soma as (x, y, z) in male-cns axes. Y is swapped so the
      // brain renders the way an anatomist draws it rather than upside down.
      const src = pack.somaXYZ;
      const pos = new Float32Array(this.n * 3);
      for (let i = 0; i < this.n; i++) {
        pos[i * 3] = src[i * 3];
        pos[i * 3 + 1] = -src[i * 3 + 1];
        pos[i * 3 + 2] = src[i * 3 + 2];
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('activation', new THREE.BufferAttribute(this.activation, 1));

      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uSize: { value: 1.6 },
          uCold: { value: new THREE.Color(THEME.violet) },
          uHot: { value: new THREE.Color(THEME.cyan) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.points = new THREE.Points(geo, this.material);
      this.scene.add(this.points);
    }
    this.spin = 0;
  }

  /** @param {Float32Array|null} activations live view, or null in Mode A */
  update(activations, dt, remoteCloud = null) {
    if (!this.points) return;
    if (activations) {
      for (let i = 0; i < this.n; i++) this.activation[i] = Math.abs(activations[i]);
    } else if (remoteCloud) {
      this.activation.fill(0);
      const { idx, act } = remoteCloud;
      for (let k = 0; k < idx.length; k++) {
        if (idx[k] < this.n) this.activation[idx[k]] = Math.abs(act[k]);
      }
    }
    this.points.geometry.attributes.activation.needsUpdate = true;

    this.spin += dt * 0.18;
    this.points.rotation.y = this.spin;
  }

  render() {
    if (this.points) this.renderer.render(this.scene, this.camera);
  }
}
