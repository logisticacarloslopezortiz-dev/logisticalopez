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
                // --- Bloqueo por dispositivo: solo un usuario por dispositivo ---
                const deviceKeyName = 'tlc_device_id';
                const boundKeyName = 'tlc_bound_user_id';
                let deviceId = localStorage.getItem(deviceKeyName);
                if (!deviceId) {
                    deviceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                    localStorage.setItem(deviceKeyName, deviceId);
                }

                const boundUserId = localStorage.getItem(boundKeyName);
                const currentUserId = data.user.id;
                if (boundUserId && boundUserId !== currentUserId) {
                    // Si el dispositivo ya está vinculado a otro usuario, bloquear acceso
                    await supabaseConfig.client.auth.signOut();
                    errorMsg.textContent = 'Este dispositivo está vinculado a otro usuario. Contacta al administrador para desvincularlo.';
                    errorMsg.classList.remove('hidden');
                    return;
                }
                // Vincular si aún no está
                if (!boundUserId) localStorage.setItem(boundKeyName, currentUserId);

                // Vinculación server-side del dispositivo para reforzar seguridad
                try {
                  const { data: bindData, error: bindErr } = await supabaseConfig.client.functions.invoke('bind-device', {
                    body: { device_id: deviceId }
                  });
                  if (bindErr) throw bindErr;
                  if (bindData && bindData.error === 'device_bound') {
                    await supabaseConfig.client.auth.signOut();
                    errorMsg.textContent = 'Este dispositivo ya está vinculado a otro usuario. Contacta al administrador para desvincularlo.';
                    errorMsg.classList.remove('hidden');
                    return;
                  }
                } catch (e) {
                  console.warn('No se pudo vincular servidor-side el dispositivo:', e?.message || e);
                  // Continuar si el cliente ya está vinculado localmente; el admin puede revisar luego
                }

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