// Variables globales
const form = document.getElementById('colaboradorForm');
const tableBody = document.getElementById('colaboradoresTableBody'); // ✅ CORREGIDO: El ID correcto es 'colaboradoresTableBody'
let colaboradores = []; // Ahora se cargará desde Supabase

// Variables para el modal de métricas
const metricsModal = document.getElementById('metricsModal');
const closeMetricsModal = document.getElementById('closeMetricsModal');
let modalWeeklyChart = null;
let modalServicesChart = null;

document.addEventListener('DOMContentLoaded', () => {
  // Inicializar iconos de Lucide
  lucide.createIcons();
  init();
});

// Función para mostrar modal de métricas
async function showMetricsModal(colaboradorId) {
  const colaborador = colaboradores.find(c => c.id === colaboradorId);
  if (!colaborador) return;

  // Actualizar información del colaborador en el modal
  document.getElementById('modalCollabName').textContent = colaborador.name;
  document.getElementById('modalCollabEmail').textContent = colaborador.email;
  const initials = (colaborador.name || colaborador.email || '?').toString().trim().charAt(0).toUpperCase();
  document.getElementById('modalCollabAvatar').textContent = initials;
  
  // Mostrar un indicador de carga mientras se obtienen los datos
  metricsModal.classList.remove('hidden');
  // (Opcional: podrías añadir un spinner aquí)

  // Cargar métricas del colaborador desde Supabase
  const { data: orders, error } = await supabaseConfig.client.from('orders').select('*').eq('assigned_to', colaboradorId);
  if (error) {
    showMessage('No se pudieron cargar las métricas del colaborador.', 'error');
    return;
  }

  // Actualizar métricas principales
  const mainMetrics = calculateMainMetrics(orders);
  document.getElementById('modalCompletedCount').textContent = mainMetrics.completed;
  document.getElementById('modalActiveCount').textContent = mainMetrics.active;
  document.getElementById('modalSuccessRate').textContent = mainMetrics.successRate + '%';
  document.getElementById('modalAvgTime').textContent = mainMetrics.avgTime + 'h';

  // Crear gráficos
  createModalWeeklyChart(getWeeklyData(orders));
  createModalServicesChart(getServicesDistribution(orders));

  // Renderizar estadísticas
  renderModalVehicleStats(getVehicleStats(orders));
  renderModalSchedule(colaborador); // Pasamos el colaborador para futuras mejoras (ej. horario desde su perfil)
}

// Función para ocultar modal de métricas
function hideMetricsModal() {
  metricsModal.classList.add('hidden');
  if (modalWeeklyChart) modalWeeklyChart.destroy();
  if (modalServicesChart) modalServicesChart.destroy();
}

