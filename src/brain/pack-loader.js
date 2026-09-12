/**
 * Reads a `.mflpack` -- one pruned, real Drosophila subgraph in a single binary
 * file. Written by python/src/madfly_lab/pack.py; see that file for the layout.
 *
 *   magic "MFLPACK1" | uint32 headerLen | JSON header | pad to 8 | typed-array blobs
 *
 * Nothing is parsed or copied out of the blob region: every array is a view
 * straight onto the downloaded ArrayBuffer, so loading a 7,922-neuron /
 * 1.38M-edge pack costs one fetch and zero per-element work.
 */

const MAGIC = 'MFLPACK1';

const VIEWS = {
  int32: Int32Array,
  uint8: Uint8Array,
  float32: Float32Array,
  float64: Float64Array,
};

export class ConnectomePack {
  constructor(buffer, header, blobStart) {
    this.buffer = buffer;
    this.header = header;
    this.blobStart = blobStart;

    this.nNeurons = header.nNeurons;
    this.nEdges = header.nEdges;
    this.dataset = header.dataset;
    this.circuit = header.circuit;
    this.license = header.license;
    this.citation = header.citation;
    this.dynamics = header.dynamics;

    // CSR adjacency, rows = targets, cols = sources (matches W @ activations).
    this.indptr = this.array('adj_indptr');
    this.indices = this.array('adj_indices');
    this.data = this.array('adj_data');

    this.somaXYZ = this.array('soma_xyz');
    this.somaValid = this.array('soma_valid');
    this.typeIdx = this.array('type_idx');
    this.sideIdx = this.array('side_idx');
    this.typeNames = header.typeNames;
    this.sideNames = header.sideNames;

    // channel name -> Int32Array of neuron indices in THIS graph.
    this.channels = new Map();
    for (const [name, meta] of Object.entries(header.channels)) {
      this.channels.set(name, this.array(meta.array));
    }
  }

  array(name) {
    const spec = this.header.arrays[name];
    if (!spec) throw new Error(`mflpack: no array "${name}" in this pack`);
    const View = VIEWS[spec.dtype];
    if (!View) throw new Error(`mflpack: unsupported dtype "${spec.dtype}"`);
    return new View(this.buffer, this.blobStart + spec.offset, spec.count);
  }

  /** Real NeuPrint cell type of one neuron, e.g. "LPLC2", "PAM11". */
  typeOf(i) { return this.typeNames[this.typeIdx[i]]; }
  sideOf(i) { return this.sideNames[this.sideIdx[i]]; }

  channelNames(kind) {
    const out = [];
    for (const [name, meta] of Object.entries(this.header.channels)) {
      if (!kind || meta.kind.includes(kind)) out.push(name);
    }
    return out.sort();
  }

  /**
   * Resolve a cell type to indices at runtime, for types the pack did not ship
   * a precomputed channel for. Linear in neuron count -- fine at startup, but
   * cache the result rather than calling it per frame.
   */
  indicesOfType(typeName) {
    const wanted = typeName.endsWith('*') ? typeName.slice(0, -1) : null;
    const t = this.typeIdx;
    const names = this.typeNames;
    const out = [];
    for (let i = 0; i < this.nNeurons; i++) {
      const name = names[t[i]];
      if (wanted ? name.startsWith(wanted) : name === typeName) out.push(i);
    }
    return Int32Array.from(out);
  }

  describe() {
    return `${this.circuit.name}: ${this.nNeurons} real neurons, ${this.nEdges} real synaptic edges `
      + `(${this.dataset}, ${this.license})`;
  }
}

export async function loadPack(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`mflpack: fetch ${url} failed (${res.status} ${res.statusText})`);
  return parsePack(await res.arrayBuffer(), url);
}

export function parsePack(buffer, label = '<buffer>') {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== MAGIC) {
    throw new Error(
      `mflpack: ${label} is not a pack (magic "${magic}"). If this is a .gz, either serve it `
      + `with Content-Encoding: gzip or point at the uncompressed .mflpack.`,
    );
  }
  const headerLen = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLen)));
  if (header.version !== 1) throw new Error(`mflpack: unsupported version ${header.version}`);

  // Blobs start at the next 8-byte boundary after magic+len+header.
  const blobStart = Math.ceil((12 + headerLen) / 8) * 8;
  return new ConnectomePack(buffer, header, blobStart);
}
