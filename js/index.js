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

// --- Lógica de animaciones con Intersection Observer ---
document.addEventListener('DOMContentLoaded', () => {

    // Animación para sección de servicios
    const serviceSection = document.getElementById('servicios');
    if (serviceSection) {
        const serviceCards = serviceSection.querySelectorAll('.service-card');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    serviceCards.forEach((card, index) => {
                        setTimeout(() => {
                            card.classList.add('animate-service-card');
                        }, index * 100);
                    });
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });
        observer.observe(serviceSection);
    }

    // Animación para sección de colaboradores
    const collabSection = document.getElementById('colaboradores');
    if (collabSection) {
        const textColumn = collabSection.querySelector('div > div > div:first-child');
        const formColumn = collabSection.querySelector('div > div > div:last-child');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if(textColumn) textColumn.classList.add('animate-colaboradores-text');
                    if(formColumn) formColumn.classList.add('animate-colaboradores-form');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });
        observer.observe(collabSection);
    }
});
