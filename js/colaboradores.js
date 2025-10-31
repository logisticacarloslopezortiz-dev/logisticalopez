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
  
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const clearFiltersBtn = document.getElementById('clearFilters');

  const totalColaboradoresEl = document.getElementById('totalColaboradores');
  const colaboradoresActivosEl = document.getElementById('colaboradoresActivos');

  let allCollaborators = [];

  // --- LÓGICA PRINCIPAL ---

  // Cargar y mostrar colaboradores
  async function loadCollaborators() {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Cargando...</td></tr>';

    const { data, error } = await supabaseConfig.client
      .from('collaborators')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al cargar colaboradores:', error);
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">No se pudieron cargar los colaboradores.</td></tr>';
      return;
    }

    allCollaborators = data;
    filterAndRender();
    updateSummary();
  }

  // Renderizar la tabla
  function renderTable(collaborators) {
    if (collaborators.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No se encontraron colaboradores.</td></tr>';
      return;
    }

    tableBody.innerHTML = collaborators.map(colab => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-6 py-4 font-medium text-gray-900">${colab.name}</td>
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
    const searchTerm = searchInput.value.toLowerCase();
    const status = statusFilter.value;

    const filtered = allCollaborators.filter(colab => {
      const matchesSearch = !searchTerm ||
        colab.name.toLowerCase().includes(searchTerm) ||
        colab.email.toLowerCase().includes(searchTerm);

      const matchesStatus = !status || colab.status === status;

      return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
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
    // Lógica para abrir un modal de edición (no implementada en este snippet)
    alert(`Funcionalidad de editar para el colaborador ID: ${id} no implementada.`);
  };

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

  // --- EVENT LISTENERS PARA FILTROS ---
  searchInput.addEventListener('input', filterAndRender);
  statusFilter.addEventListener('change', filterAndRender);
  clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    statusFilter.value = '';
    filterAndRender();
  });


  // --- INICIALIZACIÓN ---
  await loadCollaborators();
});
