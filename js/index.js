// Mobile menu toggle
const mobileBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
if (mobileBtn && mobileMenu) {
  mobileBtn.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
}

// Lógica para la instalación de la PWA
let deferredPrompt;
const installButtons = [
  document.getElementById('install-app-btn'),
  document.getElementById('install-app-header-btn'),
  document.getElementById('install-app-mobile-btn'),
  document.getElementById('install-app-animation-btn')
].filter(Boolean);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installButtons.forEach(btn => {
    btn.classList.remove('hidden');
    btn.setAttribute('aria-hidden', 'false');
  });
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

installButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
    }
  });
});

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

document.addEventListener('DOMContentLoaded', () => {
  const heroContainer = document.querySelector('.hero .animate-fadeInUp');
  if (heroContainer) {
    const title = heroContainer.querySelector('h2');
    const paragraphs = heroContainer.querySelectorAll('p');
    const btnRow = heroContainer.querySelector('.mt-8');

    const seq = [title, paragraphs[0], paragraphs[1], btnRow].filter(Boolean);
    seq.forEach(el => { if (el) el.style.opacity = '0'; });

    let delay = 0;
    seq.forEach(el => {
      if (!el) return;
      setTimeout(() => {
        el.style.opacity = '1';
        el.classList.add('animate-fadeInUp');
      }, delay);
      delay += 200;
    });
  }

  const toReveal = document.querySelectorAll('.reveal-on-scroll');
  if (toReveal.length) {
    const obs = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('animate-fadeInUp');
        el.classList.remove('opacity-0');
        el.classList.remove('translate-y-4');
        observer.unobserve(el);
      });
    }, { threshold: 0.2 });

    toReveal.forEach(el => obs.observe(el));
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('testimonialsGrid');
  const empty = document.getElementById('testimonialsEmpty');
  if (!grid) return;
  const client = (window.supabaseConfig && (window.supabaseConfig.getPublicClient ? window.supabaseConfig.getPublicClient() : window.supabaseConfig.client)) || null;
  if (!client) {
    empty && empty.classList.remove('hidden');
    return;
  }
  let items = [];
  try {
    const { data, error } = await client.rpc('get_public_testimonials', { limit_count: 10 });
    if (!error && Array.isArray(data)) items = data;
  } catch (_) {}
  if (!items.length) {
    empty && empty.classList.remove('hidden');
    return;
  }
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = items.map(it => {
    const stars = Math.max(0, Math.min(5, parseInt(it.stars || 0, 10)));
    const starsHtml = Array.from({ length: 5 }).map((_, i) => `<i class="fas fa-star ${i < stars ? 'text-yellow-400' : 'text-gray-300'}"></i>`).join('');
    const comment = esc(it.comment || '');
    const name = esc(it.client_name || 'Cliente');
    return `
      <div class="bg-white rounded-xl shadow-md border border-gray-200 p-6 text-left">
        <div class="flex items-center gap-2 mb-3 text-lg">${starsHtml}</div>
        <p class="text-gray-700 mb-4">${comment}</p>
        <div class="text-sm text-gray-500 font-semibold">${name}</div>
      </div>
    `;
  }).join('');
  grid.innerHTML = html;
});

// --- Animaciones con IntersectionObserver centralizadas ---
document.addEventListener('DOMContentLoaded', () => {
  const animationSection = document.getElementById('animation-section');
  const truck = document.getElementById('truck-animation');
  const package1 = document.getElementById('package-animation-1');
  const package2 = document.getElementById('package-animation-2');
  const actionButtons = document.getElementById('action-buttons');

  const elementsToAnimate = [
    { el: truck, animClass: 'animate-truck-loop' },
    { el: package1, animClass: 'animate-package-loop-1' },
    { el: package2, animClass: 'animate-package-loop-2' },
    { el: actionButtons, animClass: 'animate-button-loop' }
  ];

  elementsToAnimate.forEach(({ el }) => el && (el.style.opacity = '0'));

  const observerCallback = (entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      elementsToAnimate.forEach(({ el, animClass }) => {
        if (el) {
          el.style.opacity = '1';
          el.classList.add(animClass);
        }
      });
      observer.unobserve(entry.target);
    });
  };

  const observer = new IntersectionObserver(observerCallback, { threshold: 0.5 });
  if (animationSection) observer.observe(animationSection);

  const scrollEls = Array.from(document.querySelectorAll('.animate-on-scroll'));
  scrollEls.forEach(el => {
    el.style.opacity = '0';
    const delay = el.getAttribute('data-anim-delay') || '0s';
    const onEntry = (entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        el.style.opacity = '1';
        el.style.animationDelay = delay;
        el.classList.add('animate-fadeInUp');
        obs.unobserve(el);
      });
    };
    const obs = new IntersectionObserver(onEntry, { threshold: 0.2 });
    obs.observe(el);
  });
});

// --- Formulario de colaboración: abrir WhatsApp ---
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('colaborador-form');
  if (!form) return;
  form.addEventListener('submit', function(event) {
    event.preventDefault();
    const nombreEl = document.getElementById('nombre');
    const telefonoEl = document.getElementById('telefono');
    const mensajeEl = document.getElementById('mensaje');
    const nombre = (nombreEl && 'value' in nombreEl) ? nombreEl.value : '';
    const telefono = (telefonoEl && 'value' in telefonoEl) ? telefonoEl.value : '';
    const mensaje = (mensajeEl && 'value' in mensajeEl) ? mensajeEl.value : '';
    if (!nombre.trim() || !telefono.trim()) {
      alert('Por favor, completa tu nombre y teléfono.');
      return;
    }
    const numeroEmpresa = '18297293822';
    let textoWhatsApp = `¡Hola! Quisiera colaborar con ustedes.\n\n*Nombre:* ${nombre}\n*Teléfono:* ${telefono}`;
    if (mensaje) textoWhatsApp += `\n\n*Mensaje:* ${mensaje}`;
    const urlWhatsApp = `https://wa.me/${numeroEmpresa}?text=${encodeURIComponent(textoWhatsApp)}`;
    window.open(urlWhatsApp, '_blank');
  });
});
