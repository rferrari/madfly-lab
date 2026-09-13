/**
 * A small room-select overlay: Free-Roaming Arena, Tethered Training Rig
 * (blackjack), and a "Chaos Chair" easter egg. Toggle with `M`.
 *
 * This is example glue, not framework: it just calls the public SDK
 * (`lab.setRoom()`, `lab.mintNewFly()`, `lab.cycleCircuit()`, `lab.arena.set
 * Brightness()`) that already exists for exactly this kind of thing.
 */

import { CSS, GENOTYPES, CIRCUITS } from '../src/index.js';
import { enterBlackjack } from './blackjack/tethered-scene.js';

export function mountRoomMenu(lab, { onLog = () => {} } = {}) {
  let blackjack = null; // {loop, table, hud, dispose()} while Room 2 is active

  const root = document.createElement('div');
  root.id = 'madfly-room-menu';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', display: 'none', placeItems: 'center',
    background: 'rgba(11, 6, 20, 0.82)', backdropFilter: 'blur(6px)',
    zIndex: '30', font: `12px ${CSS.font}`, color: CSS.bone,
  });
  root.style.display = 'none';

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: CSS.panel, border: `1px solid ${CSS.border}`, borderRadius: '12px',
    padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '14px',
    minWidth: '280px', alignItems: 'stretch',
  });
  const title = document.createElement('div');
  title.textContent = 'MADFLY LAB';
  title.style.cssText = `color:${CSS.cyan};font-size:16px;letter-spacing:0.2em;text-align:center;margin-bottom:6px`;
  card.appendChild(title);

  const mkBtn = (label, sub, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = `background:transparent;color:${CSS.bone};border:1px solid ${CSS.border};`
      + `border-radius:8px;padding:10px 14px;cursor:pointer;text-align:left;font:12px ${CSS.font}`;
    b.innerHTML = `<div style="font-size:13px">${label}</div>`
      + (sub ? `<div style="color:${CSS.dim};font-size:10px;margin-top:2px">${sub}</div>` : '');
    b.onmouseenter = () => { b.style.borderColor = CSS.cyan; };
    b.onmouseleave = () => { b.style.borderColor = CSS.border; };
    b.onclick = () => { onClick(); hide(); };
    card.appendChild(b);
    return b;
  };

  mkBtn('🪰 Room 1 — Free-Roaming Arena', 'Open world: walk, feed, escape, court, learn nothing', () => {
    if (blackjack) { blackjack.dispose(); blackjack = null; }
    lab.setRoom('free-roaming');
    onLog('Room 1: free-roaming arena');
  });

  mkBtn('🃏 Room 2 — Tethered Training Rig', 'Stationary. Blackjack via smell; a small readout learns.', () => {
    if (blackjack) { blackjack.dispose(); blackjack = null; }
    blackjack = enterBlackjack(lab);
    onLog('Room 2: tethered rig — blackjack via ORN_DM1/VA6/DA1');
  });

  mkBtn('🎲 Chaos Chair', "Random genotype + random circuit + blazing lights. Just for fun.", () => {
    const names = Object.keys(GENOTYPES).filter((n) => n !== 'wild-type');
    const genotype = names[Math.floor(Math.random() * names.length)];
    const circuits = Object.keys(CIRCUITS).filter((n) => n !== 'full');
    const circuit = circuits[Math.floor(Math.random() * circuits.length)];
    lab.mintNewFly(genotype);
    lab.setCircuit(circuit);
    lab.arena.setBrightness('blazing');
    onLog(`🎲 chaos: ${genotype} on ${circuit}, lights blazing`);
  });

  const hint = document.createElement('div');
  hint.textContent = 'press M to reopen this menu';
  hint.style.cssText = `color:${CSS.dim};font-size:9px;text-align:center;margin-top:4px`;
  card.appendChild(hint);

  root.appendChild(card);
  document.body.appendChild(root);

  const show = () => { root.style.display = 'grid'; };
  const hide = () => { root.style.display = 'none'; };
  const toggle = () => { root.style.display === 'none' ? show() : hide(); };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') toggle();
    if (e.key === 'Escape') hide();
  });

  return { show, hide, toggle };
}
