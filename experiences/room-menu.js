/**
 * A small room-select overlay: Free-Roaming Arena and two Tethered Training
 * Rig tasks (blackjack, optogenetics). Toggle with `M`. (There's also a
 * "Chaos Chair" easter egg, currently hidden from the menu -- see the
 * commented-out `mkBtn` call below.)
 *
 * This is example glue, not framework: it just calls the public SDK
 * (`lab.setRoom()`, `lab.mintNewFly()`, `lab.cycleCircuit()`, `lab.arena.set
 * Brightness()`) that already exists for exactly this kind of thing.
 *
 * Blackjack and the optogenetics palette are both Room 2 tasks but are kept
 * mutually exclusive in v1 -- nothing structurally prevents mounting both at
 * once (disjoint DOM regions, disjoint 3D targets), it just isn't wired that
 * way yet, to avoid two examples silently fighting over screen space.
 *
 * Doubles as the mandatory FIRST screen: the scene calls `menu.show()` right
 * after boot, while the lab is still paused (`lab.stop()`), so nothing is
 * built or ticking until the player picks something here. `onEnterFreeRoaming`
 * is the hook the scene uses to lazily build Room 1's stations exactly once.
 */

// GENOTYPES/CIRCUITS are only used by the currently-disabled Chaos Chair
// button below -- kept imported so re-enabling it later is a one-line
// uncomment, not a re-import.
import { CSS, GENOTYPES, CIRCUITS } from '../src/index.js';
import { enterBlackjack } from './blackjack/tethered-scene.js';
import { mountOptogenetics } from './optogenetics/optogenetics-palette.js';
import { enterIKnowBlackjack } from './iknow-blackjack/iknow-blackjack.js';
import { enterMathClass } from './math-class/tethered-scene.js';
import { enterVisionMathClass } from './vision-math-class/tethered-scene.js';