// Función para crear gráfico semanal en el modal
function createModalWeeklyChart(weeklyData) {
  const ctx = document.getElementById('modalWeeklyChart').getContext('2d');
  if (modalWeeklyChart) modalWeeklyChart.destroy();

  modalWeeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeklyData.labels,
      datasets: [{
        label: 'Servicios Completados',
        data: weeklyData.data,
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// Función para crear gráfico de servicios en el modal
function createModalServicesChart(servicesData) {
  const ctx = document.getElementById('modalServicesChart').getContext('2d');
  if (modalServicesChart) modalServicesChart.destroy();

  modalServicesChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: servicesData.labels,
      datasets: [{
        data: servicesData.data,
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(249, 115, 22, 0.8)'
        ],
        borderColor: [
          'rgba(34, 197, 94, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(249, 115, 22, 1)'
        ],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// Función para renderizar estadísticas de vehículos en el modal
function renderModalVehicleStats(vehicleStats) {
  const container = document.getElementById('modalVehicleStats');
  const total = Object.values(vehicleStats).reduce((sum, count) => sum + count, 0);

  container.innerHTML = '';
  if (total === 0) {
    container.innerHTML = '<p class="text-gray-500 text-sm">No hay datos disponibles</p>';
    return;
  }

  Object.entries(vehicleStats).forEach(([vehicle, count]) => {
    const percentage = Math.round((count / total) * 100);
    container.innerHTML += `
      <div class="flex items-center justify-between">
        <span class="text-sm text-gray-600">${vehicle}</span>
        <div class="flex items-center space-x-2">
          <div class="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div class="h-full bg-orange-500 rounded-full" style="width: ${percentage}%"></div>
          </div>
          <span class="text-sm font-medium text-gray-800">${count}</span>
        </div>
      </div>
    `;
  });
}

// Función para renderizar horario en el modal
function renderModalSchedule(colaborador) {
  const container = document.getElementById('modalTimeStats');
  const schedule = getTimeStats(colaborador);
  if (!schedule || typeof schedule !== 'object') {
    container.innerHTML = '<p class="text-gray-500 text-sm">No hay horario configurado</p>';
    return;
  }

  const start = schedule.startTime || '—';
  const end = schedule.endTime || '—';
  const days = Array.isArray(schedule.workDays) ? schedule.workDays.join(', ') : '—';

  container.innerHTML = `
    <div class="space-y-2">
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-600">Horario:</span>
        <span class="text-sm font-medium text-gray-800">${start} - ${end}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-600">Días:</span>
        <span class="text-sm font-medium text-gray-800">${days}</span>
      </div>
    </div>
  `;
}

// Función para calcular métricas principales
function calculateMainMetrics(orders) {
  const completedOrders = orders.filter(o => o.status === 'Completado');
  const activeOrders = orders.filter(o => o.status === 'En proceso');
  
  const completed = completedOrders.length;
  const active = activeOrders.length;
  const totalConsidered = completed + active;

  const successRate = totalConsidered > 0 ? Math.round((completed / totalConsidered) * 100) : 0;
  
  // Cálculo de tiempo promedio (simplificado)
  const totalTime = completedOrders.reduce((sum, order) => {
    if (order.created_at && order.completed_at) {
      return sum + (new Date(order.completed_at) - new Date(order.created_at));
    }
    return sum;
  }, 0);
  const avgTime = completed > 0 ? Math.round(totalTime / completed / (1000 * 60 * 60)) : 0; // en horas

  return { completed, active, successRate, avgTime };
}

// Función para obtener datos semanales
function getWeeklyData(orders) {
  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const weekData = new Array(7).fill(0);

  const now = new Date();
  const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 1));

  orders.filter(order => order.status === 'Completado').forEach(order => {
    if (order.completedAt) {
      const orderDate = new Date(order.completedAt);
      const daysDiff = Math.floor((orderDate - startOfWeek) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 0 && daysDiff < 7) weekData[daysDiff]++;
    }
  });

  return { labels: days, data: weekData };
}

// Función para obtener distribución de servicios
function getServicesDistribution(orders) {
  const serviceTypes = {};
  orders.forEach(order => {
    serviceTypes[order.service] = (serviceTypes[order.service] || 0) + 1;
  });
  return {
    labels: Object.keys(serviceTypes),
    data: Object.values(serviceTypes)
  };
}

// Función para obtener estadísticas de vehículos
function getVehicleStats(orders) {
  const vehicles = {};
  orders.forEach(order => {
    if (order.vehicle) {
      vehicles[order.vehicle] = (vehicles[order.vehicle] || 0) + 1;
    }
  });
  return vehicles;
}

// Función para obtener horario
function getTimeStats(colaborador) {
  // Placeholder: En el futuro, podrías obtener esto de la tabla 'collaborators'
  return null;
}

// Función para renderizar colaboradores
function renderColaboradores() {
  if (!tableBody) return; // ✅ DEFENSA: No hacer nada si la tabla no existe
  tableBody.innerHTML = ''; // Esta línea causaba el error si tableBody era null
  
  // Obtener el contenedor de tarjetas para móvil
  const cardContainer = document.getElementById('colaboradoresCardContainer');
  if (cardContainer) cardContainer.innerHTML = '';
  
  if (colaboradores.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500"><div class="flex flex-col items-center gap-2"><i data-lucide="users" class="w-8 h-8 text-gray-400"></i><span>No hay colaboradores registrados</span></div></td></tr>';
    if (cardContainer) {
      cardContainer.innerHTML = '<div class="text-center py-8 text-gray-500"><div class="flex flex-col items-center gap-2"><i data-lucide="users" class="w-8 h-8 text-gray-400"></i><span>No hay colaboradores registrados</span></div></div>';
    }
    lucide.createIcons();
    return;
  }
  
  colaboradores.forEach((c, index) => {
    // Renderizar fila para vista de escritorio
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    
    const statusBadge = getStatusBadge(c.status || 'activo');
    const roleBadge = getRoleBadge(c.role);
    const createdDate = new Date(c.created_at).toLocaleDateString('es-ES');
    
    tr.innerHTML = `
      <td class="py-4 px-2">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
            ${(c.name || c.email || '?').toString().trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="font-medium text-gray-900">${c.name}</div>
            <div class="text-sm text-gray-500">Registrado: ${createdDate}</div>
          </div>
        </div>
      </td>
      <td class="py-4 px-2">
        <div class="text-gray-700 font-mono text-sm">${c.matricula || 'N/A'}</div>
      </td>
      <td class="py-4 px-2">
        <div class="text-gray-900">${c.email}</div>
      </td>
      <td class="py-4 px-2">
        ${roleBadge}
      </td>
      <td class="py-4 px-2">
        ${statusBadge}
      </td>
      <td class="py-4 px-2">
        <div class="flex items-center gap-2">
          <button onclick="showMetricsModal('${c.id}')" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Ver métricas">
            <i data-lucide="bar-chart-2" class="w-4 h-4"></i>
          </button>
          <button onclick="editColaborador('${c.id}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
          </button>
          <button onclick="toggleStatus('${c.id}')" class="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors" title="Cambiar estado">
            <i data-lucide="${c.status === 'inactivo' ? 'user-check' : 'user-x'}" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteColaborador('${c.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
    
    // Renderizar tarjeta para vista móvil
    if (cardContainer) {
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow p-4 mb-4';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
              ${(c.name || c.email || '?').toString().trim().charAt(0).toUpperCase()}
            </div>
            <div>
              <div class="font-medium text-gray-900">${c.name}</div>
              <div class="text-sm text-gray-500">Registrado: ${createdDate}</div>
            </div>
          </div>
          ${roleBadge}
        </div>
        
        <div class="grid grid-cols-2 gap-2 mb-3 text-sm">
          <div>
            <p class="text-gray-500">Matrícula:</p>
            <p class="font-mono">${c.matricula || 'N/A'}</p>
          </div>
          <div>
            <p class="text-gray-500">Email:</p>
            <p class="truncate">${c.email || 'N/A'}</p>
          </div>
          <div>
            <p class="text-gray-500">Estado:</p>
            ${statusBadge}
          </div>
        </div>
        
        <div class="flex justify-end gap-2 border-t pt-3">
          <button onclick="showMetricsModal('${c.id}')" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Ver métricas">
            <i data-lucide="bar-chart-2" class="w-4 h-4"></i>
          </button>
          <button onclick="editColaborador('${c.id}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
          </button>
          <button onclick="toggleStatus('${c.id}')" class="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors" title="Cambiar estado">
            <i data-lucide="${c.status === 'inactivo' ? 'user-check' : 'user-x'}" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteColaborador('${c.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
      cardContainer.appendChild(card);
    }
  });
  
  lucide.createIcons();
  updateSummary();
}

// Función para obtener badge de estado
function getStatusBadge(status) {
  const badges = {
    'activo': '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><i data-lucide="check-circle" class="w-3 h-3"></i>Activo</span>',
    'inactivo': '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"><i data-lucide="x-circle" class="w-3 h-3"></i>Inactivo</span>'
  };
  return badges[status] || badges['activo'];
} 

// Función para obtener badge de rol
function getRoleBadge(role) {
  const badges = {
    'administrador': '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800"><i data-lucide="crown" class="w-3 h-3"></i>Administrador</span>',
    'chofer': '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><i data-lucide="car" class="w-3 h-3"></i>Chofer</span>',
    'operador': '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><i data-lucide="headphones" class="w-3 h-3"></i>Operador</span>'
  };
  return badges[role] || badges['operador'];
}

// Función para actualizar resumen
function updateSummary() {
  const totalColaboradores = colaboradores.length;
  const activosCount = colaboradores.filter(c => (c.status || 'activo') === 'activo').length;
  const adminCount = colaboradores.filter(c => c.role === 'administrador').length;
  const choferCount = colaboradores.filter(c => c.role === 'chofer').length;
  
  document.getElementById('totalColaboradores').textContent = totalColaboradores;
  document.getElementById('colaboradoresActivos').textContent = activosCount;
  document.getElementById('totalAdministradores').textContent = adminCount;
  document.getElementById('totalChoferes').textContent = choferCount;
}

// Función para editar colaborador
async function editColaborador(id) {
  const colaborador = colaboradores.find(c => c.id === id);
  if (!colaborador) return;

  const newName = prompt('Nuevo nombre:', colaborador.name);
  if (newName && newName.trim()) {
    const { data, error } = await supabaseConfig.client
      .from('collaborators')
      .update({ name: newName.trim() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      showMessage(`Error al actualizar: ${error.message}`, 'error');
    } else {
      const index = colaboradores.findIndex(c => c.id === id);
      if (index !== -1) colaboradores[index] = data;
      renderColaboradores();
      showMessage('Colaborador actualizado correctamente.', 'success');
    }
  }
}

// Función para cambiar estado del colaborador
async function toggleStatus(id) {
  const colaborador = colaboradores.find(c => c.id === id);
  if (!colaborador) return;

  const currentStatus = colaborador.status || 'activo';
  const newStatus = currentStatus === 'activo' ? 'inactivo' : 'activo';
  
  if (confirm(`¿Cambiar estado de ${colaborador.name} a ${newStatus}?`)) {
    const { error } = await supabaseConfig.client.from('collaborators').update({ status: newStatus }).eq('id', id);
    if (error) {
      showMessage(`Error al cambiar estado: ${error.message}`, 'error');
    } else {
      colaborador.status = newStatus;
      renderColaboradores();
      showMessage(`Estado cambiado a ${newStatus}.`, 'success');
    }
  }
}

// Función para eliminar colaborador
async function deleteColaborador(id) {
  const colaborador = colaboradores.find(c => c.id === id);
  if (!colaborador) return;

  if (confirm(`¿Estás seguro de eliminar a ${colaborador.name}? Esta acción no se puede deshacer y eliminará su acceso.`)) {
    // Primero, eliminar de la tabla pública 'colaboradores'
    const { error } = await supabaseConfig.client.from('collaborators').delete().eq('id', id);
    
    // ✅ MEJORA: Si tiene éxito, llamar a la Función Edge para eliminar el usuario de auth.
    // Esto mantiene la base de datos de usuarios sincronizada.
    if (!error) {
      try {
        // Esta función debe ser creada en tu proyecto de Supabase.
        await supabaseConfig.client.functions.invoke('delete-user', { body: { userId: id } });
      } catch (functionError) {
        // No es un error crítico si la función falla (ej. el usuario ya no existía en auth o la función no existe aún)
        console.warn('Advertencia al eliminar usuario de auth:', functionError.message);
      }
    }

    if (error) {
      showMessage(`Error al eliminar: ${error.message}`, 'error');
    } else {
      colaboradores = colaboradores.filter(c => c.id !== id);
      renderColaboradores();
      showMessage('Colaborador eliminado correctamente.', 'success');
    }
  }
}

// Función para mostrar mensajes
function showMessage(text, type = 'info') {
  const msg = document.getElementById('colabMsg');
  msg.textContent = text;
  msg.className = 'text-sm mt-2 p-2 rounded';
  
  if (type === 'success') {
    msg.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-200');
  } else if (type === 'error') {
    msg.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-200');
  } else {
    msg.classList.add('bg-blue-100', 'text-blue-700', 'border', 'border-blue-200');
  }
  
  // Limpiar mensaje después de 3 segundos
  setTimeout(() => {
    msg.textContent = '';
    msg.className = 'text-sm';
  }, 3000);
}

// Función para validar email
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Función para filtrar colaboradores
function filterColaboradores() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const roleFilter = document.getElementById('roleFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;
  
  const filteredColaboradores = colaboradores.filter(c => {
    const name = (c.name || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const matchesSearch = name.includes(searchTerm) || email.includes(searchTerm);
    const matchesRole = roleFilter === '' || c.role === roleFilter;
    const matchesStatus = statusFilter === '' || (c.status || 'activo') === statusFilter;
    
    return matchesSearch && matchesRole && matchesStatus;
  });
  
  // En lugar de duplicar el código de renderizado, simplemente llama a la función principal
  // pasándole los datos filtrados. Esto evita la duplicación de código.
  // Nota: Para que esto funcione, renderColaboradores debe aceptar un parámetro.
  // Por simplicidad, por ahora, modificaremos la variable global y llamaremos a la función original.
  const originalColaboradores = colaboradores; // Guardar el estado original
  colaboradores = filteredColaboradores;
  renderColaboradores();
  colaboradores = originalColaboradores; // Restaurar el estado original
}

// Event listeners para el modal de métricas
if (closeMetricsModal) {
  closeMetricsModal.addEventListener('click', hideMetricsModal);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Desactivar botón y mostrar estado de carga
  submitButton.disabled = true;
  submitButton.innerHTML = `
    <i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>
    Agregando...
  `;
  lucide.createIcons();

  const name = document.getElementById('colaboradorName').value.trim();
  const matricula = document.getElementById('colaboradorMatricula').value.trim();
  const email = document.getElementById('colaboradorEmail').value.trim();
  const password = document.getElementById('colaboradorPassword').value;
  const role = document.getElementById('colaboradorRole').value;

  // Validaciones
  if (!name || !email || !password) {
    showMessage('Completa todos los campos obligatorios.', 'error');
    restoreButton();
    return;
  }
  
  if (!isValidEmail(email)) {
    showMessage('Correo electrónico inválido.', 'error');
    restoreButton();
    return;
  }
  
  if (password.length < 6) {
    showMessage('La contraseña debe tener al menos 6 caracteres.', 'error');
    restoreButton();
    return;
  }
  
  if (colaboradores.some(c => (c.email || '').toLowerCase() === email.toLowerCase())) {
    showMessage('Ya existe un colaborador con ese correo electrónico.', 'error');
    return;
  }

  // --- USANDO EDGE FUNCTION PARA CREAR COLABORADORES ---
  try {
    // Usar la Edge Function process-collaborator-requests
    const { data, error } = await supabaseConfig.client.functions.invoke('process-collaborator-requests', {
      body: {
        action: 'create_collaborator',
        collaborator_data: {
          name: name,
          email: email,
          password: password,
          matricula: matricula || null,
          role: role,
          status: 'activo'
        }
      }
    });

    if (error) {
      console.error('Error en Edge Function:', error);
      throw new Error(error.message || 'Error al procesar la solicitud');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Error desconocido al crear colaborador');
    }

    // Éxito
    showMessage('¡Colaborador agregado exitosamente!', 'success');
    form.reset();
    // Recargamos la lista de colaboradores para mostrar el nuevo.
    await init();

  } catch (error) {
    console.error('Error detallado:', error);
    let friendlyMessage = 'Ocurrió un error al agregar el colaborador.';
    
    if (error.message.includes('User already registered') || error.message.includes('already been registered')) {
      friendlyMessage = 'Este correo electrónico ya está en uso.';
    } else if (error.message.includes('Password should be at least 6 characters')) {
      friendlyMessage = 'La contraseña debe tener al menos 6 caracteres.';
    } else if (error.message.includes('Invalid email')) {
      friendlyMessage = 'El formato del correo electrónico no es válido.';
    } else if (error.message.includes('datos adicionales')) {
      friendlyMessage = 'Usuario creado pero hubo un problema al guardar los datos. Contacta al administrador.';
    }
    
    showMessage(friendlyMessage, 'error');
  } finally {
    // Restaurar el botón a su estado original
    restoreButton();
    renderColaboradores();
  }
  // --- FIN: LÓGICA REFACTORIZADA ---
});

// Event listeners para filtros
document.getElementById('searchInput').addEventListener('input', filterColaboradores);
document.getElementById('roleFilter').addEventListener('change', filterColaboradores);
document.getElementById('statusFilter').addEventListener('change', filterColaboradores);

// Función para limpiar filtros
function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('roleFilter').value = '';
  document.getElementById('statusFilter').value = '';
  renderColaboradores();
}

const submitButton = form.querySelector('button[type="submit"]');
const originalButtonHTML = submitButton.innerHTML;

function restoreButton() {
  submitButton.disabled = false;
  submitButton.innerHTML = originalButtonHTML;
  lucide.createIcons();
}

// Event listener para limpiar filtros
document.getElementById('clearFilters').addEventListener('click', clearFilters);

// La funcionalidad del botón de generar contraseña ya está en el HTML,
// por lo que no es necesario duplicarla aquí.

// Función de inicialización
async function init() {
  const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
  
  if (sessionError || !session) {
    console.error('No hay sesión activa. Redirigiendo al login.');
    window.location.href = '/login.html';
    return; // Detener la ejecución
  } else {
    try {
      const { data, error } = await supabaseConfig.client.from('collaborators').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      colaboradores = data;
      renderColaboradores();
      updateSummary();
    } catch (error) {
      console.error("Error al cargar colaboradores:", error);
      showMessage('No se pudieron cargar los colaboradores.', 'error');
    }
  }
}

// Hacer funciones globales para los botones
window.editColaborador = editColaborador;
window.toggleStatus = toggleStatus;
window.deleteColaborador = deleteColaborador;
window.clearFilters = clearFilters;
window.showMetricsModal = showMetricsModal; // Hacerla global