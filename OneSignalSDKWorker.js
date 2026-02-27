// ✅ FIJAR EL LISTENER DE MENSAJES AL INICIO ABSOLUTO (Requisito Chrome/OneSignal)
self.addEventListener('message', (event) => {
  console.log('[OneSignalWorker] Mensaje recibido:', event.data);
});

// ✅ OneSignal v16 Service Worker
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// ✅ Tu lógica de PWA/Caché
// Se carga después para evitar interferir con la inicialización de OneSignal
try {
  importScripts("/sw.js");
} catch (e) {
  console.warn("No se pudo cargar sw.js en OneSignalWorker:", e);
}
