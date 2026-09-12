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
const courtship = load('courtship');
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

    // Every index must resolve to a string, but the string may legitimately be
    // EMPTY: about 1.3% of neurons in male-cns carry no cell-type annotation at
    // all. That is a property of the dataset, not a gap in the pack, and
    // inventing a placeholder type for them would be inventing data.
    let untyped = 0;
    for (let i = 0; i < minimal.nNeurons; i++) {
      const t = minimal.typeOf(i);
      assert.equal(typeof t, 'string', `neuron ${i} has no type entry at all`);
      if (t === '') untyped++;
    }
    assert.ok(untyped / minimal.nNeurons < 0.15,
      `${untyped}/${minimal.nNeurons} neurons untyped — suspiciously many`);
  });

  test('every circuit ships a complete sensory and motor core', () => {
    // A circuit missing part of this produces a fly that cannot function, and
    // the failure is silent: the dopamine circuit once had no visual channels,
    // so the avatar's eyes drove nothing and the fly stood still with no error
    // anywhere. The core is a floor, not a convention.
    const CORE = [
      'LPLC1_L', 'LPLC1_R', 'LPLC2_L', 'LPLC2_R', 'LC4_L', 'LC4_R',
      'ORN_DM1', 'ORN_VA6', 'ORN_DA1', 'ORN_DA2', 'taste', 'touch',
      'DNa01_L', 'DNa01_R', 'DNp09', 'DNp01', 'DNp06',
    ];
    for (const ch of CORE) {
      assert.ok(minimal.channels.get(ch)?.length > 0,
        `'minimal' is missing core channel ${ch} — that fly cannot function`);
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

  test('soma coordinates are centred and robustly unit-scaled', () => {
    // Scaling is by a percentile, not the absolute max: 90% of somas sit within
    // radius 0.26 of the centroid while stragglers reach 1.07, so max-scaling
    // shrank the rendered brain to a quarter of the panel to accommodate a
    // handful of cells. So the BULK must be unit-scaled; outliers may exceed 1.
    const radii = [];
    for (let i = 0; i < minimal.nNeurons; i++) {
      if (!minimal.somaValid[i]) continue;
      radii.push(Math.hypot(
        minimal.somaXYZ[i * 3], minimal.somaXYZ[i * 3 + 1], minimal.somaXYZ[i * 3 + 2],
      ));
    }
    radii.sort((a, b) => a - b);
    const pct = minimal.header.soma.scalePercentile;
    assert.ok(pct > 0 && pct < 100, 'pack did not record its scale percentile');

    const atPct = radii[Math.floor((pct / 100) * (radii.length - 1))];
    assert.ok(Math.abs(atPct - 1) < 0.02, `p${pct} radius is ${atPct}, expected ~1`);
    // And the cloud must genuinely fill the box, not hide in a corner of it.
    const median = radii[Math.floor(0.5 * (radii.length - 1))];
    assert.ok(median > 0.1, `median radius ${median} -- cloud collapsed to a point`);
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

  test('injectCurrent decays over a DURATION, not a tick count', () => {
    const rt = new PrunedRuntime(minimal);
    rt.injectCurrent('LPLC2', 50, 0.2);   // 0.2 simulated seconds
    assert.equal(rt.pulses.size, 1);
    for (let i = 0; i < 6; i++) rt.step(1 / 60);   // 0.1s -- still alive
    assert.equal(rt.pulses.size, 1, 'pulse expired early');
    for (let i = 0; i < 8; i++) rt.step(1 / 60);   // past 0.2s
    assert.equal(rt.pulses.size, 0, 'pulse never expired');
  });

  test('steady state is independent of tick rate', () => {
    // Regression: the vendored lineage computes tanh(W a + I*dt), which makes a
    // sustained input's fixed point a function of the clock -- one drive gave
    // DNp09 4.94e-3 at 20Hz and 8.41e-4 at 120Hz, a 5.9x spread. Mode A ticks
    // at ~20Hz and Mode B at 60Hz behind one API, so this must not vary.
    const settle = (hz) => {
      const rt = new PrunedRuntime(minimal);
      rt.setInput('LPLC2', 1.0);
      for (let i = 0; i < Math.round(4 * hz); i++) rt.step(1 / hz);
      return rt.read('DNp03');
    };
    const base = settle(60);
    assert.ok(Math.abs(base) > 0, 'no response at all -- test is not measuring anything');
    for (const hz of [20, 30, 120]) {
      const rel = Math.abs(settle(hz) - base) / Math.abs(base);
      assert.ok(rel < 1e-4, `${hz}Hz differs from 60Hz by ${(rel * 100).toFixed(2)}%`);
    }
  });

  test('pulse magnitude is independent of tick rate', () => {
    const peak = (hz) => {
      const rt = new PrunedRuntime(minimal);
      rt.injectCurrent('LPLC2', 20, 0.15);
      let p = 0;
      for (let i = 0; i < Math.round(2 * hz); i++) { rt.step(1 / hz); p = Math.max(p, Math.abs(rt.read('LPLC2'))); }
      return p;
    };
    const base = peak(60);
    assert.ok(base > 0);
    assert.ok(Math.abs(peak(20) - base) / base < 1e-3, '20Hz pulse peak differs from 60Hz');
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

describe('channel calibration', { skip }, () => {
  test('every output channel ships a measured reference', () => {
    for (const name of minimal.channelNames('output')) {
      const ref = minimal.reference.get(name);
      assert.ok(ref > 0, `channel ${name} has no calibration reference`);
    }
  });

  test('calibration was measured in the linear regime', () => {
    // If the reference drive saturated the network, the ratios between channels
    // would be an artefact of tanh clipping rather than of the connectome. A
    // saturated reference reads ~1.0; these should all be far below it.
    for (const [name, ref] of minimal.reference) {
      assert.ok(ref < 0.5, `${name} reference ${ref} suggests a saturated calibration`);
    }
  });

  test('calibrated reads put disparate channels on one scale', () => {
    const rt = new PrunedRuntime(minimal);
    for (const c of minimal.channelNames('input')) rt.setInput(c, 1.0);
    for (let i = 0; i < 300; i++) rt.step(1 / 60);

    const outs = minimal.channelNames('output');
    const raw = outs.map((c) => Math.abs(rt.read(c))).filter((v) => v > 0);
    const cal = outs.map((c) => Math.abs(rt.readCalibrated(c))).filter((v) => v > 0);
    const spread = (a) => Math.max(...a) / Math.min(...a);

    assert.ok(spread(raw) > 10, `raw spread ${spread(raw).toFixed(0)}x -- expected channels to differ`);
    assert.ok(spread(cal) < 2, `calibrated spread ${spread(cal).toFixed(2)}x -- calibration did not normalize`);
  });

  test('an uncalibrated channel falls back to raw rather than a wrong scale', () => {
    const rt = new PrunedRuntime(minimal);
    for (const c of minimal.channelNames('input')) rt.setInput(c, 1.0);
    for (let i = 0; i < 60; i++) rt.step(1 / 60);
    const adhoc = minimal.typeOf(0);           // a real type with no shipped channel
    if (!minimal.reference.has(adhoc)) {
      assert.equal(rt.readCalibrated(adhoc), rt.read(adhoc));
    }
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
