(() => {
'use strict';

// ============================================
// CONSTANTES Y CONFIGURACIÓN GLOBAL
// ============================================

// Estados de órdenes (single source of truth)
const ORDER_STATUS = Object.freeze({
  PENDIENTE: 'Pendiente',
  ACEPTADA: 'Aceptada',
  EN_CURSO: 'En curso',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada'
});

// Mapeo de estados de base de datos a UI
const DB_TO_UI_STATUS = Object.freeze({
  pending: ORDER_STATUS.PENDIENTE,
  accepted: ORDER_STATUS.ACEPTADA,
  in_progress: ORDER_STATUS.EN_CURSO,
  completed: ORDER_STATUS.COMPLETADA,
  cancelled: ORDER_STATUS.CANCELADA
});

// Colores por estado (reutilizable en todo el código)
const STATUS_COLOR = Object.freeze({
  [ORDER_STATUS.PENDIENTE]: 'bg-yellow-100 text-yellow-800',
  [ORDER_STATUS.ACEPTADA]: 'bg-blue-100 text-blue-800',
  [ORDER_STATUS.EN_CURSO]: 'bg-purple-100 text-purple-800',
  [ORDER_STATUS.COMPLETADA]: 'bg-green-100 text-green-800',
  [ORDER_STATUS.CANCELADA]: 'bg-red-100 text-red-800'
});

// Variables globales
let allOrders = [];
let filteredOrders = [];
let sortColumn = 'date';
let sortDirection = 'desc';
let selectedOrderIdForAssign = null;
let __initialized = false;
let selectedOrderIdForPrice = null;
let __lucideTimer = null;
let __collaboratorsById = {};

function getCollaboratorIdFromOrder(o) {
  if (!o) return null;
  if (o.assigned_to) return o.assigned_to;
  return null;
}

async function resolveCollaboratorName(order) {
  const cid = getCollaboratorIdFromOrder(order);
  if (!cid) return null;

  // ✅ Priorizar cache local para velocidad
  if (__collaboratorsById?.[cid]?.name) {
    return __collaboratorsById[cid].name;
  }

  // Fallback a base de datos si no está en cache
  try {
    const { data } = await supabaseConfig.client.from('collaborators').select('id,name').eq('id', cid).maybeSingle();
    if (data) {
      __collaboratorsById[cid] = data;
      return data.name;
    }
  } catch (_) {}
  return null;
}

function formatUiStatus(s) {
  if (!s) return ORDER_STATUS.PENDIENTE;
  const normalized = String(s).toLowerCase();
  return DB_TO_UI_STATUS[normalized] || s || ORDER_STATUS.PENDIENTE;
}

function isFinalOrderStatus(s) {
  const v = String(s || '').toLowerCase();
  return v === 'completed' || v === 'cancelled';
}

// --- GESTIÓN DE ESTADO CENTRALIZADO ---
const AppState = {
  update(order) {
    const id = order.id;
    const idxAll = allOrders.findIndex(o => o.id === id);
    const base = idxAll !== -1 ? allOrders[idxAll] : null;
    const merged = { ...(base || {}), ...order };
    if (!merged.status && base && base.status) merged.status = base.status;
    if (idxAll !== -1) {
      allOrders[idxAll] = merged;
    } else {
      allOrders.unshift(merged);
    }
    filterOrders();
  },
  
  delete(id) {
    allOrders = allOrders.filter(o => o.id !== id);
    filterOrders();
  }
};

function getOrderDate(o) {
  if (!o || !o.date) return null;
  try { return new Date(`${o.date}T${o.time || '00:00'}`); } catch(_) { return null; }
}

function isVisibleStatus(status) {
  return !isFinalOrderStatus(status);
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
  const resp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client.from('collaborators').select('*'))
    || supabaseConfig.client.from('collaborators').select('*'));
  const { data, error } = resp;
  if (error) {
    console.error("Error al cargar colaboradores:", error);
    return [];
  }
  try { __collaboratorsById = Object.fromEntries((data || []).map(c => [c.id, c])); } catch(_) {}
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
  sortTable(sortColumn);
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

// Agregar debounce a refreshLucide para evitar recrear íconos demasiadas veces
function refreshLucide() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      if (__lucideTimer) clearTimeout(__lucideTimer);
      __lucideTimer = setTimeout(() => {
        const hasIcons = document.querySelector('[data-lucide]') !== null;
        if (hasIcons) window.lucide.createIcons();
      }, 150); // Debounce de 150ms
    }
  } catch (_) {}
}

