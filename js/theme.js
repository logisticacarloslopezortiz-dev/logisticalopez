// Sistema de modo oscuro/claro
class ThemeManager {
  constructor() {
    this.currentTheme = this.getStoredTheme() || this.getSystemTheme();
    this.init();
  }

  init() {
    this.applyTheme(this.currentTheme);
    this.createThemeToggle();
    this.setupSystemThemeListener();
  }

  getStoredTheme() {
    return localStorage.getItem('tlc_theme');
  }

  getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme(theme) {
    const html = document.documentElement;
    
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    
    this.currentTheme = theme;
    localStorage.setItem('tlc_theme', theme);
    
    // Actualizar el toggle si existe
    this.updateToggleIcon();
  }

  toggleTheme() {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme);
    
    // Mostrar notificación si está disponible
    if (typeof showInfo === 'function') {
      showInfo(`Modo ${newTheme === 'dark' ? 'oscuro' : 'claro'} activado`, {
        duration: 2000
      });
    }
  }

  createThemeToggle() {
    // Buscar el botón de toggle existente
    const existingToggle = document.getElementById('themeToggle');
    
    if (existingToggle) {
      // Si ya existe un botón, solo agregar el evento
      existingToggle.addEventListener('click', () => {
        this.toggleTheme();
      });
      
      // Actualizar el texto y los iconos según el tema actual
      this.updateToggleUI(existingToggle);
      return;
    }
    
    // Si no existe, buscar el header para agregar el toggle
    const header = document.querySelector('header .flex.items-center.gap-3');
    if (!header) return;

    // Crear botón de toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'themeToggle';
    toggleBtn.className = 'p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors duration-200';
    toggleBtn.setAttribute('aria-label', 'Cambiar tema');
    toggleBtn.innerHTML = this.getToggleIcon();
    
    toggleBtn.addEventListener('click', () => {
      this.toggleTheme();
    });
    
    // Insertar antes del primer elemento
    header.insertBefore(toggleBtn, header.firstChild);
    
    // Actualizar iconos de Lucide
    setTimeout(() => {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    }, 0);
  }

  getToggleIcon() {
    return this.currentTheme === 'dark' 
      ? '<i data-lucide="sun" class="w-5 h-5 text-yellow-500"></i>'
      : '<i data-lucide="moon" class="w-5 h-5 text-gray-600"></i>';
  }

  updateToggleIcon() {
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
      this.updateToggleUI(toggleBtn);
    }
  }
  
  updateToggleUI(toggleBtn) {
    // Verificar si el botón tiene la estructura de panel-colaborador.html
    const darkIcon = toggleBtn.querySelector('.dark-icon');
    const lightIcon = toggleBtn.querySelector('.light-icon');
    const themeText = toggleBtn.querySelector('.theme-text');
    
    if (darkIcon && lightIcon && themeText) {
      // Actualizar según el tema actual
      if (this.currentTheme === 'dark') {
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
        themeText.textContent = 'Modo claro';
      } else {
        darkIcon.classList.remove('hidden');
        lightIcon.classList.add('hidden');
        themeText.textContent = 'Modo oscuro';
      }
    } else {
      // Actualizar el icono simple
      toggleBtn.innerHTML = this.getToggleIcon();
    }
    
    // Actualizar iconos de Lucide
    setTimeout(() => {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    }, 0);
  }

  setupSystemThemeListener() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    mediaQuery.addEventListener('change', (e) => {
      // Solo cambiar si no hay preferencia guardada
      if (!this.getStoredTheme()) {
        this.applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // Método para aplicar estilos CSS personalizados para modo oscuro
  injectDarkModeStyles() {
    const styleId = 'tlc-dark-mode-styles';
    
    // Evitar duplicar estilos
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Modo oscuro personalizado */
      .dark {
        color-scheme: dark;
      }
      
      .dark body {
        background-color: #0f172a;
        color: #f1f5f9;
      }
      
      .dark .bg-white {
        background-color: #1e293b !important;
      }
      
      .dark .bg-gray-50 {
        background-color: #0f172a !important;
      }
      
      .dark .bg-gray-100 {
        background-color: #1e293b !important;
      }
      
      .dark .bg-gray-200 {
        background-color: #334155 !important;
      }
      
      .dark .text-gray-900 {
        color: #f1f5f9 !important;
      }
      
      .dark .text-gray-800 {
        color: #e2e8f0 !important;
      }
      
      .dark .text-gray-700 {
        color: #cbd5e1 !important;
      }
      
      .dark .text-gray-600 {
        color: #94a3b8 !important;
      }
      
      .dark .text-gray-500 {
        color: #64748b !important;
      }
      
      .dark .border-gray-200 {
        border-color: #334155 !important;
      }
      
      .dark .border-gray-300 {
        border-color: #475569 !important;
      }
      
      .dark input, .dark textarea, .dark select {
        background-color: #1e293b;
        border-color: #475569;
        color: #f1f5f9;
      }
      
      .dark input:focus, .dark textarea:focus, .dark select:focus {
        border-color: #ef4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }
      
      .dark .shadow-lg {
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2);
      }
      
      .dark .shadow-md {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1);
      }
      
      .dark .hover\:bg-gray-50:hover {
        background-color: #334155 !important;
      }
      
      .dark .hover\:bg-gray-100:hover {
        background-color: #475569 !important;
      }
      
      /* Botones en modo oscuro */
      .dark .bg-red-600 {
        background-color: #dc2626 !important;
      }
      
      .dark .hover\:bg-red-700:hover {
        background-color: #b91c1c !important;
      }
      
      /* Modales en modo oscuro */
      .dark .bg-black\/50 {
        background-color: rgba(0, 0, 0, 0.7) !important;
      }
      
      /* Tablas en modo oscuro */
      .dark table {
        background-color: #1e293b;
      }
      
      .dark th {
        background-color: #334155;
        color: #f1f5f9;
      }
      
      .dark td {
        border-color: #475569;
      }
      
      .dark tr:hover {
        background-color: #334155;
      }
      
      /* Badges en modo oscuro */
      .dark .bg-yellow-100 {
        background-color: #451a03 !important;
        color: #fbbf24 !important;
      }
      
      .dark .bg-green-100 {
        background-color: #052e16 !important;
        color: #22c55e !important;
      }
      
      .dark .bg-blue-100 {
        background-color: #0c1e3a !important;
        color: #3b82f6 !important;
      }
      
      .dark .bg-red-100 {
        background-color: #450a0a !important;
        color: #ef4444 !important;
      }
      
      /* Sidebar en modo oscuro */
      .dark .bg-gradient-to-br {
        background: linear-gradient(to bottom right, #1e293b, #0f172a) !important;
      }
      
      /* Transiciones suaves */
      * {
        transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      }
    `;
    
    document.head.appendChild(style);
  }
}

// Inicializar el sistema de temas
const themeManager = new ThemeManager();

// Inyectar estilos de modo oscuro
themeManager.injectDarkModeStyles();

// Exponer funciones globales
window.tlcTheme = {
  toggle: () => themeManager.toggleTheme(),
  set: (theme) => themeManager.applyTheme(theme),
  get: () => themeManager.currentTheme
};

console.log('🎨 Sistema de temas inicializado');
console.log('💡 Usa tlcTheme en la consola para gestionar temas manualmente');