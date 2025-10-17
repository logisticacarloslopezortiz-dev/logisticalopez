document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleButton = document.getElementById('sidebar-toggle');
    const toggleIcon = document.getElementById('sidebar-toggle-icon');

    if (!sidebar || !mainContent || !toggleButton || !toggleIcon) {
        console.warn('Elementos del sidebar no encontrados. La funcionalidad de colapsar no estará activa.');
        return;
    }

    const applyState = (isCollapsed) => {
        if (isCollapsed) {
            sidebar.classList.remove('w-64', 'p-6');
            sidebar.classList.add('w-20', 'p-4');
            mainContent.classList.add('ml-20');
            mainContent.classList.remove('ml-64');
            toggleIcon.setAttribute('data-lucide', 'panel-right-open');
            document.querySelectorAll('.sidebar-text').forEach(el => el.classList.add('hidden'));
        } else {
            sidebar.classList.add('w-64', 'p-6');
            sidebar.classList.remove('w-20', 'p-4');
            mainContent.classList.remove('ml-20');
            mainContent.classList.add('ml-64');
            toggleIcon.setAttribute('data-lucide', 'panel-left-close');
            document.querySelectorAll('.sidebar-text').forEach(el => el.classList.remove('hidden'));
        }
        if (window.lucide) {
            lucide.createIcons();
        }
    };

    toggleButton.addEventListener('click', () => {
        const isCollapsed = !sidebar.classList.contains('w-20');
        localStorage.setItem('sidebarCollapsed', isCollapsed);
        applyState(isCollapsed);
    });

    // Aplicar estado guardado al cargar la página
    applyState(localStorage.getItem('sidebarCollapsed') === 'true');
});