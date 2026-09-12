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
    gl_PointSize = uSize * (1.0 + vAct * 5.0) * (12.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying float vAct;
  uniform vec3 uCold;
  uniform vec3 uHot;
  uniform float uDensity;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    // Gaussian-ish falloff rather than a hard disc: with tens of thousands of
    // additively-blended sprites a sharp edge reads as speckle, a soft one
    // reads as tissue.
    float a = exp(-r * 11.0) - 0.063;
    a = max(a, 0.0);
    vec3 c = mix(uCold, uHot, clamp(vAct, 0.0, 1.0));
    // Alpha scaled by uDensity: with 176,422 additively-blended points the
    // cloud saturates to a solid white blob, so a denser cloud gets fainter
    // points. Structure over brightness.
    // Low floor, steep gain: resting anatomy stays a faint scaffold and only
    // genuinely active neurons light up.
    gl_FragColor = vec4(c, a * (0.05 + clamp(vAct, 0.0, 1.0) * 0.95) * uDensity);
  }
`;

/**
 * Half-extent along each axis containing `q` of the points, measured about the
 * origin. Robust to the sparse outlying somas that a raw bounding box would
 * otherwise be dominated by.
 */
function axisExtents(pos, n, q) {
  const pick = (offset) => {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.abs(pos[i * 3 + offset]);
    v.sort();
    return v[Math.floor(q * (n - 1))] || 1;
  };
  return { x: pick(0), y: pick(1), z: pick(2) };
}

export class SomaCloud {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} source  either a ConnectomePack (Mode B) or
   *   `{somaXYZ, somaCount}` from the Mode A server. Both provide normalized
   *   soma coordinates; nothing else about them matters here.
   */
  constructor(canvas, source) {
    this.canvas = canvas;
    const pack = source && source.somaXYZ
      ? { nNeurons: source.somaCount ?? source.somaXYZ.length / 3, somaXYZ: source.somaXYZ }
      : source;
    this.pack = pack;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 0.01, 100);
    this.camera.position.set(0, 0, 3.2);

    this.n = pack ? pack.nNeurons : 0;
    this.activation = new Float32Array(this.n);

    // Framing state MUST be initialized before the geometry block below, which
    // calls fit(). It used to be set afterwards, so fit() ran with `this.fill`
    // and `this.view` undefined, computed a NaN camera distance, and left the
    // panel silently blank -- no error, just nothing drawn.
    // 'front' rather than 'rotate' by default: a fixed anatomical view is what
    // you actually read a brain in, and the rotating one has to be framed for
    // its widest extent or it clips as it turns.
    this.view = 'front';
    // Two zoom steps out from the previous 0.70 default (each step is 1.25x),
    // which left the cloud crowding its panel edges.
    this.fill = 0.45;
    this.zoomLevel = 1;
    this.spin = 0;
    this._angle = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };

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
          uSize: { value: this.n > 40000 ? 2.0 : 2.6 },
        // Additive blending means N overlapping points sum; a dense cloud needs
        // fainter points or it saturates to a white blob. But there is a floor:
        // 6000/n gave 0.034 for the full connectome, which rendered as nothing
        // at all. Clamped so 176k points stay visible AND stay structured.
        // Tuned against the real 176,422-point cloud: 0.22 saturated it to a
        // white blob, 0.034 looked invisible (though that test was confounded
        // by the NaN-camera bug below). ~0.07 at full scale shows structure.
        uDensity: { value: Math.min(0.85, Math.max(0.085, 7000 / Math.max(1, this.n))) },
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

      // Per-axis extents at a percentile, for framing. Using the raw maximum
      // would let a handful of outlying somas dictate the zoom and shrink the
      // brain to the middle of the panel; p92 keeps the structure large while
      // still showing essentially all of it.
      // p98 rather than p92: p92 clipped the visible halo and the auto-fit then
      // zoomed in far enough that the cloud overflowed its panel.
      this.extent = axisExtents(pos, this.n, 0.98);
      this.fit();
    }
  }

  /**
   * Anatomical views. The rotating view is pretty but useless for telling
   * WHERE activity is; a fixed anterior/lateral/dorsal view is how a brain is
   * actually read, and it makes left/right asymmetry immediately visible.
   */
  static VIEWS = ['rotate', 'front', 'left', 'right', 'top'];

  /**
   * Move the camera so the cloud fills the panel.
   *
   * The camera used to sit at a fixed z, which left the brain occupying about
   * 59% of the panel's width -- a lot of empty box around a small cloud. This
   * solves for the distance at which the current view's projected extent fills
   * `fill` of the frame, honouring the panel's aspect ratio so it fits in BOTH
   * axes rather than just vertically.
   */
  fit(fill = this.fill ?? 0.45) {
    if (!this.points || !this.extent) return this;
    const { x, y, z } = this.extent;
    // Which extents face the camera depends on the view.
    let halfW = x;
    let halfH = y;
    if (this.view === 'left' || this.view === 'right') halfW = z;
    else if (this.view === 'top') halfH = z;
    else if (this.view === 'rotate') halfW = Math.max(x, z);   // widest as it spins

    const aspect = this.camera.aspect || 1;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const distV = halfH / (fill * tan);
    const distH = halfW / (fill * tan * aspect);
    let dist = Math.max(distV, distH, 0.4);
    // Guard: a NaN here silently places the camera nowhere and the panel goes
    // blank with no error. Seen when `fill` or an extent arrived undefined.
    if (!Number.isFinite(dist)) dist = 3.2;
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    return this;
  }

  /**
   * Zoom about the centre. Multiplies the auto-fit framing, so it composes with
   * whichever anatomical view is active rather than fighting it.
   */
  zoom(factor) {
    this.zoomLevel = Math.min(6, Math.max(0.25, this.zoomLevel * factor));
    this.fill = 0.45 * this.zoomLevel;
    this.fit();
    return +this.zoomLevel.toFixed(2);
  }

  resetZoom() {
    this.zoomLevel = 1;
    this.fill = 0.45;
    this.fit();
    return this;
  }

  setView(view) {
    if (!SomaCloud.VIEWS.includes(view)) {
      throw new Error(`[MadFlyLab] unknown soma view "${view}". `
        + `Known: ${SomaCloud.VIEWS.join(', ')}`);
    }
    this.view = view;
    if (!this.points) return view;
    this.fit();
    if (view === 'top') {
      // Dorsal: look straight down the Y axis. Roll so anterior points up.
      this.points.rotation.set(-Math.PI / 2, 0, 0);
    } else if (view !== 'rotate') {
      this.points.rotation.set(0, this._angle[view], 0);
    }
    return view;
  }

  cycleView() {
    const i = SomaCloud.VIEWS.indexOf(this.view);
    return this.setView(SomaCloud.VIEWS[(i + 1) % SomaCloud.VIEWS.length]);
  }

  /** @param {Float32Array|null} activations live view, or null in Mode A */
  /**
   * @param {Float32Array|null} activations live view (Mode B), or null
   *
   * Activations are NORMALIZED to the current peak before display. Raw values
   * run around 1e-5 on the full connectome and 1e-3 on a pack, so feeding them
   * straight to the shader left every point sitting at its baseline alpha: the
   * cloud showed the brain's ANATOMY as a uniform white mass and never showed
   * anything firing. Scaling by the peak is what makes activity visible, and
   * it is a display convention -- the numbers themselves are unchanged.
   */
  update(activations, dt, remoteCloud = null) {
    if (!this.points) return;
    if (activations) {
      let peak = 0;
      for (let i = 0; i < this.n; i++) {
        const v = Math.abs(activations[i]);
        this.activation[i] = v;
        if (v > peak) peak = v;
      }
      if (peak > 0) {
        const k = 1 / peak;
        for (let i = 0; i < this.n; i++) this.activation[i] *= k;
      }
      this.peak = peak;
    } else if (remoteCloud) {
      this.activation.fill(0);
      const { idx, act } = remoteCloud;
      for (let k = 0; k < idx.length; k++) {
        if (idx[k] < this.n) this.activation[idx[k]] = Math.abs(act[k]);
      }
    }
    this.points.geometry.attributes.activation.needsUpdate = true;

    if (this.view === 'rotate') {
      this.spin += dt * 0.18;
      this.points.rotation.set(0, this.spin, 0);
    }
  }

  render() {
    if (this.points) this.renderer.render(this.scene, this.camera);
  }
}
