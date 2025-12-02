// Variables globales
let allOrders = [];
let filteredOrders = [];
let sortColumn = 'created_at'; // ✅ MEJORA: Ordenar por defecto por fecha de creación
let sortDirection = 'desc';
let selectedOrderIdForAssign = null; // Guardará el ID del pedido a asignar

// --- INICIO: Carga y Filtrado de Datos ---

// Carga inicial de órdenes
async function loadOrders() {
  try {
    // Usar el cliente adecuado para la vista orders_with_client
    const client = supabaseConfig.client || supabaseConfig.getPublicClient();

    // Consultar directamente la tabla orders con relaciones definidas
    const { data: orders, error } = await client
      .from('orders')
      .select(`
        *,
        service:services(name),
        vehicle:vehicles(name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error al cargar las órdenes:", error?.message || error);
      if (window.showError) {
        window.showError('No se pudieron cargar las solicitudes. Reintenta en unos segundos.', { title: 'Error de carga' });
      }
      return;
    }

    allOrders = orders || [];

    filterOrders();
  } catch (err) {
    console.error('Fallo inesperado al cargar órdenes:', err?.message || err);
    if (window.showError) {
      window.showError('Fallo inesperado al cargar solicitudes.', { title: 'Error inesperado' });
    }
  }
}

// Carga de colaboradores desde Supabase
async function loadCollaborators() {
  const { data, error } = await supabaseConfig.client.from('collaborators').select('*');
  if (error) {
    console.error("Error al cargar colaboradores:", error);
    return [];
  }
  return data;
}

// Función para cargar y mostrar información del administrador
async function loadAdminInfo() {
  try {
    const { data: { user }, error } = await supabaseConfig.client.auth.getUser();
    
    if (error) {
      console.error('Error al obtener información del usuario:', error);
      return;
    }

    if (user) {
      const adminNameElement = document.getElementById('adminName');
      const adminAvatarElement = document.getElementById('adminAvatar');
      
      // Obtener el nombre del administrador
      let adminName = 'Administrador';
      if (user.user_metadata?.full_name) {
        adminName = user.user_metadata.full_name;
      } else if (user.email) {
        // Si no hay nombre completo, usar la parte antes del @ del email
        adminName = user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
      
      // Actualizar el nombre en el DOM
      if (adminNameElement) {
        adminNameElement.textContent = adminName;
      }
      
      // Generar avatar con iniciales
      if (adminAvatarElement) {
        const initials = adminName.split(' ').map(word => word.charAt(0).toUpperCase()).join('').substring(0, 2);
        adminAvatarElement.textContent = initials;
        
        // Generar color basado en el nombre
        const colors = ['bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-red-600', 'bg-yellow-600', 'bg-indigo-600'];
        const colorIndex = adminName.length % colors.length;
        adminAvatarElement.className = adminAvatarElement.className.replace(/bg-\w+-\d+/, colors[colorIndex]);
      }
    }
  } catch (error) {
    console.error('Error al cargar información del administrador:', error);
  }
}

// Función para filtrar pedidos
function filterOrders() {
  // YA NO HAY FILTROS EN LA UI. Se aplica el filtro por defecto de no mostrar completados/cancelados.
  filteredOrders = (allOrders || []).filter(order => {
    // Usar estados canónicos: Cancelada en lugar de Cancelado
    const matchesStatus = !['Completada', 'Cancelada'].includes(order.status);
    return matchesStatus;
  });

  sortTable(sortColumn, null, true); // Re-aplicar ordenamiento sin cambiar dirección
  renderOrders();
}

// Función para ordenar tabla
function sortTable(column, element) {
  if (element) { // Solo cambiar dirección si se hace clic en un header
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = column;
      sortDirection = 'asc';
    }
  }
  
  filteredOrders.sort((a, b) => {
    let aVal = a[column] || '';
    let bVal = b[column] || '';

    if (column === 'date') {
      aVal = new Date(`${a.date}T${a.time}`);
      bVal = new Date(`${b.date}T${b.time}`);
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  renderOrders();

  // Actualizar íconos de ordenación
  if (element) {
    document.querySelectorAll('th i[data-lucide]').forEach(icon => {
      icon.setAttribute('data-lucide', 'chevrons-up-down');
      icon.classList.remove('text-blue-600');
    });
    const icon = element.querySelector('i');
    icon.setAttribute('data-lucide', sortDirection === 'asc' ? 'chevron-up' : 'chevron-down');
    icon.classList.add('text-blue-600');
    lucide.createIcons();
  }
}

// Función para renderizar pedidos
function renderOrders(){
  const ordersTableBody = document.getElementById('ordersTableBody');
  if (!ordersTableBody) {
    console.error('No se encontró el elemento ordersTableBody');
    return;
  }
  ordersTableBody.innerHTML = '';

  // Actualizar contadores
  const showingCount = document.getElementById('showingCount');
  const totalCount = document.getElementById('totalCount');
  if (showingCount) showingCount.textContent = filteredOrders.length;
  if (totalCount) totalCount.textContent = allOrders.length;
  
  // Actualizar paneles de resumen
  updateResumen();

  if(filteredOrders.length === 0){
    ordersTableBody.innerHTML='<tr><td colspan="9" class="text-center py-6 text-gray-500">No hay pedidos que coincidan con los filtros.</td></tr>';
    // Render vacío en tarjetas móviles
    const cardContainer = document.getElementById('ordersCardContainer');
    if (cardContainer) {
      cardContainer.innerHTML = '<div class="text-center py-6 text-gray-500"><i data-lucide="package" class="w-6 h-6 text-gray-400"></i> No hay pedidos</div>';
    }
    return;
  }

  filteredOrders.forEach(o=>{
    const statusColor = {
      'Pendiente': 'bg-yellow-100 text-yellow-800',
      'Aceptada': 'bg-blue-100 text-blue-800',
      'En curso': 'bg-purple-100 text-purple-800',
      'Completada': 'bg-green-100 text-green-800',
      'Cancelada': 'bg-red-100 text-red-800'
    }[o.status] || 'bg-gray-100 text-gray-800';

    const displayStatus = (
      o.status === 'Aceptada' ? 'En proceso' :
      o.status === 'Completada' ? 'Completado' :
      o.status
    );

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = /*html*/`
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${o.id || 'N/A'}</td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm font-medium text-gray-900">${o.client_name || o.name || 'N/A'}</div>
        <div class="text-sm text-gray-500">${o.client_phone || o.phone || ''}</div>
        ${o.client_email || o.email ? `<div class="text-sm text-gray-500 truncate" title="${o.client_email || o.email}">${o.client_email || o.email}</div>` : ''}
        ${o.rnc ? `<div class="mt-1 text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full inline-block" title="Empresa: ${o.empresa || 'N/A'}">RNC: ${o.rnc}</div>` : ''}
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm text-gray-900">${o.service?.name || 'N/A'}</div>
        ${o.service_questions && Object.keys(o.service_questions).length > 0 ?
          `<button onclick="showServiceDetails(${o.id})" class="mt-1 text-xs text-blue-600 hover:text-blue-800 underline">
            <i data-lucide="info" class="w-3 h-3 inline-block mr-1"></i>Ver detalles
          </button>`
          : ''
        }
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${o.vehicle?.name || 'N/A'}</td>
      <td class="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title="${o.pickup} → ${o.delivery}">
        ${o.pickup} → ${o.delivery}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <div>${o.date}</div>
        <div class="text-gray-500">${o.time}</div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <select onchange="updateOrderStatus('${o.id}', this.value)" class="px-2 py-1 rounded-full text-xs font-semibold ${statusColor} border-0 focus:ring-2 focus:ring-blue-500">
          <option value="Pendiente" ${o.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="Aceptada" ${o.status === 'Aceptada' ? 'selected' : ''}>En Proceso</option>
          <option value="En curso" ${o.status === 'En curso' ? 'selected' : ''}>En curso</option>
          <option value="Completada" ${o.status === 'Completada' ? 'selected' : ''}>Completada</option>
          <option value="Cancelada" ${o.status === 'Cancelada' ? 'selected' : ''}>Cancelada</option>
        </select>
        ${o.collaborator?.name ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.collaborator.name}</div>` : ''}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button onclick="openPriceModal('${o.id}')" class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 transition-colors">
          <span class="font-semibold text-green-700">${o.monto_cobrado ? `$${Number(o.monto_cobrado).toLocaleString('es-DO')}` : 'Confirmar'}</span>
          <div class="text-xs text-gray-500">${o.metodo_pago || 'No especificado'}</div>
        </button>
      </td>
    `;
    tr.addEventListener('dblclick', () => openAssignModal(o.id));
    ordersTableBody.appendChild(tr);
  });

  // Render tarjetas en móvil
  const cardContainer = document.getElementById('ordersCardContainer');
  if (cardContainer) {
    cardContainer.innerHTML = '';
    filteredOrders.forEach(o => {
      const badge = {
        'Pendiente': 'bg-yellow-100 text-yellow-800',
        'Aceptada': 'bg-blue-100 text-blue-800',
        'En curso': 'bg-purple-100 text-purple-800',
        'Completada': 'bg-green-100 text-green-800',
        'Cancelada': 'bg-red-100 text-red-800'
      }[o.status] || 'bg-gray-100 text-gray-800';
      const displayStatusMobile = (
        o.status === 'Aceptada' ? 'En proceso' :
        o.status === 'Completada' ? 'Completada' :
        o.status
      );
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow p-4';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <div>
            <div class="text-sm text-gray-500">#${o.id}</div>
            <div class="font-semibold text-gray-900">${o.service?.name || 'N/A'}</div>
            <div class="text-sm text-gray-600 truncate">${o.pickup} → ${o.delivery}</div>
          </div>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${badge}">${displayStatusMobile}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <p class="text-gray-500">Cliente</p>
            <p class="text-gray-900">${o.name || 'N/A'}</p>
          </div>
          <div>
            <p class="text-gray-500">Fecha</p>
            <p class="text-gray-900">${o.date} ${o.time || ''}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          ${o.service_questions && Object.keys(o.service_questions).length > 0 ?
            `<button class="px-3 py-1 rounded bg-gray-100 text-gray-700 text-xs" onclick="showServiceDetails('${o.id}')">Detalles</button>` : ''}
          <button class="px-3 py-1 rounded bg-blue-600 text-white text-xs" onclick="openAssignModal('${o.id}')">Gestionar</button>
        </div>
      `;
      cardContainer.appendChild(card);
    });
  }

  if (window.lucide) lucide.createIcons();
  updateCharts();
}

// --- Menú de acciones eliminado ---

// --- INICIO: Funciones de Actualización y UI ---
// Función para actualizar el estado de una orden en Supabase
async function updateOrderStatus(orderId, newStatus) {
  // COMENTARIO: Esta función ahora utiliza el OrderManager centralizado.
  console.log(`[Dueño] Solicitando cambio de estado para orden #${orderId} a "${newStatus}"`);

  // El tercer parámetro (additionalData) está vacío porque el dueño solo cambia el estado principal.
  const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, newStatus, {});

  if (success) {
    notifications.success(`Estado del pedido #${orderId} actualizado a "${newStatus}".`);

    // Si el estado se cambia a 'Completado', el filtro se encargará de ocultarlo.
    // Forzamos la recarga para asegurar que la vista esté 100% sincronizada.
    await loadOrders();

    // Redirigir al historial cuando se marca como completada
    if (newStatus === 'Completada' || newStatus === 'Completado') {
      try {
        window.location.href = 'historial.html';
      } catch (_) {}
    }

  } else {
    notifications.error('No se pudo actualizar el estado de la orden.', error);
    // Si falla, recargamos para revertir cualquier cambio visual optimista.
    await loadOrders();
  }
}

// Función para mostrar detalles del servicio
function showServiceDetails(orderId) {
  const order = allOrders.find(o => o.id === Number(orderId));
  if (!order || !order.service_questions || Object.keys(order.service_questions).length === 0) {
    notifications.info('Esta orden no tiene detalles adicionales de servicio.');
    return;
  }

  let detailsHtml = `<h3 class="text-lg font-semibold mb-4 text-gray-800">Detalles del Servicio: ${order.service?.name || 'N/A'}</h3>`;
  detailsHtml += '<div class="space-y-3 text-sm">';

  for (const [question, answer] of Object.entries(order.service_questions)) {
    // Formatear la pregunta para que sea más legible
    const formattedQuestion = question.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    detailsHtml += `
      <div>
        <p class="font-medium text-gray-600">${formattedQuestion}</p>
        <p class="text-gray-900 pl-2">${answer || 'No especificado'}</p>
      </div>
    `;
  }
  detailsHtml += '</div>';

  // Crear y mostrar el modal
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto shadow-xl">
      ${detailsHtml}
      <button onclick="this.closest('.fixed').remove()" class="mt-6 w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
        Cerrar
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

// Función para actualizar resumen
function updateResumen(){
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = allOrders.filter(o => o.date === today);
  const completedOrders = allOrders.filter(o => o.status === 'Completada').length;
  const pendingOrders = allOrders.filter(o => !['Completada', 'Cancelada'].includes(o.status));
  const urgentOrders = pendingOrders.filter(o => {
    const serviceTime = new Date(`${o.date}T${o.time || '00:00'}`);
    const now = new Date();
    const diffHours = (serviceTime - now) / (1000 * 60 * 60);
    return diffHours > 0 && diffHours <= 24;
  });

  document.getElementById('totalPedidos').textContent = allOrders.length;
  document.getElementById('pedidosHoy').textContent = todayOrders.length;
  document.getElementById('pedidosCompletados').textContent = completedOrders;
  document.getElementById('porcentajeCompletados').textContent = allOrders.length > 0 ? Math.round((completedOrders / allOrders.length) * 100) : 0;
  document.getElementById('pedidosPendientes').textContent = pendingOrders.length;
  document.getElementById('urgentes').textContent = urgentOrders.length;
}

// Función para actualizar gráficos
function updateCharts() {
  const servicesChartEl = document.getElementById('servicesChart');
  const vehiclesChartEl = document.getElementById('vehiclesChart');
  const alertasEl = document.getElementById('alertasLista');

  if (!servicesChartEl || !vehiclesChartEl) return; // No hacer nada si los gráficos no están en la página
  // Gráfico de servicios
  const serviceStats = {};
  allOrders.forEach(o => {
    const serviceName = o.service?.name || 'Sin Servicio';
    serviceStats[serviceName] = (serviceStats[serviceName] || 0) + 1;
  });

  servicesChartEl.innerHTML = '';
  const maxService = Math.max(1, ...Object.values(serviceStats)); // Evitar división por cero

  Object.entries(serviceStats).forEach(([service, count]) => {
    const percentage = maxService > 0 ? (count / maxService) * 100 : 0;
    servicesChartEl.innerHTML += `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-700">${service}</span>
        <span class="text-sm text-gray-500">${count}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
      </div>
    `;
  });

  // Gráfico de vehículos
  const vehicleStats = {};
  allOrders.forEach(o => {
    const vehicleName = o.vehicle?.name || 'Sin Vehículo';
    vehicleStats[vehicleName] = (vehicleStats[vehicleName] || 0) + 1;
  });

  vehiclesChartEl.innerHTML = '';
  const maxVehicle = Math.max(1, ...Object.values(vehicleStats)); // Evitar división por cero

  Object.entries(vehicleStats).forEach(([vehicle, count]) => {
    const percentage = maxVehicle > 0 ? (count / maxVehicle) * 100 : 0;
    vehiclesChartEl.innerHTML += `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-700">${vehicle}</span>
        <span class="text-sm text-gray-500">${count}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div class="bg-red-600 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
      </div>
    `;
  });

  // Alertas
  if (alertasEl) {
    alertasEl.innerHTML = '';
    const now = new Date();
    const proximos = allOrders.filter(o => {
      const serviceTime = new Date(`${o.date}T${o.time || '00:00'}`);
      const diffMin = (serviceTime - now) / 60000;
      return diffMin > 0 && diffMin <= 60;
    });

    if (proximos.length === 0) {
      alertasEl.innerHTML = '<li class="text-gray-500">No hay alertas por ahora.</li>';
    } else {
      proximos.forEach(o => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${o.service?.name}</strong> para <strong>${o.name}</strong> comienza a las <strong>${o.time}</strong>`;
        alertasEl.appendChild(li);
      });
    }
  }
}
// Gestión de asignación y eliminación de pedidos desde modal
async function openAssignModal(orderId){
  selectedOrderIdForAssign = Number(orderId);
  const modal = document.getElementById('assignModal');
  const modalTitle = document.getElementById('assignModalTitle');
  const body = document.getElementById('assignModalBody');
  const select = document.getElementById('assignSelect');
  const assignBtn = document.getElementById('assignConfirmBtn');

  const order = allOrders.find(o => o.id === selectedOrderIdForAssign);
  const colaboradores = await loadCollaborators();

  modalTitle.textContent = `Gestionar Orden #${order.short_id || order.id}`;
  const displayClient = [order.name, order.phone || order.email].filter(Boolean).join(' · ');
  body.innerHTML = `
    <div class="space-y-1 text-sm text-gray-700">
      <p><strong>ID:</strong> ${order.short_id || order.id}</p>
      <p><strong>Cliente:</strong> ${displayClient || 'Anónimo'}</p>
      <p><strong>Servicio:</strong> ${order.service?.name || 'N/A'}</p>
      <p><strong>Ruta:</strong> ${order.pickup} → ${order.delivery}</p>
      <p><strong>Fecha/Hora:</strong> ${order.date} ${order.time || ''}</p>
      ${order.service_questions && Object.keys(order.service_questions).length > 0 ? `
        <div class="mt-2 pt-2 border-t">
          <strong class="block mb-1">Detalles Adicionales:</strong>
          <div class="text-xs space-y-1">${Object.entries(order.service_questions).map(([q, a]) => `<div><strong>${q.replace(/_/g, ' ')}:</strong> ${a}</div>`).join('')}</div>
        </div>
      ` : ''}
    </div>
  `;

  select.innerHTML = '';
  if (colaboradores.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No hay colaboradores registrados';
    select.appendChild(opt);
    select.disabled = true;
    assignBtn.disabled = true;
  } else {
    colaboradores.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; // ✅ CORREGIDO: Usar el ID (UUID) del colaborador
      opt.textContent = `${c.name} — ${c.role}`;
      select.appendChild(opt);
    });
    select.disabled = false;
    assignBtn.disabled = false;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  // Handlers de botones del modal
  const whatsappBtn = document.getElementById('whatsappBtn');
  const invoiceBtn = document.getElementById('generateInvoiceBtn');
  const cancelBtn = document.getElementById('assignCancelBtn');
  const deleteBtn = document.getElementById('deleteOrderBtn');

  // ✅ CORRECCIÓN: Asignar evento con addEventListener para mayor fiabilidad.
  if (whatsappBtn) {
    // Eliminar cualquier listener anterior para evitar duplicados
    whatsappBtn.replaceWith(whatsappBtn.cloneNode(true));
    document.getElementById('whatsappBtn').addEventListener('click', () => openWhatsApp(order));
  }

  if (invoiceBtn) invoiceBtn.onclick = () => generateAndSendInvoice(order.id);
  if (cancelBtn) cancelBtn.onclick = () => closeAssignModal();
  if (deleteBtn) deleteBtn.onclick = () => deleteSelectedOrder();

  // Doble clic para expandir el cuerpo del modal
  const modalBody = document.getElementById('assignModalBody');
  if (modalBody) {
    modalBody.addEventListener('dblclick', () => {
      modalBody.classList.toggle('max-h-[70vh]');
      modalBody.classList.toggle('overflow-y-auto');
    });
  }

  const notifyClientBtn = document.getElementById('notifyClientBtn');
  if (notifyClientBtn) {
    notifyClientBtn.replaceWith(notifyClientBtn.cloneNode(true));
    document.getElementById('notifyClientBtn').addEventListener('click', async () => {
      try {
        const r = await fetch('/api/sendToOrder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            title: `Actualización de su orden #${order.short_id || order.id}`,
            body: 'Su orden ha sido actualizada',
            data: { url: `/seguimiento.html?orderId=${order.short_id || order.id}` }
          })
        });
        if (r.ok) {
          const j = await r.json();
          if (j.success) {
            notifications.success(`Notificación enviada al cliente (${j.sent}/${j.total})`);
          } else {
            notifications.warning(j.message || 'No se enviaron notificaciones');
          }
          return;
        }
        const { data, error } = await supabaseConfig.client.functions.invoke('notify-role', {
          body: {
            role: 'cliente',
            orderId: order.id,
            title: `Actualización de su orden #${order.short_id || order.id}`,
            body: 'Su orden ha sido actualizada',
            data: { url: `/seguimiento.html?orderId=${order.short_id || order.id}` }
          }
        });
        if (error) throw error;
        notifications.success('Notificación enviada al cliente');
      } catch (e) {
        notifications.error('Error al notificar al cliente');
      }
    });
  }

  const notifyCollabBtn = document.getElementById('notifyCollabBtn');
  if (notifyCollabBtn) {
    notifyCollabBtn.replaceWith(notifyCollabBtn.cloneNode(true));
    document.getElementById('notifyCollabBtn').addEventListener('click', async () => {
      try {
        const { data, error } = await supabaseConfig.client.functions.invoke('notify-role', {
          body: {
            role: 'colaborador',
            orderId: order.id,
            title: `Orden #${order.short_id || order.id} actualizada`,
            body: 'Revisa tu panel, se actualizó tu orden asignada',
            data: { url: `/panel-colaborador.html?orderId=${order.short_id || order.id}` }
          }
        });
        if (error) throw error;
        const sent = (data && typeof data.sent === 'number') ? data.sent : null;
        const total = (data && typeof data.total === 'number') ? data.total : null;
        if (sent !== null && total !== null) {
          notifications.success(`Notificación enviada al colaborador (${sent}/${total})`);
        } else if (data?.success) {
          notifications.success('Notificación enviada al colaborador');
        } else {
          notifications.warning(data?.message || 'No se enviaron notificaciones');
        }
      } catch (e) {
        notifications.error('Error al notificar al colaborador');
      }
    });
  }

  const notifyAdminsBtn = document.getElementById('notifyAdminsBtn');
  if (notifyAdminsBtn) {
    notifyAdminsBtn.replaceWith(notifyAdminsBtn.cloneNode(true));
    document.getElementById('notifyAdminsBtn').addEventListener('click', async () => {
      try {
        const { data, error } = await supabaseConfig.client.functions.invoke('notify-role', {
          body: {
            role: 'administrador',
            orderId: order.id,
            title: `Orden #${order.short_id || order.id} modificada`,
            body: 'Se realizó una acción desde el panel del dueño',
            data: { url: `/inicio.html?orderId=${order.short_id || order.id}` }
          }
        });
        if (error) throw error;
        const sent = (data && typeof data.sent === 'number') ? data.sent : null;
        const total = (data && typeof data.total === 'number') ? data.total : null;
        if (sent !== null && total !== null) {
          notifications.success(`Notificación enviada a administradores (${sent}/${total})`);
        } else if (data?.success) {
          notifications.success('Notificación enviada a administradores');
        } else {
          notifications.warning(data?.message || 'No se enviaron notificaciones');
        }
      } catch (e) {
        notifications.error('Error al notificar a administradores');
      }
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeAssignModal(){
  const modal = document.getElementById('assignModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  selectedOrderIdForAssign = null;
}

async function assignSelectedCollaborator(){
  const collaboratorId = document.getElementById('assignSelect').value;
  if (!collaboratorId) { 
    notifications.error('Selecciona un colaborador.'); 
    return; 
  }
  
  const colaboradores = await loadCollaborators();
  const col = colaboradores.find(c => c.id === collaboratorId);
  if (!col) { 
    notifications.error('Colaborador no encontrado.'); 
    return; 
  }
  const updateData = {
    assigned_to: collaboratorId,
    assigned_at: new Date().toISOString()
  };

  // Usar OrderManager para centralizar lógica y tracking
  const { success, error } = await OrderManager.actualizarEstadoPedido(selectedOrderIdForAssign, 'en_camino_recoger', updateData);

  if (!success) {
    notifications.error('Error de asignación', error?.message || 'No se pudo asignar el pedido.');
  } else {
    // Actualizar el array local para reflejar el cambio inmediatamente
    const orderIndex = allOrders.findIndex(o => o.id === selectedOrderIdForAssign);
    if (orderIndex !== -1) {
      allOrders[orderIndex] = { ...allOrders[orderIndex], ...updateData, status: 'Aceptada' };
    }
    filterOrders();
    notifications.success(`Pedido asignado a ${col.name} y marcado como "En proceso".`);
  }
  
  closeAssignModal();
}

async function deleteSelectedOrder(){
  if (!confirm('¿Eliminar esta solicitud?')) return;
  
  const { error } = await supabaseConfig.client.from('orders').delete().eq('id', selectedOrderIdForAssign);
  
  if (error) {
    notifications.error('Error al eliminar', error.message);
  } else {
    allOrders = allOrders.filter(o => o.id !== selectedOrderIdForAssign);
    filterOrders();
    notifications.success(`La solicitud #${selectedOrderIdForAssign} ha sido eliminada.`);
  }
  closeAssignModal();
}

// Función para generar y enviar factura
async function generateAndSendInvoice(orderId) {
  const order = allOrders.find(o => o.id === Number(orderId));
  if (!order) {
    notifications.error('Orden no encontrada.');
    return;
  }

  // Validar que el cliente tenga un email
  const clientEmail = order.client_email || order.email;
  if (!clientEmail) {
    notifications.error('Cliente sin email', 'Esta orden no tiene un correo electrónico de cliente registrado para enviar la factura.');
    return;
  }

  notifications.info('Generando factura y abriendo Gmail...', 'Espera un momento.');

  try {
    // 1. Invocar una Edge Function para generar el PDF y obtener su URL
    const { data: pdfData, error: pdfError } = await supabaseConfig.client.functions.invoke('generate-invoice-pdf', {
      body: {
        orderId: order.id
      }
    });

    if (pdfError || !pdfData?.pdfUrl) {
      throw new Error(pdfError?.message || 'La función del servidor no pudo generar el PDF.');
    }

    const pdfUrl = pdfData.pdfUrl;

    try {
      const linkWrap = document.getElementById('invoiceLink');
      const linkA = document.getElementById('invoiceLinkAnchor');
      if (linkWrap && linkA) {
        linkA.href = pdfUrl;
        linkA.textContent = 'Ver factura';
        linkWrap.style.display = 'block';
      }
    } catch(_) { }

    const { data: emailResp } = await supabaseConfig.client.functions.invoke('send-invoice', {
      body: { orderId: order.id, email: clientEmail }
    });
    const emailSent = !!(emailResp && emailResp.success && emailResp.data && emailResp.data.emailSent);

    // 2. Preparar el contenido para el enlace mailto de Gmail
    const subject = `Factura de su orden #${order.short_id || order.id} con Logística López Ortiz`;
    const body = `¡Hola, ${order.client_name || order.name}!\n\nAdjunto le enviamos los detalles y la factura correspondiente a su orden de servicio con nosotros.\n\n- Servicio: ${order.service?.name || 'N/A'}\n- Ruta: ${order.pickup} → ${order.delivery}\n- Fecha: ${order.date}\n\nPuede ver y descargar su factura desde el siguiente enlace seguro:\n${pdfUrl}\n\nSi tiene alguna pregunta, no dude en contactarnos.\n\n¡Gracias por confiar en Logística López Ortiz!`;

    // 3. Crear y abrir el enlace de Gmail
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.open(gmailUrl, '_blank');

    if (emailSent) {
      notifications.success('Correo enviado', 'Se envió la factura al cliente y se abrió Gmail como respaldo.');
    } else {
      notifications.success('Gmail Abierto', 'Se abrió Gmail con el borrador para enviar la factura.');
    }

  } catch (error) {
    console.error('Error al procesar la factura:', error);
    notifications.error(
      'Error al procesar factura',
      error.message || 'No se pudo generar el enlace de la factura. Revisa la consola y la Edge Function `generate-invoice-pdf`.'
    );
  }
}

// Función para notificar al colaborador (simulada)
function notifyCollaborator(order, collaborator) {
  console.log(`Notificando a ${collaborator.name} sobre nueva asignación:`, order.id);
  // En una implementación real, aquí se enviaría una notificación push, SMS o correo
}

// Función para alternar menú de acciones
function toggleActionsMenu(orderId, event) {
  event.stopPropagation();
  
  // Cerrar otros menús abiertos
  document.querySelectorAll('.actions-menu').forEach(menu => {
    if (menu.id !== `actions-menu-${orderId}`) {
      menu.classList.add('hidden');
    }
  });
  
  // Alternar el menú actual
  const menu = document.getElementById(`actions-menu-${orderId}`);
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

// Cerrar menús al hacer clic fuera
document.addEventListener('click', function(event) {
  if (!event.target.closest('.actions-menu') && !event.target.closest('[onclick*="toggleActionsMenu"]')) {
    document.querySelectorAll('.actions-menu').forEach(menu => {
      menu.classList.add('hidden');
    });
  }
});

// --- Lógica de Tiempo Real con Supabase ---

function handleRealtimeUpdate(payload) {
  const { eventType, new: newRecord, old: oldRecord, table } = payload;

  if (table !== 'orders') return;

  switch (eventType) {
    case 'INSERT':
      // Añadir la nueva orden al principio del array
      allOrders.unshift(newRecord);
      // Volver a aplicar filtros y renderizar
      filterOrders();
      // Mostrar una notificación persistente con el ID para copiar
      if (window.notifications) {
        notifications.info( // La data relacionada (service.name) no viene en el payload de realtime, por eso no se muestra
          `Cliente: ${newRecord.name}.`,
          { title: `Nueva Solicitud #${newRecord.id}`, duration: 10000 }
        );
      }
      break;
    case 'UPDATE':
      // Encontrar y actualizar la orden en el array
      const indexToUpdate = allOrders.findIndex(order => order.id === newRecord.id);
      if (indexToUpdate !== -1) {
        // Actualizar la orden en el array
        allOrders[indexToUpdate] = { ...allOrders[indexToUpdate], ...newRecord };
        
        // Reaplicar los filtros
        filterOrders();
      }
      break;
    case 'DELETE':
      // Eliminar la orden del array
      allOrders = allOrders.filter(order => order.id !== oldRecord.id);
      filterOrders();
      break;
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Modal listeners
  document.getElementById('assignCancelBtn').addEventListener('click', closeAssignModal);
  document.getElementById('assignConfirmBtn').addEventListener('click', assignSelectedCollaborator);
  document.getElementById('deleteOrderBtn').addEventListener('click', deleteSelectedOrder);
  // Listeners para el modal de precio
  document.getElementById('priceCancelBtn').addEventListener('click', closePriceModal);
  document.getElementById('priceSaveBtn').addEventListener('click', savePriceData);

  // Función para hacer funciones globales
  window.sortTable = sortTable;
  window.updateOrderStatus = updateOrderStatus;
  window.openAssignModal = openAssignModal;
  window.generateAndSendInvoice = generateAndSendInvoice;
  window.toggleActionsMenu = toggleActionsMenu;
  window.showServiceDetails = showServiceDetails;
  window.openWhatsApp = openWhatsApp;

  // Suscribirse a los cambios en tiempo real de la tabla 'orders'
  const ordersSubscription = supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
    .subscribe();

  let selectedOrderIdForPrice = null;

  // --- Gestión del Modal de Precio ---
  function openPriceModal(orderId) {
    selectedOrderIdForPrice = orderId;
    const order = allOrders.find(o => o.id == selectedOrderIdForPrice);
    if (!order) {
      notifications.error('Error', 'No se encontró la orden para actualizar el precio.');
      return;
    }

    document.getElementById('montoCobrado').value = order.monto_cobrado || '';
    document.getElementById('metodoPago').value = order.metodo_pago || '';

    const modal = document.getElementById('priceModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closePriceModal() {
    const modal = document.getElementById('priceModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    selectedOrderIdForPrice = null;
  }

  async function savePriceData() {
    const monto = document.getElementById('montoCobrado').value;
    const metodo = document.getElementById('metodoPago').value;

    if (!monto) {
      notifications.warning('Dato requerido', 'Debes ingresar un monto.');
      return;
    }
    try {
      // Preferir RPC para evitar errores de RLS/406
      const updated = await OrderManager.setOrderAmount(selectedOrderIdForPrice, monto, metodo);
      const orderIndex = allOrders.findIndex(o => o.id == selectedOrderIdForPrice);
      if (orderIndex !== -1 && updated) {
        allOrders[orderIndex].monto_cobrado = updated.monto_cobrado ?? parseFloat(monto);
        allOrders[orderIndex].metodo_pago = updated.metodo_pago ?? metodo;
      }
      renderOrders();
      notifications.success('Éxito', 'El monto y método de pago han sido actualizados.');
      closePriceModal();
    } catch (error) {
      console.error('[savePriceData] Error al guardar monto por RPC:', error);
      notifications.error('Error al guardar', error.message || 'No se pudo guardar el monto');
    }
  }

  // Hacer funciones globales
  window.openPriceModal = openPriceModal;
  window.closeAssignModal = closeAssignModal; // Hacerla global para el botón de cierre

  function openWhatsApp(order) {
    // Verificar que existe el número de teléfono
    if (!order.phone) {
      notifications.error('Esta orden no tiene un número de teléfono registrado.');
      return;
    }
    
    // Limpiar y formatear el número de teléfono
    let phone = order.phone.replace(/[^0-9]/g, '');
    
    // Si el número no tiene código de país, agregar el de República Dominicana (+1809)
    if (phone.length === 10 && !phone.startsWith('1')) {
      phone = '1809' + phone;
    } else if (phone.length === 7) {
      phone = '1809' + phone;
    }
    
    // Crear mensaje personalizado con información de la orden
    const message = `👋 ¡Hola, ${order.name}! Somos del equipo de Logística López Ortiz 🚛.\nQueríamos informarle que recibimos su solicitud y estamos revisando algunos detalles importantes antes de proceder.\nEn breve nos pondremos en contacto con más información.\n¡Gracias por elegirnos! 💼`;
    
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

async function checkVapidStatus() {
  try {
    const { data, error } = await supabaseConfig.client.functions.invoke('getVapidKey');
    if (error) return;
    const k = data && data.key;
    if (!k || typeof k !== 'string') {
      notifications.warning('Claves VAPID no configuradas', { title: 'Push deshabilitado' });
      return;
    }
    const raw = vapidToBytes(k);
    if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
      notifications.warning('Clave VAPID inválida', { title: 'Push deshabilitado' });
    } else {
      notifications.info('VAPID configurada correctamente');
    }
  } catch (_) {}
}

function vapidToBytes(base64String) {
  try {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  } catch (_) { return new Uint8Array(0); }
}

  // Inicialización
  function init() {
    loadOrders();
    loadAdminInfo();
    checkVapidStatus();
  }

  init();
});
