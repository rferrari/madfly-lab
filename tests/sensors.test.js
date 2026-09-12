/**
 * Sensor, gradient and station tests. Everything here is DOM- and WebGL-free,
 * so it runs in plain Node -- only the Arena and the HUD canvases need a
 * browser, and those are verified by loading the page.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CompoundEye, fovForRetina } from '../src/avatar/retina.js';
import { LoomingDetector } from '../src/avatar/motion.js';
import { ScentField } from '../src/core/gradients.js';
import { OlfactoryReceptors, AVERSIVE_CHANNELS } from '../src/avatar/olfaction.js';
import { Station, Triggers } from '../src/core/station.js';
import { FoodBowl } from '../src/stations/food-bowl.js';
import { SlotMachine } from '../src/stations/slot-machine.js';

const W = 96;
const H = 64;

/** An RGBA frame with a bright disc of `radius` px centred at (cx, cy). */
function discFrame(radius, cx = W / 2, cy = H / 2) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = Math.hypot(x - cx, y - cy) <= radius;
      const j = (y * W + x) * 4;
      px[j] = px[j + 1] = px[j + 2] = inside ? 255 : 10;
      px[j + 3] = 255;
    }
  }
  return px;
}

describe('CompoundEye', () => {
  test('builds a hexagonal map of the right size', () => {
    // A hex map of radius r has 3r(r+1)+1 cells; radius 15 -> 721, matching a
    // real fly's ~700-800 ommatidia per eye.
    const eye = new CompoundEye({ radius: 15 });
    assert.equal(eye.columnCount, 3 * 15 * 16 + 1);
    assert.equal(eye.columnCount, 721);
  });

  test('samples luminance into [0,1]', () => {
    const eye = new CompoundEye({ radius: 6 });
    const response = eye.sample(discFrame(20));
    for (const v of response) assert.ok(v >= 0 && v <= 1, `response ${v} out of range`);
    assert.ok(Math.max(...response) > 0.5, 'bright disc produced no bright column');
  });

  test('splits left and right hemifields by real azimuth', () => {
    const eye = new CompoundEye({ radius: 15, verticalFov: fovForRetina({ radius: 15 }) });
    const left = eye.hemifields(eye.sample(discFrame(14, W * 0.25)));
    assert.ok(left.left > left.right, `expected left-biased, got ${JSON.stringify(left)}`);
    const right = eye.hemifields(eye.sample(discFrame(14, W * 0.75)));
    assert.ok(right.right > right.left, `expected right-biased, got ${JSON.stringify(right)}`);
  });

  test('the map fills the frame it is told to sample', () => {
    // Regression: with a 90-degree camera the radius-15 map covered only the
    // middle 46% of the frame width, so anything off to the side was invisible
    // to the fly while plainly visible in the eye-view camera. fovForRetina
    // couples the two; this asserts the coupling holds.
    const radius = 15;
    const eye = new CompoundEye({ radius, verticalFov: fovForRetina({ radius }) });
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < eye.columnCount; i++) {
      minX = Math.min(minX, eye.tap[i * 2]); maxX = Math.max(maxX, eye.tap[i * 2]);
      minY = Math.min(minY, eye.tap[i * 2 + 1]); maxY = Math.max(maxY, eye.tap[i * 2 + 1]);
    }
    assert.ok(maxY - minY > H * 0.85, `map covers only ${(maxY - minY).toFixed(0)}/${H} rows`);
    assert.ok(maxX - minX > W * 0.6, `map covers only ${(maxX - minX).toFixed(0)}/${W} columns`);
    assert.ok(minX >= -1 && maxX <= W, 'map projects outside the frame');
  });
});

