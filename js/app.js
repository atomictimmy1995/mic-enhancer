// UI wiring: sliders ↔ settings ↔ audio engine, meters, wake lock and error messages.

import { AudioEngine } from './audio-engine.js';
import {
  formatDb,
  formatHz,
  highCutFromSlider,
  levelToMeterFraction,
  lowCutFromSlider,
  sliderFromHighCut,
  sliderFromLowCut,
} from './dsp-utils.js';
import { DEFAULTS, loadSettings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

const ui = {
  power: $('power'),
  powerLabel: $('power-label'),
  message: $('message'),
  meterIn: $('meter-in'),
  meterOut: $('meter-out'),
  clip: $('clip'),
  limit: $('limit'),
  reset: $('reset'),
  notice: $('headphone-notice'),
  gain: $('gain'),
  gainValue: $('gain-value'),
  volume: $('volume'),
  volumeValue: $('volume-value'),
  lowcut: $('lowcut'),
  lowcutValue: $('lowcut-value'),
  highcut: $('highcut'),
  highcutValue: $('highcut-value'),
};

const engine = new AudioEngine();
let settings = loadSettings();
let starting = false;
let wakeLock = null;
let meterFrame = 0;
let clipHoldUntil = 0;
let limitHoldUntil = 0;

/* ---------- controls ---------- */

// Each control: how to read its value from the slider, how to set the slider
// from a stored value, how to label it, and which engine setter to call.
const controls = [
  {
    input: ui.gain,
    output: ui.gainValue,
    key: 'gainDb',
    fromSlider: (v) => v,
    toSlider: (db) => db,
    format: formatDb,
    apply: (db) => engine.setGainDb(db),
  },
  {
    input: ui.volume,
    output: ui.volumeValue,
    key: 'volume',
    fromSlider: (v) => v / 100,
    toSlider: (vol) => Math.round(vol * 100),
    format: (vol) => `${Math.round(vol * 100)}%`,
    apply: (vol) => engine.setVolume(vol),
  },
  {
    input: ui.lowcut,
    output: ui.lowcutValue,
    key: 'lowCutHz',
    fromSlider: lowCutFromSlider,
    toSlider: sliderFromLowCut,
    format: formatHz,
    apply: (hz) => engine.setLowCut(hz),
  },
  {
    input: ui.highcut,
    output: ui.highcutValue,
    key: 'highCutHz',
    fromSlider: highCutFromSlider,
    toSlider: sliderFromHighCut,
    format: formatHz,
    apply: (hz) => engine.setHighCut(hz),
  },
];

function showValue(control, value) {
  const text = control.format(value);
  control.output.value = text;
  const { input } = control;
  input.setAttribute('aria-valuetext', text);
  const fill = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty('--fill', `${fill}%`);
}

function applyAllSettings() {
  for (const c of controls) {
    const value = settings[c.key];
    c.input.value = String(c.toSlider(value));
    showValue(c, value);
    c.apply(value);
  }
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 250);
}

for (const c of controls) {
  c.input.addEventListener('input', () => {
    const value = c.fromSlider(Number(c.input.value));
    settings[c.key] = value;
    showValue(c, value);
    c.apply(value);
    scheduleSave();
  });
}

ui.reset.addEventListener('click', () => {
  settings = { ...DEFAULTS, headphoneNoticeSeen: settings.headphoneNoticeSeen };
  applyAllSettings();
  saveSettings(settings);
});

/* ---------- messages ---------- */

function showMessage(text, kind = 'error') {
  ui.message.textContent = text;
  ui.message.dataset.kind = kind;
  ui.message.hidden = false;
}

function clearMessage() {
  ui.message.hidden = true;
  ui.message.textContent = '';
}

/* ---------- start / stop ---------- */

function setPowerState(state) {
  // state: 'off' | 'starting' | 'on'
  ui.power.dataset.state = state;
  ui.power.setAttribute('aria-pressed', String(state === 'on'));
  ui.power.disabled = state === 'starting';
  ui.powerLabel.textContent = state === 'on' ? 'Stop' : state === 'starting' ? 'Starting…' : 'Start';
  document.body.classList.toggle('is-live', state === 'on');
}

async function startAudio() {
  if (starting || engine.isRunning) return;
  starting = true;
  clearMessage();
  setPowerState('starting');
  try {
    await engine.start();
    setPowerState('on');
    startMeters();
    requestWakeLock();
  } catch (err) {
    engine.stop();
    setPowerState('off');
    showMessage(err.message || String(err));
  } finally {
    starting = false;
  }
}

function stopAudio() {
  engine.stop();
  setPowerState('off');
  stopMeters();
  releaseWakeLock();
}

engine.onunexpectedstop = (err) => {
  setPowerState('off');
  stopMeters();
  releaseWakeLock();
  showMessage(err.message);
};

ui.power.addEventListener('click', () => {
  if (engine.isRunning) {
    stopAudio();
  } else if (!settings.headphoneNoticeSeen && typeof ui.notice.showModal === 'function') {
    ui.notice.showModal();
  } else {
    startAudio();
  }
});

// Start straight from the confirm button's click so we're still inside the user gesture.
ui.notice.querySelector('button[value="confirm"]').addEventListener('click', (event) => {
  event.preventDefault();
  ui.notice.close('confirm');
  settings.headphoneNoticeSeen = true;
  saveSettings(settings);
  startAudio();
});

/* ---------- meters ---------- */

function renderMeters() {
  const now = performance.now();
  const { input, output, limiterReductionDb } = engine.getLevels();

  ui.meterIn.style.transform = `scaleX(${levelToMeterFraction(input.peak)})`;
  ui.meterOut.style.transform = `scaleX(${levelToMeterFraction(output.peak)})`;

  if (input.peak >= 0.98) clipHoldUntil = now + 1000;
  if (limiterReductionDb <= -1) limitHoldUntil = now + 300;
  ui.clip.classList.toggle('is-on', now < clipHoldUntil);
  ui.limit.classList.toggle('is-on', now < limitHoldUntil);

  meterFrame = requestAnimationFrame(renderMeters);
}

function startMeters() {
  cancelAnimationFrame(meterFrame);
  meterFrame = requestAnimationFrame(renderMeters);
}

function stopMeters() {
  cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  ui.meterIn.style.transform = 'scaleX(0)';
  ui.meterOut.style.transform = 'scaleX(0)';
  ui.clip.classList.remove('is-on');
  ui.limit.classList.remove('is-on');
}

/* ---------- screen wake lock ---------- */

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    /* denied (e.g. battery saver): audio still works, the screen may just dim */
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Browsers drop the wake lock when the page is hidden; take it back when we return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.isRunning) requestWakeLock();
});

/* ---------- init ---------- */

applyAllSettings();
setPowerState('off');

if (!window.isSecureContext) {
  showMessage('Microphone access needs a secure (https://) connection. Open this app over HTTPS.');
} else if (!AudioEngine.isSupported()) {
  showMessage('This browser cannot access the microphone. Try an up-to-date Chrome, Safari or Firefox.');
}
