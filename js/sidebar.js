document.addEventListener('DOMContentLoaded', async () => {
    const path = (location.pathname || '').toLowerCase();
    const isAdminPage = path.endsWith('/inicio.html') || path.endsWith('inicio.html');
    const loginHref = isAdminPage ? 'login.html' : 'login-colaborador.html';

    const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
    if (sessionError || !session) {
        window.location.href = loginHref;
        return;
    }

    if (isAdminPage) {
        const userRole = localStorage.getItem('userRole');
        if (userRole !== 'administrador') {
            try { localStorage.clear(); } catch(_){}
            try { await supabaseConfig.client.auth.signOut(); } catch(_){}
            window.location.href = 'login.html';
            return;
        }
    }

    window.dispatchEvent(new Event(isAdminPage ? 'admin-session-ready' : 'session-ready'));

    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleButton = document.getElementById('sidebar-toggle');
    const logoutButton = document.getElementById('logout-button');
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

        // Actualizar íconos de Lucide
        if (window.lucide) {
            lucide.createIcons();
        }
    };

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
    window.addEventListener('resize', adjustMainContent);
    // --- FIN: Lógica de Sidebar Mejorada ---

    // --- INICIO: Lógica de Logout ---
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            const { error } = await supabaseConfig.client.auth.signOut();
            
            // ✅ MEJORA: Limpieza completa de localStorage para asegurar que no queden datos de la sesión anterior.
            localStorage.clear();

            if (error) {
                console.error('Error al cerrar sesión:', error);
            }
            window.location.href = loginHref;
        });
    }
});