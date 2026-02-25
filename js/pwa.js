// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Register the service worker (use path relative to the page to avoid issues when the site
  // is deployed to a subpath). Also make message sending robust from the window context.
  window.addEventListener('load', async () => {
    try {
      // ✅ IMPORTANTE: OneSignal requiere su propio Service Worker (OneSignalSDKWorker.js)
      // Hemos fusionado nuestro sw.js dentro de OneSignalSDKWorker.js para no perder PWA/Caché.
      const swPath = '/OneSignalSDKWorker.js';
      
      const reg = await navigator.serviceWorker.register(swPath);
      console.log('ServiceWorker (OneSignal/PWA) registrado:', reg.scope);

      // If a waiting worker exists, notify and activate immediately
      if (reg.waiting) {
        sendMessageToClients({ type: 'sw-update-ready' });
        if (window.pwaHelpers && typeof window.pwaHelpers.skipWaiting === 'function') {
          window.pwaHelpers.skipWaiting();
        }
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content is available; notify and activate immediately
            sendMessageToClients({ type: 'sw-update-ready' });
            if (window.pwaHelpers && typeof window.pwaHelpers.skipWaiting === 'function') {
              window.pwaHelpers.skipWaiting();
            }
          }
        });
      });
    } catch (err) {
      console.warn('Error al registrar ServiceWorker:', err);
    }

    try {
      // No habilitar suscripción push automáticamente; dejar que el usuario la active explícitamente
      if ('Notification' in window) {
        const seen = localStorage.getItem('tlc_push_prompt_seen');
        if (Notification.permission === 'default' && !seen) {
          // Solo registrar que ya se mostró el prompt en esta sesión
          localStorage.setItem('tlc_push_prompt_seen', '1');
          // Si se desea, puede mostrarse un botón en UI para activar push manualmente
        }
      }
    } catch(_){ }
  });

  // beforeinstallprompt handling moved to each page; expose helper
  window.pwaHelpers = {
    promptInstall: async (deferredPrompt) => {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      return choice && choice.outcome === 'accepted';
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
})();