describe('LoomingDetector', () => {
  test('a growing disc reads as loom', () => {
    const det = new LoomingDetector({ width: W, height: H });
    let peak = 0;
    let t = 0;
    for (let r = 6; r <= 28; r += 2) {
      t += 1 / 30;
      peak = Math.max(peak, det.step(discFrame(r), t).loom);
    }
    assert.ok(peak > 0, 'expansion produced no loom signal');
  });

  test('a static scene does not', () => {
    const det = new LoomingDetector({ width: W, height: H });
    const frame = discFrame(14);
    let peak = 0;
    for (let i = 0; i < 12; i++) peak = Math.max(peak, det.step(frame, i / 30).loom);
    assert.equal(peak, 0, 'a motionless scene triggered the escape circuit');
  });

  test('a whole-field translation does not', () => {
    // This is the property the four-sector agreement requirement buys: the
    // avatar turning must not read as something rushing at it.
    const det = new LoomingDetector({ width: W, height: H });
    let peak = 0;
    for (let i = 0; i < 12; i++) peak = Math.max(peak, det.step(discFrame(14, 20 + i * 4), i / 30).loom);
    assert.equal(peak, 0, 'lateral translation triggered the escape circuit');
  });
});

describe('ScentField', () => {
  test('concentration falls off with distance and stops at the radius', () => {
    const field = new ScentField();
    field.emit('ORN_VA6', { position: new THREE.Vector3(0, 0, 0), radius: 5, strength: 1 });
    const at = (d) => field.sampleAt('ORN_VA6', new THREE.Vector3(d, 0, 0));
    assert.ok(at(0) > at(2), 'not monotonically decreasing');
    assert.ok(at(2) > at(4));
    assert.equal(at(6), 0, 'scent leaked past its radius');
  });

  test('channels are independent populations, not one scalar', () => {
    const field = new ScentField();
    field.emit('ORN_VA6', { position: new THREE.Vector3(0, 0, 0), radius: 5 });
    const p = new THREE.Vector3(1, 0, 0);
    assert.ok(field.sampleAt('ORN_VA6', p) > 0);
    assert.equal(field.sampleAt('ORN_DA1', p), 0);
  });

  test('overlapping emitters add but saturate below 1', () => {
    const field = new ScentField();
    for (let i = 0; i < 6; i++) {
      field.emit('ORN_DM1', { position: new THREE.Vector3(0, 0, 0), radius: 5, strength: 2 });
    }
    const v = field.sampleAt('ORN_DM1', new THREE.Vector3(0.2, 0, 0));
    assert.ok(v > 0.5 && v < 1, `saturation failed: ${v}`);
  });

  test('removal handle unregisters the emitter', () => {
    const field = new ScentField();
    const remove = field.emit('ORN_DA1', { position: new THREE.Vector3(0, 0, 0), radius: 5 });
    assert.ok(field.sampleAt('ORN_DA1', new THREE.Vector3(1, 0, 0)) > 0);
    remove();
    assert.equal(field.sampleAt('ORN_DA1', new THREE.Vector3(1, 0, 0)), 0);
  });
});

describe('OlfactoryReceptors', () => {
  test('drives every real glomerulus channel into the brain', () => {
    const field = new ScentField();
    field.emit('ORN_VA6', { position: new THREE.Vector3(0, 0, 0), radius: 6, strength: 1 });
    const orn = new OlfactoryReceptors();
    orn.sample(field, new THREE.Vector3(1, 0, 0));

    const driven = new Map();
    orn.drive({ setInput: (c, v) => driven.set(c, v) });
    assert.deepEqual([...driven.keys()].sort(),
      ['ORN_DA1', 'ORN_DA2', 'ORN_DM1', 'ORN_V', 'ORN_VA6']);
    assert.ok(driven.get('ORN_VA6') > 0);
    assert.equal(driven.get('ORN_DA1'), 0);
    assert.equal(orn.strongest().channel, 'ORN_VA6');
  });

  test('valence is signed: aversive glomeruli subtract', () => {
    // This is what lets one rule cover both approach and avoidance. The CO2
    // channel is aversive in a real fly, and this pruned rate model does NOT
    // reproduce that on its own -- measured, a CO2 drive nudges forward drive
    // +0.0021, the same direction as food. So the sign lives here, at the body.
    assert.ok(AVERSIVE_CHANNELS.has('ORN_V'), 'CO2 should be aversive');
    assert.ok(!AVERSIVE_CHANNELS.has('ORN_DM1'), 'fruit odour should not be');

    const sweet = new ScentField();
    sweet.emit('ORN_DM1', { position: new THREE.Vector3(0, 0, 0), radius: 6, strength: 1 });
    const rot = new ScentField();
    rot.emit('ORN_V', { position: new THREE.Vector3(0, 0, 0), radius: 6, strength: 1 });

    const a = new OlfactoryReceptors();
    a.sample(sweet, new THREE.Vector3(1, 0, 0));
    assert.ok(a.valence() > 0, `sugar should read positive, got ${a.valence()}`);

    const b = new OlfactoryReceptors();
    b.sample(rot, new THREE.Vector3(1, 0, 0));
    assert.ok(b.valence() < 0, `rot should read negative, got ${b.valence()}`);
  });

  test('reports gradient direction between samples', () => {
    const field = new ScentField();
    field.emit('ORN_DM1', { position: new THREE.Vector3(0, 0, 0), radius: 8, strength: 1 });
    const orn = new OlfactoryReceptors();
    orn.sample(field, new THREE.Vector3(5, 0, 0));
    orn.sample(field, new THREE.Vector3(2, 0, 0)); // moving closer
    assert.ok(orn.deltas.get('ORN_DM1') > 0, 'approaching the source read as a falling gradient');
  });
});

