importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Integración de sw.js original para no perder PWA y caché
// Se cargan inmediatamente para que los listeners se registren en la evaluación inicial
importScripts("/sw.js");
