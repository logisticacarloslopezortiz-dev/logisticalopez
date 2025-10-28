document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos
    if (window.lucide) {
        lucide.createIcons();
    }

    const loginForm = document.getElementById('collabLoginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMsg = document.getElementById('loginError');

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorMsg.classList.add('hidden');
        errorMsg.textContent = '';

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            errorMsg.textContent = 'Por favor, ingresa tu correo y contraseña.';
            errorMsg.classList.remove('hidden');
            return;
        }

        try {
            const { data, error } = await supabaseConfig.client.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) throw error;

            if (data.user) {
                // ✅ Sin roles: cualquier usuario válido accede al panel de colaborador
                // Guardar datos básicos para utilizar en el panel si fuera necesario
                const fullName = data.user.user_metadata?.name || data.user.user_metadata?.full_name || '';
                const placa = data.user.user_metadata?.matricula || '';
                if (fullName) localStorage.setItem('collabName', fullName);
                if (placa) localStorage.setItem('collabMatricula', placa);

                window.location.href = 'panel-colaborador.html';
            }
        } catch (error) {
            console.error('Error de inicio de sesión:', error.message);
            if (error.message.includes('Invalid API key')) {
                errorMsg.textContent = 'Error de configuración. La clave de API no es válida.';
            } else if (error.message.includes('Invalid login credentials')) {
                errorMsg.textContent = 'Correo o contraseña incorrectos.';
            } else if (error.message.includes('Email not confirmed')) {
                errorMsg.textContent = 'Tu correo no ha sido confirmado. Revisa tu bandeja de entrada.';
            } else if (error.message.includes('administradores')) {
                errorMsg.textContent = error.message;
            } else if (error.message.includes('Failed to fetch')) {
                errorMsg.textContent = 'No se pudo conectar con el servidor. Revisa tu conexión a internet o la configuración de CORS.';
            } else {
                errorMsg.textContent = 'Ocurrió un error. Inténtalo de nuevo.';
            }
            errorMsg.classList.remove('hidden');
        }
    });
});