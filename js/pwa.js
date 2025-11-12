// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Register the service worker (use path relative to the page to avoid issues when the site
  // is deployed to a subpath). Also make message sending robust from the window context.
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('ServiceWorker registrado con éxito:', reg.scope);

      // If a waiting worker exists, notify the page
      if (reg.waiting) {
        sendMessageToClients({ type: 'sw-update-ready' });
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content is available; notify the client
            sendMessageToClients({ type: 'sw-update-ready' });
          }
        });
      });
    } catch (err) {
      console.warn('Error al registrar ServiceWorker:', err);
    }

    try {
      if ('Notification' in window) {
        const seen = localStorage.getItem('tlc_push_prompt_seen');
        if (Notification.permission === 'default' && !seen) {
          const proceed = confirm('¿Deseas recibir notificaciones sobre tus solicitudes?');
          localStorage.setItem('tlc_push_prompt_seen', '1');
          if (proceed && window.pushNotifications && window.pushNotifications.isSupported) {
            try { await window.pushNotifications.enable(); } catch(_){}
          }
        }
      }
    } catch(_){}
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
})();
