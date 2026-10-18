/**
 * Service worker source. The build (targets/web/shell-plugin.js) replaces the
 * two placeholders with the build's asset list and a content hash.
 *
 * Scope: the app shell only (HTML, JS, CSS, icons, category.json, book.json).
 * Translations live in IndexedDB; cross-origin requests (the catalog and
 * translation downloads) are never intercepted.
 */
const CACHE = 'lai-shell-__CACHE_VERSION__';
const PRECACHE = /*__PRECACHE__*/[];

self.addEventListener('install', (event) => {
  // Past the HTTP cache: a host that lets browsers keep files for minutes
  // (GitHub Pages: max-age=600) would otherwise hand this build's cache the
  // previous index.html, whose hashed assets this build no longer has.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('lai-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks for the new version only when the reader agrees to it.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'take-over') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first so a deployed update is seen; cached shell when offline.
    event.respondWith(fetch(request).catch(async () => (await caches.match('./index.html')) ?? Response.error()));
    return;
  }
  event.respondWith((async () => (await caches.match(request)) ?? fetch(request))());
});
