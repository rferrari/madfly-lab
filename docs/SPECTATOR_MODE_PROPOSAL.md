# Proposal: Lock / End-Experience + Spectator Link

**Status: not built.** This is a design write-up for later, so whoever picks it
up (possibly future us) doesn't have to re-derive the architecture. Nothing in
this document exists in the codebase yet.

## The idea

The lab owner can **lock** a running session — the simulation keeps ticking,
but all input (keyboard shortcuts, clicks, room switching) freezes — and hand
out a **spectator link**. Anyone who opens that link sees an exact live mirror
of the owner's screen (same camera, same HUD) and can't interact with
anything. Only the owner (whoever has the plain interactive URL) can unlock,
reset, or end the experience.

Two mostly-independent features, meant to be exposed through one UI widget:

1. **Local lock/unlock/end-experience** — small, low-risk, no networking.
2. **Spectator link** — a real new subsystem: capturing the owner's tab and
   streaming it to another browser over the internet.

## Why this needs real new plumbing, not just a URL

Two things worth stating plainly, since they weren't obvious going in:

- **The HUD lives outside the canvas.** The 3D scene renders into
  `lab.arena.canvas`, but the telemetry panels, toasts, the room-menu, and the
  optogenetics palette are all separate DOM elements layered on top via CSS
  `position:fixed`. `canvas.captureStream()` only captures the WebGL canvas's
  own pixels — it would silently omit every HUD panel. To get "exact mirrored
  view, same HUD, everything," the right primitive is
  `navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true })`, which
  captures the whole composited tab. Caveat: this triggers a one-time browser
  share-tab permission prompt (can't be fully silent), and `preferCurrentTab`
  is a Chromium-specific hint — other browsers fall back to the ordinary
  picker, which still works if the user manually picks their own tab.

- **There's no networking primitive in this repo that can broker a WebRTC
  connection between two browsers.** The only thing that exists is
  `src/brain/remote-runtime.js`'s `WebSocket` client talking to the brain-only
  Mode A Python server (which, per its own docstring, "owns only the brain" —
  no shared/broadcast state exists anywhere). WebRTC needs a signaling channel
  to exchange SDP offer/answer + ICE candidates before video can flow
  peer-to-peer — there's no way around building something small for this.

## Proposed architecture

### 1. Local lock / unlock / end-experience

- `MadFlyLab` (`src/core/lab.js`) gets `this.locked = false` plus
  `lock()`/`unlock()`. This is independent of `running` — a locked lab keeps
  simulating and rendering; only user-driven input stops reaching it.
- Every existing input-binding site gets a one-line guard at the top:
  - `examples/hello-lab.js`'s big `keydown` handler (camera, reset, mint,
    poke, lights, fan, brightness, circuit, zoom, genotype)
  - `src/core/lab.js`'s `_bindPointer()` (pointerdown/up → poke) and
    `_bindRecordingKeys()` (shift+R/P/V/J/C)
  - `examples/room-menu.js`'s `keydown` handler (M/Escape) and its shared
    `mkBtn` `onclick` (all 5 menu buttons route through one place)
  - `examples/optogenetics/optogenetics-palette.js`'s pointer handlers and
    tool-select/side-toggle button clicks
  - Blackjack needs nothing — it's fully autonomous, no input bindings at all.
- `window.lab` stays globally reachable from devtools regardless — `locked`
  protects against someone else's hands on the same keyboard/mouse, not
  against the owner's own console. Worth stating explicitly rather than
  quietly pretending it's a security boundary.
- **End experience** reuses machinery already built (the boot-pause flow):
  `room-menu.js` gains `endExperience()` — `leaveRoom2Tasks(); lab.stop();
  show();` — which tears down whatever Room 2 task is active and returns to
  the exact "paused, pick a room" state the app already boots into.
- **New UI**: `examples/lock-control.js`, a small persistent widget
  (bottom-right, above the room-menu's z-index so it stays clickable while
  the menu is open). Idle state: `[🔒 Lock & Share]`. Once sharing: a status
  line (`● LIVE · N spectator(s)`), the generated link + copy button,
  lock/unlock toggle, stop-sharing, and end-experience (which always works,
  locked or not).

### 2. Spectator link

