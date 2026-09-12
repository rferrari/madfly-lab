/**
 * 3D Sandbox Arena (spec 2) -- the Three.js viewport, camera rig and lab floor.
 *
 * This is the half of the framework a scene is explicitly told not to touch
 * (AGENTS.md). It owns the renderer, the resize handling, the camera modes and
 * the offscreen eye-view render target the compound eye samples from. A scene
 * adds `THREE.Object3D`s through stations and never reaches in here.
 */

import * as THREE from 'three';
import { THEME } from './theme.js';

export const CAMERA_MODES = ['orbit', 'chase', 'eye', 'top'];

/**
 * Outward yaw of each compound eye from the body axis, in radians.
 *
 * A real Drosophila eye faces mostly sideways with a modest binocular overlap
 * in front. With the default retina map spanning about +-34 degrees azimuth,
 * splaying each eye 40 degrees outward leaves a small frontal overlap and gives
 * each eye its own lateral field -- enough that an object to one side drives
 * that side's real LC4/LPLC2 population and barely touches the other's, which
 * is what makes the connectome's left/right asymmetry produce steering.
 */
export const EYE_SPLAY = (40 * Math.PI) / 180;

export class Arena {
  constructor({ canvas, size = 40, eyeResolution = [96, 64], eyeFov = 90 } = {}) {
    this.canvasSelector = canvas;
    this.size = size;
    this.eyeFov = eyeFov;
    this.cameraMode = 'chase';

    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this.eyeCamera = null;
    this.eyeTarget = null;
    this.eyePixels = null;
    this.eyeResolution = eyeResolution;

    this._orbit = { theta: Math.PI * 0.25, phi: Math.PI * 0.32, radius: size * 0.9, dragging: false };
  }

  init() {
    const canvas = typeof this.canvasSelector === 'string'
      ? document.querySelector(this.canvasSelector)
      : this.canvasSelector;
    if (!canvas) throw new Error(`[MadFlyLab] canvas "${this.canvasSelector}" not found`);
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(THEME.void);
    this.scene.fog = new THREE.FogExp2(THEME.void, 0.014);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.camera.position.set(0, this.size * 0.45, this.size * 0.6);

    // TWO compound eyes, because a fly has two and -- more to the point --
    // because the connectome's visual populations carry a real somaSide
    // annotation that the framework must not throw away. Driving only the real
    // left LPLC2 cells yields a DNa01 steering signal of 1.1e-4; driving only
    // the right yields 1.5e-3, a 13x asymmetry. Rendering one central view and
    // summing it into both sides erases exactly that, which is why the fly used
    // to walk in a straight line regardless of what was in front of it.
    //
    // Each eye is yawed outward by EYE_SPLAY, so the two fields overlap in front
    // (binocular region) and diverge to the sides, as a real fly's do.
    const [ew, eh] = this.eyeResolution;
    this.eyes = ['L', 'R'].map((side) => ({
      side,
      camera: new THREE.PerspectiveCamera(this.eyeFov, ew / eh, 0.05, 500),
      target: new THREE.WebGLRenderTarget(ew, eh, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
      }),
      pixels: new Uint8Array(ew * eh * 4),
    }));
    // Kept as aliases so 'eye' camera mode and anything reading a single eye
    // still work; the left eye is the canonical one for the first-person view.
    this.eyeCamera = this.eyes[0].camera;
    this.eyeTarget = this.eyes[0].target;
    this.eyePixels = this.eyes[0].pixels;

    this._buildLights();
    this._buildFloor();
    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    return this;
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.scene.add(new THREE.HemisphereLight(THEME.violet, THEME.void, 0.8));

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(this.size * 0.5, this.size * 1.2, this.size * 0.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = this.size;
    Object.assign(key.shadow.camera, { near: 1, far: s * 4, left: -s, right: s, top: s, bottom: -s });
    key.shadow.bias = -0.0006;
    this.scene.add(key);

    // Two neon rim lights, matching the lab art's cyan/magenta key.
    const rimA = new THREE.PointLight(THEME.cyan, 40, this.size * 2, 2);
    rimA.position.set(-this.size * 0.5, 4, -this.size * 0.4);
    this.scene.add(rimA);
    const rimB = new THREE.PointLight(THEME.magenta, 40, this.size * 2, 2);
    rimB.position.set(this.size * 0.5, 4, this.size * 0.4);
    this.scene.add(rimB);
  }

