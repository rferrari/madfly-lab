/**
 * Shared point-sprite shader for rendering a real soma point-cloud, used by
 * both the HUD's `SomaCloud` (2D panel, its own offscreen renderer) and the
 * in-world `BrainOrb` (Room 2's floating magnified brain, drawn into the main
 * scene). One shader, two mounts -- kept in one place so a tuning change
 * (sprite falloff, density scaling) does not have to be made twice.
 */

export const SOMA_VERTEX_SHADER = `
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

export const SOMA_FRAGMENT_SHADER = `
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
    // Alpha scaled by uDensity: with tens of thousands of additively-blended
    // points the cloud saturates to a solid white blob, so a denser cloud gets
    // fainter points. Structure over brightness. Low floor, steep gain:
    // resting anatomy stays a faint scaffold and only active neurons light up.
    gl_FragColor = vec4(c, a * (0.05 + clamp(vAct, 0.0, 1.0) * 0.95) * uDensity);
  }
`;

/** Density uniform that keeps a cloud legible regardless of point count. */
export function densityForCount(n, target = 12000, floor = 0.16) {
  return Math.min(1, Math.max(floor, target / Math.max(1, n)));
}

/**
 * Half-extent along each axis containing `q` of the points, measured about
 * the origin. Robust to the sparse outlying somas that a raw bounding box
 * would otherwise be dominated by.
 */
export function axisExtents(pos, n, q) {
  const pick = (offset) => {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.abs(pos[i * 3 + offset]);
    v.sort();
    return v[Math.floor(q * (n - 1))] || 1;
  };
  return { x: pick(0), y: pick(1), z: pick(2) };
}
