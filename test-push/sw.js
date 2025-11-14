self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Listo para manejar push
});

self.addEventListener('push', (event) => {
  let incoming = {};
  try { incoming = event.data && typeof event.data.json === 'function' ? event.data.json() : {}; } catch (_) {}
  const payload = incoming && typeof incoming === 'object' && incoming.notification ? incoming.notification : incoming;
  const title = typeof payload.title === 'string' ? payload.title : 'Notificación';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const icon = payload.icon || '/img/android-chrome-192x192.png';
  const dataObj = payload.data || {};
  const options = { body, icon, data: { url: dataObj.url || '/' } };
  event.waitUntil(self.registration.showNotification(title, options));
});