// Variables globales
let allOrders = [];
let filteredOrders = [];
let sortColumn = '';
let sortDirection = 'asc';
let selectedOrderIdForAssign = null;

// Funciones utilitarias

// Carga inicial de órdenes
async function loadOrders() {
  const { data, error } = await supabaseConfig.client.from('orders').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error("Error al cargar las órdenes:", error);
    return;
  }
  allOrders = data || [];
  filterOrders(); // Llama a filterOrders para aplicar filtros iniciales y renderizar
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

// Guardar colaboradores (si fuera necesario, aunque ahora se gestiona en su propia página)
async function saveCollaborators(collaborators) {
  // Esta función ahora podría usarse para hacer un upsert masivo si se necesitara.
  const { data, error } = await supabaseConfig.client.from('collaborators').upsert(collaborators);
  if (error) console.error("Error al guardar colaboradores:", error);
  return !error;
}

// Función para filtrar pedidos
function filterOrders() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const serviceFilter = document.getElementById('serviceFilter').value;
  const dateFilter = document.getElementById('dateFilter').value;

  filteredOrders = (allOrders || []).filter(order => {
    const matchesSearch = !searchTerm || 
      order.name.toLowerCase().includes(searchTerm) ||
      order.phone.includes(searchTerm) ||
      order.email.toLowerCase().includes(searchTerm);
    
    // Por defecto, no mostrar "Completado" a menos que se filtre explícitamente por ese estado
    const matchesStatus = statusFilter
      ? order.status === statusFilter
      : order.status !== 'Completado';

    const matchesService = !serviceFilter || order.service === serviceFilter;
    const matchesDate = !dateFilter || order.date === dateFilter;

    return matchesSearch && matchesStatus && matchesService && matchesDate;
  });

  renderOrders();
}

