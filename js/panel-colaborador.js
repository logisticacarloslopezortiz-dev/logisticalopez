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

/**
 * Cambia el estado de una orden, actualiza la base de datos y notifica al cliente.
 * @param {number} orderId - El ID de la orden a actualizar.
 * @param {string} newKey - La nueva clave de estado (ej. 'en_camino_recoger').
 */
async function changeStatus(orderId, newKey){
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const trackingEvent = { status: STATUS_MAP[newKey]?.label || newKey, date: new Date().toISOString() };

  const updates = { 
    last_collab_status: newKey,
    tracking: Array.isArray(order.tracking) ? [...order.tracking, trackingEvent] : [trackingEvent]
  };

  if (newKey === 'entregado') {
    updates.status = 'Completado';
    updates.completed_at = new Date().toISOString();
    updates.completed_by = state.collabSession.user.id;
  }

  try {
    await supabaseConfig.updateOrder(orderId, updates);

    // Actualizar en memoria para reflejar inmediatamente
    const idx = state.allOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) state.allOrders[idx] = { ...state.allOrders[idx], ...updates };

    // Notificación push al cliente vía función Edge
    try {
      const bodyMsg = buildStatusMessage(order, newKey);
      await supabaseConfig.client.functions.invoke('send-push-notification', {
        body: { orderId: orderId, body: bodyMsg }
      });
    } catch (pushErr) {
      console.warn('Fallo al invocar push server:', pushErr);
    }

    // Notificación del navegador como refuerzo
    if (order.push_subscription) {
      showBrowserNotification(order, newKey);
    }

    showSuccess('Estado actualizado', STATUS_MAP[newKey]?.label || newKey);
    filterAndRender();

    // Si el estado implica trabajo activo, actualizar la vista
    if (newKey !== 'entregado') {
      updateActiveJobView();
    } else {
      // Limpiar trabajo activo al finalizar
      state.activeJobId = null;
      localStorage.removeItem('tlc_collab_active_job');
      updateActiveJobView();
    }
  } catch (err) {
    showError('No se pudo actualizar el estado', err?.message || err);
  }
}

// ✅ MEJORA: Agrupar variables globales en un objeto de estado para mayor claridad.
const state = {
  allOrders: [],
  filteredOrders: [],
  selectedOrderIdForAccept: null,
  activeJobId: Number(localStorage.getItem('tlc_collab_active_job')) || null,
  collabSession: null,
};

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
  state.selectedOrderIdForAccept = order.id;
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
  state.selectedOrderIdForAccept = null;
}

function showActiveJob(order){
  // Solo mostrar el trabajo activo si está asignado al colaborador actual o si acaba de ser aceptado
  const assignedId = order.assigned_to;
  if (assignedId && assignedId !== state.collabSession.user.id) {
    return; // No mostrar si está asignado a otro colaborador
  }
  
  state.activeJobId = Number(order.id);
  localStorage.setItem('tlc_collab_active_job', state.activeJobId);
  const section = document.getElementById('activeJobSection');
  section.classList.remove('hidden');
  const info = document.getElementById('activeJobInfo');
  info.innerHTML = /*html*/`
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="px-2 py-1 text-xs rounded bg-gray-100 font-mono">ID: ${order.id}</span>
        ${order.assigned_to ? `<span class=\"px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800 inline-flex items-center gap-1\"><i data-lucide=\"user\" class=\"w-3 h-3\"></i> ${order.assigned_to}</span>` : ''}
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
        <!-- Precio oculto para colaboradores -->
        <div class="hidden">
          <i data-lucide="badge-dollar-sign" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">Precio estimado</div>
            <div class="text-green-700 font-bold">${order.estimated_price || 'Por confirmar'}</div>
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
  renderPhotoGallery(order.photos || []);
}

