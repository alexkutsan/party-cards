/* Generated service worker. Asset list and cache name are filled in by build.py. */
const CACHE = '__CACHE__';
const ASSET_PATHS = __ASSET_PATHS__;

const ROOT = new URL('./', self.location).href;
const urlFor = (path) => new URL(path, ROOT).href;
const SHELL = urlFor('index.html');
const PRECACHE = ASSET_PATHS.map(urlFor);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The browser checks this URL for updates. A cache-first hit freezes the
  // previous worker, so a new deploy never installs. The active worker does
  // not need its own script in Cache Storage to keep working offline.
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigation(req));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {'Content-Type': 'text/html; charset=utf-8'}
  });
}

async function navigation(req) {
  const cache = await caches.open(CACHE);
  const shell = await cache.match(SHELL);
  try {
    // Default fetch honors HTTP cache. Pages keeps index.html long enough
    // that a reload still points at the previous data.js hash.
    const res = await fetch(req, {cache: 'no-store'});
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) {
      cache.put(SHELL, res.clone());
      return res;
    }
    if (res.status === 404 && type.includes('text/html')) {
      const body = await res.arrayBuffer();
      const shellResponse = htmlResponse(body);
      cache.put(SHELL, shellResponse.clone());
      return shellResponse;
    }
    return shell || res;
  } catch (err) {
    return shell || Response.error();
  }
}
