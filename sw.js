// sw.js

// COMENTARIO: Se añade versionado de caché para forzar la actualización de archivos.
const CACHE_NAME = 'tlc-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/cliente.html',
  '/login.html',
  '/inicio.html',
  '/panel-colaborador.html',
  '/seguimiento.html',
  '/historial-solicitudes.html',
  '/css/styles.css',
  '/js/cliente.js?v=1.2', // Se cachea la nueva versión
  '/js/inicio.js',
  '/js/panel-colaborador.js',
  '/js/seguimiento.js',
  '/js/historial.js',
  '/js/order-manager.js',
  '/js/supabase-config.js',
  '/js/notifications.js',
  '/js/pwa.js',
  '/img/1vertical.png',
  '/img/favicon.ico',
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
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    try {
      const network = await fetch(event.request);
      // Devuelve respuesta de red si existe; si no, fallback a caché
      return network || cached || new Response('Service Unavailable', { status: 503 });
    } catch (e) {
      // En modo offline o si la red falla, devolver caché si existe
      if (cached) return cached;
      // Último recurso: respuesta 503 para evitar errores no capturados
      return new Response('Service Unavailable', { status: 503 });
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
  const data = event.data.json();
  console.log('[SW] Push Recibido:', data);

  const options = {
    body: data.body,
    icon: data.icon || '/img/android-chrome-192x192.png',
    badge: data.badge || '/img/favicon-32x32.png',
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
