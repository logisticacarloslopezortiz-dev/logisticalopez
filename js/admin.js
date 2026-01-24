// Variables globales para el estado de la tabla
let allOrders = [];
let currentSort = { column: 'date', order: 'desc' };
let currentAssigningOrder = null;

/**
 * Carga las órdenes desde Supabase y las renderiza.
 */
async function loadOrders() {
  const { data, error } = await supabaseConfig.client
    .from('orders')
    // ✅ MEJORA: Cargar los nombres de las tablas relacionadas directamente.
    .select('*, service:services(name), vehicle:vehicles(name), collaborator:collaborators(name)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al cargar las órdenes:', error);
    notifications.show('Error al cargar las órdenes.', 'error');
    return;
  }

  allOrders = data;
  filterAndRender();
  updateSummaryCards();
  loadCollaboratorsForModal();
}

/**
 * Aplica los filtros actuales y renderiza las órdenes.
 */
function filterAndRender() {
  const searchInput = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const serviceFilter = document.getElementById('serviceFilter').value;
  const dateFilter = document.getElementById('dateFilter').value;

  let filtered = allOrders.filter(order => {
    const matchesSearch = !searchInput ||
      order.name.toLowerCase().includes(searchInput) ||
      (order.service?.name || '').toLowerCase().includes(searchInput) || // ✅ CORREGIDO: Buscar por nombre de servicio
      String(order.id).includes(searchInput);

    const matchesStatus = !statusFilter || order.status === statusFilter;
    const matchesService = !serviceFilter || order.service?.name === serviceFilter; // ✅ CORREGIDO: Filtrar por nombre de servicio
    const matchesDate = !dateFilter || order.date === dateFilter;

    return matchesSearch && matchesStatus && matchesService && matchesDate;
  });

  // Aplicar ordenamiento
  sortData(filtered, currentSort.column, currentSort.order);

  renderOrders(filtered);
}

/**
 * Renderiza las órdenes en la tabla del DOM.
 * @param {Array} orders - El array de órdenes a renderizar.
 */
function renderOrders(orders) {
  const tableBody = document.getElementById('ordersTableBody');
  const showingCount = document.getElementById('showingCount');
  const totalCount = document.getElementById('totalCount');

  if (!tableBody) return;

  tableBody.innerHTML = ''; // Limpiar tabla

  if (orders.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-500">No se encontraron pedidos.</td></tr>`;
  } else {
    orders.forEach(order => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${order.id}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
          <div class="font-medium">${order.name}</div>
          <div class="text-xs text-gray-500">${order.phone}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.service?.name || 'N/A'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.vehicle?.name || 'N/A'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 max-w-xs truncate" title="${order.pickup} → ${order.delivery}">
          ${order.pickup} → ${order.delivery}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.date} ${order.time}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(order.status)}">
            ${order.status}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800">${order.estimated_price}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
          <button class="text-blue-600 hover:text-blue-900 manage-btn" data-order-id="${order.id}">Gestionar</button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  showingCount.textContent = orders.length;
  totalCount.textContent = allOrders.length;

  // Añadir listeners a los botones de "Gestionar"
  document.querySelectorAll('.manage-btn').forEach(btn => {
    btn.addEventListener('click', () => openAssignModal(btn.dataset.orderId));
  });
}

/**
 * Actualiza las tarjetas de resumen con estadísticas de las órdenes.
 */
function updateSummaryCards() {
  const today = new Date().toISOString().split('T')[0];
  const totalPedidos = allOrders.length;
  const pedidosHoy = allOrders.filter(o => o.date === today).length;
  const pedidosCompletados = allOrders.filter(o => o.status === 'Completado').length;
  const pedidosPendientes = allOrders.filter(o => o.status === 'Pendiente').length;
  const gananciaTotal = allOrders
    .filter(o => o.status === 'Completado' && o.estimated_price && !isNaN(parseFloat(o.estimated_price.replace(/[^0-9.-]+/g,""))))
    .reduce((sum, o) => sum + parseFloat(o.estimated_price.replace(/[^0-9.-]+/g,"")), 0);

  document.getElementById('totalPedidos').textContent = totalPedidos;
  document.getElementById('pedidosHoy').textContent = pedidosHoy;
  document.getElementById('pedidosCompletados').textContent = pedidosCompletados;
  document.getElementById('porcentajeCompletados').textContent = totalPedidos > 0 ? ((pedidosCompletados / totalPedidos) * 100).toFixed(0) : 0;
  document.getElementById('pedidosPendientes').textContent = pedidosPendientes;
  document.getElementById('gananciaTotal').textContent = `$${gananciaTotal.toLocaleString('es-DO')}`;
  // ... otros resúmenes
}

