// Service Worker para TLC PWA
const CACHE_NAME = 'tlc-cache-v1';
const urlsToCache = [
  '/',
  'index.html',
  'cliente.html',
  'inicio.html',
  'servicios.html',
  'historial-solicitudes.html',
  'colaboradores.html',
  'panel-colaborador.html',
  'js/cliente.js',
  'js/inicio.js',
  'js/servicios.js',
  'js/colaboradores.js',
  'js/panel-colaborador.js',
  'js/supabase-config.js',
  'img/favicon.ico',
  'img/favicon-16x16.png',
  'img/favicon-32x32.png',
  'img/android-chrome-192x192.png',
  'img/android-chrome-512x512.png',
  'img/1vertical.png', // Añadir la imagen del logo al caché
  // No cachear Tailwind CSS CDN debido a restricciones de CORS
  'https://unpkg.com/lucide@latest',
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación del Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Estrategia de caché: Network first para CDN, Cache first para recursos locales
self.addEventListener('fetch', event => {
  // No interceptar solicitudes a CDN de Tailwind
  if (event.request.url.includes('cdn.tailwindcss.com')) {
    return fetch(event.request);
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        return fetch(event.request).then(
          response => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Solo cachear recursos locales
            if (event.request.url.startsWith(self.location.origin)) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
            }

            return response;
          }
        );
      })
  );
});

// Manejo de mensajes (para comunicación con la página)
self.addEventListener('message', event => {
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Manejar eventos Push para mostrar notificaciones en segundo plano
self.addEventListener('push', event => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // Si el payload no es JSON, usar texto plano
    data = { title: 'TLC', body: event.data && event.data.text ? event.data.text() : '' };
  }
  const title = data.title || 'TLC';
  const options = {
    body: data.body || '',
    icon: data.icon || '/img/android-chrome-192x192.png',
    badge: data.badge || '/img/favicon-32x32.png',
    data: data.data || {}
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al hacer clic en la notificación, abrir la página de seguimiento del pedido
self.addEventListener('notificationclick', event => {
  const url = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : '/index.html';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        // Si ya hay una ventana abierta, navegar y enfocar
        if ('focus' in client) {
          try { client.navigate(url); } catch (_) {}
          return client.focus();
        }
      }
      // Si no hay ventanas, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});