export function mountRoomMenu(lab, { onLog = () => {}, onEnterFreeRoaming = () => {} } = {}) {
  let blackjack = null; // {loop, table, hud, dispose()} while Room 2/blackjack is active
  let optogenetics = null; // {dispose()} while Room 2/optogenetics is active
  let iknowBlackjack = null; // {dispose()} while Room 4 is active
  let mathClass = null; // {loop, hud, dispose()} while Room 5 is active
  let neuroDebugger = null; // {hud, recorder, runner, halo, dispose()} while Room 7 is active
  // Carries the learned Q-readout across a room switch: running BOTH rooms
  // at once isn't safe (they'd both be driving the same real brain -- Room
  // 1's food bowls and blackjack's odor injection target the very same real
  // glomeruli, and a walking Room 1 fly would swamp the steering channels
  // blackjack's features read), so leaving Room 2 still fully tears down its
  // loop/HUD/3D dock. What's preserved is the thing that actually matters --
  // the learned weights -- so coming back resumes training instead of
  // starting over from a blank readout.
  let savedBlackjackQ = null;
  let savedMathClassQ = null;

  const leaveRoom2Tasks = () => {
    if (blackjack) { savedBlackjackQ = blackjack.loop.q; blackjack.dispose(); blackjack = null; }
    if (optogenetics) { optogenetics.dispose(); optogenetics = null; }
    if (iknowBlackjack) { iknowBlackjack.dispose(); iknowBlackjack = null; }
    if (mathClass) { savedMathClassQ = mathClass.loop.q; mathClass.dispose(); mathClass = null; }
    if (neuroDebugger) { neuroDebugger.dispose(); neuroDebugger = null; }
  };

  const root = document.createElement('div');
  root.id = 'madfly-room-menu';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', display: 'none', placeItems: 'center',
    background: 'rgba(11, 6, 20, 0.82) url(/public/madfly_lab_menu_bg.png) center/cover no-repeat',
    backdropFilter: 'blur(6px)',
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
    // Any menu choice resumes the loop -- centralized here so it's the one
    // place that needs to know about pause/resume, not every handler below.
    b.onclick = () => { lab.resume(); onClick(); hide(); };
    card.appendChild(b);
    return b;
  };

  mkBtn('🪰 Room 1 — Free-Roaming Arena', 'Open world: walk, feed, escape, court, learn nothing', () => {
    // Leave Room 2 (if active) and restore `lab.room` to 'free-roaming'
    // BEFORE building anything: `setRoom()`'s restore path replaces
    // `lab.stations` wholesale from its saved snapshot, so building Room 1's
    // stations before that would spawn them into the (about to be discarded)
    // Room 2 scene and then have them silently wiped out by the restore.
    leaveRoom2Tasks();
    lab.setRoom('free-roaming');
    onEnterFreeRoaming(); // no-op on a later return trip -- guarded, builds once
    onLog('Room 1: free-roaming arena');
  });

  mkBtn('🃏 Room 2 — Blackjack Training Rig', 'Stationary. Blackjack via smell; a small readout learns.', () => {
    leaveRoom2Tasks();
    blackjack = enterBlackjack(lab, savedBlackjackQ ? { initialQ: savedBlackjackQ } : {});
    onLog(savedBlackjackQ
      ? 'Room 2: tethered rig — blackjack (resumed, keeping what it learned)'
      : 'Room 2: tethered rig — blackjack via ORN_DM1/VA6/DA1');
  });

  mkBtn('🧠 Room 3 — Optogenetics Lab', 'Stationary. Click/hold the floating brain to stimulate real populations.', () => {
    leaveRoom2Tasks();
    optogenetics = mountOptogenetics(lab);
    onLog('Room 2: tethered rig — optogenetics palette');
  });

  mkBtn('🕶️ Room 4 — Skill Downloader ("I Know Blackjack")', 'Load neural skills directly into a fresh fly brain.', () => {
    leaveRoom2Tasks();
    iknowBlackjack = enterIKnowBlackjack(lab);
    onLog('Room 4: tethered rig — iknow-blackjack');
  });

  mkBtn('🔢 Room 5 — Math Class (Even vs. Odd)', 'Stationary. Dot counts via real visual interneurons; a readout learns.', () => {
    leaveRoom2Tasks();
    mathClass = enterMathClass(lab, savedMathClassQ ? { initialQ: savedMathClassQ } : {});
    onLog(savedMathClassQ
      ? 'Room 5: tethered rig — math class (resumed, keeping what it learned)'
      : 'Room 5: tethered rig — math class via LPLC1/LPLC2 -> DNa01');
  });

    mkBtn('🔢 Room 6 — Vision Math Class (Even vs. Odd)', 'Stationary. Dot counts via real visual interneurons; a readout learns.', () => {
    leaveRoom2Tasks();
    mathClass = enterVisionMathClass(lab, savedMathClassQ ? { initialQ: savedMathClassQ } : {});
    onLog(savedMathClassQ
      ? 'Room 6: tethered rig — vision math class (resumed, keeping what it learned)'
      : 'Room 6: tethered rig — vision math class via LPLC1/LPLC2 -> DNa01');
  });

  mkBtn('🔬 Room 7 — Neuro-Debugger Scientist Workbench', 'Automated AI connectomics workbench & 3D telemetry dashboard.', () => {
    leaveRoom2Tasks();
    import('./neuro-debugger/enter.js').then(({ enterDebugger }) => {
      neuroDebugger = enterDebugger(lab);
      onLog('Room 7: Neuro-Debugger Scientist Workbench active');
    }).catch(err => {
      console.error('Failed to enter Neuro-Debugger:', err);
      onLog('Room 7: Neuro-Debugger — failed to initialize');
    });
  });

  // Chaos Chair -- hidden from the menu for now (not needed day-to-day), but
  // left implemented rather than deleted in case it's wanted back later.
  // Uncomment to restore the button:
  // mkBtn('🎲 Chaos Chair', "Random genotype + random circuit + blazing lights. Just for fun.", () => {
  //   // Same ordering requirement as Free-Roaming above -- leave/restore first.
  //   leaveRoom2Tasks();
  //   lab.setRoom('free-roaming');
  //   onEnterFreeRoaming(); // chaos chair implies the free-roaming arena, not Room 2
  //   const names = Object.keys(GENOTYPES).filter((n) => n !== 'wild-type');
  //   const genotype = names[Math.floor(Math.random() * names.length)];
  //   const circuits = Object.keys(CIRCUITS).filter((n) => n !== 'full');
  //   const circuit = circuits[Math.floor(Math.random() * circuits.length)];
  //   lab.mintNewFly(genotype);
  //   lab.setCircuit(circuit);
  //   lab.arena.setBrightness('blazing');
  //   onLog(`🎲 chaos: ${genotype} on ${circuit}, lights blazing`);
  // });

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
