/* ==========================================================================
   service-worker.js — caches the app shell so LifeHub still opens with zero
   signal when you're offline. Your actual data lives in IndexedDB, not in
   this cache. Fetches are network-first: whenever you're online, you always
   get the latest deployed files; the cache only kicks in as a fallback once
   there's no connection.

   Bump CACHE_VERSION if you ever remove or rename a file in SHELL_FILES —
   that's what triggers cleanup of the old, now-orphaned cache entries.
   ========================================================================== */

const CACHE_VERSION = 'lifehub-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/vendor/dexie.min.js',
  './js/db.js',
  './js/app.js',
  './js/sync/drive-auth.js',
  './js/sync/drive-sync.js',
  './js/views/dashboard.js',
  './js/views/expenses.js',
  './js/views/notes.js',
  './js/views/medications.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests (Google sign-in, Drive API) —
  // those must always hit the real network.
  if (url.origin !== self.location.origin) return;

  if (event.request.method !== 'GET') return;

  // Network-first, falling back to cache only when there's no connection.
  // (Previously cache-first — but for an app still being actively updated,
  // that meant a stale cached copy could keep serving indefinitely even
  // after a fresh deploy, only fixed by manually clearing site data. This
  // way, being online always gets you the latest deployed code, and the
  // cache still covers you the moment you lose signal.)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
