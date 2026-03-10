// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Detection functions
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // ✅ MODIFICADO: No registrar manualmente el worker si OneSignal está presente.
  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
      setTimeout(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const isOneSignalRegistered = registrations.some(r => r.active && r.active.scriptURL.includes('OneSignalSDKWorker'));
        
        if (!isOneSignalRegistered) {
          try {
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

  // PWA Manager: Uber-style installation flow
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show Android/Desktop install button if available
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.classList.remove('hidden');
  });

  window.pwaManager = {
    isIOS,
    isAndroid,
    isStandalone,
    
    checkInstallation: () => {
      const modal = document.getElementById('ios-install-modal');
      if (!modal) return;

      // Solo mostrar guía en iOS si NO está instalada
      if (isIOS() && !isStandalone()) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    },

    promptInstall: async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        return outcome === 'accepted';
      } else if (isIOS() && !isStandalone()) {
        // En iOS, solo podemos mostrar el modal de instrucciones
        const modal = document.getElementById('ios-install-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      }
      return false;
    },

    requestPermissions: async (types = ['notification', 'location']) => {
      // 1. Notificaciones
      if (types.includes('notification') && 'Notification' in window) {
        if (Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch (e) { console.warn('Error pidiendo permiso Notif:', e); }
        }
      }

      // 2. Ubicación
      if (types.includes('location') && navigator.geolocation) {
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => { console.log('GPS permitido'); resolve(true); },
            (err) => { console.warn('GPS denegado', err); resolve(false); },
            { enableHighAccuracy: true, timeout: 5000 }
          );
        });
      }
    }
  };

  // Run initial check
  document.addEventListener('DOMContentLoaded', () => {
    window.pwaManager.checkInstallation();
  });

})();
