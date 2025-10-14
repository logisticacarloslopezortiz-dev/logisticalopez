// Variables globales
let allOrders = [];
let filteredOrders = [];
let sortColumn = '';
let sortDirection = 'asc';
let selectedOrderIdForAssign = null;

// Configuración de notificaciones
const NOTIFICATION_DURATION = 5000;

// Funciones utilitarias
async function loadOrders() {
  // Usar siempre la clase SupabaseConfig como única fuente de verdad
  allOrders = (await supabaseConfig.getOrders()) || []; // Ensure allOrders is always an array
  filteredOrders = [...allOrders];
  renderOrders();
  updateResumen();
}

// Función para recargar órdenes desde localStorage (útil para actualizaciones en tiempo real)
async function reloadOrdersFromStorage() {
  allOrders = await supabaseConfig.getOrders();
  filteredOrders = [...allOrders];
  updateResumen();
  renderOrders();
}

function saveOrders(orders) {
  localStorage.setItem('tlc_orders', JSON.stringify(orders));
}

function loadCollaborators() {
  return JSON.parse(localStorage.getItem('colaboradores') || '[]');
}

function saveCollaborators(collaborators) {
  localStorage.setItem('colaboradores', JSON.stringify(collaborators));
}

// Sistema de notificaciones
function showNotification(type, title, message, duration = NOTIFICATION_DURATION) {
  // Crear contenedor si no existe
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-3';
    document.body.appendChild(container);
  }
  
  // Crear notificación
  const notification = document.createElement('div');
  notification.className = `max-w-sm w-full bg-white shadow-lg rounded-lg pointer-events-auto ring-1 overflow-hidden transition-all transform translate-y-0 opacity-100 ${type === 'error' ? 'ring-red-500' : type === 'success' ? 'ring-green-500' : 'ring-blue-500'}`;
  
  // Contenido de la notificación
  notification.innerHTML = `
    <div class="p-4">
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <i data-lucide="${type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info'}" 
             class="h-6 w-6 ${type === 'error' ? 'text-red-500' : type === 'success' ? 'text-green-500' : 'text-blue-500'}"></i>
        </div>
        <div class="ml-3 w-0 flex-1 pt-0.5">
          <p class="text-sm font-medium text-gray-900">${title}</p>
          <p class="mt-1 text-sm text-gray-500">${message}</p>
        </div>
        <div class="ml-4 flex-shrink-0 flex">
          <button class="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none">
            <span class="sr-only">Cerrar</span>
            <i data-lucide="x" class="h-5 w-5"></i>
          </button>
        </div>
      </div>
    </div>
  `;
  
  // Agregar al contenedor
  container.appendChild(notification);
  
  // Inicializar iconos
  lucide.createIcons({
    icons: {
      'x': notification.querySelector('[data-lucide="x"]'),
      [type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info']: notification.querySelector(`[data-lucide="${type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info'}"]`)
    }
  });
  
  // Evento para cerrar
  notification.querySelector('button').addEventListener('click', () => {
    notification.classList.replace('translate-y-0', '-translate-y-1');
    notification.classList.replace('opacity-100', 'opacity-0');
    setTimeout(() => notification.remove(), 300);
  });
  
  // Auto-cerrar después de la duración
  setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.replace('translate-y-0', '-translate-y-1');
      notification.classList.replace('opacity-100', 'opacity-0');
      setTimeout(() => notification.remove(), 300);
    }
  }, duration);
}

function showSuccess(title, message, duration) {
  showNotification('success', title, message, duration);
}

function showError(title, message, duration) {
  showNotification('error', title, message, duration);
}

