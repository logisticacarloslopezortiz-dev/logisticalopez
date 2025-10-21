self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
  // Forzar al nuevo Service Worker a activarse inmediatamente
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating.');
  // Tomar control de las páginas abiertas inmediatamente
  event.waitUntil(self.clients.claim());
});

// Escuchar notificaciones push desde el servidor
self.addEventListener('push', (event) => {
  const data = event.data.json();
  console.log('Push Recibido:', data);

  const options = {
    body: data.body,
    icon: data.icon || '/img/android-chrome-192x192.png', // Icono por defecto
    badge: data.badge || '/img/favicon-32x32.png', // Badge para Android
    data: {
      url: data.data.url || '/' // URL a abrir al hacer clic
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Manejar el clic en la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Cerrar la notificación

  // Abrir la URL especificada en los datos de la notificación
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});