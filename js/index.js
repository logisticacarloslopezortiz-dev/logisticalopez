// Mobile menu toggle
const mobileBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
if (mobileBtn && mobileMenu) {
  mobileBtn.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
}

// Lógica para la instalación de la PWA
let deferredPrompt;
const installButton = document.getElementById('install-app-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installButton) {
    installButton.classList.remove('hidden');
    installButton.setAttribute('aria-hidden', 'false');
  }
});

// --- Lógica para el formulario de Colaboradores ---
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('colaborador-form');
  if (form) {
    form.addEventListener('submit', function(event) {
      event.preventDefault();

      const nombreInput = document.getElementById('nombre');
      const telefonoInput = document.getElementById('telefono');
      const mensajeInput = document.getElementById('mensaje');

      const nombre = nombreInput ? nombreInput.value : '';
      const telefono = telefonoInput ? telefonoInput.value : '';
      const mensaje = mensajeInput ? mensajeInput.value : '';

      const numeroEmpresa = '18297293822';
      let textoWhatsApp = `¡Hola! Quisiera colaborar con ustedes.\n\n*Nombre:* ${nombre}\n*Teléfono:* ${telefono}`;

      if (mensaje) {
        textoWhatsApp += `\n\n*Mensaje:* ${mensaje}`;
      }

      const urlWhatsApp = `https://wa.me/${numeroEmpresa}?text=${encodeURIComponent(textoWhatsApp)}`;

      window.open(urlWhatsApp, '_blank');
    });
  }
});

// Detectar iOS para mostrar instrucciones de instalación manual
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

// Lógica para el modal de instalación en iOS
if (isIOS() && !isInStandaloneMode()) {
  const iosModal = document.getElementById('ios-install-modal');
  const closeIosModalBtn = document.getElementById('close-ios-modal');

  if (iosModal && !localStorage.getItem('hasSeenIosInstallModal')) {
    setTimeout(() => {
      iosModal.classList.remove('hidden');
      iosModal.classList.add('flex');
      localStorage.setItem('hasSeenIosInstallModal', 'true');
    }, 3000); // Mostrar después de 3 segundos
  }

  if (closeIosModalBtn) {
    closeIosModalBtn.addEventListener('click', () => {
      if (iosModal) {
        iosModal.classList.add('hidden');
        iosModal.classList.remove('flex');
      }
    });
  }
}

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
    }
  });
}

// --- Lógica para ocultar/mostrar header en scroll ---
let lastScrollY = window.scrollY;
const header = document.getElementById('main-header');

window.addEventListener('scroll', () => {
  if (header) {
    if (window.scrollY > lastScrollY && window.scrollY > header.offsetHeight) {
      // Scroll hacia abajo
      header.classList.add('header-hidden');
    } else {
      // Scroll hacia arriba
      header.classList.remove('header-hidden');
    }
    lastScrollY = window.scrollY;
  }
});
