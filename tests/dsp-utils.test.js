import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLIDER_STEPS,
  LOW_CUT_RANGE,
  HIGH_CUT_RANGE,
  clamp,
  dbToGain,
  gainToDb,
  sliderToLogFreq,
  logFreqToSlider,
  lowCutFromSlider,
  sliderFromLowCut,
  highCutFromSlider,
  sliderFromHighCut,
  formatHz,
  formatDb,
  computeLevel,
  levelToMeterFraction,
} from '../js/dsp-utils.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('clamp keeps values inside the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('dbToGain and gainToDb are inverses', () => {
  assert.equal(dbToGain(0), 1);
  close(dbToGain(20), 10);
  close(dbToGain(-20), 0.1);
  close(dbToGain(6), 1.9952623149688795);
  for (const db of [-40, -6, 0, 3, 12, 30]) close(gainToDb(dbToGain(db)), db);
  assert.equal(gainToDb(0), -Infinity);
});

test('log frequency mapping hits the endpoints and geometric midpoint', () => {
  close(sliderToLogFreq(0, 20, 1000), 20);
  close(sliderToLogFreq(1, 20, 1000), 1000);
  close(sliderToLogFreq(0.5, 20, 1000), Math.sqrt(20 * 1000)); // ≈ 141 Hz
  close(sliderToLogFreq(-1, 20, 1000), 20); // clamped
  close(sliderToLogFreq(2, 20, 1000), 1000); // clamped
  for (const f of [20, 50, 141.42, 500, 1000]) close(sliderToLogFreq(logFreqToSlider(f, 20, 1000), 20, 1000), f, 1e-6);
});

test('low cut slider: 0 is Off, the rest maps 20 Hz … 1 kHz', () => {
  assert.equal(lowCutFromSlider(0), null);
  close(lowCutFromSlider(SLIDER_STEPS), LOW_CUT_RANGE.max);
  close(lowCutFromSlider(SLIDER_STEPS / 2), Math.sqrt(LOW_CUT_RANGE.min * LOW_CUT_RANGE.max));
  assert.equal(sliderFromLowCut(null), 0);
  assert.equal(sliderFromLowCut(LOW_CUT_RANGE.max), SLIDER_STEPS);
  assert.equal(sliderFromLowCut(LOW_CUT_RANGE.min), 1, 'lowest frequency must not collide with Off');
  const pos = sliderFromLowCut(100);
  close(lowCutFromSlider(pos), 100, 1);
});

test('high cut slider: top is Off, the rest maps 1 kHz … 20 kHz', () => {
  assert.equal(highCutFromSlider(SLIDER_STEPS), null);
  close(highCutFromSlider(0), HIGH_CUT_RANGE.min);
  assert.equal(sliderFromHighCut(null), SLIDER_STEPS);
  assert.equal(sliderFromHighCut(HIGH_CUT_RANGE.min), 0);
  assert.equal(sliderFromHighCut(HIGH_CUT_RANGE.max), SLIDER_STEPS - 1, 'highest frequency must not collide with Off');
  const pos = sliderFromHighCut(10000);
  close(highCutFromSlider(pos), 10000, 50);
});

test('formatHz', () => {
  assert.equal(formatHz(null), 'Off');
  assert.equal(formatHz(85.4), '85 Hz');
  assert.equal(formatHz(999.4), '999 Hz');
  assert.equal(formatHz(1500), '1.5 kHz');
  assert.equal(formatHz(12345), '12 kHz');
});

test('formatDb', () => {
  assert.equal(formatDb(0), '0 dB');
  assert.equal(formatDb(12), '+12 dB');
  assert.equal(formatDb(-6.4), '-6 dB');
});

test('computeLevel returns RMS and peak', () => {
  assert.deepEqual(computeLevel(new Float32Array(0)), { rms: 0, peak: 0 });
  const square = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
  const { rms, peak } = computeLevel(square);
  close(rms, 0.5, 1e-7);
  close(peak, 0.5, 1e-7);
  const spike = Float32Array.from([0, 0, -0.9, 0]);
  close(computeLevel(spike).peak, 0.9, 1e-7);
});

test('levelToMeterFraction maps -60…0 dBFS onto 0…1', () => {
  assert.equal(levelToMeterFraction(0), 0);
  assert.equal(levelToMeterFraction(1), 1);
  assert.equal(levelToMeterFraction(2), 1);
  close(levelToMeterFraction(dbToGain(-30)), 0.5);
  assert.equal(levelToMeterFraction(dbToGain(-90)), 0);
});
