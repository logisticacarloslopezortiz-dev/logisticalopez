// ✅ OneSignal v16 Service Worker
// Se registran los listeners al inicio ANTES de cualquier importScript para evitar advertencias de "initial evaluation"

// Listener de mensaje - DEBE estar aquí, antes de todo
self.addEventListener('message', (event) => {
  // Manejar mensajes internos o de OneSignal
  if (event.data && event.data.type === 'sw-update-ready') {
    console.log('[OneSignalWorker] Nueva versión detectada.');
  }
  // Manejar skipWaiting del cliente
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Ahora cargar OneSignal y nuestro SW después
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
  console.error("Error cargando OneSignal SDK:", e);
}

// ✅ Tu lógica de PWA/Caché - se carga DESPUÉS de OneSignal
try {
  importScripts("/sw.js");
} catch (e) {
  console.error("No se pudo cargar sw.js en OneSignalWorker:", e);
}

