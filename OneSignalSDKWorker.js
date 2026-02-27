// ✅ OneSignal v16 Service Worker
// Se registran los listeners al inicio para evitar advertencias de "initial evaluation"
self.addEventListener('message', (event) => {
  // Manejar mensajes internos o de OneSignal
  if (event.data && event.data.type === 'sw-update-ready') {
    console.log('[OneSignalWorker] Nueva versión detectada.');
  }
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// ✅ Tu lógica de PWA/Caché
// Se carga después para no interferir con el inicio de OneSignal
try {
  importScripts("/sw.js");
} catch (e) {
  console.error("No se pudo cargar sw.js en OneSignalWorker:", e);
}
