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

  // Modal de edición de colaborador
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
  
  // Modal de edición de comisión
  const commissionModal = document.getElementById('commissionModal');
  const commissionForm = document.getElementById('commissionForm');
  const commissionMsg = document.getElementById('commissionMsg');
  const commissionCollabId = document.getElementById('commissionCollabId');
  const commissionCollabName = document.getElementById('commissionCollabName');
  const commissionRateInput = document.getElementById('commissionRate');
  const closeCommissionModalBtn = document.getElementById('closeCommissionModal');
  const cancelCommissionBtn = document.getElementById('cancelCommission');

  const totalColaboradoresEl = document.getElementById('totalColaboradores');
  const colaboradoresActivosEl = document.getElementById('colaboradoresActivos');

  let allCollaborators = [];

  // --- LÓGICA PRINCIPAL ---

  // Cargar y mostrar colaboradores desde la tabla 'profiles'
  async function loadCollaborators(retryCount = 0) {
    if (!tableBody) return;
    
    const maxRetries = 3;
    const retryDelay = 1000 * (retryCount + 1);
    
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">Cargando colaboradores...</td></tr>`;

    try {
      // ✅ CORRECCIÓN: Consultar 'profiles' en lugar de 'collaborators' y filtrar por rol.
      const { data, error } = await supabaseConfig.client
        .from('profiles')
        .select('id, full_name, matricula, email, status, role, commission_rate')
        .eq('role', 'colaborador')
        .order('created_at', { ascending: false });

      if (error) throw error;

      allCollaborators = data.map(p => ({ ...p, name: p.full_name })) || []; // Mapear full_name a name por consistencia
      filterAndRender();
      updateSummary();
      console.log(`[Colaboradores] Cargados ${allCollaborators.length} colaboradores (perfiles) exitosamente`);
      
    } catch (error) {
      console.error(`Error al cargar perfiles de colaboradores (intento ${retryCount + 1}):`, error);
      
      if (retryCount < maxRetries) {
        setTimeout(() => loadCollaborators(retryCount + 1), retryDelay);
      } else {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">No se pudieron cargar los colaboradores.</td></tr>`;
      }
    }
  }

  // Generar avatar
  function generateAvatar(name) {
    if (!name) return '';
    const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 'bg-yellow-500', 'bg-indigo-500'];
    const colorIndex = (name.length || 0) % colors.length;
    return `<div class="w-10 h-10 ${colors[colorIndex]} rounded-full flex items-center justify-center text-white font-semibold text-sm">${initials}</div>`;
  }

  // Renderizar la tabla
  function renderTable(collaborators) {
    if (collaborators.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No se encontraron colaboradores.</td></tr>';
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
            ${colab.status || 'inactivo'}
          </span>
        </td>
        <td class="px-6 py-4 font-semibold text-gray-700">${colab.commission_rate || 0}%</td>
        <td class="px-6 py-4 flex items-center gap-3">
          <button onclick="openCommissionModal('${colab.id}')" title="Editar Comisión" class="text-green-600 hover:text-green-800"><i data-lucide="percent" class="w-4 h-4"></i></button>
          <button onclick="editCollaborator('${colab.id}')" title="Editar Colaborador" class="text-blue-600 hover:text-blue-800"><i data-lucide="edit" class="w-4 h-4"></i></button>
          <button onclick="deleteCollaborator('${colab.id}')" title="Eliminar Colaborador" class="text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td>
      </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
  }

  // Filtrar y renderizar
  function filterAndRender() {
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
    try {
        const { data, error } = await supabaseConfig.client.auth.signUp({
            email: emailInput.value,
            password: passwordInput.value,
            options: {
                data: {
                    full_name: nameInput.value,
                    matricula: matriculaInput.value || null,
                    role: 'colaborador' // Asignar rol por defecto
                }
            }
        });

        if (error) throw error;
        if (!data.user) throw new Error("No se pudo crear el usuario, pero no se reportó error.");

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

  // --- LÓGICA DE MODALES ---

  // Modal de Comisión
  window.openCommissionModal = (id) => {
    const colab = allCollaborators.find(c => c.id === id);
    if (!colab) return alert('Colaborador no encontrado.');

    commissionCollabId.value = colab.id;
    commissionCollabName.textContent = colab.name;
    commissionRateInput.value = colab.commission_rate || 0;
    commissionMsg.textContent = '';
    commissionModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    if (window.lucide) lucide.createIcons();
  };

  function closeCommissionModal() {
    commissionModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  closeCommissionModalBtn.addEventListener('click', closeCommissionModal);
  cancelCommissionBtn.addEventListener('click', closeCommissionModal);

  commissionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = commissionCollabId.value;
    const rate = parseFloat(commissionRateInput.value);

    if (isNaN(rate) || rate < 0 || rate > 100) {
      commissionMsg.textContent = 'Por favor, introduce un valor entre 0 y 100.';
      commissionMsg.className = 'text-sm mt-3 text-red-600';
      return;
    }

    commissionMsg.textContent = 'Guardando...';
    commissionMsg.className = 'text-sm mt-3 text-gray-600';

    const { error } = await supabaseConfig.client
      .from('profiles')
      .update({ commission_rate: rate })
      .eq('id', id);

    if (error) {
      console.error("Error al actualizar comisión:", error);
      commissionMsg.textContent = `Error: ${error.message}`;
      commissionMsg.className = 'text-sm mt-3 text-red-600';
    } else {
      commissionMsg.textContent = '¡Comisión guardada con éxito!';
      commissionMsg.className = 'text-sm mt-3 text-green-600';
      await loadCollaborators();
      setTimeout(closeCommissionModal, 1000);
    }
  });


  // Modal de Edición de Colaborador (general)
  window.editCollaborator = (id) => {
    const colab = allCollaborators.find(c => c.id === id);
    if (!colab) return alert('Colaborador no encontrado.');

    editId.value = colab.id;
    editName.value = colab.name;
    editEmail.value = colab.email;
    editPhone.value = colab.phone || '';
    editMatricula.value = colab.matricula || '';
    editPassword.value = '';
    editMsg.textContent = '';
    editModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    if (window.lucide) lucide.createIcons();
  };

  function closeEditModal() {
    editModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  closeEditBtn.addEventListener('click', closeEditModal);
  cancelEditBtn.addEventListener('click', closeEditModal);

  editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      editMsg.textContent = 'Guardando...';
      editMsg.className = 'text-sm mt-3 text-gray-600';

      const updateData = {
          full_name: editName.value.trim(),
          matricula: editMatricula.value.trim() || null,
          phone: editPhone.value.trim() || null
      };

      // 1. Actualizar datos en la tabla 'profiles'
      const { error: profileError } = await supabaseConfig.client
          .from('profiles')
          .update(updateData)
          .eq('id', editId.value);

      if (profileError) {
          return handleUpdateError(profileError);
      }

      // 2. Actualizar email y contraseña (si se proporcionaron) usando una Edge Function por seguridad
      const password = editPassword.value;
      const email = editEmail.value;

      if(password || email !== allCollaborators.find(c => c.id === editId.value)?.email) {
          const { data: authData, error: authError } = await supabaseConfig.client.functions.invoke('update-user-auth', {
              body: {
                  userId: editId.value,
                  email: email,
                  password: password || undefined
              }
          });

          if (authError || (authData && authData.error)) {
              return handleUpdateError(authError || new Error(authData.error));
          }
      }

      editMsg.textContent = '¡Guardado con éxito!';
      editMsg.className = 'text-sm mt-3 text-green-600';
      await loadCollaborators();
      setTimeout(closeEditModal, 1000);
  });

  function handleUpdateError(error) {
      console.error("Error al actualizar:", error);
      editMsg.textContent = `Error: ${error.message}`;
      editMsg.className = 'text-sm mt-3 text-red-600';
  }

  // Generar contraseña segura
  function generateSecurePassword(len = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    const buf = new Uint32Array(len);
    window.crypto.getRandomValues(buf);
    return Array.from(buf).map(v => chars[v % chars.length]).join('');
  }

  resetPasswordBtn.addEventListener('click', () => {
    const newPass = generateSecurePassword(12);
    editPassword.type = 'text';
    editPassword.value = newPass;
    editMsg.textContent = 'Nueva contraseña generada. Guarda para aplicar los cambios.';
    editMsg.className = 'text-sm mt-3 text-yellow-600';
    setTimeout(() => { editPassword.type = 'password'; }, 2500);
  });

  // Eliminar colaborador
  window.deleteCollaborator = async (id) => {
    if (!confirm('¿Estás seguro de que quieres eliminar a este colaborador? Esta acción eliminará su cuenta de autenticación y no se puede deshacer.')) {
      return;
    }

    // Es más seguro invocar una Edge Function con privilegios de admin
    const { error } = await supabaseConfig.client.functions.invoke('delete-user', {
        body: { userId: id }
    });

    if (error) {
        alert(`Error al eliminar colaborador: ${error.message}`);
    } else {
        alert('Colaborador eliminado con éxito.');
        await loadCollaborators();
    }
  };

  // --- INICIALIZACIÓN ---
  await loadCollaborators();
  
  window.loadCollaborators = loadCollaborators; // Exponer para reintentos manuales
});
