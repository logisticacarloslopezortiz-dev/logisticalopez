let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installButtons = document.querySelectorAll('#installAppWelcome, .install-app-btn, #installAppFooter');
  installButtons.forEach(btn => {
    if (btn) btn.style.display = 'flex';
  });
});

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    const installButtons = document.querySelectorAll('#installAppWelcome, .install-app-btn, #installAppFooter');
    installButtons.forEach(btn => {
      if (btn && outcome === 'accepted') btn.style.display = 'none';
    });
  } else {
    const userAgent = navigator.userAgent.toLowerCase();
    let instructions = '';
    if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
      instructions = 'Para instalar en iOS:\n1. Toca el botón "Compartir" (⬆️)\n2. Selecciona "Agregar a pantalla de inicio"\n3. Confirma la instalación';
    } else if (userAgent.includes('android')) {
      instructions = 'Para instalar en Android:\n1. Abre el menú del navegador (⋮)\n2. Selecciona "Instalar app" o "Agregar a pantalla de inicio"\n3. Confirma la instalación';
    } else {
      instructions = 'Para instalar la app:\n\niOS: Toca "Compartir" → "Agregar a pantalla de inicio"\nAndroid: Menú del navegador → "Instalar app"';
    }
    alert(instructions);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const allInstallButtons = document.querySelectorAll('.install-app-btn, #installAppWelcome, #installAppFooter');
  allInstallButtons.forEach(btn => {
    btn.addEventListener('click', installApp);
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}
