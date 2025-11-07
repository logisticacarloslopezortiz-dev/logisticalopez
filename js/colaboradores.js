// js/colaboradores.js

document.addEventListener('DOMContentLoaded', async () => {
  // --- ELEMENTOS DEL DOM ---
  const tableBody = document.getElementById('colaboradoresTableBody');
  const form = document.getElementById('colaboradorForm');
  const nameInput = document.getElementById('colaboradorName');
  const matriculaInput = document.getElementById('colaboradorMatricula');
  const emailInput = document.getElementById('colaboradorEmail');
  const passwordInput = document.getElementById('colaboradorPassword');
  const msgDiv = document.getElementById('colabMsg');
  // Elementos del modal de edición
  const editModal = document.getElementById('editCollaboratorModal');
  const editForm = document.getElementById('editCollaboratorForm');
  const editMsg = document.getElementById('editCollabMsg');
  const editId = document.getElementById('editCollabId');
  const editName = document.getElementById('editCollabName');
  const editEmail = document.getElementById('editCollabEmail');
  const editPhone = document.getElementById('editCollabPhone');
  const editMatricula = document.getElementById('editCollabMatricula');
  const editPassword = document.getElementById('editCollabPassword');
  const closeEditBtn = document.getElementById('closeEditCollabModal');
  const cancelEditBtn = document.getElementById('cancelEditCollab');
  const resetPasswordBtn = document.getElementById('resetPasswordCollab');
  
  const totalColaboradoresEl = document.getElementById('totalColaboradores');
  const colaboradoresActivosEl = document.getElementById('colaboradoresActivos');

  let allCollaborators = [];

  // --- LÓGICA PRINCIPAL ---

  // Cargar y mostrar colaboradores con reintentos automáticos
  async function loadCollaborators(retryCount = 0) {
    if (!tableBody) return;
    
    const maxRetries = 3;
    const retryDelay = 1000 * (retryCount + 1); // 1s, 2s, 3s
    
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Cargando colaboradores${retryCount > 0 ? ` (intento ${retryCount + 1}/${maxRetries + 1})` : ''}...</td></tr>`;

    try {
      const { data, error } = await supabaseConfig.client
        .from('collaborators')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      allCollaborators = data || [];
      filterAndRender();
      updateSummary();
      console.log(`[Colaboradores] Cargados ${allCollaborators.length} colaboradores exitosamente`);
      
    } catch (error) {
      console.error(`Error al cargar colaboradores (intento ${retryCount + 1}):`, error);
      
      if (retryCount < maxRetries) {
        console.log(`[Colaboradores] Reintentando en ${retryDelay}ms...`);
        setTimeout(() => loadCollaborators(retryCount + 1), retryDelay);
      } else {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" class="text-center py-4">
              <div class="text-red-500 mb-2">No se pudieron cargar los colaboradores</div>
              <button onclick="loadCollaborators()" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Reintentar
              </button>
            </td>
          </tr>
        `;
      }
    }
  }

  // Función para generar avatar con iniciales
  function generateAvatar(name) {
    if (!name) return '';
    
    // Obtener las iniciales (máximo 2 caracteres)
    const initials = name.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
    
    // Generar color basado en el nombre para consistencia
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 
      'bg-yellow-500', 'bg-indigo-500', 'bg-pink-500', 'bg-teal-500'
    ];
    const colorIndex = name.length % colors.length;
    const bgColor = colors[colorIndex];
    
    return `
      <div class="w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-semibold text-sm">
        ${initials}
      </div>
    `;
  }

  // Renderizar la tabla
  function renderTable(collaborators) {
    if (collaborators.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No se encontraron colaboradores.</td></tr>';
      return;
    }

    tableBody.innerHTML = collaborators.map(colab => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-6 py-4 font-medium text-gray-900">
          <div class="flex items-center gap-3">
            ${generateAvatar(colab.name)}
            <div>
              <div class="font-medium">${colab.name}</div>
              <div class="text-sm text-gray-500">${colab.role || 'Colaborador'}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">${colab.matricula || 'N/A'}</td>
        <td class="px-6 py-4">${colab.email}</td>
        <td class="px-6 py-4">
          <span class="px-2 py-1 text-xs font-semibold rounded-full ${colab.status === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${colab.status}
          </span>
        </td>
        <td class="px-6 py-4 flex items-center gap-2">
          <button onclick="editCollaborator('${colab.id}')" class="text-blue-600 hover:text-blue-800"><i data-lucide="edit" class="w-4 h-4"></i></button>
          <button onclick="deleteCollaborator('${colab.id}')" class="text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td>
      </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
  }

  // Filtrar y renderizar
  function filterAndRender() {
    // Los filtros fueron eliminados de la UI. Ahora simplemente renderiza todos los colaboradores.
    renderTable(allCollaborators);
  }

  // Actualizar tarjetas de resumen
  function updateSummary() {
    totalColaboradoresEl.textContent = allCollaborators.length;
    colaboradoresActivosEl.textContent = allCollaborators.filter(c => c.status === 'activo').length;
  }

  // Crear nuevo colaborador
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgDiv.textContent = 'Creando colaborador...';

    // Lógica para crear el usuario en Supabase Auth y luego en la tabla 'collaborators'
    // (Esta parte es compleja y requiere una Edge Function para mayor seguridad)
    // Por ahora, simularemos la creación directa (requiere RLS permisivo)

    try {
        // Usar la Edge Function para crear colaboradores de forma segura
        // Esto evita exponer la service_role key en el frontend
        const response = await fetch(`${supabaseConfig.client.supabaseUrl}/functions/v1/process-collaborator-requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseConfig.client.supabaseKey}`
            },
            body: JSON.stringify({
                action: 'create_collaborator',
                collaboratorData: {
                    email: emailInput.value,
                    password: passwordInput.value,
                    name: nameInput.value,
                    matricula: matriculaInput.value || null
                }
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Error desconocido al crear colaborador');
        }

        msgDiv.textContent = '¡Colaborador creado con éxito!';
        msgDiv.classList.add('text-green-600');
        form.reset();
        await loadCollaborators();

    } catch (error) {
        console.error('Error al crear colaborador:', error);
        msgDiv.textContent = `Error: ${error.message}`;
        msgDiv.classList.add('text-red-600');
    } finally {
        setTimeout(() => {
            msgDiv.textContent = '';
            msgDiv.classList.remove('text-green-600', 'text-red-600');
        }, 5000);
    }
  });

  // --- FUNCIONES DE ACCIÓN (EDITAR/ELIMINAR) ---

  window.editCollaborator = (id) => {
    const colab = allCollaborators.find(c => c.id === id);
    if (!colab) {
      alert('No se encontró el colaborador');
      return;
    }
    editId.value = colab.id || '';
    editName.value = colab.name || '';
    editEmail.value = colab.email || '';
    editPhone.value = colab.phone || '';
    editMatricula.value = colab.matricula || '';
    editPassword.value = '';
    editMsg.textContent = '';
    editMsg.classList.remove('text-green-600','text-red-600');
    editModal.classList.remove('hidden');
    // Bloquear scroll del body y enfocar el primer campo
    document.body.classList.add('overflow-hidden');
    setTimeout(() => { try { editName.focus(); } catch(_){} }, 50);
    // Trap de foco básico dentro del modal
    const focusable = editModal.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    function trap(e){
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstEl){
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl){
        e.preventDefault(); firstEl.focus();
      }
    }
    editModal.addEventListener('keydown', trap);
    // Guardar para remover al cerrar
    editModal._trapHandler = trap;
    if (window.lucide) lucide.createIcons();
  };

  function closeEditModal(){
    editModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (editModal._trapHandler) {
      editModal.removeEventListener('keydown', editModal._trapHandler);
      editModal._trapHandler = null;
    }
  }
  if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

  // Restablecer/generar contraseña segura
  function generateSecurePassword(len = 12){
    try {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}';
      const buf = new Uint32Array(len);
      crypto.getRandomValues(buf);
      return Array.from(buf).map(v => chars[v % chars.length]).join('');
    } catch {
      return Math.random().toString(36).slice(-len);
    }
  }
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', () => {
      const newPass = generateSecurePassword(12);
      editPassword.type = 'text';
      editPassword.value = newPass;
      editMsg.textContent = 'Nueva contraseña generada. Guarda para aplicar los cambios.';
      editMsg.classList.remove('text-red-600');
      editMsg.classList.add('text-yellow-600');
      setTimeout(() => { editPassword.type = 'password'; }, 2500);
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user_id = editId.value;
      const payload = {
        user_id,
        name: editName.value.trim(),
        email: editEmail.value.trim(),
        phone: editPhone.value.trim() || undefined,
        matricula: editMatricula.value.trim() || undefined,
        password: editPassword.value.trim() || undefined,
      };
      // Limpiar mensajes
      editMsg.textContent = 'Guardando cambios...';
      editMsg.classList.remove('text-green-600','text-red-600');

      try {
        // Invocar Edge Function segura para actualizar colaborador
        const { data, error } = await supabaseConfig.client.functions.invoke('update-collaborator', {
          body: payload
        });
        if (error) throw error;
        if (data && data.error) throw new Error(data.error);

        editMsg.textContent = 'Cambios guardados correctamente';
        editMsg.classList.add('text-green-600');
        // Refrescar lista y cerrar
        await loadCollaborators();
        setTimeout(() => {
          closeEditModal();
          editMsg.textContent = '';
          editMsg.classList.remove('text-green-600');
        }, 800);
      } catch (err) {
        console.error('Error al actualizar colaborador:', err);
        const msg = (err && err.message) ? err.message : 'Error al guardar cambios';
        editMsg.textContent = msg;
        editMsg.classList.add('text-red-600');
      }
    });
  }

  // Carga lazy de Chart.js bajo demanda
  async function ensureChartJsLoaded(){
    if (window.Chart) return true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('No se pudo cargar Chart.js'));
      document.head.appendChild(script);
    });
  }
  // Exponer por si se necesita al abrir métricas
  window.ensureChartJsLoaded = ensureChartJsLoaded;

  window.deleteCollaborator = async (id) => {
    if (!confirm('¿Estás seguro de que quieres eliminar a este colaborador? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
        // Para eliminar un colaborador, es más seguro hacerlo desde una Edge Function
        // que use la service_role key para eliminar tanto de `auth.users` como de `public.collaborators`.

        // Simulación de la llamada a una función de borde:
        const { error } = await supabaseConfig.client.functions.invoke('delete-user', {
            body: { userId: id }
        });

        if (error) throw error;

        alert('Colaborador eliminado con éxito.');
        await loadCollaborators();

    } catch (error) {
        console.error('Error al eliminar colaborador:', error);
        alert(`Error: ${error.message}`);
    }
  };

  // --- INICIALIZACIÓN ---
  await loadCollaborators();
  
  // Exponer función para reintentos manuales
  window.loadCollaborators = loadCollaborators;
});
