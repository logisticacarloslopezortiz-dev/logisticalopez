// ✅ FIJAR EL LISTENER DE MENSAJES AL INICIO ABSOLUTO
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
  // Evitar logs excesivos en producción si es mensaje interno de OneSignal
  if (event.data && !event.data.command) {
    console.log('[SW] Mensaje recibido:', event.data);
  }
});

// Service Worker para llo Logística
// Manejo de caché básico (Las notificaciones Push las gestiona OneSignal)

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const CACHE_NAME = 'tlc-static-v1';
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.hostname.endsWith('.supabase.co')) return;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        try { await cache.put(req, net.clone()); } catch (_){}
        return net;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }
  const isStatic = /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|eot|html)$/.test(url.pathname);
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const fetched = fetch(req).then(async (net) => {
      try { await cache.put(req, net.clone()); } catch (_){}
      return net;
    }).catch(() => cached);
    return cached || fetched;
  })());
});
