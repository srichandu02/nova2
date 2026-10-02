/* NOVA Smart Local — offline cache. Versioned cache-first: assets are fetched once, then served locally. */
const CACHE = "nova-smart-local-v4";
const ASSETS = ["./", "index.html", "styles.css", "logic.js", "views.js", "app.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
    if (res.ok) caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
    return res;
  })).catch(() => caches.match("index.html")));
});
