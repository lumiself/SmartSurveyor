/* SmartSurveyor service worker
 * Offline-first app shell + runtime caching.
 *
 * Paths are RELATIVE to the service-worker location so the PWA works whether
 * it is served from a custom domain or a GitHub Pages project subpath
 * (e.g. https://user.github.io/smartsurveyor/).
 *
 * Bump CACHE_VERSION whenever the shell changes to roll out an update.
 */
const CACHE_VERSION = "v8";
const CACHE_NAME = `smartsurveyor-${CACHE_VERSION}`;

// Cross-origin runtime deps we deliberately cache (cache-first) so a tool's
// compute engine keeps working offline after the first online load. These are
// requested with `crossorigin="anonymous"`, so the responses are CORS (not
// opaque) and safe to inspect/replay. We never cache the live GNSS data feeds
// (CelesTrak) here — the app handles those, with its own freshness logic.
const RUNTIME_DEPS = [
  "https://cdn.jsdelivr.net/npm/satellite.js@",
  "https://unpkg.com/satellite.js@",
];

// Core app shell + all tool files — cached up-front so every page works fully
// offline, and so that bumping CACHE_VERSION atomically replaces ALL files
// (including tool JS) rather than leaving stale tool scripts in a lazy cache.
const CORE_ASSETS = [
  "./tools/navigator/index.html",
  "./tools/navigator/navigator.js",
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/styles.css",
  "./assets/js/app.js",
  "./assets/js/tools.js",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/img/creator.jpg",
  "./tools/coordinate-converter/index.html",
  "./tools/coordinate-converter/coordinate-converter.js",
  "./tools/gnss-planner/index.html",
  "./tools/gnss-planner/gnss-planner.js",
  "./tools/bearing-distance/index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("smartsurveyor-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Allowlisted cross-origin deps: cache-first so the engine loads offline.
  if (RUNTIME_DEPS.some((prefix) => request.url.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Only handle remaining same-origin requests; let the browser deal with the rest.
  if (url.origin !== self.location.origin) return;

  // Navigations (and tool pages): network-first so fresh content wins, but
  // fall back to cache — then to the landing page — when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("./index.html");
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate for instant loads + background refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