function updateActiveJobView(){
  if (!state.activeJobId) return;
  const order = state.allOrders.find(o => o.id === state.activeJobId);
  if (!order) return;
  const statusKey = order.last_collab_status || 'en_camino_recoger';
  const statusLabel = STATUS_MAP[statusKey]?.label || statusKey;
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

function renderPhotoGallery(photos) {
  const gallery = document.getElementById('photoGallery');
  gallery.innerHTML = '';
  photos.forEach(photoSrc => {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'relative aspect-square bg-gray-100 rounded-lg overflow-hidden';
    imgContainer.innerHTML = `<img src="${photoSrc}" class="w-full h-full object-cover">`;
    gallery.appendChild(imgContainer);
  });
}

/**
 * ✅ REFACTORIZADO: Maneja la subida de fotos a Supabase Storage.
 * @param {Event} event - El evento del input de archivo.
 */
async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file || !state.activeJobId) return;

  const order = state.allOrders.find(o => o.id === state.activeJobId);
  if (!order) return;

  showInfo('Subiendo foto...', 'Por favor, espera un momento.');

  try {
    // 1. Crear un nombre de archivo único para evitar colisiones
    const fileExt = file.name.split('.').pop();
    const fileName = `${state.activeJobId}/${Date.now()}.${fileExt}`;
    const filePath = `public/${fileName}`; // Guardar en una carpeta 'public' dentro del bucket

    // 2. Subir el archivo a Supabase Storage en el bucket 'order-evidence'
    const { error: uploadError } = await supabaseConfig.client.storage
      .from('order-evidence')
      .upload(filePath, file);

    if (uploadError) throw uploadError;

    // 3. Obtener la URL pública del archivo recién subido
    const { data: { publicUrl } } = supabaseConfig.client.storage
      .from('order-evidence')
      .getPublicUrl(filePath);

    // 4. Actualizar la columna 'evidence_photos' (JSONB) en la tabla 'orders'
    const currentPhotos = order.evidence_photos || [];
    const updatedPhotos = [...currentPhotos, publicUrl];
    await supabaseConfig.updateOrder(state.activeJobId, { evidence_photos: updatedPhotos });

    // 5. Actualizar la UI localmente para reflejar el cambio al instante
    order.evidence_photos = updatedPhotos;
    renderPhotoGallery(updatedPhotos);
    showSuccess('Foto subida', 'La evidencia ha sido guardada correctamente.');

  } catch (error) {
    console.error('Error al subir la foto:', error);
    
    let errorMessage = 'No se pudo guardar la foto. Inténtalo de nuevo.';
    
    if (error.message && error.message.includes('Failed to fetch')) {
      errorMessage = 'Error de conexión. Verifica tu conexión a internet e inténtalo de nuevo.';
    } else if (error.message && error.message.includes('413')) {
      errorMessage = 'La imagen es muy grande. Usa una imagen más pequeña.';
    } else if (error.message && error.message.includes('415')) {
      errorMessage = 'Formato de imagen no válido. Usa JPG, PNG, WebP o GIF.';
    } else if (error.message && error.message.includes('storage')) {
      errorMessage = 'Error en el almacenamiento. Inténtalo más tarde.';
    } else if (error.message) {
      errorMessage = `Error: ${error.message}`;
    }
    
    showError('Error de subida', errorMessage);
  }
}

let baseVisibleCount = 0;
function render(){
  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = '';
  document.getElementById('showingCount').textContent = state.filteredOrders.length;
  document.getElementById('totalCount').textContent = baseVisibleCount;

  if (state.filteredOrders.length === 0){
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-gray-500">Sin solicitudes</td></tr>';
    return;
  }

  state.filteredOrders.forEach(o => {
    const statusKey = o.last_collab_status || (o.status === 'En proceso' ? 'en_camino_recoger' : o.status);
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
        ${o.assigned_to ? `<div class="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800"><i data-lucide="user" class="w-3 h-3"></i> ${o.assigned_to}</div>` : ''}
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

    if (o.assigned_to) { tr.className += ' bg-yellow-50'; }
    tbody.appendChild(tr);
    tr.addEventListener('dblclick', () => openAcceptModal(o));

    // Wire buttons
    tr.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', () => changeStatus(o.id, btn.dataset.next));
    });
  });

  if (window.lucide) lucide.createIcons();

  // Renderizado móvil en forma de tarjetas
  try {
    renderMobileCards(state.filteredOrders);
  } catch(err) {
    console.warn('No se pudo renderizar tarjetas móviles:', err);
  }
}

