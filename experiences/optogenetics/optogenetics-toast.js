/**
 * A small transient toast for the optogenetics palette -- same fixed-div /
 * fade pattern already used in this codebase (src/core/lab.js's
 * `_showRecordingStatus`, experiences/hello-lab.js's `log()`), duplicated rather
 * than reused because both of those are private to their own modules. Own
 * `@keyframes` id so its pulse animation can't collide with
 * `recording-pulse-style` (src/core/lab.js).
 */

import { CSS } from '../../src/index.js';

const STYLE_ID = 'optogenetics-toast-style';
const FADE_MS = 2200;

export function createToast() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes optogenetics-toast-pulse {
        0% { transform: translateX(-50%) scale(0.96); opacity: 0; }
        12% { transform: translateX(-50%) scale(1); opacity: 1; }
        100% { transform: translateX(-50%) scale(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.id = 'optogenetics-toast';
  Object.assign(el.style, {
    position: 'fixed', left: '50%', top: '18px', zIndex: '19',
    transform: 'translateX(-50%)', opacity: '0',
    background: CSS.panel, border: `1px solid ${CSS.border}`, borderLeft: `3px solid ${CSS.cyan}`,
    borderRadius: '6px', padding: '8px 16px', color: CSS.bone,
    font: `12px ${CSS.font}`, letterSpacing: '0.03em', pointerEvents: 'none',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(el);

  let hideTimer = null;

  return {
    show(text, color = CSS.cyan) {
      el.textContent = text;
      el.style.borderLeftColor = color;
      el.style.animation = 'none';
      // Force reflow so re-triggering the same toast restarts the animation.
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.style.animation = `optogenetics-toast-pulse 0.3s ease-out forwards`;
      el.style.opacity = '1';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { el.style.opacity = '0'; }, FADE_MS);
    },
    dispose() {
      clearTimeout(hideTimer);
      el.remove();
    },
  };
}
