/**
 * Retinal Compound Eye (spec 3.1) -- hexagonal ommatidial sampler.
 *
 * Ported from duckfly's `shared/vision/retina.js` (Apache-2.0, same repo
 * family; see THIRD_PARTY_NOTICES.md), with the fixed 96x64 / radius-15 map
 * generalized into a constructor so a scene can trade acuity for frame time.
 *
 * A real Drosophila eye has ~700-800 ommatidia per side, so the default radius
 * 15 (721 hexagonal columns) is in the right range -- but the angular spacing
 * here is an engineering calibration, not a measured optical map, and the
 * sampler is a bilinear tap into a rendered frame, not a model of photoreceptor
 * transduction. It gives a scene a fly-shaped view of the arena. It does not
 * claim to be R1-R6 phototransduction.
 */

const DEG = Math.PI / 180;

function buildAxialMap(radius, angularSpacing) {
  const cells = [];
  for (let u = -radius; u <= radius; u++) {
    const vMin = Math.max(-radius, -u - radius);
    const vMax = Math.min(radius, -u + radius);
    for (let v = vMin; v <= vMax; v++) {
      cells.push(Object.freeze({
        index: cells.length,
        u,
        v,
        azimuth: angularSpacing * (u + v / 2),
        elevation: angularSpacing * (Math.sqrt(3) / 2) * v,
      }));
    }
  }
  return Object.freeze(cells);
}

/**
 * The vertical camera FOV that exactly covers a retina map's angular extent.
 *
 * These two numbers MUST agree. The map spans +-`angularSpacing * radius`
 * azimuth and +-`angularSpacing * (sqrt(3)/2) * radius` elevation; if the eye
 * camera renders a wider field than that, the retina samples a crop out of the
 * middle and the rest of the rendered frame is thrown away -- at the default
 * radius 15 with a 90-degree camera, the map covers only the middle 46% of the
 * frame's width, so a station off to the side is invisible to the fly while
 * looking perfectly visible in the eye-view camera. That mismatch is silent and
 * very confusing to debug, which is why the Arena derives its eye FOV from here
 * rather than taking it as an independent option.
 *
 * Note this is a planar projection of a curved eye: the default field is about
 * +-34 degrees azimuth, far narrower than a real fly's near-panoramic vision.
 * Widening `angularSpacing` widens the field at the cost of acuity per column.
 */
export function fovForRetina({ radius = 15, angularSpacing = 2.3, margin = 1.06 } = {}) {
  const maxElevation = angularSpacing * (Math.sqrt(3) / 2) * radius;
  return Math.min(170, 2 * maxElevation * margin);
}

export class CompoundEye {
  /**
   * @param {object} opts
   * @param {number} opts.radius         hex rings; 15 -> 721 columns (default)
   * @param {number} opts.width/height   source frame size the renderer provides
   * @param {number} opts.verticalFov    degrees, must match the eye camera
   * @param {number} opts.angularSpacing degrees between adjacent columns
   */
  constructor({ radius = 15, width = 96, height = 64, verticalFov = 90, angularSpacing = 2.3 } = {}) {
    this.radius = radius;
    this.width = width;
    this.height = height;
    this.verticalFov = verticalFov;
    this.aspect = width / height;
    this.angularSpacing = angularSpacing;
    this.cells = buildAxialMap(radius, angularSpacing);
    this.response = new Float32Array(this.cells.length);

    // Angular extent actually covered, for callers that need to match a camera
    // to it (see fovForRetina) or reason about what the fly can and cannot see.
    this.maxAzimuth = angularSpacing * radius;
    this.maxElevation = angularSpacing * (Math.sqrt(3) / 2) * radius;

    // Projection is fixed for a given map + camera, so precompute the bilinear
    // tap for every column once instead of recomputing 721 tangents per frame.
    this.tap = new Float32Array(this.cells.length * 2);
    const tanHalf = Math.tan((verticalFov * DEG) / 2);
    for (const cell of this.cells) {
      const y = Math.tan(cell.elevation * DEG) / tanHalf;
      const x = Math.tan(cell.azimuth * DEG) / (tanHalf * this.aspect);
      this.tap[cell.index * 2] = ((1 + x) * (width - 1)) / 2;
      this.tap[cell.index * 2 + 1] = ((1 - y) * (height - 1)) / 2;
    }
  }

