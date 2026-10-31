/* Generated service worker. Asset list and cache name are filled in by build.py. */
const CACHE = '__CACHE__';
const ASSET_PATHS = __ASSET_PATHS__;

const ROOT = new URL('./', self.location).href;
const urlFor = (path) => new URL(path, ROOT).href;
const SHELL = urlFor('index.html');
const PRECACHE = ASSET_PATHS.map(urlFor);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
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

async function navigation(req) {
  const cache = await caches.open(CACHE);
  const shell = await cache.match(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) return res;
    const type = res.headers.get('content-type') || '';
    if (res.status === 404 && type.includes('text/html')) {
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: {'Content-Type': 'text/html; charset=utf-8'}
      });
    }
    return shell || res;
  } catch (err) {
    return shell || Response.error();
  }
}