describe('Station', () => {
  const ctx = (x) => ({
    avatar: { position: new THREE.Vector3(x, 0, 0) },
    brain: { clearLooming() {} },
  });

  test('registers its scent emitter with the lab on attach', () => {
    const lab = { scent: new ScentField() };
    const bowl = new FoodBowl({ position: [0, 0, 0], scentType: 'ORN_VA6', scentRadius: 5 });
    bowl.attach(lab);
    assert.ok(lab.scent.sampleAt('ORN_VA6', new THREE.Vector3(1, 0, 0)) > 0);
    bowl.detach();
    assert.equal(lab.scent.sampleAt('ORN_VA6', new THREE.Vector3(1, 0, 0)), 0);
  });

  test('enter/kick/leave are edge-triggered, not per-frame', () => {
    const events = [];
    const s = new Station({
      position: [0, 0, 0],
      kickRadius: 1,
      onEnter: () => events.push('enter'),
      onKick: () => events.push('kick'),
      onLeave: () => events.push('leave'),
    });
    s.tick(0.016, ctx(5));
    s.tick(0.016, ctx(0.5));
    s.tick(0.016, ctx(0.4)); // still inside -- must not re-fire
    s.tick(0.016, ctx(9));
    assert.deepEqual(events, ['enter', 'kick', 'leave']);
  });

  test('a disabled station does not tick', () => {
    let ticks = 0;
    const s = new Station({ position: [0, 0, 0], onTick: () => { ticks++; } });
    s.setEnabled(false);
    s.tick(0.016, ctx(0));
    assert.equal(ticks, 0);
  });

  test('SlotMachine pulses the real dopamine channel on arrival', () => {
    const injected = [];
    const lab = { scent: new ScentField(), brain: { injectCurrent: (c, a) => injected.push([c, a]) } };
    const slots = new SlotMachine({ position: [0, 0, 0], kickRadius: 1, payout: 20, payoutChance: 1 });
    slots.attach(lab);
    slots.tick(0.016, ctx(5));
    slots.tick(0.016, ctx(0.2));
    assert.deepEqual(injected, [['PAM11', 20]]);
    assert.equal(slots.pulls, 1);
    assert.equal(slots.wins, 1);
  });

  test('FoodBowl warns when given a channel no real neuron receives', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (m) => warnings.push(m);
    try { new FoodBowl({ scentType: 'ORN_SMELLS_LIKE_PIZZA' }); } finally { console.warn = original; }
    assert.match(warnings.join(' '), /not one of the real glomerulus channels/);
  });
});

describe('Triggers', () => {
  test('throttle rate-limits', () => {
    let n = 0;
    const t = Triggers.throttle(60, () => { n++; });
    t(); t(); t();
    assert.equal(n, 1);
  });

  test('rising fires on the upward crossing only', () => {
    let value = 0;
    let n = 0;
    const t = Triggers.rising(() => value, 0.5, () => { n++; });
    t();                       // 0.0 below
    value = 0.8; t();          // cross up -> fire
    t();                       // still above -> no
    value = 0.1; t();          // fall
    value = 0.9; t();          // cross up -> fire
    assert.equal(n, 2);
  });

  test('proximity gates on distance', () => {
    let n = 0;
    const t = Triggers.proximity(2, () => { n++; });
    t(5, null);
    t(1, null);
    assert.equal(n, 1);
  });
});