/**
 * Filtra las órdenes según los criterios de búsqueda y estado, y luego las renderiza.
 * Esta función es el punto central para actualizar la vista de la tabla.
 */
function filterAndRender(){
  const term = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const visibleForCollab = (o) => {
    if (!state.collabSession) return false;
    // ✅ CORRECCIÓN: Mostrar solicitudes pendientes (no asignadas) Y las asignadas a este colaborador.
    const isPendingAndUnassigned = o.status === 'Pendiente' && !o.assigned_to;
    const isAssignedToMe = o.assigned_to === state.collabSession.user.id && o.status !== 'Completado';
    return isPendingAndUnassigned || isAssignedToMe;
  };
  const base = state.allOrders.filter(visibleForCollab);
  baseVisibleCount = base.length;
  state.filteredOrders = base.filter(o => {
    // ✅ CORRECCIÓN: Convertir el ID a String para evitar errores al buscar.
    const m1 = !term || o.name.toLowerCase().includes(term) || String(o.id).includes(term) || o.service.toLowerCase().includes(term);
    const currentStatus = o.last_collab_status || o.status;
    const m2 = !statusFilter || statusFilter === currentStatus;
    return m1 && m2;
  });
  render();
  updateCollaboratorStats(state.collabSession.user.id);
}

// === Soporte móvil: tarjetas de solicitudes asignadas ===
function ensureMobileContainer(){
  let container = document.getElementById('ordersCardContainer');
  if (container) return container;
  const tableEl = document.querySelector('table');
  if (!tableEl || !tableEl.parentElement) return null;
  container = document.createElement('div');
  container.id = 'ordersCardContainer';
  container.className = 'md:hidden space-y-4';
  // Insertar el contenedor antes del bloque de tabla
  try {
    tableEl.parentElement.parentElement.insertAdjacentElement('beforebegin', container);
  } catch (_) {
    tableEl.parentElement.insertAdjacentElement('beforebegin', container);
  }
  return container;
}

