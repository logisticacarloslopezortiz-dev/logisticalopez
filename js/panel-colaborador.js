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
    last_collab_status: newKey
  };

  if (newKey === 'entregado') {
    updates.status = 'Completado';
    updates.completed_at = new Date().toISOString();
    updates.completed_by = state.collabSession.user.id;
  }

  try {
  // Agregar evento de tracking (usar campo `tracking` consistente con esquema)
  const existingTracking = Array.isArray(order.tracking) ? order.tracking : [];
  updates.tracking = [...existingTracking, trackingEvent];

    await supabaseConfig.updateOrder(orderId, updates);

    // Actualizar en memoria para reflejar inmediatamente
  const idx = state.allOrders.findIndex(o => Number(o.id) === Number(orderId));
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

    // Notificaciones sólo para el cliente (se quita notificación del panel del colaborador)

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

let activeJobMap = null; // Variable para la instancia del mapa de trabajo activo

function collabDisplayName(email){
  try {
    const base = (email || '').split('@')[0] || 'colaborador';
    return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Colaborador'; }
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

// Decide la acción al hacer clic en una tarjeta: aceptar (pendiente) o mostrar trabajo activo (asignado)
function handleCardClick(orderId) {
  const order = state.allOrders.find(o => o.id === Number(orderId));
  if (!order) return;
  if (!order.assigned_to && order.status === 'Pendiente') {
    openAcceptModal(order);
  } else {
    showActiveJob(order);
    // al mostrar trabajo activo, ocultar tarjetas
    document.getElementById('ordersCardContainer')?.classList.add('hidden');
    document.getElementById('assignedOrdersContainer')?.classList.add('hidden');
  }
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
  // Ocultar contenedores de tarjetas mientras hay trabajo activo visible
  document.getElementById('ordersCardContainer')?.classList.add('hidden');
  document.getElementById('assignedOrdersContainer')?.classList.add('hidden');
  const info = document.getElementById('activeJobInfo');
  // ✅ MEJORA: Diseño de información de trabajo activo más limpio y organizado
  info.innerHTML = /*html*/`
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-800 font-bold font-mono shadow-sm">ID: ${order.id}</span>
        ${order.assigned_to ? `<span class=\"px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800 inline-flex items-center gap-1\"><i data-lucide=\"user\" class=\"w-3 h-3\"></i> ${getCollaboratorName(order.assigned_to)}</span>` : ''}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div class="flex items-start gap-3">
          <i data-lucide="user" class="w-5 h-5 text-gray-500 mt-0.5"></i>
          <div>
            <div class="font-semibold text-gray-800">${order.name}</div>
            <div class="text-gray-600 flex items-center gap-2">
              <a class="text-blue-600 hover:underline" href="tel:${order.phone}">${order.phone}</a>
              <span>•</span>
              <a class="text-blue-600 hover:underline" href="mailto:${order.email}">${order.email}</a>
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
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium"><i data-lucide="map-pin" class="w-3 h-3"></i> Recogida</span>
              <div class="text-gray-800">${order.pickup}</div>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium"><i data-lucide="flag" class="w-3 h-3"></i> Entrega</span>
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
        ${(order.service_questions || order.serviceQuestions) && Object.keys(order.service_questions || order.serviceQuestions).length > 0 ? `
        <div class="sm:col-span-2 border-t pt-4 mt-4">
          <div class="flex items-start gap-3">
            <i data-lucide="clipboard-list" class="w-5 h-5 text-gray-500 mt-0.5"></i>
            <div>
              <div class="font-semibold text-gray-800 mb-2">Detalles Adicionales del Servicio</div>
              <div class="space-y-2 text-sm">
                ${Object.entries(order.service_questions || order.serviceQuestions).map(([key, value]) => `
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
  if (window.lucide) lucide.createIcons(); // Renderizar iconos
  renderPhotoGallery(order.evidence_photos || []); // Renderizar fotos
}

function updateActiveJobView(){
  if (!state.activeJobId) return;
  const order = state.allOrders.find(o => o.id === state.activeJobId);
  if (!order) return;

  // ✅ MEJORA: Actualizar barra de progreso y estado visual
  const statusKey = order.last_collab_status || 'en_camino_recoger';
  const statusLabel = STATUS_MAP[statusKey]?.label || statusKey;
  const badge = document.getElementById('activeJobStatus');
  badge.textContent = statusLabel;

  const progressBar = document.getElementById('jobProgressBar');
  const progressValues = {
    'en_camino_recoger': '25%',
    'cargando': '50%',
    'en_camino_entregar': '75%',
    'entregado': '100%',
    'retraso_tapon': progressBar.style.width // Mantener el progreso actual en caso de retraso
  };
  progressBar.style.width = progressValues[statusKey] || '25%';

  // ✅ MEJORA: Usar Leaflet directamente en lugar de un iframe
  const mapContainer = document.getElementById('activeJobMap');
  const hintEl = document.getElementById('activeJobMapHint');

  // Inicializar mapa si no existe
  if (!activeJobMap) {
    activeJobMap = L.map(mapContainer).setView([18.4861, -69.9312], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(activeJobMap);
  }

  // Limpiar capas anteriores
  activeJobMap.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
      activeJobMap.removeLayer(layer);
    }
  });

  const origin = order.origin_coords;
  const destination = order.destination_coords;
  let targetLatLng, hintText;

  if (statusKey === 'cargando' || statusKey === 'en_camino_entregar' || statusKey === 'entregado') {
    targetLatLng = destination ? [destination.lat, destination.lng] : null;
    hintText = 'Dirígete a la dirección de entrega';
  } else {
    targetLatLng = origin ? [origin.lat, origin.lng] : null;
    hintText = 'Dirígete a la dirección de recogida';
  }

  hintEl.textContent = hintText;

  if (origin && destination) {
    const originLatLng = [origin.lat, origin.lng];
    const destLatLng = [destination.lat, destination.lng];
    L.marker(originLatLng, { title: 'Origen' }).addTo(activeJobMap);
    L.marker(destLatLng, { title: 'Destino' }).addTo(activeJobMap);
    L.polyline([originLatLng, destLatLng], { color: '#2563eb', weight: 4 }).addTo(activeJobMap);
    activeJobMap.fitBounds([originLatLng, destLatLng], { padding: [40, 40] });
  } else if (targetLatLng) {
    L.marker(targetLatLng).addTo(activeJobMap);
    activeJobMap.setView(targetLatLng, 15);
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

// Cache de nombres de colaboradores para evitar mostrar UUIDs
const collabNameCache = new Map();
function getCollaboratorName(userId){
  if (!userId) return '';
  const cached = collabNameCache.get(userId);
  return cached || userId; // Fallback al ID mientras se resuelve el nombre real
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
  const cardsContainer = document.getElementById('ordersCardContainer');
  const assignedContainer = document.getElementById('assignedOrdersContainer');
  if (assignedContainer) assignedContainer.classList.add('hidden'); // unificamos en un solo contenedor

  if (!cardsContainer) return;

  if (state.filteredOrders.length === 0){
    cardsContainer.innerHTML = '<div class="text-center py-6 text-gray-500">Sin solicitudes</div>';
    return;
  }

  try {
    renderMobileCards(state.filteredOrders);
  } catch(err) {
    console.warn('No se pudo renderizar tarjetas móviles:', err);
  }
  if (window.lucide) lucide.createIcons();
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
  let base = state.allOrders.filter(visibleForCollab);
  // Si hay trabajo activo, mostrar solo ese trabajo
  if (state.activeJobId) {
    base = base.filter(o => o.id === state.activeJobId);
  }
  baseVisibleCount = base.length;
  state.filteredOrders = base.filter(o => {
    // ✅ CORRECCIÓN: Convertir el ID a String para evitar errores al buscar.
    const m1 = !term 
      || o.name.toLowerCase().includes(term) 
      || String(o.id).toLowerCase().includes(term)
      || String(o.short_id || '').toLowerCase().includes(term)
      || o.service.toLowerCase().includes(term);
    const currentStatus = o.last_collab_status || o.status;
    const m2 = !statusFilter || statusFilter === currentStatus;
    return m1 && m2;
  });
  render();
  updateCollaboratorStats(state.collabSession.user.id);
}

// === Soporte móvil: tarjetas de solicitudes asignadas ===
function ensureMobileContainer(){
  // El contenedor ya existe en el HTML refactorizado
  return document.getElementById('ordersCardContainer');
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
    const onClickAttr = `onclick="handleCardClick(${o.id})"`;
    return `
      <div class="bg-white rounded-lg shadow p-4 border border-gray-100 cursor-pointer" ${onClickAttr}>
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-gray-900">#${o.id}</div>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${status.badge}">${status.label}</span>
        </div>
        <div class="text-sm text-gray-800 font-medium">${o.name}</div>
        <div class="text-xs text-gray-500 mb-2">${o.phone}</div>
        <div class="text-sm text-gray-700">${o.service}</div>
        <div class="text-xs text-gray-600 truncate" title="${o.pickup} → ${o.delivery}">${o.pickup} → ${o.delivery}</div>
        <div class="text-xs text-gray-600">${o.date} <span class="text-gray-400">•</span> ${o.time}</div>
        ${((o.service_questions && Object.keys(o.service_questions || {}).length > 0) || (o.serviceQuestions && Object.keys(o.serviceQuestions || {}).length > 0)) 
          ? `<div class='mt-3'><button class='px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded w-full' onclick="showServiceDetailsCollab('${o.id}')">Detalles</button></div>`
          : ''}
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

// === Tarjetas de escritorio para órdenes asignadas ===
function renderDesktopAssignedCards(orders){
  // ✅ CORRECCIÓN: Apuntar al nuevo contenedor de tarjetas
  const container = document.getElementById('assignedOrdersContainer');
  if (!container) return;
  const myId = state.collabSession?.user?.id;
  const assigned = (orders || []).filter(o => o.assigned_to === myId && o.status !== 'Completado');
  if (assigned.length === 0){
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = assigned.map(o => {
    const statusKey = o.last_collab_status || (o.status === 'En proceso' ? 'en_camino_recoger' : o.status);
    const status = STATUS_MAP[statusKey] || { label: statusKey, badge: 'bg-gray-100 text-gray-800' };
    // ✅ MEJORA: Diseño de tarjeta mejorado con ID destacado
    return `
      <!-- ✅ MEJORA: Tarjeta flotante y estandarizada que abre el modal al hacer clic -->
      <div class="order-card bg-white rounded-xl shadow-lg border border-gray-200/80 overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 cursor-pointer" 
           onclick="handleCardClick(${o.id})">
        <div class="p-5">
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-3">
              <span class="px-3 py-1.5 text-sm rounded-lg bg-blue-100 text-blue-800 font-bold font-mono shadow-sm">ID: ${o.id}</span>
              <span class="px-2 py-1 text-xs rounded-full ${status.badge}">${status.label}</span>
            </div>
            <i data-lucide="arrow-right" class="w-5 h-5 text-gray-400"></i>
          </div>
          <div class="space-y-3 text-sm">
            <div class="font-semibold text-gray-900 text-base">${o.name} <span class="font-normal text-gray-500">- ${o.phone || ''}</span></div>
            <div class="text-gray-700"><strong class="font-medium">Servicio:</strong> ${o.service}</div>
            <div class="text-gray-600"><strong class="font-medium">Ruta:</strong> <span class="truncate" title="${o.pickup} → ${o.delivery}">${o.pickup} → ${o.delivery}</span></div>
            <div class="text-gray-600"><strong class="font-medium">Fecha:</strong> ${o.date} <span class="text-gray-400">•</span> ${o.time}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.desk-step-btn').forEach(btn => {
    btn.addEventListener('click', () => changeStatus(Number(btn.dataset.id), btn.dataset.next));
  });
  if (window.lucide) lucide.createIcons();
}

// === Toggle de sidebar en móvil (hamburguesa) ===
function setupMobileSidebarToggle(){
  // ✅ MEJORA: Lógica de sidebar móvil con overlay
  const sidebar = document.getElementById('collabSidebar');
  const toggleBtn = document.getElementById('mobileMenuBtn');
  const overlay = document.getElementById('sidebarOverlay');

  if (!sidebar || !toggleBtn || !overlay) return;

  const openSidebar = () => {
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
    overlay.classList.add('opacity-100');
  };

  const closeSidebar = () => {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.remove('opacity-100');
    overlay.classList.add('hidden');
  };

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('-translate-x-full') ? openSidebar() : closeSidebar();
  });

  overlay.addEventListener('click', closeSidebar);
}

