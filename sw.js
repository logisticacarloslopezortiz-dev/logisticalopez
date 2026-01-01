// sw.js

// COMENTARIO: Se añade versionado de caché para forzar la actualización de archivos.
const CACHE_NAME = 'tlc-cache-v11';
const urlsToCache = [
  '/offline.html',
  '/css/styles.css',
  '/css/animations.css',
  '/css/tailwind.min.css',
  '/css/custom-styles.css',
  '/vendor/leaflet.js',
  '/vendor/supabase.umd.js',
  '/img/1vertical.png',
  '/img/favicon.ico',
  '/img/android-chrome-192x192.png',
  '/img/android-chrome-512x512.png',
  '/img/apple-touch-icon.png',
  '/img/cargo.jpg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Instalando nueva versión del Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cache abierta, añadiendo URLs al precaché.');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Forzar al nuevo Service Worker a activarse inmediatamente
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activando nueva versión del Service Worker.');
  // COMENTARIO: Esta sección es clave. Elimina todas las cachés antiguas.
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Eliminando caché antigua: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Tomar control de las páginas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const dest = event.request.destination; // 'document', 'script', 'style', 'image', 'font', ''

  if (url.origin !== self.location.origin) {
    const host = url.hostname || '';
    if (host.includes('stadiamaps.com') || host.includes('tile.openstreetmap.org') || host.includes('basemaps.cartocdn.com')) {
      return;
    }
  }
  

  event.respondWith((async () => {
    const cached = dest !== 'document'
      ? await caches.match(event.request, { ignoreSearch: true })
      : await caches.match(event.request);
    try {
      const networkResponse = await fetch(event.request);
      // Cachea en segundo plano recursos estáticos de mismo origen y respuestas OK
      if (
        networkResponse && networkResponse.ok &&
        ['script', 'style', 'image', 'font'].includes(dest) &&
        url.origin === self.location.origin
      ) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, networkResponse.clone());
        } catch (_) {}
      }
      
      return networkResponse;
    } catch (e) {
      // Fallback a caché si existe
      if (cached) return cached;
      // Para documentos, servir una página offline si está disponible
      if (dest === 'document') {
        const offline = await caches.match('/offline.html');
        if (offline) return offline;
      }
      // Último recurso: devolver respuesta vacía con 503 (mejor señal para recursos)
      return new Response('', { status: 503 });
    }
  })());
});

// Permite que la página pida saltar waiting (desde pwa.js)
self.addEventListener('message', (event) => {
  if (event?.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
});


// --- Lógica de Notificaciones Push (sin cambios) ---

self.addEventListener('push', (event) => {
  console.log('[SW] PUSH RECIBIDO', event);
  let incoming = {};
  try { incoming = event.data && typeof event.data.json === 'function' ? event.data.json() : {}; } catch (_) {}
  const payload = incoming && typeof incoming === 'object' && incoming.notification ? incoming.notification : incoming;
  const title = typeof payload.title === 'string' ? payload.title : '';
  const body = typeof payload.body === 'string' ? payload.body : '';
  if (!title || !body) return;
  const icon = payload.icon || '/img/android-chrome-192x192.png';
  const badge = payload.badge || '/img/favicon-32x32.png';
  const dataObj = payload.data || {};
  const orderId = dataObj.orderId || null;
  const builtUrl = dataObj.url ? dataObj.url : (orderId ? `/seguimiento.html?orderId=${orderId}` : '/');
  const options = {
    body,
    icon,
    badge,
    requireInteraction: payload.urgent === true,
    renotify: true,
    tag: orderId ? `tlc-order-${orderId}` : 'tlc-order',
    data: { url: builtUrl },
    actions: [
      { action: 'open', title: 'Ver', icon: '/img/android-chrome-192x192.png' },
      { action: 'dismiss', title: 'Ignorar' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclose', (event) => {
  try {
    const data = event.notification?.data || {};
    // hook opcional: enviar métricas a API si se requiere
  } catch (_) {}
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  const action = event.action;
  if (action === 'dismiss') {
    return;
  }
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.pathname === new URL(targetUrl, self.location.origin).pathname) {
          client.focus();
          return;
        }
      } catch (_) { }
    }
    await clients.openWindow(targetUrl);
  })());
});