  _buildFloor() {
    // The floor must out-reach the fog, or its far edge shows as a hard horizon
    // line against the background. FogExp2 at density 0.014 is ~99% opaque at
    // sqrt(4.6)/0.014 = 153 units, so a size*2 (=80u) plane ended well inside
    // visible range and drew a visible seam. FLOOR_REACH covers it with margin.
    const FLOOR_REACH = Math.max(this.size * 2, Math.sqrt(4.6) / this.scene.fog.density) * 2.2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_REACH, FLOOR_REACH),
      new THREE.MeshStandardMaterial({ color: THEME.floor, roughness: 0.85, metalness: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(this.size * 2, this.size, THEME.gridHot, THEME.grid);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    this.scene.add(grid);
  }

  _bindInput() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this._orbit.dragging = true;
      this._orbit.lastX = e.clientX;
      this._orbit.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      this._orbit.dragging = false;
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._orbit.dragging) return;
      this._orbit.theta -= (e.clientX - this._orbit.lastX) * 0.006;
      this._orbit.phi = clamp(this._orbit.phi - (e.clientY - this._orbit.lastY) * 0.006, 0.08, 1.5);
      this._orbit.lastX = e.clientX;
      this._orbit.lastY = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._orbit.radius = clamp(this._orbit.radius * (1 + e.deltaY * 0.001), 3, this.size * 3);
    }, { passive: false });
  }

  add(object3D) { this.scene.add(object3D); return object3D; }

  remove(object3D) { this.scene.remove(object3D); }

  setCameraMode(mode) {
    if (!CAMERA_MODES.includes(mode)) throw new Error(`[MadFlyLab] unknown camera mode "${mode}"`);
    this.cameraMode = mode;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Position the main camera for this frame, given where the avatar is. */
  updateCamera(avatar) {
    const p = avatar.position;
    if (this.cameraMode === 'orbit') {
      const { theta, phi, radius } = this._orbit;
      this.camera.position.set(
        p.x + radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi) + 1,
        p.z + radius * Math.sin(phi) * Math.sin(theta),
      );
      this.camera.lookAt(p.x, p.y, p.z);
    } else if (this.cameraMode === 'chase') {
      const back = 6;
      const target = new THREE.Vector3(
        p.x - Math.sin(avatar.yaw) * back,
        p.y + 3.2,
        p.z - Math.cos(avatar.yaw) * back,
      );
      this.camera.position.lerp(target, 0.12);
      this.camera.lookAt(p.x, p.y + 0.4, p.z);
    } else if (this.cameraMode === 'eye') {
      this.camera.position.copy(this.eyeCamera.position);
      this.camera.quaternion.copy(this.eyeCamera.quaternion);
    } else if (this.cameraMode === 'top') {
      this.camera.position.set(p.x, this.size * 1.1, p.z + 0.01);
      this.camera.lookAt(p.x, 0, p.z);
    }
  }

  /**
   * Render both compound eyes offscreen and read them back.
   *
   * The two readbacks are synchronous and are the most expensive calls in the
   * frame -- which is why each eye target is only 96x64, and why a scene that
   * does not use vision can turn it off (`MadFlyLab({ vision: false })`).
   *
   * @returns {{L: Uint8Array, R: Uint8Array}} RGBA frames, one per eye
   */
  renderEyes(avatar) {
    const [ew, eh] = this.eyeResolution;
    const out = {};
    for (const eye of this.eyes) {
      const splay = eye.side === 'L' ? EYE_SPLAY : -EYE_SPLAY;
      // Eyes sit slightly apart on the head as well as pointing apart; the
      // offset is small next to the splay but keeps the two views from being
      // an exact mirror pair, which matters for the motion detectors.
      const lateral = eye.side === 'L' ? -0.18 : 0.18;
      eye.camera.position.set(
        avatar.position.x + Math.cos(avatar.yaw) * lateral,
        avatar.position.y + 0.35,
        avatar.position.z - Math.sin(avatar.yaw) * lateral,
      );
      eye.camera.rotation.set(0, avatar.yaw + splay, 0, 'YXZ');

      this.renderer.setRenderTarget(eye.target);
      this.renderer.render(this.scene, eye.camera);
      this.renderer.readRenderTargetPixels(eye.target, 0, 0, ew, eh, eye.pixels);
      out[eye.side] = eye.pixels;
    }
    this.renderer.setRenderTarget(null);
    return out;
  }

  /** Back-compat single-eye render; returns the left eye's frame. */
  renderEye(avatar) { return this.renderEyes(avatar).L; }

  render() { this.renderer.render(this.scene, this.camera); }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
