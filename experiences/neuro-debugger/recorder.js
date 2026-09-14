/**
 * Tick-by-tick Telemetry Recorder & Replay Scrubber for Room 7 Neuro-Debugger
 */

export class TelemetryRecorder {
  constructor(lab) {
    this.lab = lab;
    this.recordedTrials = new Map(); // name -> frame array
    this.currentTrialName = null;
    this.frames = [];
    this.recording = false;
    this.isReplaying = false;
    this.replayIndex = 0;
  }

  startRecording(trialName) {
    this.currentTrialName = trialName;
    this.frames = [];
    this.recording = true;
    this.isReplaying = false;
  }

  recordFrame(extraState = {}) {
    if (!this.recording) return;
    const brain = this.lab.brain;
    const frame = {
      tick: this.frames.length,
      time: this.frames.length / (brain.tickHz || 60),
      // Core descending neurons
      DNa01_L: brain.readCalibrated('DNa01_L'),
      DNa01_R: brain.readCalibrated('DNa01_R'),
      steer: brain.readSteering('DNa01'),
      DNp09: brain.readCalibrated('DNp09'),   // Speed
      DNp01: brain.readPhasic('DNp01'),       // Escape
      DNp13: brain.readCalibrated('DNp13'),   // Courtship
      DNp06: brain.readPhasic('DNp06'),       // Feeding
      // Leg gesture
      legGesture: this.lab.legRig?.currentGesture || 'idle',
      ...extraState
    };
    this.frames.push(frame);
  }

  stopRecording() {
    this.recording = false;
    if (this.currentTrialName) {
      this.recordedTrials.set(this.currentTrialName, [...this.frames]);
    }
    return this.frames;
  }

  getTrial(trialName) {
    return this.recordedTrials.get(trialName) || [];
  }

  seek(index) {
    if (!this.frames.length) return null;
    this.replayIndex = Math.max(0, Math.min(index, this.frames.length - 1));
    this.isReplaying = true;
    return this.frames[this.replayIndex];
  }

  get currentFrame() {
    if (!this.frames.length) return null;
    return this.frames[this.replayIndex] || null;
  }

  get maxFrames() {
    return this.frames.length;
  }

  stopReplay() {
    this.isReplaying = false;
  }

  dispose() {
    this.recording = false;
    this.isReplaying = false;
    this.frames = [];
    this.recordedTrials.clear();
  }
}
