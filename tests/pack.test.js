/**
 * Tests the pack -> runtime path against REAL generated packs, not fixtures.
 * Run `npm run pack` first; these skip with a clear message if packs are absent,
 * because a green suite that silently tested nothing is worse than a red one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parsePack } from '../src/brain/pack-loader.js';
import { PrunedRuntime } from '../src/brain/pruned-runtime.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs');

function load(name) {
  const path = join(PACKS, `${name}.mflpack`);
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return parsePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
}

const minimal = load('minimal');
const courtship = load('courtship-and-foraging');
const skip = minimal ? false : 'packs not built -- run `npm run pack`';

describe('mflpack format', { skip }, () => {
  test('header describes a real male-cns subgraph', () => {
    assert.equal(minimal.header.format, 'mflpack');
    assert.equal(minimal.dataset, 'male-cns:v1.0');
    assert.equal(minimal.license, 'CC BY 4.0');
    assert.ok(minimal.nNeurons > 300, `expected >300 neurons, got ${minimal.nNeurons}`);
    assert.ok(minimal.nEdges > minimal.nNeurons);
  });

  test('CSR arrays are self-consistent', () => {
    assert.equal(minimal.indptr.length, minimal.nNeurons + 1);
    assert.equal(minimal.indptr[0], 0);
    assert.equal(minimal.indptr[minimal.nNeurons], minimal.nEdges);
    assert.equal(minimal.indices.length, minimal.nEdges);
    assert.equal(minimal.data.length, minimal.nEdges);
    for (let i = 0; i < minimal.nEdges; i += 997) {
      assert.ok(minimal.indices[i] >= 0 && minimal.indices[i] < minimal.nNeurons);
      assert.ok(Number.isFinite(minimal.data[i]));
    }
  });

  test('typed-array views are aligned onto the buffer', () => {
    // A misaligned offset throws on construction, so reaching here at all is
    // the assertion; check contents are sane too.
    assert.equal(minimal.somaXYZ.length, minimal.nNeurons * 3);
    assert.equal(minimal.typeIdx.length, minimal.nNeurons);
    for (let i = 0; i < minimal.nNeurons; i += 37) {
      assert.ok(minimal.typeNames[minimal.typeIdx[i]], `neuron ${i} has no type name`);
    }
  });

  test('ships the real cell types the circuit declares', () => {
    const lc4 = minimal.channels.get('LC4');
    const lplc2 = minimal.channels.get('LPLC2');
    assert.ok(lc4.length > 0, 'LC4 channel is empty');
    assert.ok(lplc2.length > 0, 'LPLC2 channel is empty');
    for (const i of lplc2) assert.equal(minimal.typeOf(i), 'LPLC2');
    for (const i of lc4) assert.ok(minimal.typeOf(i).startsWith('LC4'));
  });

  test('descending motor neurons are clean left/right pairs', () => {
    // The whole lateral-steering readout depends on this being true.
    for (const base of ['DNa01', 'DNp03']) {
      const l = minimal.channels.get(`${base}_L`);
      const r = minimal.channels.get(`${base}_R`);
      assert.equal(l.length, 1, `${base}_L should be exactly one neuron`);
      assert.equal(r.length, 1, `${base}_R should be exactly one neuron`);
      assert.equal(minimal.sideOf(l[0]), 'L');
      assert.equal(minimal.sideOf(r[0]), 'R');
      assert.notEqual(l[0], r[0]);
    }
  });

  test('soma coordinates are centred and unit-scaled', () => {
    let max = 0;
    for (let i = 0; i < minimal.nNeurons; i++) {
      if (!minimal.somaValid[i]) continue;
      for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(minimal.somaXYZ[i * 3 + k]));
    }
    assert.ok(max > 0.1 && max <= 1.001, `soma extent ${max} outside unit box`);
    assert.ok(minimal.header.soma.inverse.scale > 1000, 'inverse transform lost real scale');
  });
});

describe('PrunedRuntime dynamics', { skip }, () => {
  test('a silent network stays silent', () => {
    const rt = new PrunedRuntime(minimal);
    for (let i = 0; i < 50; i++) rt.step(1 / 60);
    assert.equal(rt.populationActivity(), 0);
  });

  test('activations stay bounded and finite under hard drive', () => {
    // This is the property the spectral-radius normalization exists to protect:
    // the raw real adjacency has radius ~2.7 and blows up. See prune.py.
    const rt = new PrunedRuntime(minimal);
    rt.setInput('LC4', 500);
    for (let i = 0; i < 400; i++) rt.step(1 / 60);
    const a = rt.activationView();
    for (let i = 0; i < a.length; i++) {
      assert.ok(Number.isFinite(a[i]), `neuron ${i} went non-finite`);
      assert.ok(Math.abs(a[i]) <= 1.0000001, `neuron ${i} escaped tanh range: ${a[i]}`);
    }
  });

  test('real input propagates through real edges to a real motor neuron', () => {
    const rt = new PrunedRuntime(minimal);
    const before = Math.abs(rt.read('DNa01'));
    rt.setInput('LC4', 40);
    for (let i = 0; i < 200; i++) rt.step(1 / 60);
    const after = Math.abs(rt.read('DNa01'));
    assert.ok(after > before, `LC4 drive did not reach DNa01 (${before} -> ${after})`);
  });

  test('injectCurrent decays instead of latching on', () => {
    const rt = new PrunedRuntime(minimal);
    rt.injectCurrent('LPLC2', 50, 10);
    assert.equal(rt.pulses.size, 1);
    for (let i = 0; i < 10; i++) rt.step(1 / 60);
    assert.equal(rt.pulses.size, 0, 'pulse never expired');
  });

  test('an unknown channel warns and stays silent rather than throwing', () => {
    const rt = new PrunedRuntime(minimal);
    const warnings = [];
    const original = console.warn;
    console.warn = (m) => warnings.push(m);
    try {
      rt.setInput('NOT_A_REAL_NEURON', 10);
      rt.step(1 / 60);
      assert.equal(rt.read('NOT_A_REAL_NEURON'), 0);
    } finally { console.warn = original; }
    assert.match(warnings.join(' '), /matches no neuron/);
  });

  test('resolves any real cell type, not only precomputed channels', () => {
    // Pruning pulls in real neurons the circuit never named -- the pathway the
    // signal actually travels through. Those must stay addressable, or a scene
    // could never probe anything the pack did not precompute a channel for.
    const named = new Set();
    for (const idx of minimal.channels.values()) for (const i of idx) named.add(i);
    const extra = [...Array(minimal.nNeurons).keys()].find((i) => !named.has(i));
    assert.ok(extra !== undefined, 'pruning added no neurons beyond the declared channels');

    const rt = new PrunedRuntime(minimal);
    const type = minimal.typeOf(extra);
    const found = rt.resolve(type);
    assert.ok(found.length > 0, `could not resolve real type "${type}" present in the pack`);
    assert.ok([...found].includes(extra));
  });
});

describe('courtship pack', { skip: courtship ? false : skip || 'courtship pack not built' }, () => {
  test('stays inside the browser-deployable band from the spec', () => {
    assert.ok(
      courtship.nNeurons >= 300 && courtship.nNeurons <= 8600,
      `${courtship.nNeurons} neurons is outside the spec's 300-8,600 Mode B band`,
    );
  });

  test('ships the dopamine and courtship channels scenes are told to use', () => {
    for (const ch of ['PAM11', 'PPL1', 'ORN_DA1', 'ORN_VA6', 'DNp13', 'courtship_hub', 'DNp01']) {
      assert.ok(courtship.channels.get(ch)?.length > 0, `channel ${ch} is empty`);
    }
    // PAM11 is a real 15-neuron type in male-cns:v1.0 -- guard the count so a
    // future pruning change that silently drops most of it fails here.
    assert.equal(courtship.channels.get('PAM11').length, 15);
  });

  test('steps a full-size pack inside a frame budget', () => {
    const rt = new PrunedRuntime(courtship);
    rt.setInput('ORN_DA1', 10);
    const started = performance.now();
    for (let i = 0; i < 60; i++) rt.step(1 / 60);
    const perStep = (performance.now() - started) / 60;
    assert.ok(perStep < 16, `${perStep.toFixed(2)}ms per step exceeds a 60fps frame`);
    console.log(`      ${courtship.nNeurons} neurons / ${courtship.nEdges} edges: ${perStep.toFixed(2)}ms per step`);
  });
});
