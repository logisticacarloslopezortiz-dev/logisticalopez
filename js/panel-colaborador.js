// Utilidades compartidas
function filterOrders(){ 
  const orders = JSON.parse(localStorage.getItem('tlc_orders')||'[]');
  // Eliminar solicitudes de prueba y pedidos completados/finalizados
  return orders.filter(order => 
    !order.id.toLowerCase().includes('prueba') && 
    !order.name.toLowerCase().includes('prueba') && 
    order.status !== 'Completado' && 
    order.lastCollabStatus !== 'entregado'
  );
}
function saveOrders(arr){ localStorage.setItem('tlc_orders', JSON.stringify(arr)); }

// Sesión colaborador
function getSession(){ return JSON.parse(localStorage.getItem('tlc_collab_session')||'null'); }
function requireSession(){
  const s = getSession();
  if (!s) { window.location.href = 'login-colaborador.html'; return null; }
  return s;
}

const STATUS_MAP = {
  en_camino_recoger: {
    label: 'En camino a recoger pedido',
    badge: 'bg-blue-100 text-blue-800'
  },
  cargando: {
    label: 'Cargando pedido',
    badge: 'bg-yellow-100 text-yellow-800'
  },
  en_camino_entregar: {
    label: 'En camino a entregar pedido',
    badge: 'bg-indigo-100 text-indigo-800'
  },
  retraso_tapon: {
    label: 'Retraso por tapón',
    badge: 'bg-orange-100 text-orange-800'
  },
  entregado: {
    label: 'Finalizado',
    badge: 'bg-green-100 text-green-800'
  }
};

// Notificación del navegador (con Service Worker para manejar clic y deep-link)
async function showBrowserNotification(order, statusKey) {
  try {
    const title = `Actualización de tu pedido ${order.id}`;
    const body = buildStatusMessage(order, statusKey);
    const icon = '/img/android-chrome-192x192.png';
    const badge = '/img/favicon-32x32.png';
    const data = { url: `/index.html?order=${order.id}` };

    // Preferir Service Worker para que el click funcione incluso en segundo plano
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, { body, icon, badge, data });
        return true;
      } catch (_) {}
    }

    // Fallback al Notification API del navegador
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, icon, data });
        n.onclick = () => { window.open(`/index.html?order=${order.id}`, '_blank'); };
        return true;
      } else {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const n = new Notification(title, { body, icon, data });
            n.onclick = () => { window.open(`/index.html?order=${order.id}`, '_blank'); };
            return true;
          }
        } catch (_) {}
      }
    }

    // Fallback a sistema de notificaciones interno si existe
    if (window.showInfo) window.showInfo('Cliente notificado', body, 5000);
  } catch (err) {
    console.warn('No se pudo mostrar la notificación del navegador:', err);
  }
  return false;
}
let all = [];
let filtered = [];
let selectedOrderIdForAccept = null;
let activeJobId = localStorage.getItem('tlc_collab_active_job') || null;
let currentCollabName = 'Colaborador';
let collabSession = null;

