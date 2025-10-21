document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos
    if (window.lucide) {
        lucide.createIcons();
    }

    // Redirigir si ya hay una sesión activa
    supabaseConfig.client.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            console.log('Sesión de colaborador activa encontrada, redirigiendo al panel.');
            // Idealmente, aquí podrías verificar el rol y redirigir a la página correcta
            window.location.href = 'panel-colaborador.html';
        }
    }).catch(error => {
        console.error('Error al verificar la sesión en el login de colaborador:', error);
    });

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
                // Guardar datos del colaborador en localStorage para usarlos en el panel
                localStorage.setItem('collaboratorData', JSON.stringify(data.user));
                window.location.href = 'panel-colaborador.html'; // Redirigir al panel del colaborador
            }
        } catch (error) {
            console.error('Error de inicio de sesión:', error.message);
            if (error.message.includes('Invalid login credentials')) {
                errorMsg.textContent = 'Correo o contraseña incorrectos.';
            } else if (error.message.includes('Email not confirmed')) {
                errorMsg.textContent = 'Tu correo no ha sido confirmado. Revisa tu bandeja de entrada.';
            } else {
                errorMsg.textContent = 'Ocurrió un error. Inténtalo de nuevo.';
            }
            errorMsg.classList.remove('hidden');
        }
    });
});