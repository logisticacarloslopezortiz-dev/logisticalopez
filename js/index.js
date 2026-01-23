(() => {
  'use strict';

  /* ==========================
     MENÚ MÓVIL
  ========================== */
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (mobileBtn && mobileMenu) {
    mobileBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  /* ==========================
     PWA – INSTALACIÓN
  ========================== */
  let deferredPrompt = null;

  const installButtons = [
    'install-app-btn',
    'install-app-header-btn',
    'install-app-mobile-btn',
    'install-app-animation-btn'
  ]
    .map(id => document.getElementById(id))
    .filter(Boolean);

  // Ocultar por defecto
  installButtons.forEach(btn => btn.classList.add('hidden'));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    installButtons.forEach(btn => {
      btn.classList.remove('hidden');
      btn.setAttribute('aria-hidden', 'false');
    });
  });

  installButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt = null;
    });
  });

  /* ==========================
     iOS – MODAL MANUAL
  ========================== */
  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const isStandalone = () =>
    window.navigator.standalone === true;

  if (isIOS() && !isStandalone()) {
    const iosModal = document.getElementById('ios-install-modal');
    const closeBtn = document.getElementById('close-ios-modal');

    if (iosModal && !localStorage.getItem('iosInstallSeen')) {
      setTimeout(() => {
        iosModal.classList.remove('hidden');
        iosModal.classList.add('flex');
        localStorage.setItem('iosInstallSeen', 'true');
      }, 3000);
    }

    closeBtn?.addEventListener('click', () => {
      iosModal?.classList.add('hidden');
      iosModal?.classList.remove('flex');
    });
  }

  /* ==========================
     HEADER SCROLL
  ========================== */
  const header = document.getElementById('main-header');
  let lastScrollY = window.scrollY;

  window.addEventListener('scroll', () => {
    const currentY = window.scrollY;

    if (!header) return;
    const goingDown = currentY > lastScrollY;

    if (goingDown && currentY > header.offsetHeight) {
      header.classList.add('header-hidden');
    } else {
      header.classList.remove('header-hidden');
    }

    lastScrollY = currentY;
  });

  /* ==========================
     SUPABASE – READY
  ========================== */
  let supabaseReadyPromise = null;

  async function ensureSupabase() {
    if (!supabaseReadyPromise && window.supabaseConfig?.ensureSupabaseReady) {
      supabaseReadyPromise = window.supabaseConfig.ensureSupabaseReady();
    }
    return supabaseReadyPromise;
  }

  /* ==========================
     DOM READY
  ========================== */
  document.addEventListener('DOMContentLoaded', async () => {

    /* ---------- Reveal on Scroll ---------- */
    const revealEls = document.querySelectorAll('.reveal-on-scroll, .animate-on-scroll');

    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('animate-fadeInUp');
        entry.target.style.opacity = '1';
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.2 });

    revealEls.forEach(el => {
      el.style.opacity = '0';
      revealObserver.observe(el);
    });

    /* ---------- Animación Camión ---------- */
    const animationSection = document.getElementById('animation-section');
    if (animationSection) {
      const animEls = [
        ['truck-animation', 'animate-truck-loop'],
        ['package-animation-1', 'animate-package-loop-1'],
        ['package-animation-2', 'animate-package-loop-2'],
        ['action-buttons', 'animate-button-loop']
      ];

      animEls.forEach(([id]) => {
        const el = document.getElementById(id);
        if (el) el.style.opacity = '0';
      });

      const animObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          animEls.forEach(([id, cls]) => {
            const el = document.getElementById(id);
            if (el) {
              el.style.opacity = '1';
              el.classList.add(cls);
            }
          });

          animObserver.unobserve(entry.target);
        });
      }, { threshold: 0.5 });

      animObserver.observe(animationSection);
    }

    /* ---------- Testimonios ---------- */
    const track = document.getElementById('testimonialsTrack');
    const empty = document.getElementById('testimonialsEmpty');

    if (track) {
      try {
        await ensureSupabase();
      } catch {}

      let client = null;
      try {
        // Usar cliente público o el principal si está disponible
        client = window.supabaseConfig?.getPublicClient?.() || window.supabaseConfig?.client;
      } catch {}

      let items = [];

      try {
        // ✅ CONSULTA CORRECTA: Usar tabla 'orders' en lugar de 'testimonials'
        const { data } = await client
          .from('orders')
          .select('name, customer_comment, rating, created_at')
          .not('customer_comment', 'is', null)
          .neq('customer_comment', '')
          .order('created_at', { ascending: false })
          .limit(10);

        if (data) items = data;
      } catch (err) {
        console.error('Error cargando testimonios:', err);
      }

      if (!items.length) {
        empty?.classList.remove('hidden');
        return;
      }

      const esc = s => String(s || '').replace(/[&<>"']/g, m =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
      );

      const cards = items.map((it, i) => {
        const name = esc(it.name || 'Cliente');
        const comment = esc(it.customer_comment || '');
        
        // Calcular estrellas desde rating (soporta objeto o número)
        let stars = 5;
        if (it.rating) {
            if (typeof it.rating === 'object') stars = Number(it.rating.stars || it.rating.service || 5);
            else stars = Number(it.rating);
        }
        stars = Math.max(0, Math.min(5, Math.round(stars)));
        
        const starsHtml = Array.from({ length: 5 }).map((_, idx) => 
            `<i class="fas fa-star ${idx < stars ? 'text-yellow-400' : 'text-gray-300'} text-xs"></i>`
        ).join('');

        const initial = name.charAt(0).toUpperCase();
        const colors = ['bg-blue-100 text-blue-600', 'bg-green-100 text-green-600', 'bg-purple-100 text-purple-600', 'bg-yellow-100 text-yellow-600', 'bg-pink-100 text-pink-600'];
        const theme = colors[i % colors.length];
        const dateStr = it.created_at ? new Date(it.created_at).toLocaleDateString('es-DO') : '';

        return `
        <div class="mx-4 flex-shrink-0 w-[300px] md:w-[350px] bg-white rounded-xl shadow-lg p-6 border border-gray-100 flex flex-col h-full transform transition-transform hover:-translate-y-1 duration-300">
          <div class="flex items-center gap-4 mb-4">
              <div class="w-12 h-12 rounded-full ${theme} flex items-center justify-center text-xl font-bold shadow-sm">
                ${initial}
              </div>
              <div>
                  <h4 class="font-bold text-gray-800 text-base">${name}</h4>
                  <div class="flex items-center gap-1 mt-1">${starsHtml}</div>
              </div>
          </div>
          <p class="text-gray-600 text-sm italic leading-relaxed flex-grow">"${comment}"</p>
          <div class="mt-4 pt-4 border-t border-gray-50 text-xs text-gray-400 flex justify-between items-center">
             <span>${dateStr}</span>
             <span class="flex items-center gap-1 text-green-600 font-medium"><i class="fas fa-check-circle"></i> Verificado</span>
          </div>
        </div>
        `;
      }).join('');

      // Duplicar contenido para efecto infinito si hay suficientes items
      track.innerHTML = items.length > 2 ? cards + cards : cards;
    }

    /* ---------- Formulario WhatsApp ---------- */
    const form = document.getElementById('colaborador-form');

    form?.addEventListener('submit', e => {
      e.preventDefault();

      const nombre = document.getElementById('nombre')?.value.trim();
      const telefono = document.getElementById('telefono')?.value.trim();
      const mensaje = document.getElementById('mensaje')?.value.trim();

      if (!nombre || !telefono) {
        alert('Completa nombre y teléfono');
        return;
      }

      const texto = `Hola! Quiero colaborar.\n\nNombre: ${nombre}\nTeléfono: ${telefono}${mensaje ? `\nMensaje: ${mensaje}` : ''}`;
      window.open(`https://wa.me/18297293822?text=${encodeURIComponent(texto)}`, '_blank');
    });

  });

})();