// Función para renderizar pedidos (mejorada con DocumentFragment)
function renderOrders() {
  const ordersTableBody = document.getElementById('ordersTableBody');
  if (!ordersTableBody) {
    console.error('No se encontró el elemento ordersTableBody');
    return;
  }

  // Actualizar contadores
  const showingCount = document.getElementById('showingCount');
  const totalCount = document.getElementById('totalCount');
  if (showingCount) showingCount.textContent = filteredOrders.length;
  if (totalCount) totalCount.textContent = allOrders.length;
  
  // Actualizar paneles de resumen
  updateResumen();
  updateAlerts();

  if (filteredOrders.length === 0) {
    ordersTableBody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-gray-500">No hay pedidos que coincidan con los filtros.</td></tr>';
    const cardContainer = document.getElementById('ordersCardContainer');
    if (cardContainer) {
      cardContainer.innerHTML = '<div class="text-center py-6 text-gray-500"><i data-lucide="package" class="w-6 h-6 text-gray-400"></i> No hay pedidos</div>';
    }
    return;
  }

  // Usar DocumentFragment para mejor performance
  const tableFragment = document.createDocumentFragment();
  const cardContainer = document.getElementById('ordersCardContainer');
  const cardFragment = cardContainer ? document.createDocumentFragment() : null;

  filteredOrders.forEach(o => {
    // Crear fila de tabla
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.setAttribute('data-order-id', String(o.id));
    tr.innerHTML = renderRowHtml(o);
    attachRowListeners(tr, o.id);
    tableFragment.appendChild(tr);

    // Crear tarjeta móvil
    if (cardFragment) {
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow p-4';
      card.setAttribute('data-order-id', String(o.id));
      card.innerHTML = renderCardHtml(o);
      cardFragment.appendChild(card);
    }
  });

  // Reemplazar DOM de una sola vez
  ordersTableBody.innerHTML = '';
  ordersTableBody.appendChild(tableFragment);

  if (cardContainer && cardFragment) {
    cardContainer.innerHTML = '';
    cardContainer.appendChild(cardFragment);
  }

  refreshLucide();
}

// Función auxiliar para agregar listeners a filas (prevenir duplicados)
function attachRowListeners(tr, orderId) {
  tr.removeEventListener('dblclick', openAssignModal);
  tr.addEventListener('dblclick', () => openAssignModal(orderId));
}

// --- Menú de acciones eliminado ---

