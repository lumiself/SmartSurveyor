# SmartSurveyor

**Offline-first field tools for land surveyors — one installable PWA, hosted on GitHub Pages.**

SmartSurveyor is a Progressive Web App: a single home page that lists every
tool, with each tool living in its own subfolder. Once opened with a
connection, it installs to the home screen and works **completely offline** on
iOS, Android, and desktop.

## ✨ Features

- **Offline-first** — service worker caches the app shell + each tool you visit.
- **Installable** — add-to-home-screen on iOS/Android, install on desktop.
- **iOS-optimised** — safe-area (notch) handling, standalone status bar, real
  `apple-touch-icon`, no pinch-zoom lockout, 44px touch targets, no tap delay.
- **Zero dependencies** — plain HTML/CSS/JS, no build step, no tracking, no ads.
- **Data-driven tool list** — add a tool by editing one file.

## 📁 Project structure

```
/
├── index.html                  ← landing page (hero · tools · about)
├── manifest.webmanifest        ← PWA manifest
├── sw.js                       ← service worker (offline cache)
├── .nojekyll                   ← serve files as-is on GitHub Pages
├── assets/
│   ├── css/styles.css          ← field/industrial theme
│   ├── js/tools.js             ← TOOL REGISTRY (edit this to add tools)
│   ├── js/app.js               ← rendering, install prompt, SW, offline state
│   └── icons/                  ← SVG + generated PNG icons (+ generator script)
└── tools/
    ├── coordinate-converter/index.html
    └── bearing-distance/index.html
```

## ➕ Adding a new tool

1. Create a folder and page: `tools/<slug>/index.html`
   (copy an existing tool page as a starting point — it already wires in the
   shared theme and offline cache).
2. Add **one entry** to `assets/js/tools.js`:

   ```js
   {
     slug: "area-calculator",
     name: "Area Calculator",
     tagline: "Polygon area from coordinates",
     description: "Compute area by the shoelace formula, offline.",
     href: "tools/area-calculator/",
     status: "ready",        // "ready" = live, "soon" = greyed-out placeholder
     tags: ["area", "cogo"],
     icon: "M3 3h18v18H3z"   // 24×24 SVG path data
   }
   ```

3. Bump `CACHE_VERSION` in `sw.js` so clients pick up the new shell.

The card renders on the landing page automatically.

## 🎨 Icons

Icons are generated from scratch (no design tools needed) by a pure-Python
script:

```bash
python3 assets/icons/generate_icons.py
```

This (re)creates `icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`.
Edit the palette/glyph at the top of the script, or replace `icon.svg` and the
PNGs with your own artwork.

## 🚀 Deploy to GitHub Pages

1. Push to the default branch.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   pick your branch and the `/ (root)` folder.
3. Your site goes live at `https://<user>.github.io/<repo>/`.

All paths in the app are **relative**, so it works correctly under the GitHub
Pages project subpath without any extra configuration.

> ℹ️ Service workers require HTTPS — GitHub Pages provides this automatically.
> To test locally, run a static server (e.g. `python3 -m http.server`) and open
> `http://localhost:8000` (localhost is treated as a secure context).

## 🛠 Local development

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## 📍 Roadmap

- [x] **GNSS Planner** — live satellites in view, sky plot & DOP (real orbital
  data) + live device fix accuracy
- [x] Coordinate Converter (scaffolded)
- [x] Bearing & Distance (scaffolded)
- [ ] More tools — coming soon

### 🛰 About the GNSS Planner

The web's Geolocation API only exposes lat/lon/accuracy — never a satellite
count — and Web Bluetooth/Serial don't work on iOS, so a browser can't read a
receiver's *tracked* satellites on every device. Instead this tool does the
standard GNSS mission-planning maths: it fetches live orbital elements (TLEs)
from [CelesTrak](https://celestrak.org/) for GPS, GLONASS, Galileo and BeiDou,
propagates every satellite to the current instant with SGP4
([satellite.js](https://github.com/shashwatak/satellite-js)), and reports the
satellites above your horizon, a polar sky plot and PDOP/HDOP/VDOP geometry.
That's *predicted-in-view*, not receiver-locked — exactly what you want when
deciding whether a benchmark is a good spot for a base. Alongside it, the live
**device fix accuracy** (in metres, from the Geolocation API) gives a real
on-site signal of current fix health. TLEs are cached on-device so it keeps
working through a dropout, and the SGP4 engine is cached by the service worker
after first load.

---

Built and maintained by **Dereck Dube** · [LinkedIn](https://www.linkedin.com/in/dereck-khaya-dube)
