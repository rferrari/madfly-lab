/**
 * Screen Recorder -- Capture canvas + HUD + telemetry, replay, and export to video
 *
 * Records:
 * - Canvas frames (world + HUD)
 * - Telemetry data (all channels per frame)
 * - Avatar state (position, velocity, heading)
 * - Timestamp
 *
 * Exports:
 * - MP4 video using ffmpeg.wasm
 * - JSON telemetry data
 *
 * Replay:
 * - Modal overlay showing recorded video
 * - Live fly continues running in background
 * - Playback controls (play/pause/scrub)
 * - Displays telemetry and avatar state alongside video
 */

import { CSS } from '../core/theme.js';

export class ScreenRecorder {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      fps: 30,
      format: 'image/webp',
      quality: 0.95,
      ...options,
    };

    this.isRecording = false;
    this.isReplaying = false;
    this.frames = [];
    this.telemetry = [];
    this.avatarState = [];
    this.brainChannels = [];
    this.recordedAt = null;
    this.startTime = 0;
    this.playbackFrame = 0;
    this.playbackTime = 0;
    this.recordingDuration = 0;

    // Modal replay state
    /** Cached FFmpeg instance, loaded lazily on first export. */
    this._ffmpeg = null;
    this.modalShown = false;
    this.replayPaused = false;
    this.replayFrameImg = null;
    this.replayProgressBar = null;
    this.replayTimeDisplay = null;
    this.replayTelemetryOverlay = null;
    this.replayPlayBtn = null;
    this.onFrameUpdate = null;
  }

  /**
   * Start capturing frames. Called every render loop iteration.
   */
  start() {
    this.isRecording = true;
    this.frames = [];
    this.telemetry = [];
    this.avatarState = [];
    this.recordedAt = new Date().toISOString();
    this.startTime = performance.now();
    this._lastCaptureMs = undefined;
    console.log('🔴 Recording started');
  }

  /**
   * Capture a frame. Call from the main loop after render.
   */
  captureFrame(lab) {
    if (!this.isRecording) return;

    // Throttle to options.fps. This is called once per rendered frame (i.e. at
    // display refresh rate, commonly 60Hz+), but export and replay both assume
    // a fixed `options.fps` -- the ffmpeg output framerate and the playback
    // frame-index math (`playbackTime * options.fps`) both divide by it. Without
    // this gate, a session captured at 60fps but muxed/scrubbed as 30fps plays
    // back at roughly half real speed.
    const now = performance.now();
    const minIntervalMs = 1000 / this.options.fps;
    if (this._lastCaptureMs !== undefined && now - this._lastCaptureMs < minIntervalMs) return;
    this._lastCaptureMs = now;

    try {
      // Capture canvas as DataURL
      const frameData = this.canvas.toDataURL(this.options.format, this.options.quality);
      this.frames.push(frameData);

      // Capture telemetry for all traced channels
      const telemetrySnapshot = {};
      if (lab.observer?.telemetry) {
        for (const trace of lab.observer.telemetry.traces) {
          const v = lab.brain.readCalibrated(trace.channel);
          telemetrySnapshot[trace.channel] = v;
        }
      }
      this.telemetry.push({
        timestamp: performance.now() - this.startTime,
        data: telemetrySnapshot,
      });

      // Capture avatar state. LabAvatar exposes position/yaw/speed directly
      // (no .body, no .heading) -- the previous version read `lab.avatar.body
      // .position` and `.heading`, which threw a TypeError on every frame,
      // caught silently by the outer try/catch. That meant avatarState never
      // got a single entry pushed, and -- since the throw happened before this
      // point in the function -- brainChannels below never ran either.
      const pos = lab.avatar.position;
      const vel = lab.avatar.velocity;
      this.avatarState.push({
        timestamp: performance.now() - this.startTime,
        position: [pos.x, pos.y, pos.z],
        velocity: [vel.x, vel.y, vel.z],
        heading: lab.avatar.yaw,
        speed: lab.avatar.speed,
      });

      // Record available channels on first frame. `channels()` with no
      // argument returns everything; `'all'` is not a recognized filter (only
      // 'input'/'output' are) and always returned [].
      if (this.frames.length === 1) {
        this.brainChannels = lab.brain.channels();
      }
    } catch (err) {
      console.error('Frame capture error:', err);
    }
  }

  /**
   * Stop recording and return summary
   */
  stop() {
    if (!this.isRecording) return null;

    this.isRecording = false;
    this.recordingDuration = (performance.now() - this.startTime) / 1000;
    console.log(`⏹️ Recording stopped: ${this.frames.length} frames, ${this.recordingDuration.toFixed(2)}s`);

    return {
      frameCount: this.frames.length,
      duration: this.recordingDuration,
      fps: this.frames.length / this.recordingDuration,
    };
  }

  /**
   * Start playback of recorded frames
   */
  startPlayback(onFrameUpdate) {
    if (this.frames.length === 0) {
      console.warn('No recording to play');
      return false;
    }

    this.isReplaying = true;
    this.playbackFrame = 0;
    this.playbackTime = 0;
    this.onFrameUpdate = onFrameUpdate;
    console.log('▶️ Playback started');
    return true;
  }

  /**
   * Stop playback
   */
  stopPlayback() {
    this.isReplaying = false;
    this.playbackFrame = 0;
    this.playbackTime = 0;
    console.log('⏹️ Playback stopped');
  }

  /**
   * Open replay modal with live fly in background
   */
  openReplayModal() {
    if (this.frames.length === 0) {
      console.warn('No recording to replay');
      return;
    }

    if (this.modalShown) {
      this.closeReplayModal();
      return;
    }

    this.modalShown = true;
    this.replayPaused = false;

    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'madfly-replay-modal';
    Object.assign(modal.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(11, 6, 20, 0.92)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '999',
      pointerEvents: 'auto',
      fontFamily: `"SF Mono", ui-monospace, monospace`,
      color: CSS.bone,
    });

    // Video display area
    const videoContainer = document.createElement('div');
    Object.assign(videoContainer.style, {
      position: 'relative',
      width: '80vw',
      maxWidth: '1200px',
      aspectRatio: '16 / 9',
      border: `2px solid ${CSS.cyan}`,
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: `0 0 40px rgba(0, 229, 255, 0.3)`,
      marginBottom: '20px',
    });

    // Frame image
    this.replayFrameImg = document.createElement('img');
    Object.assign(this.replayFrameImg.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    });
    videoContainer.appendChild(this.replayFrameImg);

    // Overlay with telemetry
    const telemetryOverlay = document.createElement('div');
    this.replayTelemetryOverlay = telemetryOverlay;
    Object.assign(telemetryOverlay.style, {
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      background: 'rgba(18, 10, 34, 0.8)',
      border: `1px solid ${CSS.border}`,
      borderRadius: '6px',
      padding: '8px 12px',
      font: '10px SF Mono, ui-monospace, monospace',
      color: CSS.cyan,
      maxWidth: '300px',
      backdropFilter: 'blur(8px)',
      pointerEvents: 'none',
    });
    videoContainer.appendChild(telemetryOverlay);

    // Close button (top right)
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      background: CSS.panel,
      border: `1px solid ${CSS.border}`,
      borderRadius: '6px',
      color: CSS.bone,
      cursor: 'pointer',
      width: '32px',
      height: '32px',
      fontSize: '16px',
      zIndex: '1000',
      pointerEvents: 'auto',
    });
    closeBtn.onclick = () => this.closeReplayModal();
    videoContainer.appendChild(closeBtn);

    modal.appendChild(videoContainer);

    // Controls bar
    const controlsBar = document.createElement('div');
    Object.assign(controlsBar.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      width: '80vw',
      maxWidth: '1200px',
    });

    // Play/pause button
    const playBtn = document.createElement('button');
    this.replayPlayBtn = playBtn;
    playBtn.textContent = '▶ Play';
    Object.assign(playBtn.style, {
      background: CSS.panel,
      border: `1px solid ${CSS.border}`,
      borderRadius: '6px',
      color: CSS.cyan,
      cursor: 'pointer',
      padding: '8px 16px',
      font: '11px SF Mono, ui-monospace, monospace',
      pointerEvents: 'auto',
    });
    playBtn.onclick = () => this._toggleReplayPlayback();
    controlsBar.appendChild(playBtn);

    // Progress bar
    const progressBar = document.createElement('input');
    this.replayProgressBar = progressBar;
    progressBar.type = 'range';
    progressBar.min = '0';
    progressBar.max = String(this.frames.length - 1);
    progressBar.value = '0';
    Object.assign(progressBar.style, {
      flex: '1',
      height: '6px',
      cursor: 'pointer',
      pointerEvents: 'auto',
    });
    progressBar.oninput = (e) => {
      this.playbackFrame = parseInt(e.target.value);
      this.playbackTime = this.playbackFrame / this.options.fps;
      this._updateReplayDisplay();
    };
    controlsBar.appendChild(progressBar);

    // Time display
    const timeDisplay = document.createElement('div');
    this.replayTimeDisplay = timeDisplay;
    Object.assign(timeDisplay.style, {
      minWidth: '120px',
      textAlign: 'right',
      font: '11px SF Mono, ui-monospace, monospace',
      color: CSS.dim,
      pointerEvents: 'none',
    });
    timeDisplay.textContent = `0:00 / ${this._formatTime(this.recordingDuration)}`;
    controlsBar.appendChild(timeDisplay);

    // Export buttons
    const exportVideoBtn = document.createElement('button');
    exportVideoBtn.textContent = '💾 MP4';
    exportVideoBtn.title = 'Export as MP4 video';
    Object.assign(exportVideoBtn.style, {
      background: CSS.panel,
      border: `1px solid ${CSS.border}`,
      borderRadius: '6px',
      color: CSS.lime,
      cursor: 'pointer',
      padding: '6px 12px',
      font: '10px SF Mono, ui-monospace, monospace',
      pointerEvents: 'auto',
    });
    exportVideoBtn.onclick = () => this.exportVideo();
    controlsBar.appendChild(exportVideoBtn);

    const exportTelemetryBtn = document.createElement('button');
    exportTelemetryBtn.textContent = '📊 JSON';
    exportTelemetryBtn.title = 'Export telemetry as JSON';
    Object.assign(exportTelemetryBtn.style, {
      background: CSS.panel,
      border: `1px solid ${CSS.border}`,
      borderRadius: '6px',
      color: CSS.magenta,
      cursor: 'pointer',
      padding: '6px 12px',
      font: '10px SF Mono, ui-monospace, monospace',
      pointerEvents: 'auto',
    });
    exportTelemetryBtn.onclick = () => this.exportTelemetry();
    controlsBar.appendChild(exportTelemetryBtn);

    modal.appendChild(controlsBar);
    document.body.appendChild(modal);

    // Start playback
    this.startPlayback(() => this._updateReplayDisplay());
    this._updateReplayDisplay();

    console.log('📺 Replay modal opened - live fly continues in background');
  }

  /**
   * Close the replay modal
   */
  closeReplayModal() {
    const modal = document.getElementById('madfly-replay-modal');
    if (modal) {
      modal.remove();
    }
    this.stopPlayback();
    this.modalShown = false;
    console.log('📺 Replay modal closed');
  }

  /**
   * Toggle play/pause in replay
   */
  _toggleReplayPlayback() {
    this.replayPaused = !this.replayPaused;
    if (this.replayPlayBtn) {
      this.replayPlayBtn.textContent = this.replayPaused ? '⏸ Pause' : '▶ Play';
      this.replayPlayBtn.style.color = this.replayPaused ? CSS.amber : CSS.cyan;
    }
  }

  /**
   * Update replay display (frame image + telemetry overlay)
   */
  _updateReplayDisplay() {
    const data = this.getPlaybackData();
    if (!data) return;

    // Update frame image
    if (this.replayFrameImg) {
      this.replayFrameImg.src = data.frame;
    }

    // Update progress bar
    if (this.replayProgressBar) {
      this.replayProgressBar.value = String(this.playbackFrame);
    }

    // Update time display
    if (this.replayTimeDisplay) {
      const elapsed = this.playbackFrame / this.options.fps;
      this.replayTimeDisplay.textContent = `${this._formatTime(elapsed)} / ${this._formatTime(this.recordingDuration)}`;
    }

    // Update telemetry overlay
    if (this.replayTelemetryOverlay && data.telemetry) {
      const lines = [];
      for (const [channel, value] of Object.entries(data.telemetry.data)) {
        const hz = (value * 200).toFixed(1); // Scale to display Hz
        lines.push(`${channel}: ${hz} Hz`);
      }
      if (data.avatarState) {
        const { position, heading, speed } = data.avatarState;
        lines.push(`pos: [${position[0].toFixed(1)}, ${position[2].toFixed(1)}]`);
        // `speed` is the avatar's own scalar (u/s); an earlier version read
        // velocity[0], which is just the X-component, not magnitude.
        lines.push(`speed: ${(speed ?? 0).toFixed(2)} u/s`);
        lines.push(`heading: ${(heading * 180 / Math.PI).toFixed(0)}°`);
      }
      this.replayTelemetryOverlay.textContent = lines.join('\n');
    }
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Advance playback by dt seconds
   */
  updatePlayback(dt) {
    if (!this.isReplaying || this.frames.length === 0 || this.replayPaused) return;

    this.playbackTime += dt;
    const frameIndex = Math.floor(this.playbackTime * this.options.fps);

    if (frameIndex >= this.frames.length) {
      this.stopPlayback();
      return;
    }

    this.playbackFrame = frameIndex;
    if (this.onFrameUpdate) {
      this.onFrameUpdate(frameIndex, this.getPlaybackData());
    }
  }

  /**
   * Get current playback data (frame image + telemetry)
   */
  getPlaybackData() {
    const frameIndex = this.playbackFrame;
    return {
      frame: this.frames[frameIndex],
      telemetry: this.telemetry[frameIndex],
      avatarState: this.avatarState[frameIndex],
      progress: frameIndex / this.frames.length,
    };
  }

  /**
   * Export recording as MP4 video (requires ffmpeg.wasm).
   *
   * NOTE ON THE VERSION MISMATCH THIS REPLACES: the previous version pinned
   * `@ffmpeg/ffmpeg@0.12.10` (the modern class-based package: `new FFmpeg()`,
   * `.load()`) but called it with the OLD 0.11.x factory API --
   * `.FS('writeFile', ...)`, `.run(...)`, `.FS('readFile', ...)`. Those methods
   * do not exist on a 0.12.x instance; it threw `ffmpeg.FS is not a function`
   * the first time this ran. The 0.12.x equivalents used below are
   * `writeFile`/`exec`/`readFile`/`deleteFile`, all async.
   */
  async exportVideo(filename = 'madfly-recording.mp4') {
    if (this.frames.length === 0) {
      console.warn('No recording to export');
      return;
    }

    console.log('🎬 Encoding video...');

    // Load ffmpeg.wasm from jsdelivr (pinned, matching the rest of this file's
    // CDN choice) if not already loaded. 0.12.x needs its core/wasm fetched as
    // blob URLs -- passing bare CDN URLs to `.load()` runs into cross-origin
    // worker restrictions in most browsers.
    if (!this._ffmpeg) {
      console.log('📦 Loading ffmpeg...');
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'),
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm'),
      ]);
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      this._ffmpeg = ffmpeg;
    }
    const ffmpeg = this._ffmpeg;

    try {
      // Write frames to ffmpeg's in-memory filesystem.
      console.log('📝 Writing frames to filesystem...');
      const framerate = this.options.fps;

      for (let i = 0; i < this.frames.length; i++) {
        const imageData = this._dataUrlToUint8Array(this.frames[i]);
        await ffmpeg.writeFile(`frame_${String(i).padStart(6, '0')}.png`, imageData);

        if (i % 30 === 0) {
          console.log(`✓ Wrote frame ${i}/${this.frames.length}`);
        }
      }

      // Run ffmpeg to create video
      console.log('⚙️ Running ffmpeg...');
      await ffmpeg.exec([
        '-framerate', String(framerate),
        '-i', 'frame_%06d.png',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '23', // Quality (0-51, lower is better, 23 is default)
        filename,
      ]);

      // Read output video
      const data = await ffmpeg.readFile(filename);
      await ffmpeg.deleteFile(filename);

      // Clean up frame files
      for (let i = 0; i < this.frames.length; i++) {
        await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.png`);
      }

      // Download video. `data` is a Uint8Array view; wrap in a fresh Blob part
      // rather than passing `.buffer` directly, which can include padding
      // bytes from the wasm heap's underlying ArrayBuffer.
      const blob = new Blob([data], { type: 'video/mp4' });
      this._downloadBlob(blob, filename);

      console.log('✅ Video exported:', filename);
    } catch (err) {
      console.error('Video export error:', err);
      throw err;
    }
  }

  /**
   * Export telemetry data as JSON
   */
  exportTelemetry(filename = 'madfly-telemetry.json') {
    if (this.frames.length === 0) {
      console.warn('No recording to export');
      return;
    }

    const data = {
      metadata: {
        recordedAt: this.recordedAt,
        frameCount: this.frames.length,
        duration: this.recordingDuration,
        fps: this.options.fps,
        brainChannels: this.brainChannels,
      },
      telemetry: this.telemetry,
      avatarState: this.avatarState,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this._downloadBlob(blob, filename);
    console.log('✅ Telemetry exported:', filename);
  }

  /**
   * Get recording stats
   */
  getStats() {
    return {
      isRecording: this.isRecording,
      isReplaying: this.isReplaying,
      frameCount: this.frames.length,
      duration: this.recordingDuration,
      fps: this.frames.length > 0 ? this.frames.length / this.recordingDuration : 0,
      memoryMB: this._estimateMemory(),
      recordedAt: this.recordedAt,
    };
  }

  /**
   * Clear all recorded data
   */
  clear() {
    this.frames = [];
    this.telemetry = [];
    this.avatarState = [];
    this.brainChannels = [];
    this.recordedAt = null;
    this.recordingDuration = 0;
    console.log('🗑️ Recording cleared');
  }

  // --- Private helpers ---

  _estimateMemory() {
    // Rough estimate: average frame is ~50KB
    return (this.frames.length * 50) / 1024;
  }

  _dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