// ✅ MEJORA: Lógica para el sidebar plegable en escritorio
function setupDesktopSidebarToggle() {
  const sidebar = document.getElementById('collabSidebar');
  const mainContent = document.getElementById('mainContent');
  const toggleBtn = document.getElementById('desktopSidebarToggle');
  const icon = toggleBtn.querySelector('i');

  if (!sidebar || !mainContent || !toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('-translate-x-full');
    const isHidden = sidebar.classList.contains('-translate-x-full');
    if (isHidden) {
      mainContent.classList.remove('md:ml-72');
      icon.setAttribute('data-lucide', 'panel-right-close');
    } else {
      mainContent.classList.add('md:ml-72');
      icon.setAttribute('data-lucide', 'panel-left-close');
    }
    lucide.createIcons();
    setTimeout(() => activeJobMap?.invalidateSize(), 350); // Redibujar mapa si está activo
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

// Precarga nombres de colaboradores desde perfiles para IDs asignados
async function preloadCollaboratorNames(orders){
  try {
    const ids = [...new Set((orders || []).map(o => o.assigned_to).filter(Boolean))];
    if (ids.length === 0) return;
    const { data, error } = await supabaseConfig.client
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids);
    if (error) {
      console.warn('No se pudieron cargar nombres de colaboradores:', error);
      return;
    }
    (data || []).forEach(p => {
      collabNameCache.set(p.id, p.full_name || p.email || p.id);
    });
  } catch (err) {
    console.warn('Fallo al precargar nombres de colaboradores:', err);
  }
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
    await preloadCollaboratorNames(state.allOrders);
    
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
      const index = state.allOrders.findIndex(o => Number(o.id) === Number(newRecord.id));
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

  // Configurar toggle de sidebar en móvil y escritorio si existen
  try { setupMobileSidebarToggle(); } catch(_) {}
  try { setupDesktopSidebarToggle(); } catch(_) {}

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
      const trackingEvent = { status: 'Servicio Asignado', date: new Date().toISOString() };
      // Normalizar: leer tracking desde cualquiera de las dos propiedades (tracking o tracking_data)
      const existingOrder = state.allOrders.find(o => Number(o.id) === Number(orderId)) || {};
      const existingTracking = Array.isArray(existingOrder.tracking)
        ? existingOrder.tracking
        : (Array.isArray(existingOrder.tracking_data) ? existingOrder.tracking_data : []);

      // Intentar escribir ambos campos para mantener compatibilidad con esquemas antiguos y nuevos.
      const newTracking = [...existingTracking, trackingEvent];
      await supabaseConfig.updateOrder(orderId, {
        status: 'En proceso',
        tracking: newTracking,
        tracking_data: newTracking
      });

      // Actualizar el estado local y mostrar el trabajo activo.
      const idx = state.allOrders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        state.allOrders[idx] = {
          ...state.allOrders[idx],
          assigned_to: myId,
          assigned_at: new Date().toISOString(),
          status: 'En proceso',
          // Actualizar localmente ambos campos para consistencia de lectura
          tracking: newTracking,
          tracking_data: newTracking
        };
        showActiveJob(state.allOrders[idx]);
        // Ocultar otras solicitudes y centrar en el trabajo activo
        state.activeJobId = orderId;
        localStorage.setItem('tlc_collab_active_job', String(orderId));
        filterAndRender();
      }

      showSuccess('¡Solicitud aceptada!', 'El trabajo ahora es tuyo.');

      // Notificar al cliente que su solicitud fue aceptada
      try {
        await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: { orderId, body: 'Tu solicitud ha sido aceptada y está en proceso.' }
        });
      } catch (pushErr) {
        console.warn('Fallo al invocar push server (aceptación):', pushErr);
      }
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

  // Botón cancelar trabajo activo
  const cancelBtn = document.getElementById('cancelActiveJobBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!state.activeJobId) return;
      const order = state.allOrders.find(o => o.id === state.activeJobId);
      if (!order) return;
      const ok = confirm('¿Cancelar este trabajo activo? Esto marcará la solicitud como Cancelado.');
      if (!ok) return;
      try {
        const trackingEvent = { status: 'Trabajo cancelado por colaborador', date: new Date().toISOString() };
        const existingTracking = Array.isArray(order.tracking)
          ? order.tracking
          : (Array.isArray(order.tracking_data) ? order.tracking_data : []);
        const newTracking = [...existingTracking, trackingEvent];

        await supabaseConfig.updateOrder(state.activeJobId, {
          status: 'Cancelado',
          assigned_to: null,
          assigned_at: null,
          tracking: newTracking,
          tracking_data: newTracking
        });
        // Actualizar local
        const idx = state.allOrders.findIndex(o => o.id === state.activeJobId);
        if (idx !== -1) {
          state.allOrders[idx] = {
            ...state.allOrders[idx],
            status: 'Cancelado',
            assigned_to: null,
            assigned_at: null,
            tracking: newTracking,
            tracking_data: newTracking
          };
        }
        // Limpiar trabajo activo y volver a mostrar solicitudes
        state.activeJobId = null;
        localStorage.removeItem('tlc_collab_active_job');
        document.getElementById('activeJobSection')?.classList.add('hidden');
        filterAndRender();
        showSuccess('Trabajo cancelado', 'La solicitud ha sido marcada como cancelada.');
      } catch (err) {
        console.error('Error al cancelar trabajo activo:', err);
        showError('Error al cancelar', err?.message || 'No se pudo cancelar el trabajo.');
      }
    });
  }

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
// --- Modal de Detalles del Servicio (similar a inicio.js) ---
function showServiceDetailsCollab(orderId){
  const order = state.allOrders.find(o => o.id === Number(orderId));
  const details = order && (order.service_questions || order.serviceQuestions);
  if (!order || !details || Object.keys(details).length === 0){
    try { if (window.notifications?.info) window.notifications.info('Esta orden no tiene detalles adicionales de servicio.'); } catch(_){}
    return;
  }

  let detailsHtml = `<h3 class="text-lg font-semibold mb-4 text-gray-800">Detalles del Servicio: ${order.service || 'N/A'}</h3>`;
  detailsHtml += '<div class="space-y-3 text-sm">';
  for (const [question, answer] of Object.entries(details)){
    const formatted = String(question).replace(/_/g,' ').replace(/\b\w/g, l=>l.toUpperCase());
    detailsHtml += `
      <div>
        <p class="font-medium text-gray-600">${formatted}</p>
        <p class="text-gray-900 pl-2">${answer ?? 'No especificado'}</p>
      </div>
    `;
  }
  detailsHtml += '</div>';

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto shadow-xl">
      ${detailsHtml}
      <button onclick="this.closest('.fixed').remove()" class="mt-6 w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// Hacer accesible globalmente
window.showServiceDetailsCollab = showServiceDetailsCollab;