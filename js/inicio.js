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
    const [ordersRes, services, vehicles] = await Promise.all([
      supabaseConfig.client
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false }),
      supabaseConfig.getServices(),
      supabaseConfig.getVehicles()
    ]);

    const { data: orders, error } = ordersRes || {};
    if (error) {
      console.error("Error al cargar las órdenes:", error?.message || error);
      if (window.showError) {
        window.showError('No se pudieron cargar las solicitudes. Reintenta en unos segundos.', { title: 'Error de carga' });
      }
      return;
    }

    const serviceMap = Object.fromEntries((services || []).map(s => [s.id, s]));
    const vehicleMap = Object.fromEntries((vehicles || []).map(v => [v.id, v]));

    allOrders = (orders || []).map(o => ({
      ...o,
      service: o.service || serviceMap[o.service_id] || null,
      vehicle: o.vehicle || vehicleMap[o.vehicle_id] || null
    }));

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

// Función para filtrar pedidos
function filterOrders() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const serviceFilter = document.getElementById('serviceFilter').value;
  const dateFilter = document.getElementById('dateFilter').value;

  filteredOrders = (allOrders || []).filter(order => {
    const matchesSearch = !searchTerm || 
      (order.name || '').toLowerCase().includes(searchTerm) ||
      (order.phone || '').includes(searchTerm) ||
      ((order.email || '').toLowerCase().includes(searchTerm)) ||
      String(order.id).includes(searchTerm);

    // COMENTARIO: Lógica de filtrado actualizada.
    // Por defecto, se ocultan las órdenes 'Completado' y 'Cancelado'.
    // Si se selecciona un filtro de estado, se muestra solo ese estado.
    const matchesStatus = statusFilter ? order.status === statusFilter : !['Completado', 'Cancelado'].includes(order.status);

    const matchesService = !serviceFilter || ((order.service?.name || order.service || '').toLowerCase() === serviceFilter.toLowerCase());
    const matchesDate = !dateFilter || order.date === dateFilter;

    return matchesSearch && matchesStatus && matchesService && matchesDate;
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
      'En proceso': 'bg-blue-100 text-blue-800',
      'Completado': 'bg-green-100 text-green-800',
      'Cancelado': 'bg-red-100 text-red-800'
    }[o.status] || 'bg-gray-100 text-gray-800';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = /*html*/`
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${o.id || 'N/A'}</td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm font-medium text-gray-900">${o.name}</div>
        <div class="text-sm text-gray-500">${o.phone}</div>
        ${o.email ? `<div class="text-sm text-gray-500 truncate" title="${o.email}">${o.email}</div>` : ''}
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
          <option value="En proceso" ${o.status === 'En proceso' ? 'selected' : ''}>En Proceso</option>
          <option value="Completado" ${o.status === 'Completado' ? 'selected' : ''}>Completado</option>
          <option value="Cancelado" ${o.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
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
        'En proceso': 'bg-blue-100 text-blue-800',
        'Completado': 'bg-green-100 text-green-800',
        'Cancelado': 'bg-red-100 text-red-800'
      }[o.status] || 'bg-gray-100 text-gray-800';
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow p-4';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <div>
            <div class="text-sm text-gray-500">#${o.id}</div>
            <div class="font-semibold text-gray-900">${o.service?.name || 'N/A'}</div>
            <div class="text-sm text-gray-600 truncate">${o.pickup} → ${o.delivery}</div>
          </div>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${badge}">${o.status}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <p class="text-gray-500">Cliente</p>
            <p class="text-gray-900">${o.name}</p>
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
  const completedOrders = allOrders.filter(o => o.status === 'Completado').length;
  const pendingOrders = allOrders.filter(o => !['Completado', 'Cancelado'].includes(o.status));
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
  body.innerHTML = `
    <div class="space-y-1 text-sm text-gray-700">
      <p><strong>ID:</strong> ${order.id}</p>
      <p><strong>Cliente:</strong> ${order.name} (${order.phone})</p>
      ${order.rnc ? `<p><strong>RNC:</strong> ${order.rnc} (${order.empresa || 'N/A'})</p>` : ''}
      <p><strong>Servicio:</strong> ${order.service?.name || 'N/A'}</p>
      <p><strong>Ruta:</strong> ${order.pickup} → ${order.delivery}</p>
      <p><strong>Fecha/Hora:</strong> ${order.date} ${order.time}</p>
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
  if (whatsappBtn) whatsappBtn.onclick = () => openWhatsApp(order);
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
    assigned_to: collaboratorId, // ✅ CORREGIDO: Asignar por ID (UUID)
    assigned_at: new Date().toISOString(),
    status: 'En proceso' // Cambio automático a "En proceso"
  };

  const { data, error } = await supabaseConfig.client
    .from('orders')
    .update(updateData)
    .eq('id', selectedOrderIdForAssign);

  if (error) {
    notifications.error('Error de asignación', error.message);
  } else {
    // Actualizar el array local para reflejar el cambio inmediatamente
    const orderIndex = allOrders.findIndex(o => o.id === selectedOrderIdForAssign);
    if (orderIndex !== -1) {
      allOrders[orderIndex] = { ...allOrders[orderIndex], ...updateData };
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
  notifications.info('Generando Factura...', 'Por favor, espera un momento.');
  const order = allOrders.find(o => o.id === orderId); // ✅ CORREGIDO: El ID ahora es UUID (texto), no se convierte a número.
  if (!order) {
    notifications.error('Orden no encontrada.');
    return;
  }

  if (!order.estimated_price || order.estimated_price === 'Por confirmar') {
    notifications.warning('Debes establecer un precio antes de generar la factura.');
    return;
  }

  try {
    const businessSettings = await supabaseConfig.getBusinessSettings();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // --- Contenido del PDF ---
    // Logo (si existe)
    if (businessSettings.logo_url) {
      try {
        // Necesitamos una imagen que no tenga restricciones de CORS
        // Por ahora, lo dejamos como texto. Para usar una imagen, debe estar en un bucket público.
        // const imgData = businessSettings.logo_url; 
        // doc.addImage(imgData, 'PNG', 15, 15, 40, 40);
      } catch (e) { console.error("No se pudo cargar el logo en el PDF:", e); }
    }

    // Encabezado de la factura
    doc.setFontSize(20);
    doc.text(businessSettings.business_name || 'Logística López Ortiz', 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text(businessSettings.address || 'Dirección de la empresa', 105, 27, { align: 'center' });
    doc.text(`Tel: ${businessSettings.phone || 'N/A'} | Email: ${businessSettings.email || 'N/A'}`, 105, 32, { align: 'center' });

    doc.setFontSize(16);
    doc.text(`Factura #${order.id}`, 15, 50);
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, 15, 56);

    // Datos del cliente
    doc.setFontSize(12);
    doc.text('Facturar a:', 15, 70);
    doc.setFontSize(10);
    doc.text(order.name, 15, 76);
    doc.text(order.phone, 15, 81);
    doc.text(order.email, 15, 86);
    if (order.rnc) {
      doc.text(`RNC: ${order.rnc} (${order.empresa})`, 15, 91);
    }

    // Tabla con detalles del servicio
    doc.autoTable({
      startY: 100,
      head: [['Descripción', 'Detalle']],
      body: [
        ['Servicio', order.service?.name || 'N/A'],
        ['Vehículo', order.vehicle?.name || 'N/A'],
        ['Fecha Programada', `${order.date} a las ${order.time}`],
        ['Origen', order.pickup],
        ['Destino', order.delivery],
      ],
      theme: 'striped'
    });

    // Total
    const finalY = doc.lastAutoTable.finalY;
    doc.setFontSize(14);
    doc.text('Total:', 140, finalY + 15);
    doc.setFont(undefined, 'bold');
    doc.text(order.estimated_price, 170, finalY + 15);

    // La subida a Storage y el registro en la tabla invoices
    // ahora los realiza la Edge Function `send-invoice` con clave de servicio.
    // Esto evita errores de CORS y asegura consistencia con el esquema del servidor.
    // Si se requiere vista previa local, podemos seguir generando el PDF en memoria.
    const arrayBuffer = doc.output('arraybuffer');
    const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });

    // --- Envío por Correo ---
    const pdfBase64 = doc.output('datauristring').split(',')[1];

    showNotification('Enviando Correo...', 'La factura se está enviando al cliente.', 'info');

    // Invocar la Edge Function con el contrato esperado: { orderId, email }
    const { data: fnResp, error: functionError } = await supabaseConfig.client.functions.invoke('send-invoice', {
      body: {
        orderId: String(order.id),
        email: order.email
      }
    });

    if (functionError) throw functionError;

    const recipientInfo = fnResp?.data?.recipientEmail ? ` a ${fnResp.data.recipientEmail}` : '';
    if (fnResp?.success) {
      notifications.success('Factura Enviada', `La factura para la orden #${order.id} ha sido enviada${recipientInfo}.`);
    } else {
      notifications.success('Factura Generada', `La factura para la orden #${order.id} fue generada correctamente.`);
    }

  } catch (error) {
    console.error('Error al generar o enviar la factura:', error);
    notifications.error('Error de Factura', 'No se pudo generar o enviar el PDF. Revisa la consola.');
  }
}