New files:
- `vite-plugins/signal-relay.js` — a Vite plugin using `configureServer` +
  the `ws` package (not currently a dependency) to add a WebSocket upgrade
  endpoint at `/signal` to Vite's own dev server. Works only under `vite dev`
  — a `vite build` + static-serve deployment would need a small standalone
  relay process running the same logic on its own port. That's a deliberate,
  labeled follow-up for whenever this actually gets hosted somewhere, not
  something to build now.
- `examples/broadcast/signal-client.js` — a tiny shared helper: open the
  relay socket, send/receive op-tagged JSON messages.
- `examples/broadcast/owner-broadcast.js` — the owner side:
  `getDisplayMedia({preferCurrentTab:true})`, one `RTCPeerConnection` per
  joining spectator (all fed from the same capture stream), STUN-only NAT
  traversal (`stun:stun.l.google.com:19302`, no TURN server — documented
  limitation, works for most home networks, will fail behind some
  restrictive/symmetric NATs).
- `examples/broadcast/spectator-page.js` — the spectator side: a full-viewport
  `<video>` element and one `RTCPeerConnection`. Critically, this module never
  imports `MadFlyLab` or touches `src/index.js` — a spectator tab never
  constructs a lab at all, which is the strongest possible "zero control"
  guarantee, stronger than any runtime permission check.
- `index.html` gets an early branch: if `?spectate=<sessionId>` is present,
  skip the connectome boot splash entirely and import
  `spectator-page.js` instead of `hello-lab.js`.

Signaling protocol (mirrors the op-tagged-JSON style already used by
`remote-runtime.js`/`server.py`):

| Message | Direction |
|---|---|
| `{op:'create-session'}` | owner → relay |
| `{op:'session-created', sessionId}` | relay → owner |
| `{op:'join', sessionId}` | spectator → relay |
| `{op:'joined', spectatorId}` | relay → spectator |
| `{op:'session-not-found'}` | relay → spectator |
| `{op:'spectator-joined', spectatorId}` | relay → owner |
| `{op:'spectator-left', spectatorId}` | relay → owner |
| `{op:'offer'/'answer'/'ice-candidate', sessionId, spectatorId, ...}` | relayed both directions |
| `{op:'owner-left'}` | relay → all spectators |

In-memory only (`Map<sessionId, {ownerWs, spectators}>` inside the plugin's
closure) — no persistence, sessions die with the dev server process, same
spirit as the Mode A server's per-session (never shared) brain state.

## Explicitly out of scope

- A production/internet-hosted signaling relay (only the Vite-dev-server
  plugin version is proposed for now).
- A TURN server.
- Any cryptographic auth/session-token system — the access model is just
  "plain interactive URL = owner, separately-generated spectator URL = zero
  controls by construction," nothing more.
- Any state-sync/replay alternative to video mirroring — this is a
  video-mirror-only design, deliberately, not independently re-simulated
  views for each spectator.
- Reconnect-with-backoff for the owner-disappearing case — a spectator just
  sees "session ended," no auto-retry.

## One real gotcha to remember when building this

`getDisplayMedia` requires a secure context. `localhost` is exempt, but
`npm run dev -- --host 0.0.0.0` served over plain `http://<lan-ip>:port` is
**not** secure in Chrome by default — "Lock & Share" would silently have
nothing to call. Testing via `localhost` sidesteps this; real deployment on
HTTPS resolves it for free, which is presumably where this ends up living
anyway.

## How to verify this once built

Two headless Chrome tabs (this project's established verification method for
anything interactive/visual), one as owner, one as spectator:

1. Owner: boot, pick a room, click "Lock & Share," confirm the widget shows a
   `?spectate=` link and `lab.locked === true`.
2. Dispatch synthetic input (keydown, clicks) at every gated site on the
   owner tab while locked; confirm no observable state changes anywhere
   except through the always-live unlock/end-experience control.
3. Spectator tab: navigate to the generated link; confirm `window.lab` is
   `undefined`, the `<video>` element receives frames, and a screenshot
   matches the owner's HUD panels (not just the 3D scene) at the same moment.
4. Confirm input on the spectator tab does nothing to the owner's state (no
   data channel exists to carry it back).
5. Click "End Experience" on the owner tab; confirm the room-menu reappears
   and the spectator tab receives `owner-left` and shows "session ended."
