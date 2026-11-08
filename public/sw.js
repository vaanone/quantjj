/* Vaan.One service worker — enables PWA install prompt, basic offline
 * support, and Web Push notifications.
 *
 * Strategy: network-first for navigations (so chart data is always fresh),
 *           cache-first for static assets (icons, css, js).
 */

const CACHE_VERSION = "vaanone-v2";
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

// Activate: clean up old caches + claim clients immediately so the SW
// can receive push events as soon as it activates.
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

// ---------- Web Push handlers ----------

// 'push' event fires when the push service delivers a message.
// We parse the JSON payload and show a system notification.
self.addEventListener("push", (event) => {
  let payload = { title: "Vaan.One Alert", body: "Price alert triggered" };
  try {
    if (event.data) {
      const text = event.data.text();
      payload = JSON.parse(text);
    }
  } catch (e) {
    // Not JSON — use the raw text as the body.
    payload = { title: "Vaan.One Alert", body: event.data ? event.data.text() : "Price alert triggered" };
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "vaan-alert",
    renotify: true,
    data: {
      url: payload.url || "/",
    },
    vibrate: [200, 100, 200, 100, 200], // double-beep pattern on Android
    requireInteraction: false, // auto-dismiss after ~5s; change to true for sticky alerts
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options),
  );
});

// 'notificationclick' — focus or open the chart when the user taps the
// notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // If a tab is already open, focus it.
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          // Optionally navigate to the target URL.
          if (targetUrl && client.url !== self.location.origin + targetUrl) {
            client.navigate(targetUrl);
          }
          return;
        }
      }

      // Otherwise open a new tab.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
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
