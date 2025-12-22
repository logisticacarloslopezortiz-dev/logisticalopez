(() => {
'use strict';
// Variables globales
let allOrders = [];
let filteredOrders = [];
let sortColumn = 'date';
let sortDirection = 'desc';
let selectedOrderIdForAssign = null; // Guardará el ID del pedido a asignar
let __initialized = false;
let selectedOrderIdForPrice = null;
let __lucideTimer = null;

// --- GESTIÓN DE ESTADO CENTRALIZADO ---
const AppState = {
  update(order) {
    const id = order.id;
    const idxAll = allOrders.findIndex(o => o.id === id);
    if (idxAll !== -1) {
      allOrders[idxAll] = { ...allOrders[idxAll], ...order };
    } else {
      allOrders.unshift(order);
    }
    
    const updatedOrder = idxAll !== -1 ? allOrders[idxAll] : order;
    const idxVis = filteredOrders.findIndex(o => o.id === id);
    const visible = isVisibleStatus(updatedOrder.status);

    if (idxVis !== -1) {
      if (visible) {
        filteredOrders[idxVis] = updatedOrder;
        updateRow(updatedOrder);
      } else {
        filteredOrders.splice(idxVis, 1);
        removeRowDom(id);
      }
    } else {
      if (visible) {
        const insertIdx = findInsertIndex(filteredOrders, updatedOrder);
        filteredOrders.splice(insertIdx, 0, updatedOrder);
        insertRowDom(updatedOrder, insertIdx);
      }
    }
    updateDashboardPanels();
  },
  
  delete(id) {
    allOrders = allOrders.filter(o => o.id !== id);
    const idxVis = filteredOrders.findIndex(o => o.id === id);
    if (idxVis !== -1) {
      filteredOrders.splice(idxVis, 1);
      removeRowDom(id);
    }
    updateDashboardPanels();
  }
};

function getOrderDate(o) {
  if (!o || !o.date) return null;
  try { return new Date(`${o.date}T${o.time || '00:00'}`); } catch(_) { return null; }
}

function isVisibleStatus(status) {
  return !['Completada', 'Cancelada'].includes(status);
}

function normalizePhoneDR(phone) {
  let p = String(phone || '').replace(/[^0-9]/g, '');
  if (p.length === 10 && !p.startsWith('1')) p = '1' + p;
  if (p.length === 7) p = '1809' + p;
  if (!/^1\d{10}$/.test(p)) return null;
  return p;
}

// --- INICIO: Carga y Filtrado de Datos ---

// Carga inicial de órdenes
async function loadOrders() {
  try {
    const orders = await supabaseConfig.getOrders();
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
    try { if (supabaseConfig.ensureFreshSession) await supabaseConfig.ensureFreshSession(); } catch(_) {}
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    if (!session) return;
    const user = session.user;
    const adminNameElement = document.getElementById('adminName');
    const adminAvatarElement = document.getElementById('adminAvatar');
    let adminName = '';
    try {
      const { data: collab } = await supabaseConfig.client
        .from('collaborators')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      if (collab && collab.name) adminName = String(collab.name).trim();
    } catch(_) {}
    if (!adminName) {
      if (user.user_metadata?.full_name) {
        adminName = String(user.user_metadata.full_name).trim();
      } else if (user.email) {
        adminName = String(user.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      } else {
        adminName = '';
      }
    }
    if (adminNameElement) {
      adminNameElement.textContent = adminName || 'Usuario no encontrado';
    }
    if (adminAvatarElement) {
      const initials = (adminName || '').split(' ').map(word => word.charAt(0).toUpperCase()).join('').substring(0, 2) || '?';
      adminAvatarElement.textContent = initials;
      const colors = ['bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-red-600', 'bg-yellow-600', 'bg-indigo-600'];
      const colorIndex = adminName.length % colors.length;
      adminAvatarElement.className = adminAvatarElement.className.replace(/bg-\w+-\d+/, colors[colorIndex]);
    }
  } catch (error) {
    console.error('Error al cargar información del administrador:', error);
  }
}

// Función para filtrar pedidos
function filterOrders() {
  // YA NO HAY FILTROS EN LA UI. Se aplica el filtro por defecto de no mostrar completados/cancelados.
  filteredOrders = (allOrders || []).filter(order => isVisibleStatus(order.status));

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
      aVal = getOrderDate(a) || new Date(0);
      bVal = getOrderDate(b) || new Date(0);
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
    refreshLucide();
  }
}

function refreshLucide(){
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      if (__lucideTimer) { clearTimeout(__lucideTimer); }
      __lucideTimer = setTimeout(() => {
        const hasIcons = document.querySelector('[data-lucide]') !== null;
        if (hasIcons) window.lucide.createIcons();
      }, 100);
    }
  } catch(_) {}
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
  updateAlerts();

  if(filteredOrders.length === 0){
    ordersTableBody.innerHTML='<tr><td colspan="9" class="text-center py-6 text-gray-500">No hay pedidos que coincidan con los filtros.</td></tr>';
    // Render vacío en tarjetas móviles
    const cardContainer = document.getElementById('ordersCardContainer');
    if (cardContainer) {
      cardContainer.innerHTML = '<div class="text-center py-6 text-gray-500"><i data-lucide="package" class="w-6 h-6 text-gray-400"></i> No hay pedidos</div>';
    }
    return;
  }

  filteredOrders.forEach(o => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.setAttribute('data-order-id', String(o.id));
    tr.innerHTML = renderRowHtml(o);
    tr.addEventListener('dblclick', () => openAssignModal(o.id));
    ordersTableBody.appendChild(tr);
  });

  // Render tarjetas en móvil
  const cardContainer = document.getElementById('ordersCardContainer');
  if (cardContainer) {
    cardContainer.innerHTML = '';
    filteredOrders.forEach(o => {
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow p-4';
      card.setAttribute('data-order-id', String(o.id));
      card.innerHTML = renderCardHtml(o);
      cardContainer.appendChild(card);
    });
  }
  refreshLucide();
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
    
    AppState.update({ id: Number(orderId), status: newStatus });
    refreshLucide();

    if (newStatus === 'Completada') {
      try { window.location.href = 'historial-solicitudes.html'; } catch (_) {}
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
  const pendingOrders = allOrders.filter(o => isVisibleStatus(o.status));
  const urgentOrders = pendingOrders.filter(o => {
    const serviceTime = getOrderDate(o) || new Date(8640000000000000);
    const now = new Date();
    const diffHours = (serviceTime - now) / (1000 * 60 * 60);
    return diffHours > 0 && diffHours <= 24;
  });

  const totalEl = document.getElementById('totalPedidos'); if (totalEl) totalEl.textContent = allOrders.length;
  const hoyEl = document.getElementById('pedidosHoy'); if (hoyEl) hoyEl.textContent = todayOrders.length;
  const compEl = document.getElementById('pedidosCompletados'); if (compEl) compEl.textContent = completedOrders;
  const pctEl = document.getElementById('porcentajeCompletados'); if (pctEl) pctEl.textContent = allOrders.length > 0 ? Math.round((completedOrders / allOrders.length) * 100) : 0;
  const pendEl = document.getElementById('pedidosPendientes'); if (pendEl) pendEl.textContent = pendingOrders.length;
  const urgEl = document.getElementById('urgentes'); if (urgEl) urgEl.textContent = urgentOrders.length;
}

