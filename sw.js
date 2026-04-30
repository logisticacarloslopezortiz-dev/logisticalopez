// ✅ LISTENER DE MENSAJES - Solo si no está ya registrado (para evitar duplicados cuando se importa desde OneSignalSDKWorker.js)
// Verificar que no existe ya un listener añadido por OneSignalSDKWorker
(function() {
  // Si este worker está siendo importado como script, permitir que el padre maneje el listener
  // Solo añadir si se ejecuta como worker independiente
  if (typeof importScripts === 'undefined') {
    // No es un Service Worker, skip
    return;
  }
  
  // Verificar si ya hay una instancia del listener (de OneSignalSDKWorker)
  // En ese caso, no duplicar
  const hasExistingListener = typeof self._messageListenerInstalled !== 'undefined' && self._messageListenerInstalled;
  
  if (!hasExistingListener) {
    self.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
      }
      // Evitar logs excesivos en producción si es mensaje interno de OneSignal
      if (event.data && !event.data.command) {
        console.log('[SW] Mensaje recibido:', event.data);
      }
    });
    self._messageListenerInstalled = true;
  }
})();

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

const CACHE_NAME = 'tlc-static-v3';

const PRECACHE = [
  './login.html',
  './login-colaborador.html',
  './cliente.html',
  './seguimiento.html',
  './panel-colaborador.html',
  './offline.html',
  './manifest.json',
  './manifest-cliente.json',
  './manifest-colaborador.json',
  './css/admin-panel-styles.css',
  './img/android-chrome-192x192.png',
  './img/favicon.ico'
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
        // Fallback: si la URL solicitada no está cacheada, devolver offline.html
        const fallback = await cache.match('./offline.html') || await cache.match('./login.html');
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