function renderMobileCards(orders){
  const container = ensureMobileContainer();
  if (!container) return;
  if (!orders || orders.length === 0){
    container.innerHTML = '<div class="text-center py-6 text-gray-500">Sin solicitudes</div>';
    return;
  }
  container.innerHTML = orders.map(o => {
    const statusKey = o.last_collab_status || (o.status === 'En proceso' ? 'en_camino_recoger' : o.status);
    const status = STATUS_MAP[statusKey] || { label: statusKey, badge: 'bg-gray-100 text-gray-800' };
    return `
      <div class="bg-white rounded-lg shadow p-4 border border-gray-100">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-gray-900">#${o.id}</div>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${status.badge}">${status.label}</span>
        </div>
        <div class="text-sm text-gray-800 font-medium">${o.name}</div>
        <div class="text-xs text-gray-500 mb-2">${o.phone}</div>
        <div class="text-sm text-gray-700">${o.service}</div>
        <div class="text-xs text-gray-600 truncate" title="${o.pickup} → ${o.delivery}">${o.pickup} → ${o.delivery}</div>
        <div class="text-xs text-gray-600">${o.date} <span class="text-gray-400">•</span> ${o.time}</div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button data-id="${o.id}" data-next="en_camino_recoger" class="mob-step-btn px-2 py-2 text-xs bg-blue-600 text-white rounded">Recoger</button>
          <button data-id="${o.id}" data-next="cargando" class="mob-step-btn px-2 py-2 text-xs bg-yellow-600 text-white rounded">Cargando</button>
          <button data-id="${o.id}" data-next="en_camino_entregar" class="mob-step-btn px-2 py-2 text-xs bg-indigo-600 text-white rounded">Entregar</button>
          <button data-id="${o.id}" data-next="retraso_tapon" class="mob-step-btn px-2 py-2 text-xs bg-orange-600 text-white rounded">Retraso</button>
          <button data-id="${o.id}" data-next="entregado" class="mob-step-btn col-span-2 px-2 py-2 text-xs bg-green-600 text-white rounded">Finalizar</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.mob-step-btn').forEach(btn => {
    btn.addEventListener('click', () => changeStatus(Number(btn.dataset.id), btn.dataset.next));
  });
  if (window.lucide) lucide.createIcons();
}

// === Toggle de sidebar en móvil (hamburguesa) ===
function setupMobileSidebarToggle(){
  const sidebar = document.getElementById('sidebar') || document.getElementById('collabSidebar');
  const toggleBtn = document.getElementById('mobileSidebarToggle') || document.getElementById('mobileMenuBtn');
  if (!sidebar || !toggleBtn) return;
  // Estado inicial: oculto en móvil
  sidebar.classList.add('md:translate-x-0');
  sidebar.classList.add('-translate-x-full');
  sidebar.classList.add('md:static');
  sidebar.classList.add('fixed');
  sidebar.classList.add('top-0');
  sidebar.classList.add('left-0');
  sidebar.classList.add('h-screen');
  sidebar.classList.add('z-40');
  sidebar.classList.add('transition-transform');
  toggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('-translate-x-full')){
      sidebar.classList.remove('-translate-x-full');
    } else {
      sidebar.classList.add('-translate-x-full');
    }
  });
}

// Funciones para actualizar el sidebar
function updateCollaboratorProfile(session) {
  // ✅ CORRECCIÓN: Usar el nombre completo desde los metadatos del usuario si existe.
  const user = session.user;
  const name = user.user_metadata?.full_name || collabDisplayName(user.email);
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  
  document.getElementById('collabName').textContent = name;
  document.getElementById('collabEmail').textContent = user.email;
  document.getElementById('collabAvatar').textContent = initials;
  
  updateCollaboratorStats(user.id);
}

// Función para cargar órdenes
async function loadInitialOrders() {
  try {
    // Helper para ejecutar la consulta
    const doQuery = async () => {
      return await supabaseConfig.client
        .from('orders')
        .select(`
          *,
          service:services(name),
          vehicle:vehicles(name)
        `)
        .or(`status.eq.Pendiente,and(assigned_to.eq.${state.collabSession.user.id},status.neq.Completado)`)
        .order('created_at', { ascending: false });
    };

    let { data, error } = await doQuery();

    // Detectar token expirado y refrescar sesión, luego reintentar
    if (error && (error.code === 'PGRST303' || /JWT expired/i.test(error.message || '') || error.status === 401)) {
      console.warn('JWT expirado. Intentando refrescar sesión y reintentar...');
      const { data: refreshData, error: refreshError } = await supabaseConfig.client.auth.refreshSession();
      if (refreshError) {
        console.error('Error al refrescar sesión:', refreshError);
        throw new Error(`Sesión expirada. Inicia sesión nuevamente. (${refreshError.message || refreshError.code})`);
      }
      if (refreshData?.session) {
        state.collabSession = refreshData.session;
      }
      ({ data, error } = await doQuery());
    }

    if (error) {
      console.error('Error de Supabase:', error);
      throw new Error(`Error de base de datos: ${error.message || error.code || 'Error desconocido'}`);
    }

    // ✅ CORRECCIÓN: Procesar los datos para asegurar que service y vehicle sean strings
    state.allOrders = (data || []).map(order => ({
      ...order,
      service: order.service?.name || order.service || 'Sin servicio',
      vehicle: order.vehicle?.name || order.vehicle || 'Sin vehículo'
    }));
    
    filterAndRender();
  } catch (error) {
    console.error('Error al cargar órdenes iniciales:', error);
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    showError('Error de Carga', `No se pudieron cargar las solicitudes: ${errorMsg}`);
    state.allOrders = [];
  }
}

function updateCollaboratorStats(collaboratorId) {
  const collaboratorOrders = state.allOrders.filter(order => order.assigned_to === collaboratorId);
  
  const activeJobs = collaboratorOrders.filter(order => order.status === 'En proceso').length;
  const completedJobs = collaboratorOrders.filter(order => order.status === 'Completado').length;
  
  const pendingRequests = state.allOrders.filter(order => order.status === 'Pendiente' && !order.assigned_to).length;
  
  document.getElementById('collabActiveJobs').textContent = activeJobs;
  document.getElementById('collabCompletedJobs').textContent = completedJobs;
  document.getElementById('pendingRequestsCount').textContent = pendingRequests;
}

// --- Lógica de Tiempo Real ---
function handleRealtimeUpdate(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  switch (eventType) {
    case 'INSERT':
      // Añadir si es una nueva orden pendiente
      if (newRecord.status === 'Pendiente') {
        state.allOrders.unshift(newRecord);
      }
      break;
    case 'UPDATE':
      // ✅ CORRECCIÓN: Comparar IDs como números para evitar inconsistencias.
      const index = state.allOrders.findIndex(o => o.id === newRecord.id);
      if (index !== -1) {
        state.allOrders[index] = { ...state.allOrders[index], ...newRecord };
      } else {
        // Si no estaba, es una orden que ahora es relevante (ej. asignada)
        state.allOrders.unshift(newRecord);
      }
      break;
    case 'DELETE':
      state.allOrders = state.allOrders.filter(o => o.id !== oldRecord.id);
      break;
  }
  filterAndRender();
  // ✅ CORRECCIÓN: Actualizar la vista del trabajo activo si cambia en tiempo real.
  if (state.activeJobId && payload.new?.id === state.activeJobId) {
    showActiveJob(payload.new);
    // ✅ CORRECIÓN: Actualizar el mapa si el estado cambia.
    updateActiveJobView();
  }
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  // ✅ CORRECCIÓN: Usar el método oficial de Supabase para verificar la sesión
  const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();

  if (sessionError || !session) {
    const msg = 'No hay sesión de colaborador activa. Redirigiendo al login.';
    console.error(msg);
    if (window.showError) {
      try { window.showError('Sesión requerida', msg); } catch (_) {}
    }
    setTimeout(() => { window.location.href = 'login-colaborador.html'; }, 400);
    return;
  }
  
  state.collabSession = session;

  // Configurar toggle de sidebar en móvil si existe
  try { setupMobileSidebarToggle(); } catch(_) {}

  // Suscribirse a cambios de auth para mantener sesión fresca
  supabaseConfig.client.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) {
      state.collabSession = newSession;
    }
  });
    
  // Actualizar perfil del colaborador
  updateCollaboratorProfile(session);

  document.getElementById('searchInput').addEventListener('input', filterAndRender);
  document.getElementById('statusFilter').addEventListener('change', filterAndRender);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    filterAndRender();
  });

  document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault();
    // ✅ CORRECCIÓN: Usar el método oficial de Supabase para cerrar sesión
    supabaseConfig.client.auth.signOut();
    window.location.href = 'login-colaborador.html';
  });

  // Modal aceptar trabajo
  document.getElementById('cancelAcceptBtn').addEventListener('click', (e) => {
    e.preventDefault();
    closeAcceptModal();
  });
  // ✅ CORRECCIÓN: Conectar el input de subida de fotos a su función.
  document.getElementById('photoUpload').addEventListener('change', handlePhotoUpload);

  document.getElementById('confirmAcceptBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!state.selectedOrderIdForAccept) { closeAcceptModal(); return; }

    const orderId = state.selectedOrderIdForAccept;
    const myId = state.collabSession.user.id;

    try {
      // Paso 1: Reclamar la orden (solo asignar)
      await supabaseConfig.updateOrder(orderId, {
        assigned_to: myId,
        assigned_at: new Date().toISOString()
      });

      // Paso 2: Actualizar estado (removido last_collab_status por no existir en la BD)
      await supabaseConfig.updateOrder(orderId, {
        status: 'En proceso'
      });

      // Actualizar el estado local y mostrar el trabajo activo.
      const idx = state.allOrders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        state.allOrders[idx] = {
          ...state.allOrders[idx],
          assigned_to: myId,
          assigned_at: new Date().toISOString(),
          status: 'En proceso'
        };
        showActiveJob(state.allOrders[idx]);
      }

      showSuccess('¡Solicitud aceptada!', 'El trabajo ahora es tuyo.');
    } catch (err) {
      console.error('Error al aceptar la solicitud:', err);
      
      // Logging detallado para depuración
      console.log('=== ERROR DETAILS ===');
      console.log('Error type:', typeof err);
      console.log('Error constructor:', err?.constructor?.name);
      console.log('Error keys:', err ? Object.keys(err) : 'null');
      
      try {
        console.log('Error JSON:', JSON.stringify(err, null, 2));
      } catch (jsonErr) {
        console.log('Cannot stringify error:', jsonErr.message);
      }
      
      let msg = 'Error desconocido';
      
      // Manejo específico para errores de Supabase
      if (err && typeof err === 'object') {
        // Intentar diferentes propiedades del error
        const possibleMessages = [
          err.message,
          err.error,
          err.details,
          err.hint,
          err.code,
          err.statusText
        ].filter(Boolean);
        
        if (possibleMessages.length > 0) {
          msg = possibleMessages.join(' - ');
        } else {
          // Último recurso: mostrar todas las propiedades
          const props = Object.entries(err)
            .filter(([key, value]) => value != null)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
          msg = props || 'Error sin detalles disponibles';
        }
      } else {
        msg = String(err);
      }
      
      console.log('Final error message:', msg);
      console.log('Order ID:', orderId);
      console.log('User ID:', myId);
      console.log('=== END ERROR DETAILS ===');
      
      showError('Error al aceptar la solicitud', msg);
    } finally {
      closeAcceptModal();
      filterAndRender();
    }
  });

  // Carga inicial y suscripción a tiempo real
  await loadInitialOrders();

  // ✅ CORRECCIÓN: Mover la lógica para restaurar el trabajo activo a DESPUÉS de cargar los pedidos.
  restoreActiveJob();

  if (supabaseConfig.client && !supabaseConfig.useLocalStorage) {
    supabaseConfig.client
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
      .subscribe();
  } else {
    // Fallback: refrescar periódicamente desde localStorage
    setInterval(async () => {
      // En modo Supabase, el refresco es manejado por el listener de tiempo real.
      // Si se quiere un refresco forzado, se llamaría a loadInitialOrders() de nuevo.
      filterAndRender();
    }, 5000);
  }
});

/**
 * ✅ NUEVA FUNCIÓN: Busca y muestra el trabajo activo guardado en localStorage
 * o encuentra el primer trabajo activo asignado al colaborador.
 */
function restoreActiveJob() {
  if (state.activeJobId) {
    const order = state.allOrders.find(o => o.id === state.activeJobId);
    const assignedId = order?.assigned_to;
    const lastStatus = order?.last_collab_status;
    
    if (order && assignedId === state.collabSession.user.id && lastStatus !== 'entregado') {
      showActiveJob(order);
      return; // Salir si se encontró un trabajo activo válido
    }
  }

  // Si no hay un trabajo activo guardado o es inválido, buscar uno nuevo.
  state.activeJobId = null;
  localStorage.removeItem('tlc_collab_active_job');
  document.getElementById('activeJobSection').classList.add('hidden');
}

// Helper para construir el mensaje de notificación según estado
function buildStatusMessage(order, statusKey) {
  const map = {
    en_camino_recoger: `Tu pedido #${order.id} está en camino a recoger.`,
    cargando: `Estamos cargando tu pedido #${order.id}.`,
    en_camino_entregar: `Tu pedido #${order.id} va en camino a entregar.`,
    retraso_tapon: `Tu pedido #${order.id} tiene retraso por tapón.`,
    entregado: `Tu pedido #${order.id} fue entregado. ¡Gracias!`
  };
  return map[statusKey] || `Actualización del pedido #${order.id}: ${STATUS_MAP[statusKey]?.label || statusKey}`;
}