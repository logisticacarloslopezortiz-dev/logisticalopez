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

let supabaseReadyPromise = null;
async function ensureSupabaseOnce() {
  if (!supabaseReadyPromise && window.supabaseConfig?.ensureSupabaseReady) {
    supabaseReadyPromise = window.supabaseConfig.ensureSupabaseReady();
  }
  return supabaseReadyPromise;
}

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
  const track = document.getElementById('testimonialsTrack');
  const empty = document.getElementById('testimonialsEmpty');
  if (!track) return;

  // Esperar a que Supabase esté listo
  if (window.supabaseConfig && window.supabaseConfig.ensureSupabaseReady) {
    try {
      await ensureSupabaseOnce();
    } catch (e) {
      console.warn('ensureSupabaseReady falló, usando REST fallback:', e?.message || e);
    }
  }

  let client = null;
  if (window.supabaseConfig) {
    try {
      client = window.supabaseConfig.getPublicClient?.() || null;
    } catch (_) {
      client = null;
    }
  }

  let items = [];
  if (!client && window.supabaseConfig && typeof window.supabaseConfig.restSelect === 'function') {
    try {
      const { data } = await window.supabaseConfig.restSelect('testimonials', {
        select: '*',
        'is_public': 'eq.true',
        'order': 'created_at.desc',
        'limit': '10'
      });
      items = Array.isArray(data) ? data : [];
    } catch (_) {}
  }

  if (client && items.length === 0 && typeof client.rpc === 'function') {
    try {
      const { data, error } = await client.rpc('get_public_testimonials', { limit_count: 10 });
      if (!error && Array.isArray(data)) {
        items = data;
      } else if (typeof client.from === 'function') {
        const { data: tableData, error: tableError } = await client
          .from('testimonials')
          .select('*')
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(10);
        if (!tableError && tableData) items = tableData;
      }
    } catch (err) {
      console.error('Error fetching testimonials:', err);
    }
  } else if (client && items.length === 0 && typeof client.from === 'function') {
    try {
      const { data: tableData, error: tableError } = await client
        .from('testimonials')
        .select('*')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!tableError && tableData) items = tableData;
    } catch (err) {
      console.error('Error fetching testimonials (select only):', err);
    }
  }

  if (!items.length) {
    empty && empty.classList.remove('hidden');
    return;
  }

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  
  // Generar tarjetas con diseño mejorado y dinámico
  const generateCard = (it, index) => {
    const stars = Math.max(0, Math.min(5, parseInt(it.stars || 5, 10)));
    const starsHtml = Array.from({ length: 5 }).map((_, i) => 
      `<i class="fas fa-star ${i < stars ? 'text-yellow-400' : 'text-gray-300'} text-xs"></i>`
    ).join('');
    
    const comment = esc(it.comment || '');
    const name = esc(it.client_name || 'Cliente');
    const initial = name.charAt(0).toUpperCase();
    
    // Formatear fecha
    let dateStr = '';
    try {
      if (it.created_at) {
        const d = new Date(it.created_at);
        dateStr = d.toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch(_) {}

    // Colores aleatorios más vibrantes para el avatar y bordes
    const colors = [
      { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-l-4 border-blue-500', icon: 'text-blue-400' },
      { bg: 'bg-green-100', text: 'text-green-600', border: 'border-l-4 border-green-500', icon: 'text-green-400' },
      { bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-l-4 border-purple-500', icon: 'text-purple-400' },
      { bg: 'bg-yellow-100', text: 'text-yellow-600', border: 'border-l-4 border-yellow-500', icon: 'text-yellow-400' },
      { bg: 'bg-pink-100', text: 'text-pink-600', border: 'border-l-4 border-pink-500', icon: 'text-pink-400' },
      { bg: 'bg-indigo-100', text: 'text-indigo-600', border: 'border-l-4 border-indigo-500', icon: 'text-indigo-400' },
      { bg: 'bg-red-100', text: 'text-red-600', border: 'border-l-4 border-red-500', icon: 'text-red-400' },
      { bg: 'bg-teal-100', text: 'text-teal-600', border: 'border-l-4 border-teal-500', icon: 'text-teal-400' },
    ];
    const theme = colors[index % colors.length];

    return `
      <div class="w-[300px] md:w-[350px] bg-white rounded-xl shadow-lg p-6 flex-shrink-0 ${theme.border} transform transition-all hover:-translate-y-2 hover:shadow-2xl duration-300 mx-4 flex flex-col justify-between h-full relative overflow-hidden group">
        <!-- Elemento decorativo de fondo -->
        <div class="absolute -right-6 -top-6 w-24 h-24 rounded-full ${theme.bg} opacity-20 group-hover:scale-150 transition-transform duration-500"></div>
        
        <div>
          <div class="flex items-center gap-4 mb-4 relative z-10">
              <div class="w-12 h-12 rounded-full ${theme.bg} ${theme.text} flex items-center justify-center text-xl font-bold shadow-sm ring-2 ring-white">
                ${initial}
              </div>
              <div>
                  <h4 class="font-bold text-gray-800 text-base leading-tight">${name}</h4>
                  <div class="flex items-center gap-1 mt-1">${starsHtml}</div>
              </div>
          </div>
          <div class="relative z-10">
            <i class="fas fa-quote-left ${theme.icon} text-3xl absolute -top-3 -left-1 opacity-20"></i>
            <p class="text-gray-600 text-sm italic leading-relaxed pl-6 relative z-10 min-h-[60px]">"${comment}"</p>
          </div>
        </div>
        
        <div class="flex justify-between items-center pt-4 mt-4 border-t border-gray-100 relative z-10">
            <span class="text-xs text-gray-500 font-medium flex items-center gap-1">
              <i class="far fa-calendar-alt"></i> ${dateStr}
            </span>
            <div class="flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-full">
               <span class="text-[10px] font-bold uppercase tracking-wider text-blue-600">Verificado</span>
               <i class="fas fa-check-circle text-blue-500 text-xs"></i>
            </div>
        </div>
      </div>
    `;
  };

  const html = items.map(generateCard).join('');
  
  // Duplicar el contenido suficientes veces para asegurar el loop infinito suave
  // Si hay pocos items, duplicamos más veces
  let content = html;
  if (items.length < 5) content += html + html + html; 
  else content += html;

  track.innerHTML = content;
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
