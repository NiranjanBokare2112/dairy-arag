// Service worker: cache the app shell so the PWA opens even if the desktop server restarts
// or the phone briefly loses Wi-Fi. API calls (/api/*) are never cached.
const VERSION = 'arag-v149';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './favicon.png',
  './assets/fonts/mukta.css', './assets/img/cow-calf.png', './assets/img/icon-192.png',
  './src/styles/app.css', './src/styles/print.css', './src/styles/site.css', './src/app.js',
  './assets/img/farm-scene-800.jpg', './assets/img/cow-logo.png', './assets/sim/milk-collection.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for app files (so updates arrive on the LAN), cache as fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__dev/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