  get columnCount() { return this.cells.length; }

  /**
   * Sample an RGBA frame into per-column luminance in [0,1].
   * @param {Uint8Array|Uint8ClampedArray} pixels RGBA, width*height*4
   * @returns {Float32Array} one value per ommatidial column (reused buffer)
   */
  sample(pixels) {
    const { width: w, height: h, tap, response } = this;
    const gray = (px, py) => {
      const cx = px < 0 ? 0 : px >= w ? w - 1 : px;
      const cy = py < 0 ? 0 : py >= h ? h - 1 : py;
      const j = (cy * w + cx) * 4;
      return (pixels[j] * 0.299 + pixels[j + 1] * 0.587 + pixels[j + 2] * 0.114) / 255;
    };
    for (let i = 0; i < response.length; i++) {
      const x = tap[i * 2];
      const y = tap[i * 2 + 1];
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      response[i] = gray(ix, iy) * (1 - fx) * (1 - fy)
        + gray(ix + 1, iy) * fx * (1 - fy)
        + gray(ix, iy + 1) * (1 - fx) * fy
        + gray(ix + 1, iy + 1) * fx * fy;
    }
    return response;
  }

  /**
   * Light adaptation -- normalize the current frame against a slow-running mean,
   * so what reaches the brain is CONTRAST rather than absolute luminance.
   *
   * This is not a convenience hack: real Drosophila photoreceptors adapt over
   * several orders of magnitude of ambient light, which is why a fly works
   * indoors and in sunlight. It is also load-bearing here. The lab arena is
   * dark by design, so raw hemifield means came out around 0.02 against a
   * calibration reference of 1.0 -- the fly was 50x under-driven and crawled at
   * 0.05 u/s regardless of what was in front of it. Adapting makes the drive
   * depend on how much brighter a station is than the background, which is the
   * quantity that actually carries information.
   *
   * `floor` keeps a pitch-black frame from dividing by ~0 and manufacturing
   * contrast out of sensor noise. The result feeds a saturating response curve
   * (see `hemifields`), not a hard clip, so two eyes never both pin at 1.0.
   */
  adapt(response = this.response, { rate = 0.02, floor = 0.02 } = {}) {
    let sum = 0;
    for (let i = 0; i < response.length; i++) sum += response[i];
    const mean = sum / response.length;
    this.adaptedMean = this.adaptedMean === undefined
      ? mean
      : this.adaptedMean + (mean - this.adaptedMean) * rate;
    this.adaptationLevel = Math.max(this.adaptedMean, floor);
    return this.adaptationLevel;
  }

  /**
   * Mean luminance over the left and right visual hemifields. This is what
   * feeds the real LPLC1/LPLC2 left/right channels -- the same left/right
   * split every sibling project in this repo family drives vision with.
   *
   * With `adapted`, values are divided by the running adaptation level and
   * clipped to [0, 1], so 1.0 means "much brighter than this eye's recent
   * average" rather than "near-white pixel".
   */
  hemifields(response = this.response, { adapted = false } = {}) {
    let l = 0;
    let lN = 0;
    let r = 0;
    let rN = 0;
    for (const cell of this.cells) {
      if (cell.azimuth < 0) { l += response[cell.index]; lN++; }
      else if (cell.azimuth > 0) { r += response[cell.index]; rN++; }
    }
    let left = lN ? l / lN : 0;
    let right = rN ? r / rN : 0;
    if (adapted) {
      const level = this.adaptationLevel ?? this.adapt(response);
      // Naka-Rushton saturation: v / (v + level). This is the standard
      // photoreceptor response function, and the reason it is used here rather
      // than a plain divide-and-clip is concrete: dividing by the adaptation
      // level and clamping to 1 drove BOTH eyes to exactly 1.0 in the lab's
      // dark arena, which erased the left/right difference the whole two-eye
      // design exists to preserve. This curve maps 0 -> 0, level -> 0.5 and
      // saturates smoothly toward 1 without ever clipping, so the ordering
      // between the eyes survives at any ambient level.
      left = left / (left + level);
      right = right / (right + level);
    }
    return { left, right };
  }
}
