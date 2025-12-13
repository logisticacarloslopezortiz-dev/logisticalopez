document.addEventListener('DOMContentLoaded', async () => {
    const path = (location.pathname || '').toLowerCase();
    const endsWith = (p) => path.endsWith('/' + p) || path.endsWith(p);
    const adminPages = ['inicio.html','servicios.html','ganancias.html','mi-negocio.html','colaboradores.html'];
    const isAdminPage = adminPages.some(endsWith);
    const isPublicPage = endsWith('historial-solicitudes.html');
    const loginHref = 'login.html';
    try { if (supabaseConfig.ensureFreshSession) await supabaseConfig.ensureFreshSession(); } catch(_) {}
    const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
    const now = Math.floor(Date.now() / 1000);
    const exp = session?.expires_at || 0;
    const isExpired = !session || exp <= now;
    if ((sessionError || isExpired) && !isPublicPage) {
        window.location.href = loginHref;
        return;
    }

    if (isAdminPage) {
        let hasAdminRole = false;
        try {
            const { data: isAdmin, error: rpcError } = await supabaseConfig.client.rpc('is_admin');
            if (rpcError) { try { console.error('Error RPC is_admin:', rpcError); } catch(_) {} }
            hasAdminRole = !!isAdmin;
        } catch(_) {}
        if (!hasAdminRole) {
            try { console.warn('Sesión sin rol administrador; redirigiendo a login'); } catch(_){}
            window.location.href = loginHref;
            return;
        }
        window.dispatchEvent(new Event('admin-session-ready'));
    } else {
        window.dispatchEvent(new Event('session-ready'));
    }

    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleButton = document.getElementById('sidebar-toggle');
    const logoutButton = document.getElementById('logout-button');
    const logoutMobile = document.getElementById('logout-button-mobile');
    const mobileToggle = document.getElementById('mobileSidebarToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (!sidebar || !mainContent) {
        console.warn('Algunos elementos del sidebar no fueron encontrados. La funcionalidad podría ser limitada.');
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
