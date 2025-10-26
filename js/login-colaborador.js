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
                // ✅ MEJORA: Verificar el rol del usuario para asegurar que no es un administrador.
                const { data: profile, error: profileError } = await supabaseConfig.client
                    .from('collaborators')
                    .select('role')
                    .eq('id', data.user.id)
                    .single();

                if (profileError) {
                    console.warn('No se pudo encontrar el perfil del colaborador. Usando user_metadata.role como fallback.');
                }

                let role = profile?.role?.toLowerCase();
                if (!role) {
                    const { data: userData } = await supabaseConfig.client.auth.getUser();
                    role = (userData?.user?.user_metadata?.role || '').toLowerCase();
                }

                if (!role) {
                    await supabaseConfig.client.auth.signOut(); // Cerrar sesión por seguridad
                    throw new Error('No se pudo encontrar el perfil del colaborador.');
                }

                if (role === 'administrador') {
                    await supabaseConfig.client.auth.signOut(); // Cerrar sesión por seguridad
                    throw new Error('Los administradores deben iniciar sesión en el panel principal.');
                }

                window.location.href = 'panel-colaborador.html'; // Redirigir al panel del colaborador
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