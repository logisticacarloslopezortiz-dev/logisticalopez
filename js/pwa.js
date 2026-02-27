// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // ✅ MODIFICADO: No registrar manualmente el worker si OneSignal está presente.
  // OneSignal v16 maneja su propio registro de worker con los parámetros necesarios (?appId=...).
  // Solo registramos si OneSignal NO está en la página (fallback).
  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
      // Esperar un poco para ver si OneSignal toma el control
      setTimeout(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const isOneSignalRegistered = registrations.some(r => r.active && r.active.scriptURL.includes('OneSignalSDKWorker'));
        
        if (!isOneSignalRegistered) {
          try {
            // Si OneSignal no lo hizo, lo hacemos nosotros para PWA
            const reg = await navigator.serviceWorker.register('/OneSignalSDKWorker.js');
            console.log('ServiceWorker (PWA Fallback) registrado:', reg.scope);
          } catch (e) {
            console.warn('Error registrando SW Fallback:', e);
          }
        } else {
          console.log('ServiceWorker ya gestionado por OneSignal.');
        }
      }, 3000);
    }
  });

  // beforeinstallprompt handling moved to each page; expose helper
  window.pwaHelpers = {
    promptInstall: async (deferredPrompt) => {
      if (!deferredPrompt) return false;
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        return choice && choice.outcome === 'accepted';
      } catch (e) {
        console.warn('Error en prompt de instalación PWA:', e);
        return false;
      }
    },
    skipWaiting: () => {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
      }
    }
  };

  // Safe messaging from window context to service worker(s).
  function sendMessageToClients(msg) {
    try {
      // Prefer posting to the active controller if available
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(msg);
        return;
      }

      // Otherwise, iterate registrations and post to active/waiting workers
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(r => {
            if (r.waiting) r.waiting.postMessage(msg);
            if (r.active) r.active.postMessage(msg);
          });
        }).catch(() => {});
      }
    } catch (e) {
      // Silently ignore - this helper must not throw in the page context
      console.warn('sendMessageToClients failed:', e);
    }
  }

  // Force reload once when controller changes to ensure new SW takes over
  // ✅ DESACTIVADO: La recarga automática causa problemas al usuario (pérdida de datos/IDs)
  /*
  (function setupControllerChangeReload(){
    try {
      let reloaded = false;
      navigator.serviceWorker && navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch(_){}
  })();
  */
})();
