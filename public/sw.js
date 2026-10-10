// STEM Tesla BioHub — service worker
// Strategies:
//   - precache the app shell on install (best-effort; failures don't break install)
//   - cache-first for static assets (CSS/JS/icons/fonts) — instant loads
//   - network-first for HTML pages — always get fresh content if online, fall back to cache
//   - never cache /api/ or /socket.io/ requests
//   - navigation preload for snappier first paint on slow networks
//   - offline fallback for HTML requests that fail

const VERSION = 'biohub-v4';
const APP_SHELL = [
  '/',
  '/login',
  '/about',
  '/css/style.css',
  '/js/toast.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/assets/stem-logo.jpeg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll rejects if any request fails — wrap each one to make it best-effort.
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    // Enable navigation preload for snappier first paint on supported browsers.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  if (url.pathname.startsWith('/uploads/')) return;

  const isStaticAsset = /\.(?:css|js|png|jpe?g|svg|ico|webmanifest|json|woff2?)$/i.test(url.pathname)
    || url.pathname === '/manifest.json';

  if (isStaticAsset) {
    // Cache-first with network fallback (and lazy population).
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => cached))
    );
    return;
  }

  // HTML navigation — network-first, fall back to cache, then offline page.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;
        const resp = preloadResp || await fetch(req);
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {});
        }
        return resp;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match('/');
        if (fallback) return fallback;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>'
          + '<meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<body style="background:#0b1220;color:#e8ecf3;font-family:Inter,system-ui,sans-serif;padding:3rem;text-align:center">'
          + '<h1>You\'re offline</h1>'
          + '<p style="color:#8b95b3">Reconnect to load this page.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