// Función para notificar al colaborador (simulada)
function notifyCollaborator(order, collaborator) {
  console.log(`Notificando a ${collaborator.name} sobre nueva asignación:`, order.id);
  // En una implementación real, aquí se enviaría una notificación push, SMS o correo
}

// Función para exportar datos
function exportToCSV() {
  const headers = ['ID', 'Cliente', 'Teléfono', 'Email', 'Servicio', 'Vehículo', 'Recogida', 'Entrega', 'Fecha', 'Hora', 'Estado', 'Precio'];
  const csvContent = [headers.join(',')];
  
  filteredOrders.forEach(order => {
    const row = [
      order.id,
      `"${order.name}"`, // Escaped quotes for CSV
      order.phone,
      order.email,
      `"${order.service}"`, // Escaped quotes for CSV
      `"${order.vehicle}"`, // Escaped quotes for CSV
      `"${order.pickup}"`, // Escaped quotes for CSV
      `"${order.delivery}"`, // Escaped quotes for CSV
      order.date,
      order.time,
      order.status,
      order.estimated_price || 'Por confirmar'
    ];
    csvContent.push(row.join(','));
  });
  
  const blob = new Blob([csvContent.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `pedidos_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
        allOrders[indexToUpdate] = { ...allOrders[indexToUpdate], ...newRecord };
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
  document.getElementById('searchInput').addEventListener('input', filterOrders);
  document.getElementById('statusFilter').addEventListener('change', filterOrders);
  document.getElementById('serviceFilter').addEventListener('change', filterOrders);
  document.getElementById('dateFilter').addEventListener('change', filterOrders);
  document.getElementById('exportBtn').addEventListener('click', exportToCSV);
  // Modal listeners
  document.getElementById('assignCancelBtn').addEventListener('click', closeAssignModal);
  document.getElementById('assignConfirmBtn').addEventListener('click', assignSelectedCollaborator);
  document.getElementById('deleteOrderBtn').addEventListener('click', deleteSelectedOrder);
  // Listeners para el modal de precio
  document.getElementById('priceCancelBtn').addEventListener('click', closePriceModal);
  document.getElementById('priceSaveBtn').addEventListener('click', savePriceData);
  
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('serviceFilter').value = '';
    document.getElementById('dateFilter').value = '';
    filterOrders();
  });

  // Función para hacer funciones globales
  window.sortTable = sortTable;
  window.updateOrderStatus = updateOrderStatus;
  window.openAssignModal = openAssignModal;
  window.generateAndSendInvoice = generateAndSendInvoice;
  window.toggleActionsMenu = toggleActionsMenu;
  window.showServiceDetails = showServiceDetails;

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

    const { data, error } = await supabaseConfig.client
      .from('orders')
      .update({
        monto_cobrado: parseFloat(monto),
        metodo_pago: metodo
      })
      .eq('id', selectedOrderIdForPrice)
      .select()
      .single();

    if (error) {
      notifications.error('Error al guardar', error.message);
    } else {
      const orderIndex = allOrders.findIndex(o => o.id == selectedOrderIdForPrice);
      if (orderIndex !== -1) {
        allOrders[orderIndex].monto_cobrado = data.monto_cobrado;
        allOrders[orderIndex].metodo_pago = data.metodo_pago;
      }
      renderOrders();
      notifications.success('Éxito', 'El monto y método de pago han sido actualizados.');
      closePriceModal();
    }
  }

  // Hacer funciones globales
  window.openPriceModal = openPriceModal;
  window.closeAssignModal = closeAssignModal; // Hacerla global para el botón de cierre

  function openWhatsApp(order) {
    const phone = order.phone.replace(/[^0-9]/g, ''); // Limpiar número
    const message = `Hola ${order.name}, te contacto sobre tu orden #${order.short_id || order.id} de ${order.service.name}.`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  // Inicialización
  function init() {
    loadOrders();
  }

  init();
});