// Función para actualizar el estado de una orden en Supabase
async function updateOrderStatus(orderId, newStatus) {
  if (!orderId) {
    console.error('[updateOrderStatus] ID de orden no válido');
    return;
  }

  console.log(`[Dueño] Solicitando cambio de estado para orden #${orderId} a "${newStatus}"`);

  // Normalizar estados: UI español → DB inglés
  const statusMap = {
    'pendiente': 'pending',
    'aceptada': 'accepted',
    'en curso': 'in_progress',
    'completada': 'completed',
    'cancelada': 'cancelled'
  };
  
  const normalizedStatus = statusMap[String(newStatus).toLowerCase()] || String(newStatus).toLowerCase();

  try {
    const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, normalizedStatus, {});

    if (success) {
      notifications.success(`Estado del pedido #${orderId} actualizado a "${newStatus}".`);
      AppState.update({ id: Number(orderId), status: normalizedStatus });
      refreshLucide();

      if (normalizedStatus === 'completed' || normalizedStatus === 'cancelled') {
        try { window.location.href = 'historial-solicitudes.html'; } catch (_) {}
      }
    } else {
      notifications.error('No se pudo actualizar el estado de la orden.', error);
      await loadOrders(); // Revertir cambios visuales optimistas
    }
  } catch (err) {
    console.error('[updateOrderStatus] Error inesperado:', err);
    notifications.error('Error al actualizar estado', err?.message || 'Error desconocido');
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
  const completedOrders = allOrders.filter(o => {
    const v = String(o.status || '').toLowerCase();
    return v === 'completed' || v === 'completada' || o.status === ORDER_STATUS.COMPLETADA;
  }).length;
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
// Mejorada con validaciones DR y mejor manejo de errores
async function openAssignModal(orderOrId) {
  // Aceptar objeto de orden o ID
  let orderId = null;
  if (orderOrId && typeof orderOrId === 'object' && Number.isFinite(orderOrId.id)) {
    orderId = Number(orderOrId.id);
  } else {
    const n = Number(orderOrId);
    orderId = Number.isFinite(n) ? n : null;
  }
  if (!Number.isFinite(orderId) || orderId === null) {
    console.error('[openAssignModal] ID de orden no válido:', orderOrId);
    notifications.error('Error', 'ID de orden no válido');
    return;
  }

  selectedOrderIdForAssign = orderId;
  
  const modal = document.getElementById('assignModal');
  const modalTitle = document.getElementById('assignModalTitle');
  const body = document.getElementById('assignModalBody');
  const select = document.getElementById('assignSelect');
  const assignBtn = document.getElementById('assignConfirmBtn');

  if (!modal || !modalTitle || !body || !select || !assignBtn) {
    console.error('[openAssignModal] Elementos del modal no encontrados en el DOM');
    notifications.error('Error de interfaz', 'No se pudo abrir el modal de asignación.');
    return;
  }

  const order = allOrders.find(o => o.id === selectedOrderIdForAssign);
  if (!order) {
    console.error('[openAssignModal] Orden no encontrada:', selectedOrderIdForAssign);
    notifications.error('Orden no encontrada');
    return;
  }
  
  // ✅ Validar que la orden siga siendo asignable
  if (isFinalOrderStatus(order.status)) {
    notifications.warning('Orden completada', 'Esta orden ya está completada o cancelada y no puede ser modificada.');
    return;
  }
  
  try {
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
        opt.value = c.id; // UUID del colaborador
        opt.textContent = `${c.name} — ${c.role}`;
        select.appendChild(opt);
      });
      select.disabled = false;
      assignBtn.disabled = false;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // ✅ Asignar eventos directamente (sin duplicados)
    const whatsappBtn = document.getElementById('whatsappBtn');
    const invoiceBtn = document.getElementById('generateInvoiceBtn');
    const copyTrackBtn = document.getElementById('copyTrackingLinkBtn');

    if (whatsappBtn) {
      whatsappBtn.onclick = () => openWhatsApp(order);
    }

    if (invoiceBtn) {
      invoiceBtn.onclick = () => generateAndSendInvoice(order.id);
    }

    if (assignBtn) {
      assignBtn.onclick = assignSelectedCollaborator;
    }

    if (copyTrackBtn) {
      copyTrackBtn.onclick = async () => {
        const url = `https://logisticalopezortiz.com/seguimiento.html?orderId=${order.short_id || order.id}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch (_) {
          if (window.notifications) notifications.warning('No se pudo copiar al portapapeles');
        }
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
        } catch (err) {
          console.error('[copyTrackBtn] Error:', err);
          window.open(url, '_blank');
        }
      };
    }

    refreshLucide();
  } catch (err) {
    console.error('[openAssignModal] Error inesperado:', err);
    notifications.error('Error al abrir modal', err?.message || 'Error desconocido');
  }
}

// Mejorada con validaciones
function closeAssignModal() {
  const modal = document.getElementById('assignModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  selectedOrderIdForAssign = null;
}

// Mejorada con validaciones y manejo de errores robusto
async function assignSelectedCollaborator() {
  const assignBtn = document.getElementById('assignConfirmBtn');
  const selectEl = document.getElementById('assignSelect');

  if (!selectEl || !selectEl.value) {
    notifications.error('Selecciona un colaborador.');
    return;
  }

  if (!selectedOrderIdForAssign) {
    notifications.error('No se seleccionó ninguna orden.');
    return;
  }

  const collaboratorId = selectEl.value;

  assignBtn.disabled = true;
  const originalText = assignBtn.textContent;
  assignBtn.innerHTML =
    '<i data-lucide="loader" class="w-4 h-4 animate-spin inline-block mr-2"></i>Asignando...';
  refreshLucide();

  try {

    // 1️⃣ Verificar colaborador existe
    const { data: col, error: colErr } = await supabaseConfig.client
      .from('collaborators')
      .select('id,name')
      .eq('id', collaboratorId)
      .maybeSingle();

    if (colErr || !col) {
      notifications.error('Colaborador no encontrado.');
      return;
    }

    // 2️⃣ Verificar que NO tenga orden activa
    const { data: conflicts } = await supabaseConfig.client
      .from('orders')
      .select('id')
      .eq('assigned_to', collaboratorId)
      .in('status', ['accepted', 'in_progress'])
      .limit(1);

    if (conflicts && conflicts.length > 0) {
      notifications.error('El colaborador ya tiene una orden activa.');
      return;
    }

    // 3️⃣ Actualizar orden
    const { success, error } =
      await OrderManager.actualizarEstadoPedido(
        Number(selectedOrderIdForAssign),
        'accepted',
        {
          assigned_to: String(collaboratorId)
        }
      );

    if (!success) {
      notifications.error(
        'No se pudo asignar la orden',
        error?.message
      );
      return;
    }

    // 4️⃣ Refrescar cache y estado local
    try { __collaboratorsById[collaboratorId] = col; } catch(_){}
    AppState.update({
      id: Number(selectedOrderIdForAssign),
      assigned_to: collaboratorId,
      status: 'accepted'
    });

    filterOrders();
    const order = allOrders.find(o => o.id === Number(selectedOrderIdForAssign));
    const orderId = order ? (order.short_id || order.id) : selectedOrderIdForAssign;
    notifications.success(`Orden #${orderId} asignada a ${col.name} ✓`, { duration: 5000 });
    
    // ✅ NOTIFICACIÓN ONESIGNAL AL COLABORADOR
    if (col.onesignal_id && window.OrderManager?.notifyOneSignal) {
      window.OrderManager.notifyOneSignal({
        player_ids: [col.onesignal_id],
        title: '🚛 Nueva Orden Asignada',
        message: `Se te ha asignado la orden #${orderId}. Revisa los detalles en tu panel.`,
        url: `${window.location.origin}/panel-colaborador.html`
      });
    }

    closeAssignModal();

  } catch (err) {
    console.error('[assignSelectedCollaborator]', err);
    notifications.error('Error asignando colaborador');
  } finally {
    assignBtn.disabled = false;
    assignBtn.textContent = originalText;
  }
}

// Mejorada con validación de ID antes de usar
async function deleteSelectedOrder() {
  if (!selectedOrderIdForAssign) {
    notifications.error('Error', 'No se seleccionó ninguna orden.');
    return;
  }

  if (!confirm('¿Eliminar esta solicitud?')) return;

  try {
    const { error } = await (supabaseConfig.withAuthRetry?.(() => 
      supabaseConfig.client.from('orders').delete().eq('id', selectedOrderIdForAssign)
    ) || supabaseConfig.client.from('orders').delete().eq('id', selectedOrderIdForAssign));
    
    if (error) {
      notifications.error('Error al eliminar', error.message);
      return;
    }

    allOrders = allOrders.filter(o => o.id !== selectedOrderIdForAssign);
    filterOrders();
    notifications.success(`La solicitud #${selectedOrderIdForAssign} ha sido eliminada.`);
    closeAssignModal();

  } catch (err) {
    console.error('[deleteSelectedOrder] Error inesperado:', err);
    notifications.error('Error al eliminar', err?.message || 'Error desconocido');
  }
}

// ===============================
// FACTURA → SOLO send-invoice
// ===============================
async function generateAndSendInvoice(orderId) {

  if (!orderId) {
    notifications.error('ID de orden inválido');
    return;
  }

  const order = allOrders.find(o => o.id === Number(orderId));
  if (!order) {
    notifications.error('Orden no encontrada');
    return;
  }

  const clientEmail = order.client_email || order.email;

  if (!clientEmail) {
    notifications.warning(
      'Cliente sin correo',
      'Esta orden no tiene email registrado.'
    );
    return;
  }

  const btn = document.getElementById('generateInvoiceBtn');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin inline-block mr-2"></i>Generando...`;
      refreshLucide();
    }

    notifications.info('Generando factura...', 'Por favor espera');

    let respData = null;
    let respError = null;
    const invokeRes = await supabaseConfig.client.functions.invoke('send-invoice', {
      body: {
        orderId: Number(orderId),
        email: clientEmail
      }
    });
    if (invokeRes.error || !invokeRes.data) {
      try {
        const { data: { session } } = await supabaseConfig.client.auth.getSession();
        const token = session?.access_token || supabaseConfig.anonKey;
        const url = `${supabaseConfig.functionsUrl}/send-invoice`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': supabaseConfig.anonKey
          },
          body: JSON.stringify({ orderId: Number(orderId), email: clientEmail })
        });
        respData = await r.json().catch(() => null);
        if (!r.ok) {
          respError = new Error((respData && respData.error) || `HTTP ${r.status}`);
        }
      } catch (e) {
        respError = e;
      }
    } else {
      respData = invokeRes.data;
    }

    if (respError) {
      throw new Error(respError.message || 'Error al invocar send-invoice');
    }

    if (!respData?.success) {
      throw new Error(respData?.message || 'La función no devolvió éxito');
    }

    const pdfUrl = (respData?.data && respData.data.pdfUrl) ? respData.data.pdfUrl : null;

    // Mostrar link si existe
    if (pdfUrl) {
      const wrap = document.getElementById('invoiceLink');
      const a = document.getElementById('invoiceLinkAnchor');

      if (wrap && a) {
        a.href = pdfUrl;
        a.target = '_blank';
        a.textContent = 'Abrir factura (PDF)';
        wrap.style.display = 'block';
      }
    }

    notifications.success(
      'Factura enviada',
      `Se envió la factura a ${clientEmail}`
    );

  } catch (err) {

    console.error('[send-invoice]', err);

    notifications.error(
      'Error al enviar factura',
      err.message || 'Fallo interno'
    );

  } finally {

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Generar factura';
    }

  }
}

