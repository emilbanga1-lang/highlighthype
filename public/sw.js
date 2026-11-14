/* HighlightHype service worker (Round 161, 2026-11-14).
   Deliberately conservative — three rules and nothing else:
   1. Navigations (HTML) are NETWORK-FIRST: a fresh deploy is
      what every visitor gets; the cached shell is only an
      offline fallback.
   2. ?v=-pinned static assets (app.js / styles.css — the pin
      IS the version, so a cached copy can never be stale) and
      the brand images / PWA icons are CACHE-FIRST.
   3. Everything else passes through untouched: /api/*, media
      and video files, /uploads/*, /moderate links, POSTs, and
      anything cross-origin. No offline video, no background
      sync, no push plumbing (a separate future round).
   HH_SW_VERSION is the single version constant: bump it in
   the same commit that bumps the ?v= asset pin, so old caches
   are dropped on activate and no visitor is stranded on a
   stale app shell. */
const HH_SW_VERSION = "r163-v162";
const HH_CACHE161 = "hh-static-" + HH_SW_VERSION;
const HH_PRECACHE161 = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(HH_CACHE161)
      .then((cache) => cache.addAll(HH_PRECACHE161))
      .then(() => self.skipWaiting())
      .catch(() => { /* precache is a nicety; never block install */ })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== HH_CACHE161).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .catch(() => { /* a lingering old cache is harmless */ })
  );
});

function hhNetworkFirst161(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(HH_CACHE161).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    })
    .catch(() => caches.match(request).then((hit) => hit || caches.match("/")));
}

function hhCacheFirst161(request) {
  return caches.match(request).then((hit) => {
    if (hit) return hit;
    return fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(HH_CACHE161).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    });
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // cross-origin: untouched
  if (url.pathname.startsWith("/api/")) return; // API: untouched
  if (url.pathname.startsWith("/moderate")) return; // moderation links: untouched
  if (url.pathname.startsWith("/uploads/")) return; // play media + posters: untouched
  if (/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return; // video files: untouched
  if (request.mode === "navigate") {
    event.respondWith(hhNetworkFirst161(request));
    return;
  }
  const pinned161 = /[?&]v=/.test(url.search) && /\.(js|css)$/i.test(url.pathname);
  const brandImage161 = /\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname);
  if (pinned161 || url.pathname.startsWith("/icons/") || brandImage161) {
    event.respondWith(hhCacheFirst161(request));
  }
});
