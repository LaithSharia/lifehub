/* ==========================================================================
   service-worker.js — caches the app shell so LifeHub opens with zero
   network. Your actual data lives in IndexedDB, not in this cache.

   Bump CACHE_VERSION whenever you change any cached file and redeploy —
   that's what makes the update actually reach installed devices.
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

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