// Función para actualizar gráficos
function updateDashboardPanels(){
  const showingCount = document.getElementById('showingCount');
  const totalCount = document.getElementById('totalCount');
  if (showingCount) showingCount.textContent = filteredOrders.length;
  if (totalCount) totalCount.textContent = allOrders.length;
  updateResumen();
  updateAlerts();
}

function updateAlerts() {
  const alertasEl = document.getElementById('alertasLista');
  if (!alertasEl) return;
  alertasEl.innerHTML = '';
  const now = new Date();
  const proximos = allOrders.filter(o => {
    const serviceTime = getOrderDate(o) || new Date(8640000000000000);
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
// Gestión de asignación y eliminación de pedidos desde modal
async function openAssignModal(orderId){
  selectedOrderIdForAssign = Number(orderId);
  const modal = document.getElementById('assignModal');
  const modalTitle = document.getElementById('assignModalTitle');
  const body = document.getElementById('assignModalBody');
  const select = document.getElementById('assignSelect');
  const assignBtn = document.getElementById('assignConfirmBtn');

  if (!modal || !modalTitle || !body || !select || !assignBtn) {
    console.error('Elementos del modal de asignación no encontrados en el DOM');
    if (window.notifications) notifications.error('Error de interfaz', 'No se pudo abrir el modal de asignación.');
    return;
  }

  const order = allOrders.find(o => o.id === selectedOrderIdForAssign);
  if (!order) { if (window.notifications) notifications.error('Orden no encontrada'); return; }
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
  
  // Handlers de botones del modal (solo dinámicos)
  const whatsappBtn = document.getElementById('whatsappBtn');
  const invoiceBtn = document.getElementById('generateInvoiceBtn');
  const copyTrackBtn = document.getElementById('copyTrackingLinkBtn');

  // ✅ CORRECCIÓN: Asignación directa de eventos (elimina uso de cloneNode/replaceWith)
  if (whatsappBtn) {
    whatsappBtn.onclick = () => openWhatsApp(order);
  }

  if (invoiceBtn) {
    invoiceBtn.onclick = () => generateAndSendInvoice(order.id);
  }

  // Copiar enlace directo de seguimiento
  if (copyTrackBtn) {
    copyTrackBtn.onclick = async () => {
      const url = `https://logisticalopezortiz.com/seguimiento.html?orderId=${order.short_id || order.id}`;
      try { await navigator.clipboard.writeText(url); }
      catch(_) { if (window.notifications) notifications.warning('No se pudo copiar al portapapeles'); }
      try {
        const phone = normalizePhoneDR(order.phone);
        if (phone) {
          const msg = `👋 Hola, ${order.name || 'cliente'}. Aquí puedes ver el estado de tu servicio en tiempo real:\n${url}\n\nSi necesitas ayuda, respóndenos por aquí. ¡Gracias por elegirnos! 🚛`;
          const wa = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
          window.open(wa, '_blank');
          notifications.success('Enviado por WhatsApp: seguimiento');
        } else {
          window.open(url, '_blank');
          notifications.warning('Número no disponible. Abriendo enlace de seguimiento');
        }
      } catch(_) {
        window.open(url, '_blank');
      }
    };
  }

  refreshLucide();
}

function closeAssignModal(){
  const modal = document.getElementById('assignModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
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
  const { success, error } = await OrderManager.actualizarEstadoPedido(selectedOrderIdForAssign, 'En curso', updateData);

  if (!success) {
    notifications.error('Error de asignación', error?.message || 'No se pudo asignar el pedido.');
  } else {
    // Actualizar el array local para reflejar el cambio inmediatamente
    const orderIndex = allOrders.findIndex(o => o.id === selectedOrderIdForAssign);
    if (orderIndex !== -1) {
      allOrders[orderIndex] = { ...allOrders[orderIndex], ...updateData, status: 'En curso' };
    }
    filterOrders();
    notifications.success(`Pedido asignado a ${col.name} y marcado como "En curso".`);
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

  notifications.info('Generando factura y enviando enlace por correo...', 'Espera un momento.');

  console.log('[Factura] Iniciando invocación de función generate-invoice-pdf...');
  console.log('[Factura] Order ID:', order.id);

  try {
    let pdfData = null;
    let pdfError = null;
    const r = await supabaseConfig.client.functions.invoke('generate-invoice-pdf', {
      body: { orderId: order.id }
    });
    pdfData = r?.data || null;
    pdfError = r?.error || null;

    console.log('[Factura] Respuesta recibida:', { pdfData, pdfError });
    console.log('[Factura] DATA:', JSON.stringify(pdfData));
    console.log('[Factura] ERROR:', JSON.stringify(pdfError));

    if (pdfError || !pdfData) {
      try {
        const u = `${supabaseConfig.functionsUrl}/functions/v1/generate-invoice-pdf`;
        const res = await fetch(u, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseConfig.anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ orderId: order.id })
        });
        if (res.ok) {
          pdfData = await res.json();
          pdfError = null;
          console.log('[Factura] Fallback fetch OK');
        } else {
          console.error('[Factura] Fallback fetch HTTP', res.status);
        }
      } catch (e) {
        console.error('[Factura] Fallback fetch error', e?.message || e);
      }
    }
    
    const candidateUrl = pdfData && (pdfData.data?.pdfUrl || pdfData.pdfUrl || pdfData.url);
    if (!pdfData || pdfData.error || !candidateUrl) {
      console.error('Error en respuesta de función:', pdfData);
      throw new Error(pdfData?.error || 'La función no devolvió una URL válida.');
    }
    const pdfUrl = candidateUrl;

    try {
      const linkWrap = document.getElementById('invoiceLink');
      const linkA = document.getElementById('invoiceLinkAnchor');
      if (linkWrap && linkA) {
        linkA.href = pdfUrl;
        linkA.textContent = 'Ver factura';
        linkWrap.style.display = 'block';
      }
    } catch(_) { }

    if (pdfData.data?.emailSent) {
      notifications.success('Factura enviada', 'El cliente recibió el enlace de su factura por correo.');
    } else {
      // Fallback si el envío automático falló pero tenemos PDF
      const subject = `Factura de su orden #${order.short_id || order.id} con Logística López Ortiz`;
      const body = `¡Hola, ${order.client_name || order.name}!\n\nAdjunto le enviamos los detalles y la factura correspondiente a su orden de servicio con nosotros.\n\n- Servicio: ${order.service?.name || 'N/A'}\n- Ruta: ${order.pickup} → ${order.delivery}\n- Fecha: ${order.date}\n\nPuede ver y descargar su factura desde el siguiente enlace seguro:\n${pdfUrl}\n\nSi tiene alguna pregunta, no dude en contactarnos.\n\n¡Gracias por confiar en Logística López Ortiz!`;
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(gmailUrl, '_blank');
      notifications.warning('Envío automático falló', 'Se abrió Gmail con el borrador para enviar la factura manualmente.');
    }

  } catch (error) {
    console.error('Error al procesar la factura:', error);
    notifications.error(
      'Error al procesar factura',
      error.message || 'No se pudo generar el enlace de la factura. Revisa la consola y la Edge Function `generate-invoice-pdf`.'
    );
  }
}

function renderCardHtml(o) {
  const badge = {
    'Pendiente': 'bg-yellow-100 text-yellow-800',
    'Aceptada': 'bg-blue-100 text-blue-800',
    'En curso': 'bg-purple-100 text-purple-800',
    'Completada': 'bg-green-100 text-green-800',
    'Cancelada': 'bg-red-100 text-red-800'
  }[o.status] || 'bg-gray-100 text-gray-800';

  return `
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
}

 

function renderRowHtml(o){
  const statusColor = {
    'Pendiente': 'bg-yellow-100 text-yellow-800',
    'Aceptada': 'bg-blue-100 text-blue-800',
    'En curso': 'bg-purple-100 text-purple-800',
    'Completada': 'bg-green-100 text-green-800',
    'Cancelada': 'bg-red-100 text-red-800'
  }[o.status] || 'bg-gray-100 text-gray-800';
  return `
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${o.id || 'N/A'}</td>
    <td class="px-6 py-4 whitespace-nowrap">
      <div class="text-sm font-medium text-gray-900">${o.name || 'N/A'}</div>
      <div class="text-sm text-gray-500">${o.client_phone || o.phone || ''}</div>
      ${o.client_email || o.email ? `<div class="text-sm text-gray-500 truncate" title="${o.client_email || o.email}">${o.client_email || o.email}</div>` : ''}
      ${o.rnc ? `<div class="mt-1 text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full inline-block" title="Empresa: ${o.empresa || 'N/A'}">RNC: ${o.rnc}</div>` : ''}
    </td>
    <td class="px-6 py-4 whitespace-nowrap">
      <div class="text-sm text-gray-900">${o.service?.name || 'N/A'}</div>
      ${o.service_questions && Object.keys(o.service_questions).length > 0 ?
        `<button onclick="showServiceDetails(${o.id})" class="mt-1 text-xs text-blue-600 hover:text-blue-800 underline">\n            <i data-lucide="info" class="w-3 h-3 inline-block mr-1"></i>Ver detalles\n          </button>`
        : ''
      }
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${o.vehicle?.name || 'N/A'}</td>
    <td class="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title="${o.pickup} → ${o.delivery}">${o.pickup} → ${o.delivery}</td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900"><div>${o.date}</div><div class="text-gray-500">${o.time}</div></td>
    <td class="px-6 py-4 whitespace-nowrap">
      <select onchange="updateOrderStatus('${o.id}', this.value)" class="px-2 py-1 rounded-full text-xs font-semibold ${statusColor} border-0 focus:ring-2 focus:ring-blue-500">\n        <option value="Pendiente" ${o.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option>\n        <option value="Aceptada" ${o.status === 'Aceptada' ? 'selected' : ''}>Aceptada</option>\n        <option value="En curso" ${o.status === 'En curso' ? 'selected' : ''}>En curso</option>\n        <option value="Completada" ${o.status === 'Completada' ? 'selected' : ''}>Completada</option>\n        <option value="Cancelada" ${o.status === 'Cancelada' ? 'selected' : ''}>Cancelada</option>\n      </select>
      ${o.collaborator?.name ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.collaborator.name}</div>` : ''}
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
      <button onclick="openPriceModal('${o.id}')" class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 transition-colors">\n        <span class="font-semibold text-green-700">${o.monto_cobrado ? `$${Number(o.monto_cobrado).toLocaleString('es-DO')}` : 'Confirmar'}</span>\n        <div class="text-xs text-gray-500">${o.metodo_pago || 'No especificado'}</div>\n      </button>
    </td>
  `;
}

function compareOrders(a, b){
  let aVal = a[sortColumn] || '';
  let bVal = b[sortColumn] || '';
  if (sortColumn === 'date') {
    aVal = getOrderDate(a) || new Date(0);
    bVal = getOrderDate(b) || new Date(0);
  }
  if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
  if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
  return 0;
}

function findInsertIndex(list, order){
  for (let i = 0; i < list.length; i++) {
    if (compareOrders(order, list[i]) < 0) return i;
  }
  return list.length;
}

function insertRowDom(o, idx){
  const tbl = document.getElementById('ordersTableBody');
  const cards = document.getElementById('ordersCardContainer');
  if (!tbl) return;
  
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-gray-50 transition-colors';
  tr.setAttribute('data-order-id', String(o.id));
  tr.innerHTML = renderRowHtml(o);
  tr.addEventListener('dblclick', () => openAssignModal(o.id));
  const ref = tbl.children[idx] || null;
  tbl.insertBefore(tr, ref);
  if (cards) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow p-4';
    card.setAttribute('data-order-id', String(o.id));
    card.innerHTML = renderCardHtml(o);
    const refCard = cards.children[idx] || null;
    cards.insertBefore(card, refCard);
  }
  refreshLucide();
}

function updateRow(o){
  const tr = document.querySelector(`tbody#ordersTableBody tr[data-order-id="${String(o.id)}"]`);
  if (tr) {
    tr.innerHTML = renderRowHtml(o);
  }
  const cards = document.getElementById('ordersCardContainer');
  if (cards) {
    const card = cards.querySelector(`div[data-order-id="${String(o.id)}"]`);
    if (card) {
      card.innerHTML = renderCardHtml(o);
    }
  }
  refreshLucide();
}

function removeRowDom(orderId){
  const tbl = document.getElementById('ordersTableBody');
  const cards = document.getElementById('ordersCardContainer');
  const tr = document.querySelector(`tbody#ordersTableBody tr[data-order-id="${String(orderId)}"]`);
  if (tr && tbl) tbl.removeChild(tr);
  if (cards) {
    const card = cards.querySelector(`div[data-order-id="${String(orderId)}"]`);
    if (card) cards.removeChild(card);
  }
}

// --- Lógica de Tiempo Real con Supabase ---

async function handleRealtimeUpdate(payload) {
  const { eventType, new: newRecord, old: oldRecord, table } = payload;
  if (table !== 'orders') return;

  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    let full = null;
    // Intentar obtener la orden completa para tener las relaciones (service, vehicle, etc.)
    try { full = await supabaseConfig.getOrderById(newRecord.id); } catch(_) {}
    const orderObj = full || newRecord;
    
    // Usar AppState para actualizar/insertar
    AppState.update(orderObj);
    
    if (eventType === 'INSERT' && window.notifications) {
      notifications.info(`Cliente: ${orderObj.name}.`, { title: `Nueva Solicitud #${orderObj.id}`, duration: 10000 });
    }
    return;
  }

  if (eventType === 'DELETE') {
    const id = oldRecord?.id;
    if (!id) return;
    // Usar AppState para eliminar
    AppState.delete(id);
    return;
  }
}

function setupRealtime() {
  try { if (window.__ordersSubscription) supabaseConfig.client.removeChannel(window.__ordersSubscription); } catch(_) {}
  window.__ordersSubscription = supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
    .subscribe();
}

function openPriceModal(orderId) {
  selectedOrderIdForPrice = orderId;
  const order = allOrders.find(o => o.id == selectedOrderIdForPrice);
  if (!order) { notifications.error('Error', 'No se encontró la orden para actualizar el precio.'); return; }
  const montoEl = document.getElementById('montoCobrado');
  const metodoEl = document.getElementById('metodoPago');
  if (montoEl) montoEl.value = order.monto_cobrado || '';
  if (metodoEl) metodoEl.value = order.metodo_pago || '';
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
  const montoEl = document.getElementById('montoCobrado');
  const metodoEl = document.getElementById('metodoPago');
  const monto = montoEl ? montoEl.value : '';
  const metodo = metodoEl ? metodoEl.value : '';
  if (!monto) { notifications.warning('Dato requerido', 'Debes ingresar un monto.'); return; }
  try {
    if (!selectedOrderIdForPrice) throw new Error('ID de orden no válido');
    const updated = await OrderManager.setOrderAmount(selectedOrderIdForPrice, monto, metodo);
    
    AppState.update({
      id: selectedOrderIdForPrice,
      monto_cobrado: updated?.monto_cobrado ?? parseFloat(monto),
      metodo_pago: updated?.metodo_pago ?? metodo
    });

    refreshLucide();
    notifications.success('Éxito', 'El monto y método de pago han sido actualizados.');
    closePriceModal();
  } catch (error) {
    console.error('[savePriceData] Error al guardar monto por RPC:', error);
    notifications.error('Error al guardar', error.message || 'No se pudo guardar el monto');
  }
}

function openWhatsApp(order) {
  if (!order.phone) { notifications.error('Esta orden no tiene un número de teléfono registrado.'); return; }
  const phone = normalizePhoneDR(order.phone);
  const message = `👋 ¡Hola, ${order.name}! Somos del equipo de Logística López Ortiz 🚛.\nQueríamos informarle que recibimos su solicitud y estamos revisando algunos detalles importantes antes de proceder.\nEn breve nos pondremos en contacto con más información.\n¡Gracias por elegirnos! 💼`;
  if (phone) {
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  } else {
    notifications.warning('Número inválido');
  }
}

async function checkVapidStatus() {
  try {
    const { data, error } = await supabaseConfig.client.functions.invoke('getVapidKey');
    if (error) return;
    const k = data && data.key;
    if (!k || typeof k !== 'string') { notifications.warning('Claves VAPID no configuradas', { title: 'Push deshabilitado' }); return; }
    const raw = vapidToBytes(k);
    if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) { notifications.warning('Clave VAPID inválida', { title: 'Push deshabilitado' }); }
    else { notifications.info('VAPID configurada correctamente'); }
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

async function initAdminOrdersPage() {
  if (__initialized) return;
  __initialized = true;
  await loadOrders();
  await loadAdminInfo();
  checkVapidStatus();
  setupRealtime();
  refreshLucide();
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const assignCancel = document.getElementById('assignCancelBtn');
    const assignCloseX = document.getElementById('assignCloseXBtn');
    const assignConfirm = document.getElementById('assignConfirmBtn');
    const deleteOrder = document.getElementById('deleteOrderBtn');
    const assignModalBody = document.getElementById('assignModalBody'); // Moved from openAssignModal

    if (assignCancel) assignCancel.addEventListener('click', closeAssignModal);
    if (assignCloseX) assignCloseX.addEventListener('click', closeAssignModal);
    if (assignConfirm) assignConfirm.addEventListener('click', assignSelectedCollaborator);
    if (deleteOrder) deleteOrder.addEventListener('click', deleteSelectedOrder);

    const priceCancel = document.getElementById('priceCancelBtn');
    const priceSave = document.getElementById('priceSaveBtn');
    if (priceCancel) priceCancel.addEventListener('click', closePriceModal);
    if (priceSave) priceSave.addEventListener('click', savePriceData);
    
    // Listener estático para doble clic en el cuerpo del modal
    if (assignModalBody) {
      assignModalBody.addEventListener('dblclick', () => {
        assignModalBody.classList.toggle('max-h-[70vh]');
        assignModalBody.classList.toggle('overflow-y-auto');
      });
    }
  } catch (_) {}
  window.sortTable = sortTable;
  window.updateOrderStatus = updateOrderStatus;
  window.openAssignModal = openAssignModal;
  window.generateAndSendInvoice = generateAndSendInvoice;
  window.showServiceDetails = showServiceDetails;
  window.openWhatsApp = openWhatsApp;
  window.openPriceModal = openPriceModal;
  window.closeAssignModal = closeAssignModal;
  window.closePriceModal = closePriceModal;
  window.savePriceData = savePriceData;

  try {
    const permEl = document.getElementById('pushStatusPerm');
    const subEl = document.getElementById('pushStatusSub');
    const enableBtn = document.getElementById('pushEnableBtn');
    const disableBtn = document.getElementById('pushDisableBtn');
    const testBtn = document.getElementById('pushTestBtn');
    const refresh = () => {
      try { if (permEl) permEl.textContent = `Permiso: ${window.pushNotifications?.permission || '—'}`; } catch(_){}
      try { if (subEl) subEl.textContent = `Suscripción: ${window.pushNotifications?.isEnabled ? 'Sí' : 'No'}`; } catch(_){}
    };
    if (enableBtn) enableBtn.addEventListener('click', async () => { try { await window.pushNotifications?.enable(); } catch(_){} refresh(); });
    if (disableBtn) disableBtn.addEventListener('click', async () => { try { await window.pushNotifications?.disable(); } catch(_){} refresh(); });
    if (testBtn) testBtn.addEventListener('click', async () => { try { await window.pushNotifications?.sendTest(); notifications?.info?.('Notificación de prueba enviada'); } catch(e){ notifications?.error?.('Fallo al enviar prueba'); } });
    refresh();
  } catch(_){ }
});

document.addEventListener('admin-session-ready', (e) => {
  if (!e.detail?.isAdmin) { return; }
  initAdminOrdersPage();
}, { once: true });

})();
