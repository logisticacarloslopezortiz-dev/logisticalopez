// Service Worker para TLC Logística
// Manejo de notificaciones push y caché básico

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!(self.Notification && self.Notification.permission === 'granted')) {
    return;
  }

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nueva Notificación', body: event.data.text() };
    }
  }

  const title = data.title || 'TLC Logística';
  const options = {
    body: data.body || 'Tienes una nueva actualización.',
    icon: '/img/logo.png', // Asegúrate de tener un logo aquí o usa uno genérico
    badge: '/img/badge.png', // Icono pequeño para la barra de estado
    data: data.data || {},
    vibrate: [100, 50, 100],
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Datos adjuntos a la notificación
  const data = event.notification.data;
  const urlToOpen = data.url || '/inicio.html'; // URL por defecto

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta con esa URL, enfocarla
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

const CACHE_NAME = 'tlc-static-v1';
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
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
