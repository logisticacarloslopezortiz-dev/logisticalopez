// ✅ FIJAR EL LISTENER DE MENSAJES AL INICIO ABSOLUTO (Requisito Chrome/OneSignal)
self.addEventListener('message', (event) => {
  console.log('[OneSignalWorker] Mensaje recibido:', event.data);
});

importScripts(
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js", 
  "/sw.js"
);
