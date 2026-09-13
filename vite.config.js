import { defineConfig } from 'vite';
import { skillStorage } from './vite-plugins/skill-storage.js';

// `packs/` holds the generated .mflpack binaries. They are served as static
// assets from the project root rather than bundled: they are multi-megabyte
// typed-array blobs that must arrive as an ArrayBuffer, and letting Vite
// fingerprint/inline them would defeat browser caching of the one file a scene
// reloads least often.
export default defineConfig({
  publicDir: 'packs',
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  // Dev-server-only endpoints for saving/loading a trained Q-readout to a
  // real file under training/skills/ -- see vite-plugins/skill-storage.js.
  plugins: [skillStorage()],
});
