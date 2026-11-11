// Pure helper functions shared by the audio engine and the UI.
// No DOM or Web Audio access here, so everything can be unit tested in Node.

/** Number of discrete steps used by the frequency sliders (0 … SLIDER_STEPS). */
export const SLIDER_STEPS = 1000;

/** Low cut (high-pass) range in Hz. Slider position 0 means "Off". */
export const LOW_CUT_RANGE = Object.freeze({ min: 20, max: 1000 });

/** High cut (low-pass) range in Hz. Slider position SLIDER_STEPS means "Off". */
export const HIGH_CUT_RANGE = Object.freeze({ min: 1000, max: 20000 });

/** Input gain range in dB. */
export const GAIN_RANGE_DB = Object.freeze({ min: 0, max: 30 });

/** Lowest level shown on the meters, in dBFS. */
export const METER_FLOOR_DB = -60;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Decibels to linear amplitude (0 dB → 1, +6 dB → ~2). */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/** Linear amplitude to decibels. Returns -Infinity for 0. */
export function gainToDb(gain) {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

/** Map a 0…1 slider position onto a logarithmic frequency scale. */
export function sliderToLogFreq(t, min, max) {
  return min * Math.pow(max / min, clamp(t, 0, 1));
}

/** Inverse of sliderToLogFreq: frequency → 0…1 slider position. */
export function logFreqToSlider(freq, min, max) {
  return clamp(Math.log(freq / min) / Math.log(max / min), 0, 1);
}

/** Low cut slider (0…SLIDER_STEPS) → Hz, or null when switched off. */
export function lowCutFromSlider(position) {
  if (position <= 0) return null;
  return sliderToLogFreq(position / SLIDER_STEPS, LOW_CUT_RANGE.min, LOW_CUT_RANGE.max);
}

/** Hz (or null for off) → low cut slider position (0…SLIDER_STEPS). */
export function sliderFromLowCut(hz) {
  if (hz == null) return 0;
  const pos = Math.round(logFreqToSlider(hz, LOW_CUT_RANGE.min, LOW_CUT_RANGE.max) * SLIDER_STEPS);
  return Math.max(1, pos); // position 0 is reserved for "Off"
}

/** High cut slider (0…SLIDER_STEPS) → Hz, or null when switched off. */
export function highCutFromSlider(position) {
  if (position >= SLIDER_STEPS) return null;
  return sliderToLogFreq(position / SLIDER_STEPS, HIGH_CUT_RANGE.min, HIGH_CUT_RANGE.max);
}

/** Hz (or null for off) → high cut slider position (0…SLIDER_STEPS). */
export function sliderFromHighCut(hz) {
  if (hz == null) return SLIDER_STEPS;
  const pos = Math.round(logFreqToSlider(hz, HIGH_CUT_RANGE.min, HIGH_CUT_RANGE.max) * SLIDER_STEPS);
  return Math.min(SLIDER_STEPS - 1, pos); // top position is reserved for "Off"
}

/** Human-friendly frequency: "85 Hz", "1.5 kHz", "12 kHz", or "Off" for null. */
export function formatHz(hz) {
  if (hz == null) return 'Off';
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  const khz = hz / 1000;
  return `${khz < 10 ? khz.toFixed(1) : Math.round(khz)} kHz`;
}

/** Signed decibel label: "+12 dB", "0 dB". */
export function formatDb(db) {
  const rounded = Math.round(db);
  return `${rounded > 0 ? '+' : ''}${rounded} dB`;
}

/** RMS and peak (both linear, 0…1+) of a block of samples. */
export function computeLevel(samples) {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSquares += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  return { rms, peak };
}

/** Linear level → 0…1 meter fill, on a dB scale from METER_FLOOR_DB to 0 dBFS. */
export function levelToMeterFraction(level, floorDb = METER_FLOOR_DB) {
  const db = gainToDb(level);
  if (!Number.isFinite(db)) return 0;
  return clamp((db - floorDb) / -floorDb, 0, 1);
}