function renderCardHtml(o) {
  const displayStatus = formatUiStatus(o.status);
  const badgeClass = STATUS_COLOR[displayStatus] || 'bg-gray-100 text-gray-800';
  const collabId = getCollaboratorIdFromOrder(o);
  const collabName = o.collaborator?.name || (__collaboratorsById?.[collabId]?.name) || o.nombre_chofer || '';

  return `
    <div class="flex justify-between items-start mb-2">
      <div>
        <div class="text-sm text-gray-500">#${o.id}</div>
        <div class="font-semibold text-gray-900">${o.service?.name || 'N/A'}</div>
        <div class="text-sm text-gray-600 truncate">${o.pickup} → ${o.delivery}</div>
      </div>
      <span class="px-2 py-1 rounded-full text-xs font-semibold ${badgeClass}">${displayStatus}</span>
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
    ${collabName ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${collabName}</div>` : ''}
    <div class="flex justify-end gap-2">
      ${o.service_questions && Object.keys(o.service_questions).length > 0 ?
        `<button class="px-3 py-1 rounded bg-gray-100 text-gray-700 text-xs" onclick="showServiceDetails('${o.id}')">Detalles</button>` : ''}
      <button class="px-3 py-1 rounded bg-blue-600 text-white text-xs" onclick="openAssignModal('${o.id}')">Gestionar</button>
    </div>
  `;
}

 

function renderRowHtml(o) {
  const displayStatus = formatUiStatus(o.status);
  const statusColorClass = STATUS_COLOR[displayStatus] || 'bg-gray-100 text-gray-800';
  const collabId = getCollaboratorIdFromOrder(o);
  const collabName = o.collaborator?.name || (__collaboratorsById?.[collabId]?.name) || o.nombre_chofer || '';

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
        `<button onclick="showServiceDetails(${o.id})" class="mt-1 text-xs text-blue-600 hover:text-blue-800 underline">
            <i data-lucide="info" class="w-3 h-3 inline-block mr-1"></i>Ver detalles
          </button>`
        : ''
      }
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${o.vehicle?.name || 'N/A'}</td>
    <td class="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title="${o.pickup} → ${o.delivery}">${o.pickup} → ${o.delivery}</td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900"><div>${o.date}</div><div class="text-gray-500">${o.time}</div></td>
    <td class="px-6 py-4 whitespace-nowrap">
      <select onchange="updateOrderStatus('${o.id}', this.value)" class="px-2 py-1 rounded-full text-xs font-semibold ${statusColorClass} border-0 focus:ring-2 focus:ring-blue-500">
        <option value="${ORDER_STATUS.PENDIENTE}" ${displayStatus === ORDER_STATUS.PENDIENTE ? 'selected' : ''}>${ORDER_STATUS.PENDIENTE}</option>
        <option value="${ORDER_STATUS.ACEPTADA}" ${displayStatus === ORDER_STATUS.ACEPTADA ? 'selected' : ''}>${ORDER_STATUS.ACEPTADA}</option>
        <option value="${ORDER_STATUS.EN_CURSO}" ${displayStatus === ORDER_STATUS.EN_CURSO ? 'selected' : ''}>${ORDER_STATUS.EN_CURSO}</option>
        <option value="${ORDER_STATUS.COMPLETADA}" ${displayStatus === ORDER_STATUS.COMPLETADA ? 'selected' : ''}>${ORDER_STATUS.COMPLETADA}</option>
        <option value="${ORDER_STATUS.CANCELADA}" ${displayStatus === ORDER_STATUS.CANCELADA ? 'selected' : ''}>${ORDER_STATUS.CANCELADA}</option>
      </select>
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
      ${collabName ? `<div class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800"><i data-lucide="user" class="w-3 h-3"></i> ${collabName}</div>` : '<span class="text-gray-400 text-xs">Sin asignar</span>'}
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
      <button onclick="openPriceModal('${o.id}')" class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 transition-colors">
        <span class="font-semibold text-green-700">${o.monto_cobrado ? `$${Number(o.monto_cobrado).toLocaleString('es-DO')}` : 'Confirmar'}</span>
        <div class="text-xs text-gray-500">${o.metodo_pago || 'No especificado'}</div>
      </button>
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

