document.addEventListener('DOMContentLoaded', async () => {
    // --- INICIO: Auth Guard para el Panel de Administrador ---
    const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();

    if (sessionError || !session) {
        console.error('No hay sesión activa. Redirigiendo al login.');
        window.location.href = '/login.html';
        return;
    }

    const userRole = localStorage.getItem('userRole');
    if (userRole !== 'administrador') {
        console.error('Acceso denegado. Se requiere rol de administrador.');
        await supabaseConfig.client.auth.signOut();
        window.location.href = '/login.html';
        return;
    }
    // --- FIN: Auth Guard ---

    // Emitir evento global indicando que la sesión admin está lista
    window.dispatchEvent(new Event('admin-session-ready'));

    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleButton = document.getElementById('sidebar-toggle');
    const logoutButton = document.getElementById('logout-button');
    
    if (!sidebar || !mainContent || !toggleButton) {
        console.warn('Algunos elementos del sidebar no fueron encontrados. La funcionalidad podría ser limitada.');
        return;
    }

    // --- INICIO: Lógica de Sidebar Mejorada ---

    const applyState = (isCollapsed, isPermanent = false) => {
        const sidebarTexts = document.querySelectorAll('.sidebar-text');
        const sidebarLinks = document.querySelectorAll('#sidebar nav a');
        const toggleIcon = document.getElementById('sidebar-toggle-icon');

        if (isCollapsed) { // Estado Colapsado
            sidebar.classList.add('w-20');
            sidebar.classList.remove('w-64');
            mainContent.classList.add('ml-20');
            mainContent.classList.remove('ml-64');
            sidebarTexts.forEach(el => el.classList.add('hidden'));
            sidebarLinks.forEach(el => el.classList.add('justify-center'));
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-right-open');
        } else { // Estado Expandido
            sidebar.classList.remove('w-20');
            sidebar.classList.add('w-64');
            mainContent.classList.remove('ml-20');
            mainContent.classList.add('ml-64');
            sidebarTexts.forEach(el => el.classList.remove('hidden'));
            sidebarLinks.forEach(el => el.classList.remove('justify-center'));
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left-close');
        }

        // Actualizar íconos de Lucide
        if (window.lucide) {
            lucide.createIcons();
        }
    };

    toggleButton.addEventListener('click', () => {
        const isCurrentlyCollapsed = sidebar.classList.contains('w-20');
        localStorage.setItem('sidebarCollapsed', !isCurrentlyCollapsed);
        applyState(!isCurrentlyCollapsed, true);
    });

    // Expansión automática al pasar el mouse
    sidebar.addEventListener('mouseenter', () => {
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            applyState(false);
        }
    });

    sidebar.addEventListener('mouseleave', () => {
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            applyState(true);
        }
    });

    // Aplicar estado guardado al cargar la página
    applyState(localStorage.getItem('sidebarCollapsed') === 'true');
    // --- FIN: Lógica de Sidebar Mejorada ---

    // --- INICIO: Lógica de Logout ---
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            const { error } = await supabaseConfig.client.auth.signOut();
            
            // Limpiar datos de sesión del localStorage
            localStorage.removeItem('userRole');
            localStorage.removeItem('userData');

            if (error) {
                console.error('Error al cerrar sesión:', error);
            }
            window.location.href = '/login.html'; // Redirigir siempre al login
        });
    }
});