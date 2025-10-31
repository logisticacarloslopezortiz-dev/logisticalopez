self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Listo para manejar push
});

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Notificación';
    const body = data.body || '';
    event.waitUntil(
      self.registration.showNotification(title, { body })
    );
  } catch (e) {
    // fallback
    event.waitUntil(self.registration.showNotification('Notificación', { body: '' }));
  }
});