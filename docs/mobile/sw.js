/* Service worker «Мої ігри»: оболонка сторінки офлайн, відповіді OpenDota — «спершу мережа, потім кеш»,
 * картинки Steam лишаються HTTP-кешу браузера (CDN не віддає CORS, а непрозорі відповіді в Cache Storage
 * займають непропорційно багато квоти). Відповідь із кешу позначається заголовком x-da-cached-at (час збереження). */
'use strict';

const VERSION = 'v1';
const SHELL_CACHE = `da-shell-${VERSION}`;
const API_CACHE = 'da-api';
const API_LIMIT = 80; // відповідей OpenDota (матч — до ~1 МБ), старіші видаляються
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'favicon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('da-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.opendota.com') {
    event.respondWith(networkFirst(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(shell(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      const body = await res.clone().arrayBuffer();
      await cache.put(req, new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-da-cached-at': String(Date.now()),
          // Відповідь іде сторінці як CORS — заголовок треба явно відкрити.
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'x-da-cached-at',
        },
      }));
      trim(cache, API_LIMIT);
      return res;
    }
    // Ліміт (429) чи збій сервера: краще показати збережене, ніж помилку.
    if (res.status === 429 || res.status >= 500) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function shell(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await cache.match('index.html');
      if (index) return index;
    }
    return new Response('Офлайн', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
