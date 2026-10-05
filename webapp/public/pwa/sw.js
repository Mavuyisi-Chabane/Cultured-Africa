// Cultured Africa service worker: lets the site be added to a phone's home screen and
// shows a branded "You're offline" page when there's no connection. It deliberately
// caches nothing else: no films, account pages or personal data are stored on the device.
const CACHE = 'cultured-africa-offline-v2';
const OFFLINE_URL = '/offline';
const OFFLINE_LOGO = '/images/brand/sun.png';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE_URL, OFFLINE_LOGO])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Page loads: try the network, and fall back to the offline page. The only other
// request handled is the offline page's logo, served from the cache when offline.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
  } else if (url.origin === location.origin && url.pathname === OFFLINE_LOGO) {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_LOGO)));
  }
});
