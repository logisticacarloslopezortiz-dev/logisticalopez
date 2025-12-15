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
                let deviceId = localStorage.getItem(deviceKeyName);
                if (!deviceId) {
                    deviceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                    localStorage.setItem(deviceKeyName, deviceId);
                }

                // Vinculación server-side del dispositivo para reforzar seguridad
                try {
                  const isDevOrigin = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
                  if (!isDevOrigin) {
                    const { data: bindData, error: bindErr } = await supabaseConfig.client.functions.invoke('bind-device', {
                      body: { device_id: deviceId },
                      headers: { 'Content-Type': 'application/json' }
                    });
                    if (bindErr) throw bindErr;
                    if (bindData && bindData.error === 'device_bound') {
                      await supabaseConfig.client.auth.signOut();
                      errorMsg.textContent = 'Este dispositivo ya está vinculado a otro usuario. Contacta al administrador para desvincularlo.';
                      errorMsg.classList.remove('hidden');
                      return;
                    }
                  } else {
                    console.warn('Omitiendo bind-device en desarrollo por CORS.');
                  }
                } catch (e) {
                  console.warn('No se pudo vincular servidor-side el dispositivo:', e?.message || e);
                  // Continuar si el cliente ya está vinculado localmente; el admin puede revisar luego
                }

                try {
                  const v = await supabaseConfig.validateActiveCollaborator(data.user.id);
                  if (!v?.isValid) {
                    await supabaseConfig.client.auth.signOut();
                    const msg = v?.error === 'Collaborator is not active'
                      ? 'Tu cuenta ha sido desactivada. Contacta al administrador.'
                      : v?.error === 'Invalid role for this panel'
                        ? 'No tienes permisos de colaborador para este panel.'
                        : 'No estás registrado como colaborador.';
                    errorMsg.textContent = msg;
                    errorMsg.classList.remove('hidden');
                    return;
                  }
                } catch (e) {
                  console.error('Error validando colaborador:', e?.message || e);
                }

                try { localStorage.setItem('userRole','colaborador'); } catch(_){ }
                try {
                  await supabaseConfig.ensureFreshSession?.();
                  const { data: { session } } = await supabaseConfig.client.auth.getSession();
                  if (!session) {
                    await new Promise(r => setTimeout(r, 400));
                  }
                } catch(_){ }
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
