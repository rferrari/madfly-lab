/**
 * Floor labels -- a text plate laid on the ground under a station.
 *
 * Stations are told apart by colour alone otherwise, which is fine for the
 * developer who wrote the scene and useless for anyone else looking at it. A
 * label says what the thing is AND which real neuron population it drives, so
 * the arena explains itself.
 *
 * Drawn to a canvas and used as a texture rather than rendered as 3D text: no
 * font loading, no extra dependency, and a canvas texture is cheap because it
 * is generated once and never updated.
 */

import * as THREE from 'three';
import { CSS } from './theme.js';

const PX_PER_UNIT = 128;

/**
 * @param {string} title    e.g. "FOOD BOWL"
 * @param {string} subtitle e.g. "ORN_VA6 · 63 real neurons"
 * @param {object} opts     {color, width, height}
 * @returns {THREE.Mesh} a flat plane, already rotated to lie on the floor
 */
export function makeFloorLabel(title, subtitle = '', {
  color = CSS.cyan, width = 3.4, height = 1.0,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width * PX_PER_UNIT;
  canvas.height = height * PX_PER_UNIT;
  const ctx = canvas.getContext('2d');

  // Rounded translucent plate so the text stays legible over the floor grid.
  const r = 16;
  ctx.fillStyle = 'rgba(11, 6, 20, 0.72)';
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, r);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.round(canvas.height * 0.3)}px ${CSS.font}`;
  ctx.fillText(title, canvas.width / 2, canvas.height * (subtitle ? 0.42 : 0.6));

  if (subtitle) {
    ctx.fillStyle = 'rgba(232, 224, 245, 0.66)';
    ctx.font = `${Math.round(canvas.height * 0.19)}px ${CSS.font}`;
    ctx.fillText(subtitle, canvas.width / 2, canvas.height * 0.72);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;          // just above the floor, below everything else
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Draw-your-own screen texture. Returns {canvas, ctx, texture} -- call
 * `texture.needsUpdate = true` after drawing. This is the hook a scene uses to
 * put a video, a game, or anything else on a Screen station: the fly's retina
 * samples whatever ends up on it through the normal render path, so animated
 * content is real visual input, not a special case.
 */
export function makeScreenTexture(width = 512, height = 320) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, texture };
}
