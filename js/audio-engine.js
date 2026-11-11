// Web Audio graph for live microphone amplification.
//
//   mic → source → gain → high-pass (low cut) → low-pass (high cut) → limiter → volume → speakers/headphones
//            └→ input analyser                                                     └→ output analyser

import { GAIN_RANGE_DB, clamp, computeLevel, dbToGain } from './dsp-utils.js';

/** Time constant (seconds) for smoothing parameter changes, to avoid clicks. */
const RAMP_SECONDS = 0.02;

/** Frequency used for the high-pass filter when the low cut is "Off". */
const LOW_CUT_OFF_HZ = 10;

/** Filter Q for a flat (Butterworth) 12 dB/octave slope. */
const BUTTERWORTH_Q = Math.SQRT1_2;

/** Analyser block size: ~21 ms at 48 kHz, plenty for a level meter. */
const ANALYSER_SIZE = 1024;

const MIC_CONSTRAINTS = {
  audio: {
    // Turn off phone/browser voice processing so we get the raw, unaltered signal.
    // Automatic gain control in particular would fight the gain slider.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  video: false,
};

export class EngineError extends Error {
  /**
   * @param {'unsupported'|'insecure'|'denied'|'no-mic'|'busy'|'unknown'} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.cause = cause;
  }
}

function toEngineError(err) {
  if (err instanceof EngineError) return err;
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new EngineError(
        'denied',
        'Microphone access is blocked. Allow the microphone for this site in your browser settings, then tap Start again.',
        err,
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new EngineError('no-mic', 'No microphone was found on this device.', err);
    case 'NotReadableError':
    case 'AbortError':
      return new EngineError(
        'busy',
        'The microphone could not be opened. Another app (a call or a recorder) may be using it.',
        err,
      );
    case 'NotSupportedError':
      return new EngineError(
        'unsupported',
        'This browser cannot use the microphone here. Try an up-to-date Chrome, Safari or Firefox.',
        err,
      );
    default:
      return new EngineError('unknown', `Could not start audio: ${err?.message || err}`, err);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.nodes = null;
    this.source = null;
    this.params = { gainDb: 12, volume: 0.3, lowCutHz: null, highCutHz: null };

    /** Called when audio stops by itself (mic unplugged, permission revoked, …). */
    this.onunexpectedstop = null;

    this._inputBuffer = null;
    this._outputBuffer = null;
    this._onTrackEnded = () => {
      if (!this.stream) return;
      this.stop();
      this.onunexpectedstop?.(new EngineError('busy', 'The microphone stopped. Tap Start to try again.'));
    };
  }

  static isSupported() {
    return Boolean(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.getUserMedia &&
        (window.AudioContext || window.webkitAudioContext),
    );
  }

  get isRunning() {
    return Boolean(this.stream && this.ctx && this.ctx.state === 'running');
  }

  /** Must be called from a user gesture (tap/click) so the browser allows audio. */
  async start() {
    if (this.stream) return;
    if (!window.isSecureContext) {
      throw new EngineError('insecure', 'Microphone access needs a secure (https://) connection. Open the app over HTTPS.');
    }
    if (!AudioEngine.isSupported()) {
      throw new EngineError('unsupported', 'This browser cannot access the microphone. Try an up-to-date Chrome, Safari or Firefox.');
    }

    // Create and resume the context *before* awaiting the permission prompt,
    // while we are still inside the user gesture (required by iOS Safari).
    if (!this.ctx) this._createGraph();
    const resumed = this.ctx.resume();

    // iOS Safari 16.4+: ask for a session that records and plays at the same time.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
    } catch {
      /* not supported, ignore */
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      await resumed;
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      throw toEngineError(err);
    }

    this.stream = stream;
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', this._onTrackEnded);

    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.nodes.inputGain);
    this.source.connect(this.nodes.inputAnalyser);

    // Ramp the output in from silence so starting never "pops".
    const { volume } = this.nodes;
    const now = this.ctx.currentTime;
    volume.gain.cancelScheduledValues(now);
    volume.gain.setValueAtTime(0, now);
    volume.gain.setTargetAtTime(this.params.volume, now, 0.05);

    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this._onTrackEnded);
        track.stop();
      }
      this.stream = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  setGainDb(db) {
    this.params.gainDb = clamp(db, GAIN_RANGE_DB.min, GAIN_RANGE_DB.max);
    this._ramp(this.nodes?.inputGain.gain, dbToGain(this.params.gainDb));
  }

  /** @param {number} volume 0…1 */
  setVolume(volume) {
    this.params.volume = clamp(volume, 0, 1);
    this._ramp(this.nodes?.volume.gain, this.params.volume);
  }

  /** @param {number|null} hz cutoff in Hz, or null to switch the low cut off */
  setLowCut(hz) {
    this.params.lowCutHz = hz;
    if (this.nodes) this._ramp(this.nodes.lowCut.frequency, this._lowCutFrequency());
  }

  /** @param {number|null} hz cutoff in Hz, or null to switch the high cut off */
  setHighCut(hz) {
    this.params.highCutHz = hz;
    if (this.nodes) this._ramp(this.nodes.highCut.frequency, this._highCutFrequency());
  }

  /** Current meter readings (linear 0…1) plus the limiter's gain reduction in dB (≤ 0). */
  getLevels() {
    if (!this.nodes || !this.isRunning) {
      return { input: { rms: 0, peak: 0 }, output: { rms: 0, peak: 0 }, limiterReductionDb: 0 };
    }
    const { inputAnalyser, outputAnalyser, limiter } = this.nodes;
    inputAnalyser.getFloatTimeDomainData(this._inputBuffer);
    outputAnalyser.getFloatTimeDomainData(this._outputBuffer);
    const reduction = limiter.reduction;
    return {
      input: computeLevel(this._inputBuffer),
      output: computeLevel(this._outputBuffer),
      // Older Chrome exposed reduction as an AudioParam.
      limiterReductionDb: typeof reduction === 'number' ? reduction : reduction?.value ?? 0,
    };
  }

  _createGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const inputGain = ctx.createGain();

    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.Q.value = BUTTERWORTH_Q;

    const highCut = ctx.createBiquadFilter();
    highCut.type = 'lowpass';
    highCut.Q.value = BUTTERWORTH_Q;

    // Safety limiter: stops a sudden loud sound from being amplified to painful levels.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    const volume = ctx.createGain();

    const inputAnalyser = ctx.createAnalyser();
    inputAnalyser.fftSize = ANALYSER_SIZE;
    const outputAnalyser = ctx.createAnalyser();
    outputAnalyser.fftSize = ANALYSER_SIZE;

    inputGain.connect(lowCut).connect(highCut).connect(limiter).connect(volume).connect(ctx.destination);
    volume.connect(outputAnalyser);

    this.nodes = { inputGain, lowCut, highCut, limiter, volume, inputAnalyser, outputAnalyser };
    this._inputBuffer = new Float32Array(ANALYSER_SIZE);
    this._outputBuffer = new Float32Array(ANALYSER_SIZE);

    // Apply the current settings immediately (no ramp) to the freshly built graph.
    inputGain.gain.value = dbToGain(this.params.gainDb);
    lowCut.frequency.value = this._lowCutFrequency();
    highCut.frequency.value = this._highCutFrequency();
    volume.gain.value = 0; // faded in by start()
  }

  _lowCutFrequency() {
    return this.params.lowCutHz == null ? LOW_CUT_OFF_HZ : this.params.lowCutHz;
  }

  _highCutFrequency() {
    const nyquist = this.ctx.sampleRate / 2;
    return this.params.highCutHz == null ? nyquist : Math.min(this.params.highCutHz, nyquist);
  }

  _ramp(param, value) {
    if (!param || !this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, RAMP_SECONDS);
  }
}
