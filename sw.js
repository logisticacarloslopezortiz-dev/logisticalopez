// sw.js

// COMENTARIO: Se añade versionado de caché para forzar la actualización de archivos.
const CACHE_NAME = 'tlc-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/offline.html',
  '/cliente.html',
  '/login.html',
  '/inicio.html',
  '/panel-colaborador.html',
  '/seguimiento.html',
  '/historial-solicitudes.html',
  '/css/styles.css',
  '/css/animations.css',
  '/css/tailwind.min.css',
  '/css/custom-styles.css',
  '/js/cliente.js',
  '/js/inicio.js',
  '/js/index.js',
  '/js/panel-colaborador.js',
  '/js/seguimiento.js',
  '/js/historial.js',
  '/js/order-manager.js',
  '/js/supabase-config.js',
  '/js/notifications.js',
  '/js/pwa.js',
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

  const dest = event.request.destination; // 'document', 'script', 'style', 'image', 'font', ''

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    try {
      const networkResponse = await fetch(event.request);
      // Cachea en segundo plano algunos recursos estáticos para mejor experiencia offline
      if (['script', 'style', 'image', 'font'].includes(dest)) {
        try {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
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
      // Como último recurso, permitir que el navegador gestione el error sin forzar 503
      return new Response('', { status: 408 });
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
