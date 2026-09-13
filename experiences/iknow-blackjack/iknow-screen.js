/**
 * IKnowScreen -- a 2D DOM "monitor" for the "I Know Blackjack" task, stacked
 * directly above the SkillHUD panel. Shows exactly the same content as the
 * in-world screen (iknow-table.js): current hand, the fly's action, and the
 * live Q-values, plus a mode/accuracy banner (see `render`'s `meta` param).
 * Standalone copy for iknow-blackjack -- not shared with
 * experiences/blackjack/'s hand-screen.js.
 */

import { CSS } from '../../src/index.js';

export class IKnowScreen {
  /** @param {HTMLElement} container  prepended as the first child, so it
   *   stacks ABOVE whatever's already there (the TrainingHUD panel). */
  mount(container) {
    const box = document.createElement('div');
    box.style.cssText = `background:${CSS.panel};border:1px solid ${CSS.border};`
      + 'border-radius:8px;padding:8px 10px;backdrop-filter:blur(8px);';

    const title = document.createElement('div');
    title.textContent = 'HAND SCREEN';
    title.style.cssText = `color:${CSS.violet};font-size:9px;letter-spacing:0.14em;margin-bottom:6px`;
    box.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 300;
    this.canvas.height = 200;
    this.canvas.style.cssText = 'width:100%;display:block;border-radius:4px;';
    box.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    container.insertBefore(box, container.firstChild);
    this.box = box;
    this.render({ playerTotal: 0, dealerUpcard: 0, usableAce: false }, null, 'IDLE', {});
    return this;
  }

  /**
   * Same drawing this task used to put on the in-world screen's canvas, plus
   * a mode/accuracy banner across the top.
   * @param {{evaluating?:boolean, successRate?:number, trials?:number,
   *   evalStats?:{trials:number,wins:number}}} [meta]  same shape TrainingHUD
   *   .setBadge() takes -- pass the same object to both.
   */
  render(state, action, decisionState, q, meta = {}) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0b0614';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Mode/accuracy banner -- which number below means "training" vs
    // "playing" is exactly the ambiguity this is here to remove, so it says
    // so directly rather than assuming the viewer is also watching
    // TrainingHUD's smaller badge text at the same moment.
    const evaluating = !!meta.evaluating;
    const bannerH = 26;
    ctx.fillStyle = evaluating ? 'rgba(0, 229, 255, 0.16)' : 'rgba(154, 92, 255, 0.18)';
    ctx.fillRect(2, 2, w - 4, bannerH);

    // Label the percentage explicitly as a WIN rate (it used to just be a
    // bare number, easy to mistake for something else, e.g. confidence) and
    // color it by the same win-rate thresholds SkillHUD's diagnostics use
    // (>42% good, <35% bad, between = middling) so red vs green is legible
    // at a glance without reading the digits.
    let winPct;
    let label;
    if (evaluating) {
      const n = meta.evalStats?.trials ?? 0;
      winPct = n ? (meta.evalStats.wins / n) * 100 : 0;
      label = `▶ PLAYING · WIN ${winPct.toFixed(1)}% (${n} hands)`;
    } else {
      winPct = (meta.successRate ?? 0) * 100;
      label = `● LEARNING · WIN ${winPct.toFixed(1)}% (${meta.trials ?? 0} hands)`;
    }
    ctx.fillStyle = winPct > 42 ? CSS.lime : winPct < 35 ? CSS.red : CSS.amber;
    ctx.font = `700 13px ${CSS.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, bannerH / 2 + 5);

    ctx.fillStyle = CSS.cyan;
    ctx.font = `600 20px ${CSS.font}`;
    ctx.fillText(`FLY ${state.playerTotal}${state.usableAce ? ' (soft)' : ''}`, w / 2, bannerH + 30);
    ctx.fillStyle = CSS.magenta;
    ctx.font = `600 20px ${CSS.font}`;
    ctx.fillText(`DEALER shows ${state.dealerUpcard}`, w / 2, bannerH + 58);

    if (action) {
      ctx.fillStyle = action === 'hit' ? CSS.lime : CSS.amber;
      ctx.font = `700 28px ${CSS.font}`;
      ctx.fillText(action.toUpperCase(), w / 2, bannerH + 92);
    }

    ctx.font = `11px ${CSS.font}`;
    ctx.fillStyle = CSS.dim;
    ctx.fillText(`Q(hit) ${(q.hit ?? 0).toFixed(3)}   Q(stand) ${(q.stand ?? 0).toFixed(3)}`, w / 2, bannerH + 118);

    ctx.font = `10px ${CSS.font}`;
    ctx.fillStyle = CSS.violet;
    ctx.fillText(decisionState, w / 2, h - 12);
    ctx.textAlign = 'left';
  }

  dispose() {
    this.box?.remove();
  }
}