// Mejorada para usar replaceWith en lugar de cloneNode
function insertRowDom(o, idx) {
  const tbl = document.getElementById('ordersTableBody');
  const cards = document.getElementById('ordersCardContainer');
  if (!tbl) return;
  
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-gray-50 transition-colors';
  tr.setAttribute('data-order-id', String(o.id));
  tr.innerHTML = renderRowHtml(o);
  attachRowListeners(tr, o.id);
  
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

// Mejorada para evitar múltiples listeners
function updateRow(o) {
  const tr = document.querySelector(`tbody#ordersTableBody tr[data-order-id="${String(o.id)}"]`);
  if (tr) {
    // Actualizar contenido sin recrear el nodo
    tr.innerHTML = renderRowHtml(o);
    // Volver a agregar listener después de actualizar HTML
    attachRowListeners(tr, o.id);
  }

  // Actualizar tarjeta móvil
  const card = document.querySelector(`#ordersCardContainer div[data-order-id="${String(o.id)}"]`);
  if (card) {
    card.innerHTML = renderCardHtml(o);
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

// Manejo mejorado de tiempo real (sin fetches innecesarios)
async function handleRealtimeUpdate(payload) {
  const { eventType, new: newRecord, old: oldRecord, table } = payload;
  if (table !== 'orders') return;

  try {
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      // Solo traer datos extra si realmente es necesario
      let orderObj = newRecord;

      // Verificar si falta información crítica (service, vehicle, colaborador)
      const needsFull = !newRecord.service || !newRecord.vehicle;
      if (needsFull) {
        try {
          const full = await supabaseConfig.getOrderById(newRecord.id);
          if (full) orderObj = full;
        } catch (err) {
          console.warn('[handleRealtimeUpdate] No se pudo traer orden completa, usando record parcial:', err);
        }
      }

      AppState.update(orderObj);
      resolveCollaboratorName(orderObj).then(() => updateRow(orderObj));

      if (eventType === 'INSERT' && window.notifications) {
        notifications.info(`Cliente: ${orderObj.name || 'Anónimo'}.`, { 
          title: `Nueva Solicitud #${orderObj.id}`, 
          duration: 10000 
        });
      }
      return;
    }

    if (eventType === 'DELETE') {
      const id = oldRecord?.id;
      if (!id) return;
      AppState.delete(id);
      return;
    }
  } catch (err) {
    console.error('[handleRealtimeUpdate] Error en actualización en tiempo real:', err);
  }
}

function setupRealtime() {
  try { if (window.__ordersSubscription) supabaseConfig.client.removeChannel(window.__ordersSubscription); } catch(_) {}
  window.__ordersSubscription = supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
    .subscribe();
}

// Mejorada con mejor manejo de errores
async function openPriceModal(orderId) {
  if (!orderId) {
    console.error('[openPriceModal] ID de orden no válido');
    notifications.error('Error', 'ID de orden no válido');
    return;
  }

  selectedOrderIdForPrice = Number(orderId);
  const order = allOrders.find(o => o.id === selectedOrderIdForPrice);
  
  if (!order) {
    notifications.error('Error', 'No se encontró la orden para actualizar el precio.');
    selectedOrderIdForPrice = null;
    return;
  }

  const montoEl = document.getElementById('montoCobrado');
  const metodoEl = document.getElementById('metodoPago');
  
  if (montoEl) montoEl.value = order.monto_cobrado || '';
  if (metodoEl) metodoEl.value = order.metodo_pago || '';
  
  const modal = document.getElementById('priceModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

// Mejorada con validaciones
function closePriceModal() {
  const modal = document.getElementById('priceModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  selectedOrderIdForPrice = null;
}

// Mejorada con validaciones y mejor manejo de errores
async function savePriceData() {
  const montoEl = document.getElementById('montoCobrado');
  const metodoEl = document.getElementById('metodoPago');
  
  const monto = montoEl ? montoEl.value : '';
  const metodo = metodoEl ? metodoEl.value : '';

  if (!monto) {
    notifications.warning('Dato requerido', 'Debes ingresar un monto.');
    return;
  }

  if (!selectedOrderIdForPrice) {
    notifications.error('Error', 'ID de orden no válido');
    return;
  }

  try {
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
    console.error('[savePriceData] Error al guardar monto:', error);
    notifications.error('Error al guardar', error?.message || 'No se pudo guardar el monto');
  }
}

// Mejorada con validaciones de normalización DR
function openWhatsApp(order) {
  if (!order || !order.phone) {
    notifications.error('Esta orden no tiene un número de teléfono registrado.');
    return;
  }

  const phone = normalizePhoneDR(order.phone);
  if (!phone) {
    notifications.warning('Número de teléfono inválido');
    return;
  }

  const message = `👋 ¡Hola, ${order.name || 'cliente'}! Somos del equipo de Logística López Ortiz 🚛.\nQueríamos informarle que recibimos su solicitud y estamos revisando algunos detalles importantes antes de proceder.\nEn breve nos pondremos en contacto con más información.\n¡Gracias por elegirnos! 💼`;
  
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
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
  await loadCollaborators(); // Cargar primero los colaboradores para el mapa
  await loadOrders(); // Cargar órdenes después
  await loadAdminInfo();
  checkVapidStatus();
  setupRealtime();
  refreshLucide();
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const assignCancel = document.getElementById('assignCancelBtn');
    const assignCloseX = document.getElementById('assignCloseXBtn');
    const deleteOrder = document.getElementById('deleteOrderBtn');
    const assignModalBody = document.getElementById('assignModalBody');

    // Asignar listeners sin duplicados
    if (assignCancel) assignCancel.addEventListener('click', closeAssignModal);
    if (assignCloseX) assignCloseX.addEventListener('click', closeAssignModal);
    // ✅ NOTA: assignConfirmBtn se asigna dinámicamente en openAssignModal
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
  } catch (err) {
    console.error('[DOMContentLoaded] Error al configurar listeners:', err);
  }

  // Exponer funciones globales
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

  // Solicitar permisos de notificación
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const enable = window.pushNotifications && window.pushNotifications.enable;
        if (typeof enable === 'function') {
          enable().catch(() => {});
        } else if (Notification.requestPermission) {
          Notification.requestPermission().catch(() => {});
        }
      } catch (_) {}
    }
  } catch (_) {}
});

document.addEventListener('admin-session-ready', (e) => {
  if (!e.detail?.isAdmin) return;
  
  // Suscribirse a notificaciones personales
  if (e.detail.userId && window.notifications) {
    window.notifications.subscribeToUserNotifications(e.detail.userId);
  }
  
  initAdminOrdersPage();
}, { once: true });

})();
