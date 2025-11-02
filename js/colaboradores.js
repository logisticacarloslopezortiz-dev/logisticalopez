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

  // --- INICIALIZACIÓN ---
  await loadCollaborators();
  
  // Exponer función para reintentos manuales
  window.loadCollaborators = loadCollaborators;
});
