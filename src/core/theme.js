/**
 * MadFly Lab palette -- neon on deep violet-black, taken from the project's own
 * lab art. Every panel, gizmo and trace in the framework
 * pulls from here so a scene that adds its own stations still looks like it
 * belongs in the same lab.
 */
export const THEME = {
  void: 0x0b0614,        // arena background
  floor: 0x140a24,       // lab bench floor
  grid: 0x2c1b4d,        // floor grid lines
  gridHot: 0x6a3fd6,     // floor grid accents
  cyan: 0x00e5ff,        // neural / data
  magenta: 0xff2bd6,     // dopamine / reward
  amber: 0xff8a3d,       // compound eye / warmth
  lime: 0x39ff88,        // go / motor
  red: 0xff3355,         // threat / aversive
  violet: 0x9a5cff,      // structure
  bone: 0xe8e0f5,        // text
};

export const CSS = {
  void: '#0b0614',
  panel: 'rgba(18, 10, 34, 0.82)',
  border: 'rgba(154, 92, 255, 0.35)',
  cyan: '#00e5ff',
  magenta: '#ff2bd6',
  amber: '#ff8a3d',
  lime: '#39ff88',
  red: '#ff3355',
  violet: '#9a5cff',
  bone: '#e8e0f5',
  dim: 'rgba(232, 224, 245, 0.55)',
  font: "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
};
