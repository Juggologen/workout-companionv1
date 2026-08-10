/**
 * sw.js -- service worker.
 *
 * Two jobs: make the app installable to a phone's home screen, and keep it
 * working when the gym has no signal.
 *
 * The strategy is **network-first with a cache fallback**. That ordering is
 * deliberate: cache-first is faster but means a friend keeps running an old
 * copy until the cache is invalidated, and the whole point of hosting this is
 * that you can push a fix and have everyone get it. Network-first costs one
 * round trip when online and falls back to the last good copy when not.
 *
 * Bumping VERSION is not required for people to receive updates — it only
 * purges the old cache. Bump it when the file list below changes.
 */

const VERSION = 'v3';
const CACHE = `workout-companion-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/engine.js',
  './src/data.js',
  './src/store.js',
  './src/i18n.js',
  './src/ui.js',
  './src/muscles.js',
  './data/exercises.json',
  './data/warmups.json',
  './data/mobility.json',
  './data/prescriptions.json',
  './data/vocabulary.json',
  './data/hypertrophy.json',
  './data/complexity.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only same-origin GETs. The Google Fonts stylesheet is left to the browser:
  // it has its own caching, and the app falls back to the system sans anyway.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation to any path should still open the app when offline.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
