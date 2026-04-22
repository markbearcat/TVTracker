// TV Tracker — Service Worker
// Strategy: network-first for all app shell files (HTML/JS/CSS) so
// updates are always picked up immediately. Cache fallback for offline.
// Cache-first only for icons (they never change).

const CACHE = 'tv-tracker-v4';
const SHELL = [
  './', './index.html', './style.css', './app.js',
  './config.js', './manifest.json'
];
const ICONS = [
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-384.png', './icons/icon-144.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...SHELL, ...ICONS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for external APIs
  if (url.hostname.includes('tvmaze.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('accounts.google.com') ||
      url.hostname.includes('strem.io')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Icons: cache-first (they never change)
  if (url.pathname.includes('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // App shell (HTML, JS, CSS, manifest): network-first, cache fallback
  // This ensures updated files are always used immediately.
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
