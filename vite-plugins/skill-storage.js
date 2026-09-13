/**
 * skillStorage -- a Vite dev-server plugin that lets a scene persist a
 * trained Q-readout ("skill") to a real file under `training/skills/`,
 * instead of only copy-to-clipboard. Dev-only: this middleware runs on
 * Vite's own dev server (`configureServer`), so it does nothing in a
 * `vite build` + static-serve deployment -- fine for what this is (a local
 * training-run artifact you're saving for yourself), but worth knowing if
 * this ever gets hosted.
 *
 * Endpoints (same-origin, so no CORS setup needed):
 *   POST /api/skills            {task, data} -> {filename}
 *   GET  /api/skills?task=NAME  -> [{filename, savedAt}], newest first
 *   GET  /api/skills/:filename  -> the raw saved JSON ({task, savedAt, data})
 *
 * Filenames are server-generated (`<task>-<ISO timestamp>.json`, colons
 * replaced so it's a valid filename) -- the client never gets to pick one,
 * which is what keeps the :filename read route safe from path traversal:
 * it's checked against exactly that pattern before touching the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';

const SKILLS_DIR = path.resolve(process.cwd(), 'training/skills');
const FILENAME_RE = /^[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export function skillStorage() {
  return {
    name: 'madfly-skill-storage',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/skills')) return next();

        try {
          // Re-checked on every request, not just once at server startup:
          // the directory holds nothing but generated artifacts, so it's
          // easy to delete by hand (or clean up) while the dev server keeps
          // running -- the next save/list/load after that would otherwise
          // 500 on a missing directory instead of just quietly recreating
          // it, which is what actually happened once already.
          fs.mkdirSync(SKILLS_DIR, { recursive: true });

          const url = new URL(req.url, 'http://localhost');

          if (req.method === 'POST' && url.pathname === '/api/skills') {
            const { task, data } = JSON.parse(await readBody(req));
            if (!task || typeof task !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(task)) {
              return sendJSON(res, 400, { error: 'task must be a plain alphanumeric name' });
            }
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${task}-${stamp}.json`;
            const savedAt = new Date().toISOString();
            fs.writeFileSync(
              path.join(SKILLS_DIR, filename),
              JSON.stringify({ task, savedAt, data }, null, 2),
            );
            return sendJSON(res, 200, { filename });
          }

          if (req.method === 'GET' && url.pathname === '/api/skills') {
            const task = url.searchParams.get('task');
            const files = fs.readdirSync(SKILLS_DIR)
              .filter((f) => FILENAME_RE.test(f) && (!task || f.startsWith(`${task}-`)))
              .map((filename) => {
                const stat = fs.statSync(path.join(SKILLS_DIR, filename));
                return { filename, savedAt: stat.mtime.toISOString() };
              })
              .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
            return sendJSON(res, 200, files);
          }

          const fileMatch = url.pathname.match(/^\/api\/skills\/(.+)$/);
          if (req.method === 'GET' && fileMatch) {
            const filename = decodeURIComponent(fileMatch[1]);
            if (!FILENAME_RE.test(filename)) return sendJSON(res, 400, { error: 'invalid filename' });
            const full = path.join(SKILLS_DIR, filename);
            if (!fs.existsSync(full)) return sendJSON(res, 404, { error: 'not found' });
            return sendJSON(res, 200, JSON.parse(fs.readFileSync(full, 'utf8')));
          }

          next();
        } catch (err) {
          sendJSON(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