// Función para ordenar tabla
function sortTable(column, element) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
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
  document.querySelectorAll('th i[data-lucide="chevron-up-down"], th i[data-lucide="chevron-up"], th i[data-lucide="chevron-down"]').forEach(icon => {
    icon.setAttribute('data-lucide', 'chevron-up-down');
  });
  const icon = element.querySelector('i');
  icon.setAttribute('data-lucide', sortDirection === 'asc' ? 'chevron-up' : 'chevron-down');
  lucide.createIcons();
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
  if (typeof updateSummaryPanels === 'function') {
    updateSummaryPanels();
  } else {
    // Fallback si la función no está definida
    updateResumen();
  }

  if(filteredOrders.length === 0){
    ordersTableBody.innerHTML='<tr><td colspan="9" class="text-center py-6 text-gray-500">No hay pedidos que coincidan con los filtros.</td></tr>';
    return;
  }

  filteredOrders.forEach(o=>{
    const mensaje = encodeURIComponent(
      `Hola ${o.name},\n\nHemos recibido tu solicitud de ${o.service}. Nos contactaremos pronto para afinar detalles.\n\n¡Gracias!`
    );

    const statusColor = {
      'Pendiente': 'bg-yellow-100 text-yellow-800',
      'En proceso': 'bg-blue-100 text-blue-800', // Corregido
      'Completado': 'bg-green-100 text-green-800'
    }[o.status] || 'bg-gray-100 text-gray-800';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = /*html*/`
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${o.id || 'N/A'}</td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm font-medium text-gray-900">${o.name}</div>
        <div class="text-sm text-gray-500">${o.phone}</div>
        ${o.email ? `<div class="text-sm text-gray-500 truncate" title="${o.email}">${o.email}</div>` : ''}
        ${o.rnc ? `<div class="mt-1 text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full inline-block">RNC: ${o.rnc} (${o.empresa || 'N/A'})</div>` : ''}
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm text-gray-900">${o.service}</div>
        ${o.serviceQuestions && Object.keys(o.serviceQuestions).length > 0 ?
          `<button onclick="showServiceDetails('${o.id}')" class="mt-1 text-xs text-blue-600 hover:text-blue-800 underline">
            <i data-lucide="info" class="w-3 h-3 inline-block mr-1"></i>Ver detalles
          </button>`
          : ''
        }
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${o.vehicle}</td>
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
        </select>
        ${o.assignedTo ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.assignedTo}</div>` : ''}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
        <span class="editable-price cursor-pointer hover:bg-yellow-100 px-2 py-1 rounded" 
              data-order-id="${o.id}" 
              onclick="editPrice('${o.id}', this)">
          ${o.estimated_price || 'Por confirmar'}
        </span>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <div class="relative inline-block text-left">
          <div>
            <button type="button" class="inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-3 py-1 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 focus:ring-indigo-500" onclick="toggleActionsMenu(this)">
              Acciones
              <i data-lucide="chevron-down" class="ml-2 -mr-1 h-5 w-5"></i>
            </button>
          </div>
          <div class="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden z-10">
            <div class="py-1" role="menu" aria-orientation="vertical">
              <a href="https://wa.me/${o.phone}?text=${mensaje}" target="_blank" class="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">
                <i data-lucide="message-circle" class="w-4 h-4 text-green-500"></i> WhatsApp
              </a>
              <a href="mailto:${o.email}?subject=Solicitud recibida&body=${mensaje}" target="_blank" class="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">
                <i data-lucide="mail" class="w-4 h-4 text-blue-500"></i> Email
              </a>
              <a href="#" onclick="generateAndSendInvoice('${o.id}')" class="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">
                <i data-lucide="file-text" class="w-4 h-4 text-gray-500"></i> Generar Factura
              </a>
            </div>
          </div>
        </div>
      </td>
    `;
    tr.addEventListener('dblclick', () => openAssignModal(o.id));
    ordersTableBody.appendChild(tr);
  });

  lucide.createIcons();
  // Solo llamar a estas funciones si existen los elementos necesarios
  try {
    if (typeof updateResumen === 'function') updateResumen();
    if (typeof updateCharts === 'function') updateCharts();
    if (typeof checkAlertas === 'function') checkAlertas();
  } catch (error) {
    console.warn('Error al actualizar gráficos o alertas:', error.message);
  }
}

// Función para mostrar/ocultar el menú de acciones
function toggleActionsMenu(button) {
  const dropdown = button.nextElementSibling;
  if (!dropdown) return; // Evita el error si el elemento no existe
  dropdown.classList.toggle('hidden');
  // Cerrar otros menús abiertos
  document.querySelectorAll('.origin-top-right').forEach(menu => {
    if (menu !== dropdown && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
    }
  });
}
// Cerrar menús si se hace clic fuera
window.addEventListener('click', (e) => { 
  if (!e.target.closest('.relative.inline-block')) {
    document.querySelectorAll('.origin-top-right').forEach(menu => menu.classList.add('hidden'));
  }
});

// Función para actualizar el estado de una orden en Supabase
async function updateOrderStatus(orderId, newStatus) {
  const { data, error } = await supabaseConfig.client
    .from('orders')
    .update({ status: newStatus })
    .eq('id', orderId);

  if (error) {
    console.error('Error al actualizar el estado:', error);
    alert('No se pudo actualizar el estado de la orden.');
    // Revertir el cambio en la UI si falla
    loadOrders();
  } else {
    // Actualizar el estado en el array local para no tener que recargar toda la data
    const orderIndex = allOrders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) allOrders[orderIndex].status = newStatus;
    filterOrders(); // Re-renderizar con el nuevo estado
    showSuccess('Estado actualizado', `El estado del pedido ${orderId} es ahora ${newStatus}`);
  }}

// Función para mostrar detalles del servicio
function showServiceDetails(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !order.serviceQuestions || Object.keys(order.serviceQuestions).length === 0) {
    showError('Sin detalles', 'Esta orden no tiene detalles adicionales de servicio.');
    return;
  }

  let detailsHtml = `<h3 class="text-lg font-semibold mb-4 text-gray-800">Detalles del Servicio: ${order.service}</h3>`;
  detailsHtml += '<div class="space-y-3 text-sm">';

  for (const [question, answer] of Object.entries(order.serviceQuestions)) {
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
  const completedOrders = allOrders.filter(o => o.status === 'Completado');
  const pendingOrders = allOrders.filter(o => o.status !== 'Completado');
  const urgentOrders = pendingOrders.filter(o => {
    const serviceTime = new Date(`${o.date}T${o.time}`);
    const now = new Date();
    const diffHours = (serviceTime - now) / (1000 * 60 * 60);
    return diffHours > 0 && diffHours <= 24;
  });

  // Calcular ganancias
  const totalEarnings = allOrders.reduce((sum, o) => {
    if (o.estimated_price) {
      const price = parseInt(o.estimated_price.replace(/[^0-9]/g, '')) || 0;
      return sum + price;
    }
    return sum + 150000; // Precio base estimado
  }, 0);

  const todayEarnings = todayOrders.reduce((sum, o) => {
    if (o.estimated_price) {
      const price = parseInt(o.estimated_price.replace(/[^0-9]/g, '')) || 0;
      return sum + price;
    }
    return sum + 150000;
  }, 0);

  document.getElementById('totalPedidos').textContent = allOrders.length;
  document.getElementById('pedidosHoy').textContent = todayOrders.length;
  document.getElementById('pedidosCompletados').textContent = completedOrders.length;
  document.getElementById('porcentajeCompletados').textContent = allOrders.length > 0 ? Math.round((completedOrders.length / allOrders.length) * 100) : 0;
  document.getElementById('pedidosPendientes').textContent = pendingOrders.length;
  document.getElementById('urgentes').textContent = urgentOrders.length;
  document.getElementById('gananciaTotal').textContent = `$${totalEarnings.toLocaleString('es-CO')}`;
  document.getElementById('gananciaHoy').textContent = todayEarnings.toLocaleString('es-CO');
}

// Función para actualizar gráficos
function updateCharts() {
  const servicesChartEl = document.getElementById('servicesChart');
  const vehiclesChartEl = document.getElementById('vehiclesChart');
  if (!servicesChartEl || !vehiclesChartEl) return; // No hacer nada si los gráficos no están en la página
  // Gráfico de servicios
  const serviceStats = {};
  allOrders.forEach(o => {
    serviceStats[o.service] = (serviceStats[o.service] || 0) + 1;
  });

  servicesChartEl.innerHTML = '';
  const maxService = Math.max(...Object.values(serviceStats));

  Object.entries(serviceStats).forEach(([service, count]) => {
    const percentage = maxService > 0 ? (count / maxService) * 100 : 0;
    servicesChart.innerHTML += `
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
    vehicleStats[o.vehicle] = (vehicleStats[o.vehicle] || 0) + 1;
  });

  vehiclesChartEl.innerHTML = '';
  const maxVehicle = Math.max(...Object.values(vehicleStats));

  Object.entries(vehicleStats).forEach(([vehicle, count]) => {
    const percentage = maxVehicle > 0 ? (count / maxVehicle) * 100 : 0;
    vehiclesChart.innerHTML += `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-700">${vehicle}</span>
        <span class="text-sm text-gray-500">${count}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div class="bg-red-600 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
      </div>
    `;
  });
}