function showInfo(title, message, duration) {
  showNotification('info', title, message, duration);
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
    
    // Por defecto excluir "Completado", a menos que se filtre explícitamente por ese estado
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
function sortTable(column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
  }

  filteredOrders.sort((a, b) => {
    let aVal = a[column];
    let bVal = b[column];

    if (column === 'date') {
      aVal = new Date(`${a.date}T${a.time}`);
      bVal = new Date(`${b.date}T${b.time}`);
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  renderOrders();
}

// Función para cambiar estado de pedido
function changeOrderStatus(orderId, newStatus, collaboratorEmail = null) {
  const orderIndex = allOrders.findIndex(o => o.id === orderId);
  if (orderIndex !== -1) {
    const oldStatus = allOrders[orderIndex].status;
    allOrders[orderIndex].status = newStatus;
    
    // Si cambia a "En proceso" y no tiene colaborador asignado, asignar al colaborador actual
    if (newStatus === 'En proceso' && !allOrders[orderIndex].assignedTo && collaboratorEmail) {
      const collaborators = loadCollaborators();
      const collaborator = collaborators.find(c => c.email === collaboratorEmail);
      if (collaborator) {
        allOrders[orderIndex].assignedTo = collaborator.name;
        allOrders[orderIndex].assignedEmail = collaborator.email;
        allOrders[orderIndex].assignedAt = new Date().toISOString();
        showSuccess('Servicio asignado', `El servicio ha sido asignado a ${collaborator.name} y marcado como "En proceso"`);
      }
    }
    
    // Si cambia a "Completado" o el colaborador marca como "entregado", registrar fecha de finalización
    if ((newStatus === 'Completado' && oldStatus !== 'Completado') || 
        allOrders[orderIndex].lastCollabStatus === 'entregado') {
      allOrders[orderIndex].completedAt = new Date().toISOString();
      allOrders[orderIndex].status = 'Completado';
      
      // Actualizar métricas del colaborador si fue finalizado por él
      if (allOrders[orderIndex].lastCollabStatus === 'entregado' && allOrders[orderIndex].assignedEmail) {
        const collabMetrics = JSON.parse(localStorage.getItem('tlc_collab_metrics') || '{}');
        const email = allOrders[orderIndex].assignedEmail;
        
        if (!collabMetrics[email]) {
          collabMetrics[email] = {
            completedOrders: 0,
            totalTime: 0,
            serviceTypes: {}
          };
        }
        
        collabMetrics[email].completedOrders++;
        
        if (allOrders[orderIndex].assignedAt) {
          const timeElapsed = new Date(allOrders[orderIndex].completedAt) - new Date(allOrders[orderIndex].assignedAt);
          collabMetrics[email].totalTime += timeElapsed;
        }
        
        const serviceType = allOrders[orderIndex].service;
        if (serviceType) {
          collabMetrics[email].serviceTypes[serviceType] = 
            (collabMetrics[email].serviceTypes[serviceType] || 0) + 1;
        }
        
        localStorage.setItem('tlc_collab_metrics', JSON.stringify(collabMetrics));
      }
      
      showSuccess('Servicio completado', 'El servicio ha sido marcado como completado');
    }
    
    saveOrders(allOrders);
    filterOrders();
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
    tr.innerHTML = `
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
        <select onchange="changeOrderStatus('${o.id}', this.value)" class="px-2 py-1 rounded-full text-xs font-semibold ${statusColor} border-0 focus:ring-2 focus:ring-blue-500">
          <option value="Pendiente" ${o.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="En proceso" ${o.status === 'En proceso' ? 'selected' : ''}>En proceso</option>
          <option value="Completado" ${o.status === 'Completado' ? 'selected' : ''}>Completado</option>
        </select>
        ${o.assignedTo ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.assignedTo}</div>` : ''}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
        <span class="editable-price cursor-pointer hover:bg-yellow-100 px-2 py-1 rounded" 
              data-order-id="${o.id}" 
              onclick="editPrice('${o.id}', this)">
          ${o.estimatedPrice || 'Por confirmar'}
        </span>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <div class="flex gap-2">
          <a href="mailto:${o.email}?subject=Solicitud recibida&body=${mensaje}" target="_blank" 
             class="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 transition-colors flex items-center gap-1">
            <i data-lucide="mail" class="w-3 h-3"></i> Email
          </a>
          <a href="https://wa.me/${o.phone}?text=${mensaje}" target="_blank" 
             class="bg-green-500 text-white px-2 py-1 rounded text-xs hover:bg-green-600 transition-colors flex items-center gap-1">
            <i data-lucide="message-circle" class="w-3 h-3"></i> WhatsApp
          </a>
          <button onclick="generateAndSendInvoice('${o.id}')" 
             class="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 transition-colors flex items-center gap-1">
            <i data-lucide="file-text" class="w-3 h-3"></i> Factura
          </button>
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
    if (o.estimatedPrice) {
      const price = parseInt(o.estimatedPrice.replace(/[^0-9]/g, '')) || 0;
      return sum + price;
    }
    return sum + 150000; // Precio base estimado
  }, 0);

  const todayEarnings = todayOrders.reduce((sum, o) => {
    if (o.estimatedPrice) {
      const price = parseInt(o.estimatedPrice.replace(/[^0-9]/g, '')) || 0;
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
  // Gráfico de servicios
  const serviceStats = {};
  allOrders.forEach(o => {
    serviceStats[o.service] = (serviceStats[o.service] || 0) + 1;
  });

  const servicesChart = document.getElementById('servicesChart');
  servicesChart.innerHTML = '';
  const maxService = Math.max(...Object.values(serviceStats));

  Object.entries(serviceStats).forEach(([service, count]) => {
    const percentage = maxService > 0 ? (count / maxService) * 100 : 0;
    servicesChart.innerHTML += `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-700">${service}</span>
        <span class="text-sm text-gray-500">${count}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div class="bg-red-600 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
      </div>
    `;
  });

  // Gráfico de vehículos
  const vehicleStats = {};
  allOrders.forEach(o => {
    vehicleStats[o.vehicle] = (vehicleStats[o.vehicle] || 0) + 1;
  });

  const vehiclesChart = document.getElementById('vehiclesChart');
  vehiclesChart.innerHTML = '';
  const maxVehicle = Math.max(...Object.values(vehicleStats));

  Object.entries(vehicleStats).forEach(([vehicle, count]) => {
    const percentage = maxVehicle > 0 ? (count / maxVehicle) * 100 : 0;
    vehiclesChart.innerHTML += `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-gray-700">${vehicle}</span>
        <span class="text-sm text-gray-500">${count}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
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
function openAssignModal(orderId){
  selectedOrderIdForAssign = orderId;
  const modal = document.getElementById('assignModal');
  const body = document.getElementById('assignModalBody');
  const select = document.getElementById('assignSelect');
  const assignBtn = document.getElementById('assignConfirmBtn');

  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId);
  const colaboradores = JSON.parse(localStorage.getItem('colaboradores') || '[]');

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

function assignSelectedCollaborator(){
  const email = document.getElementById('assignSelect').value;
  if (!email) { 
    showError('Error', 'Selecciona un colaborador'); 
    return; 
  }
  
  const colaboradores = loadCollaborators();
  const col = colaboradores.find(c => c.email === email);
  if (!col) { 
    showError('Error', 'Colaborador no encontrado'); 
    return; 
  }

  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === selectedOrderIdForAssign);
  if (idx === -1) return;
  
  // Asignar colaborador y cambiar estado a "En proceso"
  orders[idx].assignedTo = col.name;
  orders[idx].assignedEmail = col.email;
  orders[idx].assignedAt = new Date().toISOString();
  orders[idx].status = 'En proceso'; // Cambio automático a "En proceso"
  
  saveOrders(orders);
  allOrders = orders;
  filterOrders();
  closeAssignModal();
  
  showSuccess('Asignación exitosa', `El pedido ha sido asignado a ${col.name} y marcado como "En proceso"`);
  
  // Enviar notificación al colaborador (simulado)
  notifyCollaborator(orders[idx], col);
}

function deleteSelectedOrder(){
  if (!confirm('¿Eliminar esta solicitud?')) return;
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === selectedOrderIdForAssign);
  if (idx === -1) return;
  
  const deletedOrder = orders[idx];
  orders.splice(idx, 1);
  saveOrders(orders);
  allOrders = orders;
  filterOrders();
  closeAssignModal();
  
  showInfo('Solicitud eliminada', `La solicitud ${deletedOrder.id} ha sido eliminada`);
}

// Función para generar y enviar factura
function generateAndSendInvoice(orderId) {
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId);
  
  if (!order) {
    showError('Error', 'No se encontró la orden solicitada');
    return;
  }
  
  // Simulación de generación de factura
  console.log('Generando factura para orden:', order.id);
  
  // Crear mensaje para WhatsApp y correo
  const invoiceMessage = encodeURIComponent(
    `Hola ${order.name},\n\nAdjunto encontrarás la factura de tu servicio de ${order.service}.\n\nDetalles del servicio:\n` +
    `- Servicio: ${order.service}\n` +
    `- Vehículo: ${order.vehicle}\n` +
    `- Fecha: ${order.date}\n` +
    `- Hora: ${order.time}\n` +
    `- Ruta: ${order.pickup} → ${order.delivery}\n` +
    `- Precio: ${order.estimatedPrice || 'Por confirmar'}\n\n` +
    `Gracias por confiar en nuestros servicios.\n\nAtentamente,\nEquipo TLC`
  );
  
  // Simular envío por correo
  const emailSubject = encodeURIComponent(`Factura de servicio TLC - ${order.id}`);
  window.open(`mailto:${order.email}?subject=${emailSubject}&body=${invoiceMessage}`, '_blank');
  
  // Simular envío por WhatsApp
  setTimeout(() => {
    window.open(`https://wa.me/${order.phone}?text=${invoiceMessage}`, '_blank');
  }, 1000);
  
  showSuccess('Factura enviada', `La factura de la orden ${order.id} ha sido enviada al cliente por correo electrónico y WhatsApp.`);
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
      order.estimatedPrice || 'Por confirmar'
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
  window.changeOrderStatus = changeOrderStatus;
  window.generateAndSendInvoice = generateAndSendInvoice;


  // Escuchar cambios en localStorage para actualizar automáticamente
  window.addEventListener('storage', function(e) {
    if (e.key === 'tlc_orders') {
      reloadOrdersFromStorage();
    }
  });

  // Verificar periódicamente si hay nuevas órdenes (para cuando se actualiza en la misma pestaña)
  setInterval(() => {
    const currentOrders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
    if (currentOrders.length !== allOrders.length) {
      reloadOrdersFromStorage();
    }
  }, 2000); // Verificar cada 2 segundos

  // Función para actualizar los paneles de resumen
  function updateSummaryPanels() {
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
      const orderIndex = allOrders.findIndex(o => o.id === orderId);
      if (orderIndex !== -1) {
        allOrders[orderIndex].estimatedPrice = newPrice;
        saveOrders(allOrders);
        element.innerHTML = newPrice;
        showSuccess('Precio actualizado', `Precio actualizado a ${newPrice}`);
        updateResumen();
      }
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
    loadOrders().then((orders) => {
      allOrders = orders;
      filteredOrders = [...allOrders];
      renderOrders();
      updateResumen();
      console.log('Sistema inicializado con', allOrders.length, 'pedidos.');
    });
  }

  init();
  setInterval(() => {
    allOrders = loadOrders();
    filterOrders();
  }, 30000);
});