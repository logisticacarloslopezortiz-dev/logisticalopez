document.addEventListener('DOMContentLoaded', async () => {
  // ✅ CORRECCIÓN ARQUITECTURAL: Centralizar la validación y emitir un evento único.
  const path = location.pathname.split('/').pop() || '';
  const currentPage = path.split('?')[0].toLowerCase(); // Ignorar parámetros de la URL
  const adminPages = new Set([
    'inicio.html',
    'servicios.html',
    'ganancias.html',
    'mi-negocio.html',
    'colaboradores.html',
    'historial-solicitudes.html'
  ]);

  const collabPages = new Set([
    'panel-colaborador.html',
    'rendimiento.html'
  ]);
  const isAdminPage = adminPages.has(currentPage);
  const isCollabPage = collabPages.has(currentPage);
  const loginHref = isCollabPage ? 'login-colaborador.html' : 'login.html';

  let adminReady = false;

  if (isAdminPage) {
    try {
      await supabaseConfig.ensureFreshSession?.();

      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const now = Math.floor(Date.now() / 1000);
      const uid = session?.user?.id || null;

      if (!session || session.expires_at <= now || !uid) {
        window.location.replace(`${loginHref}?redirect=${encodeURIComponent(currentPage)}`);
        return;
      }

      const [admRes, ownRes] = await Promise.all([
        supabaseConfig.client.rpc('is_admin', { uid }),
        supabaseConfig.client.rpc('is_owner', { uid })
      ]);
      const isAdmin = !!admRes?.data;
      const isOwner = !!ownRes?.data;
      if (!(isAdmin || isOwner)) {
        window.location.replace(`${loginHref}?redirect=${encodeURIComponent(currentPage)}`);
        return;
      }

      adminReady = true;
    } catch (err) {
      console.error('[Sidebar] Error validando sesión admin/owner:', err);
      window.location.replace('login.html');
      return;
    }
  }

  // ✅ EVENTO GLOBAL – SE EMITE UNA SOLA VEZ, con el estado de la sesión.
  window.tlcAdminReady = adminReady; // Flag global para scripts que carguen tarde
  document.dispatchEvent(
    new CustomEvent('admin-session-ready', {
      detail: { 
        isAdmin: adminReady,
        userId: (adminReady && typeof session !== 'undefined') ? session.user.id : null 
      }
    })
  );

    // --- El resto de la lógica de UI del sidebar continúa aquí ---
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content') || document.querySelector('main');
    const toggleButton = document.getElementById('sidebar-toggle');
    const logoutButton = document.getElementById('logout-button');
    const logoutMobile = document.getElementById('logout-button-mobile');
    const mobileToggle = document.getElementById('mobileSidebarToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (!sidebar || !mainContent) {
        return;
    }

    // --- INICIO: Lógica de Sidebar Mejorada ---

    const applyState = (isCollapsed, isPermanent = false) => {
        const sidebarTexts = document.querySelectorAll('.sidebar-text');
        const sidebarLinks = document.querySelectorAll('#sidebar nav a');
        const toggleIcon = document.getElementById('sidebar-toggle-icon');

        // Solo aplicar clases de ancho en pantallas medianas y grandes
        if (window.innerWidth >= 768) {
            if (isCollapsed) { // Estado Colapsado
                sidebar.classList.add('w-20');
                sidebar.classList.remove('w-64');
                mainContent.classList.add('md:ml-20');
                mainContent.classList.remove('md:ml-64');
                sidebarTexts.forEach(el => el.classList.add('hidden'));
                sidebarLinks.forEach(el => el.classList.add('justify-center'));
                if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-right-open');
            } else { // Estado Expandido
                sidebar.classList.remove('w-20');
                sidebar.classList.add('w-64');
                mainContent.classList.remove('md:ml-20');
                mainContent.classList.add('md:ml-64');
                sidebarTexts.forEach(el => el.classList.remove('hidden'));
                sidebarLinks.forEach(el => el.classList.remove('justify-center'));
                if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left-close');
            }
        }
    };

    function refreshLucide() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (_) {}
        }
    }

    // Función para manejar el sidebar en móvil
    const toggleMobileSidebar = () => {
        const isVisible = !sidebar.classList.contains('-translate-x-full');
        
        if (isVisible) {
            // Ocultar sidebar
            sidebar.classList.add('-translate-x-full');
            if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
        } else {
            // Mostrar sidebar
            sidebar.classList.remove('-translate-x-full');
            if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
        }
    };

    // Configurar eventos para móvil
    if (mobileToggle) {
        mobileToggle.addEventListener('click', toggleMobileSidebar);
    }
    
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', toggleMobileSidebar);
    }

    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            const isCurrentlyCollapsed = sidebar.classList.contains('w-20');
            localStorage.setItem('sidebarCollapsed', !isCurrentlyCollapsed);
            applyState(!isCurrentlyCollapsed, true);
        });
    }

    // Expansión automática al pasar el mouse (solo en escritorio)
    sidebar.addEventListener('mouseenter', () => {
        if (window.innerWidth >= 768 && localStorage.getItem('sidebarCollapsed') === 'true') {
            applyState(false);
        }
    });

    sidebar.addEventListener('mouseleave', () => {
        if (window.innerWidth >= 768 && localStorage.getItem('sidebarCollapsed') === 'true') {
            applyState(true);
        }
    });

    // Aplicar estado guardado al cargar la página
    applyState(localStorage.getItem('sidebarCollapsed') === 'true');
    refreshLucide();
    
    // Ajustar el contenido principal en móvil
    const adjustMainContent = () => {
        if (window.innerWidth < 768) {
            mainContent.classList.remove('ml-20', 'ml-64');
            mainContent.classList.add('ml-0');
        } else {
            mainContent.classList.remove('ml-0');
            if (localStorage.getItem('sidebarCollapsed') === 'true') {
                mainContent.classList.add('ml-20');
                mainContent.classList.remove('ml-64');
            } else {
                mainContent.classList.remove('ml-20');
                mainContent.classList.add('ml-64');
            }
        }
    };
    
    // Ajustar al cargar y al cambiar tamaño
    adjustMainContent();
    if (!window.__SIDEBAR_RESIZE__) {
        window.__SIDEBAR_RESIZE__ = true;
        window.addEventListener('resize', adjustMainContent);
    }
    // --- FIN: Lógica de Sidebar Mejorada ---

    // --- INICIO: Lógica de Logout ---
    async function performLogout(){
        const { error } = await supabaseConfig.client.auth.signOut();
        localStorage.clear();
        if (error) {
            console.error('Error al cerrar sesión:', error);
        }
        window.location.href = loginHref;
    }

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            await performLogout();
        });
    }
    if (logoutMobile) {
        logoutMobile.addEventListener('click', async () => {
            await performLogout();
        });
    }
});
