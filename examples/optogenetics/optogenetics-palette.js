/**
 * Mouse Optogenetics -- Room 2 only. Hover the floating brain orb to see the
 * currently-selected tool's real population halo; click for a one-shot pulse,
 * hold for a sustained drive; a 4-tool floating palette picks which real
 * channel is targeted. See src/observer/brain-raycaster.js and
 * src/observer/brain-halo.js for the framework-generic raycast/highlight
 * machinery this wires up; see optogenetics-tools.js for what each of the 4
 * tools actually does.
 *
 * Call `mountOptogenetics(lab)` after (or instead of) `lab.setRoom('tethered-
 * rig')` -- mirrors examples/blackjack/tethered-scene.js's `enterBlackjack`
 * lifecycle shape exactly. Call the returned `dispose()` to leave cleanly.
 */

import * as THREE from 'three';
import { CSS, BrainRaycaster, BrainHalo } from '../../src/index.js';
import { TOOLS } from './optogenetics-tools.js';
import { createToast } from './optogenetics-toast.js';

const HOLD_THRESHOLD_MS = 180;
const HOLD_HARD_CAP_MS = 2000;
const DRAG_GUARD_PX = 5;

export function mountOptogenetics(lab, opts = {}) {
  if (lab.room !== 'tethered-rig') lab.setRoom('tethered-rig');

  const toast = createToast();

  if (!lab.brain.pack) {
    // Mode A (full-connectome server) has no local channel index to resolve
    // a click against -- rather than guess, disable outright and say why.
    console.warn('[optogenetics] requires Mode B (a local ConnectomePack) -- unavailable in Mode A.');
    toast.show('optogenetics: requires Mode B — no local channel index in Mode A', CSS.amber);
    return { dispose() { toast.dispose(); } };
  }

  let active = true;
  const capturedPack = lab.brain.pack;
  let staleNotified = false;

  // ---- UI --------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'madfly-optogenetics';
  Object.assign(root.style, {
    // Bottom-left, NOT top-right: the observer HUD (src/observer/lab-observer.js)
    // is a fixed `top:0; right:0` column spanning the whole right edge, so
    // top-right is already claimed. Bottom-left is where TrainingHUD lives too
    // (examples/blackjack/), but the two Room 2 tasks are mounted mutually
    // exclusively (see room-menu.js), so there is never a simultaneous clash.
    position: 'fixed', bottom: '16px', left: '16px', zIndex: '18',
    display: 'flex', flexDirection: 'column', gap: '8px', width: '198px',
    font: `11px ${CSS.font}`,
  });

  const title = document.createElement('div');
  title.textContent = 'OPTOGENETICS';
  Object.assign(title.style, {
    color: CSS.violet, fontSize: '9px', letterSpacing: '0.14em',
    padding: '0 2px 2px',
  });
  root.appendChild(title);

  const buttons = new Map(); // tool.id -> {button, sideL, sideR}

  const availability = () => Object.fromEntries(TOOLS.map((t) => [
    t.id, t.requiredChannels.every((c) => lab.brain.pack?.channels.has(c)),
  ]));
  let available = availability();

  let selectedTool = TOOLS.find((t) => available[t.id]) ?? null;
  let selectedSide = 'L'; // only meaningful for the steering tool

  function toolChannel(tool, side = selectedSide) {
    return tool.sides ? tool.channelFor(side) : tool.channel;
  }

  function resolveClusterIndices(tool, side = selectedSide) {
    const pack = lab.brain.pack;
    const idx = pack?.channels.get(toolChannel(tool, side));
    if (!idx) return new Int32Array(0);
    const valid = pack.somaValid;
    let count = 0;
    for (let k = 0; k < idx.length; k++) if (!valid || valid[idx[k]]) count++;
    const out = new Int32Array(count);
    let w = 0;
    for (let k = 0; k < idx.length; k++) if (!valid || valid[idx[k]]) out[w++] = idx[k];
    return out;
  }

  function refreshHalo() {
    if (!selectedTool || !halo) return;
    halo.setColor(selectedTool.color);
    halo.setCluster(resolveClusterIndices(selectedTool));
  }

  function selectTool(tool) {
    if (!available[tool.id]) return;
    selectedTool = tool;
    refreshHalo();
    renderButtons();
  }

  function renderButtons() {
    for (const [id, refs] of buttons) {
      const tool = TOOLS.find((t) => t.id === id);
      const isSel = selectedTool === tool;
      const isAvail = available[id];
      refs.button.style.opacity = isAvail ? '1' : '0.4';
      refs.button.style.cursor = isAvail ? 'pointer' : 'not-allowed';
      refs.button.style.borderLeft = `3px solid ${isSel ? tool.cssColor : 'transparent'}`;
      refs.button.style.background = isSel ? 'rgba(255,255,255,0.04)' : 'transparent';
      refs.sub.textContent = isAvail ? tool.sublabel : `${tool.sublabel} (unavailable — ${capturedPack.circuit.name} circuit)`;
      if (refs.sideL) {
        refs.sideL.style.opacity = selectedSide === 'L' ? '1' : '0.4';
        refs.sideR.style.opacity = selectedSide === 'R' ? '1' : '0.4';
      }
    }
  }

  for (const tool of TOOLS) {
    const button = document.createElement('div');
    Object.assign(button.style, {
      background: 'transparent', color: CSS.bone, border: `1px solid ${CSS.border}`,
      borderRadius: '8px', padding: '8px 10px', display: 'flex', flexDirection: 'column',
      gap: '2px', transition: 'background 0.15s, border-color 0.15s',
    });
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px';
    const label = document.createElement('span');
    label.textContent = `${tool.emoji} ${tool.label}`;
    head.appendChild(label);

    if (tool.sides) {
      const sideWrap = document.createElement('span');
      sideWrap.style.cssText = 'display:flex;gap:4px';
      const sideL = document.createElement('button');
      const sideR = document.createElement('button');
      for (const [btn, side] of [[sideL, 'L'], [sideR, 'R']]) {
        btn.textContent = side;
        btn.style.cssText = `background:transparent;color:${CSS.bone};border:1px solid ${CSS.border};`
          + 'border-radius:4px;width:18px;height:18px;font-size:9px;cursor:pointer;padding:0';
        btn.onclick = (e) => {
          e.stopPropagation();
          selectedSide = side;
          selectTool(tool);
        };
        sideWrap.appendChild(btn);
      }
      head.appendChild(sideWrap);
      buttons.set(tool.id, { button, sub: null, sideL, sideR });
    } else {
      buttons.set(tool.id, { button, sub: null });
    }
    button.appendChild(head);

    const sub = document.createElement('div');
    sub.style.cssText = `color:${CSS.dim};font-size:9px`;
    button.appendChild(sub);
    buttons.get(tool.id).sub = sub;

    button.onmouseenter = () => { if (available[tool.id]) button.style.borderColor = tool.cssColor; };
    button.onmouseleave = () => { button.style.borderColor = selectedTool === tool ? tool.cssColor : CSS.border; };
    button.onclick = () => selectTool(tool);

    root.appendChild(button);
  }

  document.body.appendChild(root);
  renderButtons();

  function disableAll(message) {
    available = Object.fromEntries(TOOLS.map((t) => [t.id, false]));
    selectedTool = null;
    halo?.setHoverVisible(false);
    renderButtons();
    if (message) toast.show(message, CSS.amber);
  }

  // ---- raycasting / halo -------------------------------------------------
  const raycaster = new BrainRaycaster();
  let halo = null;
  if (selectedTool) {
    halo = new BrainHalo(lab.brainOrb, { color: selectedTool.color });
    halo.attach();
    refreshHalo();
  }

  function ndcFromEvent(e) {
    const rect = lab.arena.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function hitTestAt(e) {
    if (!active || !selectedTool || !halo) return null;
    const orb = lab.brainOrb;
    if (!orb?.points) return null;
    return raycaster.hitTest(ndcFromEvent(e), lab.arena.camera, orb.points);
  }

  // ---- click / hold interaction -------------------------------------------
  let down = null; // {x, y}
  let holdTimer = null;
  let holdCapTimer = null;
  let holding = false;

  function clearHoldTimers() {
    clearTimeout(holdTimer); holdTimer = null;
    clearTimeout(holdCapTimer); holdCapTimer = null;
  }

  function fireReaction(tool, side) {
    tool.react(lab, {
      side,
      api: { toast: (text, color) => toast.show(text, color), applyYawKick },
    });
  }

  function releaseHold(tool, side) {
    if (!holding) return;
    holding = false;
    lab.brain.setInput(toolChannel(tool, side), 0);
  }

  function onPointerDown(e) {
    if (!active) return;
    const hit = hitTestAt(e);
    down = { x: e.clientX, y: e.clientY, hit: !!hit };
    if (!hit || !selectedTool) return;
    const tool = selectedTool;
    const side = selectedSide;
    holdTimer = setTimeout(() => {
      holding = true;
      lab.brain.setInput(toolChannel(tool, side), tool.inject.holdIntensity);
      toast.show(`[HOLDING: ${toolChannel(tool, side)} (+${tool.inject.holdIntensity})]`, tool.cssColor);
      if (tool.reactionMode === 'direct') fireReaction(tool, side);
      holdCapTimer = setTimeout(() => releaseHold(tool, side), HOLD_HARD_CAP_MS - HOLD_THRESHOLD_MS);
    }, HOLD_THRESHOLD_MS);
  }

  function onPointerMove(e) {
    if (!active) return;
    const hit = hitTestAt(e);
    halo?.setHoverVisible(!!hit);
  }

  function onPointerUp(e) {
    if (!active || !down) return;
    const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_GUARD_PX;
    const wasHit = down.hit;
    const tool = selectedTool;
    const side = selectedSide;
    down = null;

    if (holding) { clearHoldTimers(); releaseHold(tool, side); return; }
    clearHoldTimers();
    if (dragged || !wasHit || !tool) return;

    lab.brain.injectCurrent(toolChannel(tool, side), tool.inject.amount, tool.inject.decaySeconds);
    halo?.triggerShockwave();
    toast.show(`[STIMULATED: ${toolChannel(tool, side)} (+${tool.inject.amount}mV)]`, tool.cssColor);
    if (tool.reactionMode === 'direct') fireReaction(tool, side);
  }

  lab.arena.canvas.addEventListener('pointerdown', onPointerDown);
  lab.arena.canvas.addEventListener('pointermove', onPointerMove);
  lab.arena.canvas.addEventListener('pointerup', onPointerUp);

  // ---- looming laser's emergent reaction: a real DNp01 threshold crossing ---
  const loomingTool = TOOLS.find((t) => t.id === 'looming');
  if (loomingTool && available.looming) {
    lab.brain.onSignal(loomingTool.signalChannel, (value) => {
      if (!active || selectedTool !== loomingTool) return;
      loomingTool.react(lab, { api: { toast: (t, c) => toast.show(t, c), applyYawKick } });
    }, { threshold: loomingTool.signalThreshold, mode: 'rising' });
  }

  // ---- steering yaw-kick: a scripted decay applied to avatar.yaw (see
  // optogenetics-tools.js's steering tool for why yaw, not object3D.rotation.y) --
  let yawKick = null;
  function applyYawKick(amount, duration) {
    yawKick = { restYaw: yawKick ? yawKick.restYaw : lab.avatar.yaw, amount, t: 0, duration };
  }

  lab.onFrame((dt) => {
    if (!active) return;

    if (lab.brain.pack !== capturedPack) {
      if (!staleNotified) {
        staleNotified = true;
        disableAll('optogenetics: brain reloaded — leave and re-enter Room 2 to resume');
      }
      return;
    }

    halo?.update(dt);

    if (yawKick) {
      yawKick.t += dt;
      const p = Math.min(1, yawKick.t / yawKick.duration);
      lab.avatar.yaw = yawKick.restYaw + yawKick.amount * (1 - p);
      if (p >= 1) { lab.avatar.yaw = yawKick.restYaw; yawKick = null; }
    }
  });

  return {
    dispose() {
      active = false;
      clearHoldTimers();
      lab.arena.canvas.removeEventListener('pointerdown', onPointerDown);
      lab.arena.canvas.removeEventListener('pointermove', onPointerMove);
      lab.arena.canvas.removeEventListener('pointerup', onPointerUp);
      halo?.dispose();
      toast.dispose();
      root.remove();
    },
  };
}
