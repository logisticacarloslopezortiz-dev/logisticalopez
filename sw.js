// ✅ FIJAR EL LISTENER DE MENSAJES AL INICIO ABSOLUTO (REQUERIDO POR NAVEGADORES)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
  // Evitar logs excesivos en producción si es mensaje interno de OneSignal
  if (event.data && !event.data.command) {
    console.log('[SW] Mensaje recibido:', event.data);
  }
});

// Importar OneSignal si existe el script (Chaining)
try {
  // OneSignal usualmente inyecta sus propios workers, 
  // pero permitimos que sw.js viva como parte de OneSignalSDKWorker.js
} catch(e){}

// Service Worker para Logísticaexiste el script (Chaining)
try {
  // OneSignal usualmente inyecta sus propios workers, 
  // pero si este worker es el principal, debemos ser cuidadosos.
} catch (e) {}

// Service Worker para Logística López Ortiz

const CACHE_NAME = 'tlc-static-v2';

// Archivos críticos a pre-cachear en install
const PRECACHE = [
  './login.html',
  './login-colaborador.html',
  './manifest-cliente.json',
  './manifest-colaborador.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Limpiar caches viejos
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
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
        // Offline: devolver la página cacheada exacta que se solicitó
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        // Fallback: si la URL solicitada no está cacheada, devolver login.html
        const fallback = await cache.match('./login.html');
        return fallback || Response.error();
      }
    })());
    return;
  }

  const isStatic = /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|eot|html|json)$/.test(url.pathname);
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
