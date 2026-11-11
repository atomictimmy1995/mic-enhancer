// Persisted user settings (localStorage), with validation of anything read back.

import { GAIN_RANGE_DB, HIGH_CUT_RANGE, LOW_CUT_RANGE } from './dsp-utils.js';

const STORAGE_KEY = 'mic-enhancer:settings:v1';

export const DEFAULTS = Object.freeze({
  gainDb: 12, // moderate boost to start with
  volume: 0.3, // start quiet, it's going straight into your ears
  lowCutHz: 100, // trims wind and handling rumble
  highCutHz: 10000, // trims mic hiss that gets louder with the boost
  headphoneNoticeSeen: false,
});

const isNumberIn = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function validate(raw) {
  const s = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  if (isNumberIn(raw.gainDb, GAIN_RANGE_DB.min, GAIN_RANGE_DB.max)) s.gainDb = raw.gainDb;
  if (isNumberIn(raw.volume, 0, 1)) s.volume = raw.volume;
  if (raw.lowCutHz === null || isNumberIn(raw.lowCutHz, LOW_CUT_RANGE.min, LOW_CUT_RANGE.max)) s.lowCutHz = raw.lowCutHz;
  if (raw.highCutHz === null || isNumberIn(raw.highCutHz, HIGH_CUT_RANGE.min, HIGH_CUT_RANGE.max)) s.highCutHz = raw.highCutHz;
  if (typeof raw.headphoneNoticeSeen === 'boolean') s.headphoneNoticeSeen = raw.headphoneNoticeSeen;
  return s;
}

export function loadSettings() {
  try {
    return validate(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validate(settings)));
  } catch {
    /* storage full or blocked (private mode): settings just won't persist */
  }
}