// Función para verificar alertas
function checkAlertas(){
  const alertas = document.getElementById('alertasLista');
  if (!alertas) return;
  
  alertas.innerHTML = '';
  const now = new Date();
  const proximos = allOrders.filter(o=>{
    const serviceTime = new Date(`${o.date}T${o.time}`);
    const diffMin = (serviceTime-now)/60000;
    return diffMin>0 && diffMin<=60;
  });

  if(proximos.length===0){
    alertas.innerHTML='<li class="text-gray-500">No hay alertas por ahora.</li>';
    return;
  }

  proximos.forEach(o=>{
    const li=document.createElement('li');
    li.innerHTML=`<strong>${o.service}</strong> para <strong>${o.name}</strong> comienza a las <strong>${o.time}</strong>`;
    alertas.appendChild(li);
  });
}

// Gestión de asignación y eliminación de pedidos desde modal
async function openAssignModal(orderId){
  selectedOrderIdForAssign = orderId;
  const modal = document.getElementById('assignModal');
  const body = document.getElementById('assignModalBody');
  const select = document.getElementById('assignSelect');
  const assignBtn = document.getElementById('assignConfirmBtn');

  const order = allOrders.find(o => o.id === orderId);
  const colaboradores = await loadCollaborators();

  body.innerHTML = `
    <div class="space-y-1 text-sm text-gray-700">
      <div><span class="font-semibold">ID:</span> ${order.id}</div>
      <div><span class="font-semibold">Cliente:</span> ${order.name} (${order.phone})</div>
      <div><span class="font-semibold">Servicio:</span> ${order.service} — ${order.vehicle}</div>
      <div><span class="font-semibold">Ruta:</span> ${order.pickup} → ${order.delivery}</div>
      <div><span class="font-semibold">Fecha/Hora:</span> ${order.date} ${order.time}</div>
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
      opt.value = c.email;
      opt.textContent = `${c.name} — ${c.role}`;
      select.appendChild(opt);
    });
    select.disabled = false;
    assignBtn.disabled = false;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  lucide.createIcons();
}

function closeAssignModal(){
  const modal = document.getElementById('assignModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  selectedOrderIdForAssign = null;
}

async function assignSelectedCollaborator(){
  const email = document.getElementById('assignSelect').value;
  if (!email) { 
    showError('Error', 'Selecciona un colaborador'); 
    return; 
  }
  
  const colaboradores = await loadCollaborators();
  const col = colaboradores.find(c => c.email === email);
  if (!col) { 
    showError('Error', 'Colaborador no encontrado'); 
    return; 
  }

  const updateData = {
    assigned_to: col.name,
    assigned_email: col.email,
    assigned_at: new Date().toISOString(),
    status: 'En proceso' // Cambio automático a "En proceso"
  };

  const { data, error } = await supabaseConfig.client
    .from('orders')
    .update(updateData)
    .eq('id', selectedOrderIdForAssign);

  if (error) {
    showError('Error de asignación', error.message);
  } else {
    // Actualizar el array local para reflejar el cambio inmediatamente
    const orderIndex = allOrders.findIndex(o => o.id === selectedOrderIdForAssign);
    if (orderIndex !== -1) {
      allOrders[orderIndex] = { ...allOrders[orderIndex], ...updateData };
    }
    filterOrders();
    showSuccess('Asignación exitosa', `El pedido ha sido asignado a ${col.name} y marcado como "En proceso"`);
  }
  
  closeAssignModal();
}

async function deleteSelectedOrder(){
  if (!confirm('¿Eliminar esta solicitud?')) return;
  
  const { error } = await supabaseConfig.client.from('orders').delete().eq('id', selectedOrderIdForAssign);
  
  if (error) {
    showError('Error al eliminar', error.message);
  } else {
    allOrders = allOrders.filter(o => o.id !== selectedOrderIdForAssign);
    filterOrders();
    showSuccess('Solicitud eliminada', `La solicitud ${selectedOrderIdForAssign} ha sido eliminada.`);
  }
  closeAssignModal();
}

// Función para generar y enviar factura
async function generateAndSendInvoice(orderId) {
  showNotification('Generando Factura...', 'Por favor, espera un momento.', 'info');

  const order = allOrders.find(o => o.id === orderId);
  if (!order) {
    showError('Error', 'Orden no encontrada.');
    return;
  }

  if (!order.estimated_price || order.estimated_price === 'Por confirmar') {
    showError('Acción requerida', 'Debes establecer un precio antes de generar la factura.');
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
        ['Servicio', order.service],
        ['Vehículo', order.vehicle],
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

    // --- Envío por Correo ---
    const pdfBase64 = doc.output('datauristring').split(',')[1];

    showNotification('Enviando Correo...', 'La factura se está enviando al cliente.', 'info');

    const { error: functionError } = await supabaseConfig.client.functions.invoke('send-invoice', {
      body: {
        to: order.email,
        subject: `Factura de tu servicio TLC: Orden #${order.id}`,
        html: `¡Hola ${order.name}! <br><br>Adjuntamos la factura de tu servicio. ¡Gracias por confiar en nosotros!<br><br>Equipo de Logística López Ortiz`,
        pdfData: pdfBase64,
        fileName: `Factura-${order.id}.pdf`
      }
    });

    if (functionError) throw functionError;

    showSuccess('Factura Enviada', `La factura para la orden #${order.id} ha sido enviada por correo.`);

  } catch (error) {
    console.error('Error al generar o enviar la factura:', error);
    showError('Error de Factura', 'No se pudo generar o enviar el PDF. Revisa la consola.');
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
      `"${order.name}"`,
      order.phone,
      order.email,
      `"${order.service}"`,
      `"${order.vehicle}"`,
      `"${order.pickup}"`,
      `"${order.delivery}"`,
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
      // Mostrar una notificación
      showNotification('Nueva Solicitud Recibida', `Cliente: ${newRecord.name}\nServicio: ${newRecord.service}`, 'info');
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

function showNotification(title, body, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const typeConfig = {
    success: { icon: 'check-circle', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
    error: { icon: 'x-circle', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    warning: { icon: 'alert-triangle', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    info: { icon: 'bell-ring', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
  };

  const config = typeConfig[type] || typeConfig.info;

  const toastId = `toast-${Date.now()}`;
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = `toast-in border rounded-lg shadow-lg p-4 flex items-start gap-3 ${config.bg} ${config.border}`;

  toast.innerHTML = `
    <div>
      <i data-lucide="${config.icon}" class="w-6 h-6 ${config.color}"></i>
    </div>
    <div class="flex-1">
      <p class="font-semibold text-gray-800">${title}</p>
      <p class="text-sm text-gray-600 whitespace-pre-wrap">${body}</p>
    </div>
    <div>
      <button onclick="this.closest('.toast-in').classList.add('toast-out')" class="text-gray-400 hover:text-gray-600">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  container.appendChild(toast);
  lucide.createIcons(); // Renderizar el nuevo ícono

  // Auto-dismiss after 7 seconds
  setTimeout(() => {
    const activeToast = document.getElementById(toastId);
    if (activeToast && !activeToast.classList.contains('toast-out')) {
      activeToast.classList.add('toast-out');
    }
  }, 7000);

  // Eliminar el elemento del DOM después de la animación de salida
  toast.addEventListener('animationend', (e) => {
    if (e.animationName.includes('toast-out')) {
      toast.remove();
    }
  });
}

const showSuccess = (title, body) => showNotification(title, body, 'success');
const showError = (title, body) => showNotification(title, body, 'error');
const showWarning = (title, body) => showNotification(title, body, 'warning');
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

  // Suscribirse a los cambios en tiempo real de la tabla 'orders'
  const ordersSubscription = supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
    .subscribe();

  // Función para actualizar los paneles de resumen
  function updateSummaryPanels() {
    if (!allOrders) return;

    // Actualizar contadores en los paneles de resumen
    const totalPedidos = document.getElementById('totalPedidos');
    const pedidosCompletados = document.getElementById('pedidosCompletados');
    const pedidosPendientes = document.getElementById('pedidosPendientes');
    const pedidosHoy = document.getElementById('pedidosHoy');
    const porcentajeCompletados = document.getElementById('porcentajeCompletados');
    const urgentes = document.getElementById('urgentes');
    
    if (totalPedidos) totalPedidos.textContent = allOrders.length;
    
    // Contar pedidos completados
    const completados = allOrders.filter(o => o.status === 'Completado').length;
    if (pedidosCompletados) pedidosCompletados.textContent = completados;
    
    // Calcular porcentaje de completados
    const porcentaje = allOrders.length > 0 ? Math.round((completados / allOrders.length) * 100) : 0;
    if (porcentajeCompletados) porcentajeCompletados.textContent = porcentaje;
    
    // Contar pedidos pendientes
    const pendientes = allOrders.filter(o => o.status !== 'Completado').length;
    if (pedidosPendientes) pedidosPendientes.textContent = pendientes;
    
    // Contar pedidos de hoy
    const hoy = new Date().toISOString().split('T')[0];
    const pedidosDeHoy = allOrders.filter(o => o.date === hoy).length;
    if (pedidosHoy) pedidosHoy.textContent = pedidosDeHoy;
    
    // Contar urgentes (pedidos para hoy o mañana que no están completados)
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().split('T')[0];
    
    const urgentesCount = allOrders.filter(o => 
      (o.date === hoy || o.date === mananaStr) && o.status !== 'Completado'
    ).length;
    
    if (urgentes) urgentes.textContent = urgentesCount;
  }
  
  // Función para editar precio
  function editPrice(orderId, element) {
    const currentPrice = element.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentPrice === 'Por confirmar' ? '' : currentPrice;
    input.className = 'w-full px-2 py-1 border rounded text-sm';
    input.placeholder = 'Ej: $150,000';
    
    element.innerHTML = '';
    element.appendChild(input);
    input.focus();
    
    function savePrice() {
        const newPrice = input.value.trim() || 'Por confirmar';
        
        supabaseConfig.client
          .from('orders')
          .update({ estimated_price: newPrice })
          .eq('id', orderId)
          .then(({ error }) => {
            if (error) {
              showError('Error al guardar', error.message);
              element.innerHTML = currentPrice; // Revertir
            } else {
              element.innerHTML = newPrice;
              showSuccess('Precio actualizado', `Precio actualizado a ${newPrice}`);
              const orderIndex = allOrders.findIndex(o => o.id === orderId);
              if (orderIndex !== -1) allOrders[orderIndex].estimated_price = newPrice;
              updateResumen();
            }
          });
    }
    
    input.addEventListener('blur', savePrice);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        savePrice();
      }
    });
  }
  
  // Función para generar y enviar factura
  function generateAndSendInvoice(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) {
      showError('Error', 'Pedido no encontrado');
      return;
    }
    
    const price = order.estimatedPrice || 'Por confirmar';
    if (price === 'Por confirmar') {
      showError('Error', 'Debe establecer un precio antes de generar la factura');
      return;
    }
    
    // Generar contenido de la factura
    const invoiceDate = new Date().toLocaleDateString('es-CO');
    const invoiceNumber = `TLC-${order.id}-${Date.now().toString().slice(-6)}`;
    
    const invoiceContent = `
=== FACTURA DE SERVICIO ===
Transporte Logístico Carlos López

Factura N°: ${invoiceNumber}
Fecha: ${invoiceDate}

--- DATOS DEL CLIENTE ---
Nombre: ${order.name}
Teléfono: ${order.phone}
Email: ${order.email}

--- DETALLES DEL SERVICIO ---
Servicio: ${order.service}
Vehículo: ${order.vehicle}
Ruta: ${order.pickup} → ${order.delivery}
Fecha programada: ${order.date}
Hora: ${order.time}
Estado: ${order.status}

--- FACTURACIÓN ---
Monto total: ${price}

--- INFORMACIÓN DE PAGO ---
Formas de pago aceptadas:
• Efectivo
• Transferencia bancaria
• Nequi/Daviplata

Gracias por confiar en nuestros servicios.

--- CONTACTO ---
TLC - Transporte Logístico Carlos López
Teléfono: +57 300 123 4567
Email: info@tlc-transporte.com
    `;
    
    // Crear enlace de Gmail con la factura
    const subject = encodeURIComponent(`Factura de Servicio - ${order.service} - ${invoiceNumber}`);
    const body = encodeURIComponent(invoiceContent);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${order.email}&su=${subject}&body=${body}`;
    
    // Abrir Gmail en nueva ventana
    window.open(gmailUrl, '_blank');
    
    // Mostrar notificación de éxito
    showSuccess('Factura generada', `Factura ${invoiceNumber} lista para enviar por Gmail`);
    
    // Actualizar el estado del pedido si está pendiente
    if (order.status === 'Pendiente') {
      const orderIndex = allOrders.findIndex(o => o.id === orderId);
      if (orderIndex !== -1) {
        allOrders[orderIndex].status = 'En proceso';
        saveOrders(allOrders);
        renderOrders();
      }
    }
  }
  
  // Hacer las funciones globales
  window.editPrice = editPrice;
  window.generateAndSendInvoice = generateAndSendInvoice;
  window.showServiceDetails = showServiceDetails;

  // Inicialización
  function init() {
    loadOrders();
  }

  init();
});