document.addEventListener('DOMContentLoaded', () => {
    // Inicializar Supabase (asumiendo que supabase-config.js ya está cargado)
    if (typeof supabaseConfig === 'undefined') {
        console.error('Supabase config no está cargado. Asegúrate de incluir supabase-config.js antes de este script.');
        // Crear un div de error para que sea visible en la página
        const errorDiv = document.getElementById('loginError');
        if(errorDiv) {
            errorDiv.textContent = 'Error de configuración. Contacte al administrador.';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    const loginForm = document.getElementById('collabLoginForm');
    const errorDiv = document.getElementById('loginError');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        const { data, error } = await supabaseConfig.loginCollaborator(email, password);

        if (error) {
            console.error('Error de inicio de sesión:', error.message);
            errorDiv.textContent = 'Correo o contraseña incorrectos. Por favor, inténtalo de nuevo.';
            errorDiv.classList.remove('hidden');
        } else if (data.user) {
            console.log('Inicio de sesión exitoso:', data.user);
            // Guardar la sesión del usuario para usarla en otras páginas
            sessionStorage.setItem('supabase.auth.token', JSON.stringify(data.session));
            // Redirigir al panel principal
            window.location.href = 'inicio.html';
        }
    });

    lucide.createIcons();
});