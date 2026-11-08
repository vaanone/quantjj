/* Vaan.One service worker — enables PWA install prompt and basic offline support.
 *
 * Strategy: network-first for navigations (so chart data is always fresh),
 *           cache-first for static assets (icons, css, js).
 */

const CACHE_VERSION = "vaanone-v1";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/logo.png",
];

// Install: pre-cache the app shell so the PWA can boot offline.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

// Activate: clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch:
//   - For navigations: try network first, fall back to cached "/" so the app
//     shell always launches even with no connection.
//   - For /api/* calls: always network (don't cache live data).
//   - For everything else (static assets): cache first, fall back to network.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip cross-origin requests (Yahoo Finance, Google Drive, Forex Factory, etc.)
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — they must always hit the network for fresh data.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match(req))),
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            // Only cache successful, same-origin, basic responses.
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached),
    ),
  );
});
