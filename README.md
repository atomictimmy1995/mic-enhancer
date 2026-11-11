# mic-enhancer

A simple web app that turns your phone into a hearing helper. It picks up sound with the
phone's microphone, boosts it, and plays it live into your headphones, so you can hear quiet
or hard-to-hear things around you.

## Features

- **Gain**: boosts the microphone, 0 to +30 dB.
- **Volume**: sets how loud it plays in your headphones, 0–100 %.
- **EQ**:
  - **Low cut** (high-pass, 20 Hz – 1 kHz, or Off) trims rumble, wind and traffic.
  - **High cut** (low-pass, 1 kHz – 20 kHz, or Off) trims hiss and harsh sounds.
- **Safety limiter** is always on, so sudden loud sounds aren't amplified to painful levels.
- **Level meters** for input and output. The *Clip* light means the mic itself is overloading,
  and the *Limit* light means the limiter is turning loud sounds down.
- Settings are remembered between visits. The screen is kept awake while it's running.
- Can be added to your home screen and opened full-screen like an app.

## Using it

1. **Put on headphones first.** Through the phone speaker the sound loops back into the mic
   and squeals. Wired headphones work best. Bluetooth adds a delay (often 150–300 ms) that
   makes the sound feel out of sync.
2. Open the app and tap **Start**. Allow microphone access when asked.
3. Raise **Gain** until quiet sounds are clear. Use **Volume** to set a comfortable level.
4. Use **Low cut** to remove rumble and wind, and **High cut** to soften hiss.

> **Protect your hearing.** Start with the volume low and keep your phone's own volume
> moderate. The limiter helps, but it can't make loud listening safe for long periods.

## How it works

Plain HTML, CSS and JavaScript using the Web Audio API. There is no framework, no build step
and nothing to install at runtime.

```
mic (echo cancellation, noise suppression and auto gain off)
  → Gain → Low cut (high-pass) → High cut (low-pass) → Limiter → Volume → headphones
```

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page layout and mobile-first styling |
| `js/app.js` | Wires the controls, meters, wake lock and messages together |
| `js/audio-engine.js` | Builds the Web Audio graph and handles start/stop |
| `js/settings.js` | Saves and loads settings in `localStorage` |
| `js/dsp-utils.js` | Pure helpers (dB conversion, log-scale sliders, levels), unit tested |
| `scripts/serve.js` | Zero-dependency local web server |

## Running locally

Requires Node.js 18 or later.

```sh
npm start   # serves the app at http://localhost:8080
npm test    # runs the unit tests
```

Browsers only allow microphone access on secure pages. `http://localhost` counts as secure,
but your computer's LAN address (e.g. `http://192.168.1.20:8080`) does not, so opening that
on your phone won't work. To try it on a phone, either:

- deploy it to GitHub Pages (below) and open the `https://` link, or
- on Android, use Chrome's port forwarding (`chrome://inspect` → *Port forwarding*,
  `8080 → localhost:8080`) and open `http://localhost:8080` on the phone.

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site on every
push to `main`. Turn it on once in the repository's **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The app will then be at
`https://<your-username>.github.io/mic-enhancer/`.

## Browser support and limits

- Built for current Chrome (Android) and Safari (iOS 16.4+). Firefox should also work but
  hasn't been tested.
- Phones handle the mic differently. Some (iOS in particular) may still apply their own
  processing even though the app asks for the raw signal.
- Bluetooth delay comes from the headphones and the phone's OS, so a web page can't remove it.
- Audio may stop if you switch apps or lock the phone, depending on the browser.
