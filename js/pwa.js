// Central PWA registration and install handling
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Detection functions
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // ✅ CORREGIDO: Registrar SOLO OneSignalSDKWorker.js que importa sw.js internamente
  // Esto evita conflictos de múltiples listeners de mensaje y conexiones cerradas
  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
      try {
        // OneSignalSDKWorker.js importa internamente /sw.js, no duplicar registraciones
        await navigator.serviceWorker.register('/OneSignalSDKWorker.js');
        console.log('[PWA] OneSignalSDKWorker registrado (incluye sw.js)');
      } catch (e) {
        console.warn('[PWA] Error registrando OneSignalSDKWorker:', e);
        // Fallback: si OneSignal falla, registrar solo sw.js
        try {
          await navigator.serviceWorker.register('/sw.js');
          console.log('[PWA] sw.js registrado como fallback');
        } catch (e2) {
          console.warn('[PWA] Error registrando sw.js fallback:', e2);
        }
      }
    }
  });

  // PWA Manager: Uber-style installation flow
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Muestra el botón de instalación para Android/Escritorio si no está en modo standalone
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn && !isStandalone()) installBtn.classList.remove('hidden');
  });

  window.pwaManager = {
    isIOS,
    isAndroid,
    isStandalone,
    
    checkInstallation: () => {
      const installBtn = document.getElementById('install-app-btn');
      const modal = document.getElementById('ios-install-modal');
      const installedBadge = document.getElementById('app-installed-badge');

      if (isStandalone()) {
        // La app está instalada y en modo standalone
        if (installBtn) installBtn.classList.add('hidden');
        if (modal) modal.classList.add('hidden');
        if (installedBadge) installedBadge.classList.remove('hidden');
      } else {
        // La app no está instalada, mostrar el botón de instalación para iOS
        if (installedBadge) installedBadge.classList.add('hidden');
        if (isIOS() && installBtn) {
          installBtn.classList.remove('hidden');
        }
      }
    },

    promptInstall: async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        return outcome === 'accepted';
      } else if (isIOS() && !isStandalone()) {
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
    const installBtn = document.getElementById('install-app-btn');
    if(installBtn) {
      installBtn.addEventListener('click', () => {
        window.pwaManager.promptInstall();
      });
    }

    // Esto gestiona la visibilidad del badge "App Instalada" y el botón en iOS.
    // El evento 'beforeinstallprompt' gestiona el botón para Android/Escritorio.
    window.pwaManager.checkInstallation(); 
  });

})();
