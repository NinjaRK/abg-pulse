const CACHE_NAME = 'abg-pulse-shell-v5';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/core.mjs',
  '/manifest.webmanifest', '/assets/icon.svg', '/assets/icon-192.png', '/assets/icon-512.png',
  '/data/entities.json', '/data/source-registry.json', '/data/entity-universe-summary.json', '/data/build-milestones.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && url.origin === self.location.origin) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached || caches.match('/index.html'));
      return cached || network;
    })
  );
});
