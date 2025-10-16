// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Register the service worker
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('ServiceWorker registrado con éxito:', reg.scope);

      // Listen for updates and notify the page
      if (reg.waiting) {
        sendMessageToClients({ type: 'sw-update-ready' });
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
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

  function sendMessageToClients(msg) {
    clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        client.postMessage(msg);
      }
    });
  }
})();
