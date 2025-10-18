document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleButton = document.getElementById('sidebar-toggle');    
    
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
});