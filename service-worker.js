// service-worker.js

const CACHE_VERSION = 'v3.0-apex';
const STATIC_CACHE_NAME = `aperture-static-${CACHE_VERSION}`;
const PAGES_CACHE_NAME = `aperture-pages-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `aperture-dynamic-${CACHE_VERSION}`;

const ALL_CACHES = [STATIC_CACHE_NAME, PAGES_CACHE_NAME, DYNAMIC_CACHE_NAME];
const PAGE_CACHE_EXPIRATION_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_PAGES_CACHE_SIZE = 50;

const STATIC_ASSETS = [
  './',
  './index.html',
  './a1-engine.js',
  './offline.html', // Add offline page to cache
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !ALL_CACHES.includes(name))
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Serve app shell for navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request)
        .then(response => response || fetch(request))
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }

  // Serve static assets from cache first
  if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '')))) {
    event.respondWith(caches.match(request));
    return;
  }

  // Stale-while-revalidate for dynamic content (APIs, fonts)
  if (url.hostname === 'ac.duckduckgo.com' || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(DYNAMIC_CACHE_NAME, request));
    return;
  }

  // Stale-while-revalidate with expiration for proxied pages
  if (url.hostname.endsWith('cors.sh') || url.hostname.endsWith('allorigins.win')) {
    event.respondWith(
      staleWhileRevalidate(PAGES_CACHE_NAME, request, true)
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }
});

const staleWhileRevalidate = async (cacheName, request, withExpiration = false) => {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  const networkFetch = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      const responseToCache = withExpiration ? addTimestampToResponse(networkResponse) : networkResponse.clone();
      cache.put(request, responseToCache);
      if (cacheName === PAGES_CACHE_NAME) trimCache(cacheName, MAX_PAGES_CACHE_SIZE);
    }
    return networkResponse;
  }).catch(err => {
    console.error('[SW] Network fetch failed:', err);
    if (cachedResponse) return cachedResponse;
    throw err;
  });

  if (cachedResponse) {
    if (withExpiration && isCacheExpired(cachedResponse)) {
      return networkFetch; // Expired, must fetch
    }
    return cachedResponse; // Not expired, serve from cache
  }
  return networkFetch; // Not in cache, must fetch
};

const addTimestampToResponse = (response) => {
  const headers = new Headers(response.headers);
  headers.append('sw-cache-timestamp', Date.now());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
};

const isCacheExpired = (response) => {
  const timestamp = response.headers.get('sw-cache-timestamp');
  if (!timestamp) return false; // No timestamp, assume not expired
  const cacheAge = (Date.now() - parseInt(timestamp, 10)) / 1000;
  return cacheAge > PAGE_CACHE_EXPIRATION_SECONDS;
};

const trimCache = async (cacheName, maxSize) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxSize) {
    const keysToDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(keysToDelete.map(key => cache.delete(key)));
  }
};

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'BURN_SESSION') {
    event.waitUntil(
      caches.keys().then(cacheNames => Promise.all(cacheNames.map(name => caches.delete(name))))
        .then(() => event.source?.postMessage({ type: 'BURN_COMPLETE' }))
    );
  } else if (event.data && event.data.type === 'PRECACHE_URL') {
    // Proactively cache a URL without responding to a fetch event
    event.waitUntil(staleWhileRevalidate(PAGES_CACHE_NAME, new Request(event.data.url), true));
  }
});