/**
 * Devuelve la clase de color de Tailwind CSS según el estado de la orden.
 * @param {string} status - El estado de la orden.
 * @returns {string} La clase CSS.
 */
function getStatusClass(status) {
  switch (status) {
    case 'Pendiente': return 'bg-yellow-100 text-yellow-800';
    case 'En proceso': return 'bg-blue-100 text-blue-800';
    case 'Completada': return 'bg-green-100 text-green-800';
    case 'Cancelada': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Ordena un array de datos por una columna y dirección específicas.
 * @param {Array} data - El array a ordenar.
 * @param {string} column - La columna por la que ordenar.
 * @param {string} order - 'asc' o 'desc'.
 */
function sortData(data, column, order) {
  data.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (column === 'date') {
      valA = new Date(`${a.date}T${a.time}`);
      valB = new Date(`${b.date}T${b.time}`);
    }

    // ✅ MEJORA: Asegurar que los IDs se ordenen numéricamente.
    if (column === 'id') {
      valA = Number(valA);
      valB = Number(valB);
    }
    
    if (valA < valB) return order === 'asc' ? -1 : 1;
    if (valA > valB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Maneja el clic en las cabeceras de la tabla para ordenar.
 * @param {string} column - La columna por la que se quiere ordenar.
 */
function sortTable(column) {
  if (currentSort.column === column) {
    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.order = 'asc';
  }
  filterAndRender();
}

/**
 * Carga los colaboradores desde Supabase y los añade al select del modal.
 */
async function loadCollaboratorsForModal() {
  const select = document.getElementById('assignSelect');
  if (!select) {
    // Si el select no está en la página (ej. vista de colaborador), no hacer nada.
    return;
  }
  const { data, error } = await supabaseConfig.client.from('collaborators').select('id, name');
  if (error || !data) {
    console.error('Error al cargar colaboradores:', error);
    return;
  }
  select.innerHTML = '<option value="">Sin asignar</option>';
  data.forEach(col => {
    select.innerHTML += `<option value="${col.id}">${col.name}</option>`;
  });
}

/**
 * Abre el modal para asignar un colaborador a una orden.
 * @param {string} orderId - El ID de la orden a gestionar.
 */
function openAssignModal(orderId) {
  currentAssigningOrder = allOrders.find(o => o.id === Number(orderId));
  if (!currentAssigningOrder) return;

  const modal = document.getElementById('assignModal');
  const modalBody = document.getElementById('assignModalBody');
  const assignSelect = document.getElementById('assignSelect');

  // Limpiar listeners anteriores para evitar duplicados
  document.getElementById('whatsappBtn').onclick = null;
  document.getElementById('generateInvoiceBtn').onclick = null;

  modalBody.innerHTML = `
    <p><strong>ID:</strong> ${currentAssigningOrder.id}</p>
    <p><strong>Cliente:</strong> ${currentAssigningOrder.name}</p>
    <p><strong>Servicio:</strong> ${currentAssigningOrder.service?.name || 'N/A'}</p>
  `;
  assignSelect.value = currentAssigningOrder.assigned_to || '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Asignar nuevos listeners
  document.getElementById('whatsappBtn').onclick = () => sendWhatsAppMessage(currentAssigningOrder);
  document.getElementById('generateInvoiceBtn').onclick = () => generateAndSendInvoice(currentAssigningOrder);
}

/**
 * Cierra el modal de asignación.
 */
function closeAssignModal() {
  const modal = document.getElementById('assignModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  currentAssigningOrder = null;
}

/**
 * Asigna un colaborador a la orden actual y actualiza en Supabase.
 */
async function assignCollaborator() {
  if (!currentAssigningOrder) return;

  const collaboratorId = document.getElementById('assignSelect').value;
  const { error } = await supabaseConfig.client
    .from('orders')
    .update({ 
      assigned_to: collaboratorId || null,
      status: 'Pendiente'
    })
    .eq('id', currentAssigningOrder.id);

  if (error) {
    notifications.show('Error al asignar la orden.', 'error');
    console.error('Error al asignar:', error);
  } else {
    notifications.show('Orden actualizada correctamente.', 'success');
    // Actualizar localmente para no recargar todo
    const order = allOrders.find(o => o.id === currentAssigningOrder.id);
    if (order) {
        order.assigned_to = collaboratorId || null;
        order.status = 'Pendiente';
    }
    filterAndRender();
    updateSummaryCards();
  }
  closeAssignModal();
}

/**
 * Elimina la orden actual de Supabase.
 */
async function deleteOrder() {
  if (!currentAssigningOrder || !confirm(`¿Estás seguro de que quieres eliminar la orden ${currentAssigningOrder.id}?`)) {
    return;
  }

  const { error } = await supabaseConfig.client
    .from('orders')
    .delete()
    .eq('id', currentAssigningOrder.id);

  if (error) {
    notifications.show('Error al eliminar la orden.', 'error');
    console.error('Error al eliminar:', error);
  } else {
    notifications.show('Orden eliminada correctamente.', 'success');
    allOrders = allOrders.filter(o => o.id !== currentAssigningOrder.id);
    filterAndRender();
    updateSummaryCards();
  }
  closeAssignModal();
}

/**
 * Abre WhatsApp con un mensaje predefinido para el cliente.
 * @param {object} order - La orden a la que se le enviará el mensaje.
 */
function sendWhatsAppMessage(order) {
  if (!order || !order.phone) {
    notifications.error('El cliente no tiene un número de teléfono registrado.');
    return;
  }
  // Limpiar el número de teléfono para que solo contenga dígitos
  const phone = order.phone.replace(/\D/g, '');
  const message = encodeURIComponent(`Hola ${order.name}, te contactamos sobre tu solicitud de servicio con ID ${order.id}.`);
  const whatsappUrl = `https://wa.me/${phone}?text=${message}`;
  window.open(whatsappUrl, '_blank');
}

/**
 * Genera una factura en PDF y la envía por correo (simulado).
 * @param {object} order - La orden para la cual se generará la factura.
 */
async function generateAndSendInvoice(order) {
  if (!order) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Aquí iría la lógica para obtener los datos de tu negocio
  const businessName = "Logística López Ortiz";
  const businessAddress = "Azua, República Dominicana";

  // Encabezado de la factura
  doc.setFontSize(20);
  doc.text(businessName, 105, 20, { align: 'center' });
  doc.setFontSize(10);
  doc.text(businessAddress, 105, 28, { align: 'center' });
  doc.setFontSize(16);
  doc.text(`Factura #${order.id}`, 20, 40);
  doc.line(20, 42, 190, 42);

  // Datos del cliente
  doc.setFontSize(12);
  doc.text(`Cliente: ${order.name}`, 20, 50);
  doc.text(`Teléfono: ${order.phone}`, 20, 57);
  doc.text(`Email: ${order.email}`, 20, 64);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, 140, 50);

  // Cuerpo de la factura (usando autoTable)
  doc.autoTable({
    startY: 75,
    head: [['Descripción', 'Precio']],
    body: [
      [`Servicio de ${order.service} (${order.vehicle})`, `${order.estimated_price}`],
      [`Ruta: ${order.pickup} -> ${order.delivery}`, ''],
    ],
    theme: 'striped'
  });

  // Total
  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(14);
  doc.text(`Total: ${order.estimated_price}`, 190, finalY, { align: 'right' });

  // Simulación de envío por correo
  notifications.info('Generando factura... En un sistema real, esto se enviaría por correo.');

  // Abrir el PDF en una nueva pestaña para visualización
  doc.output('dataurlnewwindow');

  try {
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    const payload = { orderId: order.short_id || order.id, email: order.email };
    const { data, error } = await supabaseConfig.client.functions.invoke('send-invoice', { body: payload });
    if (error) {
      notifications.error('Error enviando factura por correo');
    } else {
      notifications.info('Factura enviada por correo');
    }
    console.log('[Admin] send-invoice result:', data || error);
  } catch (e) {
    console.error('[Admin] Error invocando send-invoice', e);
    notifications.error('No se pudo invocar el envío de factura');
  }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
  // --- INICIO: Verificación de Sesión Obligatoria ---
  const { data: { session } } = await supabaseConfig.client.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return; // Detener la ejecución si no hay sesión
  }
  // --- FIN: Verificación de Sesión Obligatoria ---
  
  // Esperar confirmación del rol admin por servidor
  document.addEventListener('admin-session-ready', () => {
    loadOrders();
    // Inicializar Lucide Icons tras carga
    try { lucide.createIcons(); } catch(_) {}
  });
    
    // Listeners para filtros
    document.getElementById('searchInput')?.addEventListener('input', filterAndRender);
    document.getElementById('statusFilter')?.addEventListener('change', filterAndRender);
    document.getElementById('serviceFilter')?.addEventListener('change', filterAndRender);
    document.getElementById('dateFilter')?.addEventListener('change', filterAndRender);
    document.getElementById('clearFilters')?.addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('serviceFilter').value = '';
        document.getElementById('dateFilter').value = '';
        filterAndRender();
    });

    // Listeners para el modal
    document.getElementById('assignCancelBtn')?.addEventListener('click', closeAssignModal);
    document.getElementById('assignConfirmBtn')?.addEventListener('click', assignCollaborator);
    document.getElementById('deleteOrderBtn')?.addEventListener('click', deleteOrder);
    // Los listeners de whatsapp y factura se asignan dinámicamente en openAssignModal


    // Lucide se inicializa después de admin-session-ready
});
