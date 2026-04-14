/**
 * sw.js — Service Worker for TiVo Tracker PWA
 * Enables offline access and installability on Android
 */

const CACHE_NAME = 'tivo-tracker-v1';
const STATIC_ASSETS = [
  '/TVTracker/',
  '/TVTracker/index.html',
  '/TVTracker/css/style.css',
  '/TVTracker/js/storage.js',
  '/TVTracker/js/api.js',
  '/TVTracker/js/stremio.js',
  '/TVTracker/js/gcal.js',
  '/TVTracker/js/ui.js',
  '/TVTracker/js/app.js',
  '/TVTracker/manifest.json',
  '/TVTracker/icons/icon-192.png',
  '/TVTracker/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap',
];

// Install — cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't intercept Google OAuth or Stremio API calls
  if (
    url.hostname.includes('google') ||
    url.hostname.includes('strem.io') ||
    url.hostname.includes('themoviedb.org') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // Let these go straight to network
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('/TVTracker/index.html');
        }
      });
    })
  );
});
