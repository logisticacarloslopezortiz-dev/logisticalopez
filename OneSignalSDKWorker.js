importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Integración de sw.js original para no perder PWA y caché
try {
  importScripts("/sw.js");
} catch (e) {
  console.error("No se pudo cargar sw.js en OneSignalWorker:", e);
}