function collabDisplayName(email){
  try {
    const base = (email || '').split('@')[0] || 'colaborador';
    return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Colaborador'; }
}

function gmapEmbed(addr){
  return 'https://www.google.com/maps?q=' + encodeURIComponent(addr) + '&output=embed';
}

function openAcceptModal(order){
  selectedOrderIdForAccept = order.id;
  const modal = document.getElementById('acceptModal');
  const body = document.getElementById('acceptModalBody');
  body.innerHTML = `
    <div class="space-y-1">
      <div><span class="font-semibold">ID:</span> ${order.id}</div>
      <div><span class="font-semibold">Cliente:</span> ${order.name} (${order.phone})</div>
      <div><span class="font-semibold">Servicio:</span> ${order.service} — ${order.vehicle}</div>
      <div><span class="font-semibold">Ruta:</span> ${order.pickup} → ${order.delivery}</div>
      <div><span class="font-semibold">Fecha/Hora:</span> ${order.date} ${order.time}</div>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) lucide.createIcons();
}

function closeAcceptModal(){
  const modal = document.getElementById('acceptModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  selectedOrderIdForAccept = null;
}

function showActiveJob(order){
  // Solo mostrar el trabajo activo si está asignado al colaborador actual o si acaba de ser aceptado
  // Si el colaborador acaba de aceptar la orden, permitir mostrarla aunque aún no tenga assignedEmail
  if (order.assignedEmail && order.assignedEmail !== collabSession.email) {
    return; // No mostrar si está asignado a otro colaborador
  }
  
  activeJobId = order.id;
  localStorage.setItem('tlc_collab_active_job', activeJobId);
  const section = document.getElementById('activeJobSection');
  section.classList.remove('hidden');
  const info = document.getElementById('activeJobInfo');
  info.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="px-2 py-1 text-xs rounded bg-gray-100">ID: ${order.id}</span>
        ${order.assignedTo ? `<span class=\"px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800 inline-flex items-center gap-1\"><i data-lucide=\"user\" class=\"w-3 h-3\"></i> ${order.assignedTo}</span>` : ''}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div class="flex items-start gap-3">
          <i data-lucide="user" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">${order.name}</div>
            <div class="text-gray-600 flex flex-wrap gap-2">
              <a class="text-blue-600 underline" href="tel:${order.phone}">${order.phone}</a>
              <span>•</span>
              <a class="text-blue-600 underline" href="mailto:${order.email}">${order.email}</a>
            </div>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <i data-lucide="truck" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">${order.service}</div>
            <div class="text-gray-600">${order.vehicle}</div>
          </div>
        </div>
        <div class="flex items-start gap-3 sm:col-span-2">
          <i data-lucide="route" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div class="w-full">
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs"><i data-lucide="map-pin" class="w-3 h-3"></i> Recogida</span>
              <div class="text-gray-800">${order.pickup}</div>
            </div>
            <div class="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-xs"><i data-lucide="flag" class="w-3 h-3"></i> Entrega</span>
              <div class="text-gray-800">${order.delivery}</div>
            </div>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <i data-lucide="calendar" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">${order.date}</div>
            <div class="text-gray-600">${order.time}</div>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <i data-lucide="badge-dollar-sign" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">Precio estimado</div>
            <div class="text-green-700 font-bold">${order.estimatedPrice || 'Por confirmar'}</div>
          </div>
        </div>
        
        ${order.serviceQuestions && Object.keys(order.serviceQuestions).length > 0 ? `
        <div class="sm:col-span-2 border-t pt-4 mt-4">
          <div class="flex items-start gap-3">
            <i data-lucide="clipboard-list" class="w-5 h-5 text-gray-500 mt-0.5"></i>
            <div>
              <div class="font-semibold text-gray-800 mb-2">Detalles Adicionales del Servicio</div>
              <div class="space-y-2 text-sm">
                ${Object.entries(order.serviceQuestions).map(([key, value]) => `
                  <div class="text-gray-600"><span class="font-medium text-gray-700">${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}:</span> ${value}</div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>` : ''}

      </div>
    </div>
  `;
  updateActiveJobView();
  if (window.lucide) lucide.createIcons();
}

function updateActiveJobView(){
  if (!activeJobId) return;
  const order = all.find(o => o.id === activeJobId);
  if (!order) return;
  const statusKey = order.lastCollabStatus || 'en_camino_recoger';
  const statusLabel = (STATUS_MAP[statusKey] && STATUS_MAP[statusKey].label) || statusKey;
  const badge = document.getElementById('activeJobStatus');
  badge.textContent = statusLabel;
  const mapEl = document.getElementById('activeJobMap');
  const hintEl = document.getElementById('activeJobMapHint');
  if (statusKey === 'cargando' || statusKey === 'en_camino_entregar' || statusKey === 'entregado') {
    mapEl.src = gmapEmbed(order.delivery);
    hintEl.textContent = 'Dirígete a la dirección de entrega';
  } else {
    mapEl.src = gmapEmbed(order.pickup);
    hintEl.textContent = 'Dirígete a la dirección de recogida';
  }
}

function notifyClient(order, statusKey){
  const statusLabel = STATUS_MAP[statusKey]?.label || statusKey;
  
  // Guardamos un historial simple en el pedido
  order.tracking = order.tracking || [];
  order.tracking.unshift({
    at: new Date().toISOString(),
    status: statusLabel
  });
  saveOrders(all);
  
  return { success: true };
}

async function changeStatus(orderId, newKey){
  const idx = all.findIndex(o => o.id === orderId);
  if (idx === -1) return;
  all[idx].lastCollabStatus = newKey;

  // Notificar al cliente del cambio de estado
  notifyClient(all[idx], newKey);
  
  // Mostrar notificación de éxito al colaborador
  notifications.success('Estado actualizado y cliente notificado', {
    title: 'Notificación enviada',
    duration: 5000
  });

  // Mostrar notificación del navegador al cliente
  await showBrowserNotification(all[idx], newKey);

  // Si se finaliza el pedido, actualizar estado global y fecha de finalización
  if (newKey === 'entregado') {
    all[idx].status = 'Completado';
    all[idx].completedAt = new Date().toISOString();
    all[idx].completedBy = collabSession.email;
    
    // Actualizar métricas de rendimiento
    const collabMetrics = JSON.parse(localStorage.getItem('tlc_collab_metrics') || '{}');
    if (!collabMetrics[collabSession.email]) {
      collabMetrics[collabSession.email] = {
        completedOrders: 0,
        totalTime: 0,
        serviceTypes: {}
      };
    }
    
    collabMetrics[collabSession.email].completedOrders++;
    
    // Calcular tiempo total desde la asignación hasta la entrega
    if (all[idx].assignedAt) {
      const timeElapsed = new Date(all[idx].completedAt) - new Date(all[idx].assignedAt);
      collabMetrics[collabSession.email].totalTime += timeElapsed;
    }
    
    // Actualizar distribución de servicios
    const serviceType = all[idx].service;
    if (serviceType) {
      collabMetrics[collabSession.email].serviceTypes[serviceType] = 
        (collabMetrics[collabSession.email].serviceTypes[serviceType] || 0) + 1;
    }
    
    localStorage.setItem('tlc_collab_metrics', JSON.stringify(collabMetrics));
    
    // Remover de la lista de pedidos activos
    filtered = filtered.filter(o => o.id !== orderId);
    
    // Mostrar notificación para valorar el servicio
    setTimeout(() => {
      showRatingNotification(all[idx]);
    }, 1000);
  }

  // Intentar enviar Web Push mediante servidor; si falla, usar notificación local
  const pushed = await sendPushToClient(all[idx], newKey);
  if (!pushed) await showBrowserNotification(all[idx], newKey);
  
  // Si el trabajo se marca como entregado, limpiar el trabajo activo
  if (newKey === 'entregado' && activeJobId === orderId) {
    activeJobId = null;
    localStorage.removeItem('tlc_collab_active_job');
    document.getElementById('activeJobSection').classList.add('hidden');
  }
  
  saveOrders(all);
  filterAndRender();
  if (activeJobId === orderId) updateActiveJobView();

  // Toast mínimo
  const t = document.createElement('div');
  t.className = 'fixed bottom-6 right-6 bg-gray-900 text-white px-4 py-2 rounded shadow';
  t.innerHTML = `<div class="flex items-center gap-2"><i data-lucide="bell" class="w-4 h-4"></i><span>Estado actualizado y cliente notificado</span></div>`;
  document.body.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 4000);
  if (window.lucide) lucide.createIcons();
}

let baseVisibleCount = 0;
function render(){
  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = '';
  document.getElementById('showingCount').textContent = filtered.length;
  document.getElementById('totalCount').textContent = baseVisibleCount;

  if (filtered.length === 0){
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-gray-500">Sin solicitudes</td></tr>';
    return;
  }

  filtered.forEach(o => {
    const statusKey = o.lastCollabStatus || 'en_camino_recoger';
    const status = STATUS_MAP[statusKey] || { label: statusKey, badge: 'bg-gray-100 text-gray-800' };
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50';
    tr.innerHTML = `
      <td class="px-3 md:px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${o.id}</td>
      <td class="px-3 md:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
        <div class="text-sm font-medium text-gray-900">${o.name}</div>
        <div class="text-sm text-gray-500">${o.phone}</div>
      </td>
      <td class="px-3 md:px-6 py-4 whitespace-nowrap text-sm text-gray-900 hidden sm:table-cell">${o.service}</td>
      <td class="px-3 md:px-6 py-4 text-sm text-gray-900 max-w-xs truncate hidden md:table-cell" title="${o.pickup} → ${o.delivery}">
        ${o.pickup} → ${o.delivery}
      </td>
      <td class="px-3 md:px-6 py-4 whitespace-nowrap text-sm text-gray-900 hidden sm:table-cell">
        <div>${o.date}</div>
        <div class="text-gray-500">${o.time}</div>
      </td>
      <td class="px-3 md:px-6 py-4 whitespace-nowrap">
        <span class="px-2 py-1 rounded-full text-xs font-semibold ${status.badge}">${status.label}</span>
        ${o.assignedTo ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.assignedTo}</div>` : ''}
      </td>
      <td class="px-3 md:px-6 py-4 whitespace-nowrap text-sm">
        <div class="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
          <button data-next="en_camino_recoger" class="step-btn px-2 py-1 text-xs bg-blue-600 text-white rounded w-full sm:w-auto">Recoger</button>
          <button data-next="cargando" class="step-btn px-2 py-1 text-xs bg-yellow-600 text-white rounded w-full sm:w-auto">Cargando</button>
          <button data-next="en_camino_entregar" class="step-btn px-2 py-1 text-xs bg-indigo-600 text-white rounded w-full sm:w-auto">Entregar</button>
          <button data-next="retraso_tapon" class="step-btn px-2 py-1 text-xs bg-orange-600 text-white rounded w-full sm:w-auto">Retraso</button>
          <button data-next="entregado" class="step-btn px-2 py-1 text-xs bg-green-600 text-white rounded w-full sm:w-auto">Finalizar</button>
        </div>
      </td>
    `;

    if (o.assignedTo) { tr.className += ' bg-yellow-50'; }
    tbody.appendChild(tr);
    tr.addEventListener('dblclick', () => openAcceptModal(o));

    // Wire buttons
    tr.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', () => changeStatus(o.id, btn.dataset.next));
    });
  });

  if (window.lucide) lucide.createIcons();
}

function filterAndRender(){
  const term = document.getElementById('searchInput').value.toLowerCase();
  const s = document.getElementById('statusFilter').value;
  const visibleForCollab = (o) => {
    if (!collabSession) return false;
    // Mostrar sólo solicitudes no entregadas y no completadas
    return (!o.assignedTo || o.assignedEmail === collabSession.email) &&
           (o.lastCollabStatus !== 'entregado') &&
           (o.status !== 'Completado');
  };
  const base = all.filter(visibleForCollab);
  baseVisibleCount = base.length;
  filtered = base.filter(o => {
    const m1 = !term || o.name.toLowerCase().includes(term) || o.id.toLowerCase().includes(term) || o.service.toLowerCase().includes(term);
    const current = o.lastCollabStatus || 'en_camino_recoger';
    const m2 = !s || s === current || s === o.status; // permite filtrar por estados del dueño si fuera necesario
    return m1 && m2;
  });
  render();
}

// Funciones para actualizar el sidebar
function updateCollaboratorProfile(session) {
  const name = collabDisplayName(session.email);
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  
  document.getElementById('collabName').textContent = name;
  document.getElementById('collabEmail').textContent = session.email;
  document.getElementById('collabAvatar').textContent = initials;
  
  // Actualizar estadísticas del colaborador
  updateCollaboratorStats(session.email);
}

// Función para cargar órdenes
function loadOrders() {
  return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
}

function updateCollaboratorStats(email) {
  const orders = loadOrders();
  const collaboratorOrders = orders.filter(order => order.assignedEmail === email);
  
  const activeJobs = collaboratorOrders.filter(order => 
    ['en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(order.lastCollabStatus || order.status)
  ).length;
  
  const completedJobs = collaboratorOrders.filter(order => 
    order.status === 'Completado' || order.lastCollabStatus === 'entregado'
  ).length;
  
  const pendingRequests = orders.filter(order => 
    !order.assignedTo || (order.assignedEmail === email && order.status !== 'Completado')
  ).length;
  
  document.getElementById('collabActiveJobs').textContent = activeJobs;
  document.getElementById('collabCompletedJobs').textContent = completedJobs;
  document.getElementById('pendingRequestsCount').textContent = pendingRequests;
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  const session = requireSession();
  if (!session) return; // redirigido
  
  currentCollabName = collabDisplayName(session.email);
  collabSession = session;
  
  // Actualizar perfil del colaborador
  updateCollaboratorProfile(session);

  all = loadOrders();
  filtered = [...all];

  document.getElementById('searchInput').addEventListener('input', filterAndRender);
  document.getElementById('statusFilter').addEventListener('change', filterAndRender);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    filterAndRender();
  });

  document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('tlc_collab_session');
    window.location.href = 'login-colaborador.html';
  });

  // Modal aceptar trabajo
  document.getElementById('cancelAcceptBtn').addEventListener('click', (e) => {
    e.preventDefault();
    closeAcceptModal();
  });
  document.getElementById('confirmAcceptBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (!selectedOrderIdForAccept) { closeAcceptModal(); return; }
    const order = all.find(o => o.id === selectedOrderIdForAccept);
    closeAcceptModal();
    if (order) {
      order.assignedTo = currentCollabName;
      order.assignedEmail = collabSession.email;
      order.assignedAt = new Date().toISOString();
      order.status = 'En proceso'; // Marcar automáticamente como "En proceso"
      order.lastCollabStatus = 'en_camino_recoger'; // Estado inicial del colaborador
      saveOrders(all);
      filterAndRender();
      // Asegurarse de que se muestre el trabajo activo
      showActiveJob(order);
      // Hacer scroll hasta la sección de trabajo activo para que sea visible
      document.getElementById('activeJobSection').scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Restaurar trabajo activo si existe
  if (activeJobId) {
    const order = all.find(o => o.id === activeJobId);
    // Solo mostrar si está asignado al colaborador actual y no está entregado
    if (order && (!order.assignedEmail || order.assignedEmail === collabSession.email) && order.lastCollabStatus !== 'entregado') {
      showActiveJob(order);
    } else {
      // Si el trabajo ya no está asignado a este colaborador o está entregado, limpiar el activeJobId
      activeJobId = null;
      localStorage.removeItem('tlc_collab_active_job');
      document.getElementById('activeJobSection').classList.add('hidden');
    }
  }
  
  // Buscar automáticamente trabajos activos asignados al colaborador actual
  if (!activeJobId) {
    const activeOrder = all.find(order => 
      order.assignedEmail === collabSession.email && 
      order.lastCollabStatus && 
      order.lastCollabStatus !== 'entregado' &&
      ['en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(order.lastCollabStatus)
    );
    
    if (activeOrder) {
      showActiveJob(activeOrder);
    }
  }

  filterAndRender();

  // Sincronizar cada 30s en caso de que el dueño cree nuevas solicitudes
  setInterval(() => {
    all = loadOrders();
    filterAndRender();
    updateCollaboratorStats(session.email);
  }, 30000);
});

// Endpoint de envío de Web Push (configurable). Si no está definido, se usa sólo la notificación local.
const PUSH_ENDPOINT = 'http://localhost:3000/api/push';

// Mensajes personalizados según estado del colaborador
function buildStatusMessage(order, statusKey) {
  const name = order.name || 'cliente';
  const map = {
    en_camino_recoger: `Hola ${name}, vamos en camino a recoger tu pedido.`,
    cargando: `Hola ${name}, tu pedido se encuentra siendo cargado en el vehículo.`,
    en_camino_entregar: `Hola ${name}, tu pedido va en camino hacia el destino.`,
    entregado: `Hola ${name}, tu pedido ha sido entregado. ¡Gracias por confiar en nosotros!`
  };
  const fallbackLabel = STATUS_MAP[statusKey]?.label || statusKey;
  return map[statusKey] || `Hola ${name}, tu pedido está en estado: ${fallbackLabel}.`;
}

// Notificación local (colaborador) y fallback
async function showBrowserNotification(order, statusKey) {
  try {
    const title = `Actualización de tu pedido ${order.id}`;
    const body = buildStatusMessage(order, statusKey);
    const icon = '/img/android-chrome-192x192.png';
    const badge = '/img/favicon-32x32.png';
    const data = { url: `/index.html?order=${order.id}` };

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon, badge, data });
      return true;
    }

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, icon, data });
        n.onclick = () => { window.open(`/index.html?order=${order.id}`, '_blank'); };
        return true;
      } else {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          const n = new Notification(title, { body, icon, data });
          n.onclick = () => { window.open(`/index.html?order=${order.id}`, '_blank'); };
          return true;
        }
      }
    }
  } catch (e) {
    console.warn('No se pudo mostrar notificación local:', e);
  }
  return false;
}

// Enviar notificación Web Push al cliente mediante servidor
async function sendPushToClient(order, statusKey) {
  try {
    if (!PUSH_ENDPOINT) return false; // Aún no configurado
    if (!order.pushSubscription) return false; // Cliente no se suscribió
    const payload = {
      subscription: order.pushSubscription,
      notification: {
        title: `Actualización de tu pedido ${order.id}`,
        body: buildStatusMessage(order, statusKey),
        icon: '/img/android-chrome-192x192.png',
        badge: '/img/favicon-32x32.png',
        data: { url: `/index.html?order=${order.id}` }
      }
    };
    const res = await fetch(PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.warn('Error enviando Web Push al cliente:', e);
    return false;
  }
}

// Cambiar estado de la orden (colaborador)
async function changeStatus(orderId, newStatusKey) {
  await handleStatusChange(orderId, newStatusKey);
}

filterAndRender();