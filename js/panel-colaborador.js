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

/**
 * Inicializa y configura el mapa para mostrar origen y destino
 * @param {Object} order - Datos de la orden
 */
function initializeMap(order) {
  try {
    console.log('[Mapa] Inicializando mapa para orden:', order.id);
    
    // Limpiar mapa anterior si existe
    if (window.activeJobMap) {
      window.activeJobMap.remove();
    }
    
    // Verificar que existan coordenadas
    if (!order.pickup_coords || !order.delivery_coords) {
      console.error('[Mapa] Error: Faltan coordenadas de origen o destino');
      document.getElementById('mapErrorMessage').classList.remove('hidden');
      return;
    }
    
    // Ocultar mensaje de error si estaba visible
    document.getElementById('mapErrorMessage').classList.add('hidden');
    
    // Parsear coordenadas
    const pickupCoords = parseCoordinates(order.pickup_coords);
    const deliveryCoords = parseCoordinates(order.delivery_coords);
    
    if (!pickupCoords || !deliveryCoords) {
      console.error('[Mapa] Error: Formato de coordenadas inválido');
      document.getElementById('mapErrorMessage').classList.remove('hidden');
      return;
    }
    
    // Inicializar mapa centrado entre origen y destino
    const centerLat = (pickupCoords.lat + deliveryCoords.lat) / 2;
    const centerLng = (pickupCoords.lng + deliveryCoords.lng) / 2;
    
    const map = L.map('activeJobMap').setView([centerLat, centerLng], 13);
    
    // Añadir capa de mapa
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Añadir marcadores
    const pickupMarker = L.marker([pickupCoords.lat, pickupCoords.lng], {
      icon: createCustomIcon('green', 'A')
    }).addTo(map);
    pickupMarker.bindPopup('<strong>Origen:</strong> ' + order.pickup_address).openPopup();
    
    const deliveryMarker = L.marker([deliveryCoords.lat, deliveryCoords.lng], {
      icon: createCustomIcon('red', 'B')
    }).addTo(map);
    deliveryMarker.bindPopup('<strong>Destino:</strong> ' + order.delivery_address);
    
    // Dibujar ruta entre puntos
    const points = [
      [pickupCoords.lat, pickupCoords.lng],
      [deliveryCoords.lat, deliveryCoords.lng]
    ];
    
    const polyline = L.polyline(points, {color: 'blue', weight: 5, opacity: 0.7}).addTo(map);
    
    // Ajustar vista para mostrar toda la ruta
    map.fitBounds(polyline.getBounds(), {padding: [50, 50]});
    
    // Guardar referencia al mapa
    window.activeJobMap = map;
    
    console.log('[Mapa] Mapa inicializado correctamente');
  } catch (err) {
    console.error('[Mapa] Error al inicializar mapa:', err);
    document.getElementById('mapErrorMessage').classList.remove('hidden');
  }
}

/**
 * Parsea string de coordenadas a objeto {lat, lng}
 * @param {string} coordsString - String de coordenadas (formato: "lat,lng" o [lat,lng])
 * @returns {Object|null} - Objeto con lat y lng o null si es inválido
 */
function parseCoordinates(coordsString) {
  try {
    if (!coordsString) return null;
    
    // Intentar parsear diferentes formatos
    let coords;
    
    // Si es un string, intentar separar por coma
    if (typeof coordsString === 'string') {
      // Limpiar posibles corchetes
      const cleaned = coordsString.replace(/[\[\]]/g, '');
      coords = cleaned.split(',').map(c => parseFloat(c.trim()));
    } 
    // Si es un array, usarlo directamente
    else if (Array.isArray(coordsString)) {
      coords = coordsString.map(c => parseFloat(c));
    }
    // Si es un objeto con lat y lng
    else if (coordsString.lat !== undefined && coordsString.lng !== undefined) {
      return {
        lat: parseFloat(coordsString.lat),
        lng: parseFloat(coordsString.lng)
      };
    }
    
    // Validar que sean dos números
    if (coords && coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      return {
        lat: coords[0],
        lng: coords[1]
      };
    }
    
    return null;
  } catch (err) {
    console.error('[Mapa] Error al parsear coordenadas:', err);
    return null;
  }
}

/**
 * Crea un icono personalizado para el mapa
 * @param {string} color - Color del icono
 * @param {string} text - Texto a mostrar
 * @returns {L.DivIcon} - Icono personalizado
 */
function createCustomIcon(color, text) {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<div style="background-color: ${color}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; font-weight: bold;">${text}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

/**
 * Guarda métricas de finalización en localStorage
 * @param {Object} metrics - Datos de métricas
 * @param {number} orderId - ID de la orden
 */
function saveCompletionMetrics(metrics, orderId) {
  try {
    // Obtener métricas existentes o inicializar
    const existingMetrics = JSON.parse(localStorage.getItem('tlc_completion_metrics') || '[]');
    
    // Agregar nueva métrica
    existingMetrics.push({
      ...metrics,
      order_id: orderId,
      timestamp: new Date().toISOString()
    });
    
    // Guardar en localStorage
    localStorage.setItem('tlc_completion_metrics', JSON.stringify(existingMetrics));
    
    // Enviar a Supabase si está disponible
    if (window.supabase) {
      supabase.from('completion_metrics').insert([{
        order_id: orderId,
        colaborador_id: metrics.colaborador_id,
        tiempo_total_minutos: metrics.tiempo_total,
        fecha_completado: metrics.fecha_completado
      }]).then(res => {
        if (res.error) console.error('[Métricas] Error al guardar en Supabase:', res.error);
        else console.log('[Métricas] Guardadas en Supabase correctamente');
      });
    }
  } catch (err) {
    console.error('[Métricas] Error al guardar métricas:', err);
  }
}

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
 * Función para calcular el tiempo total que tomó completar una orden
 * @param {number} orderId - ID de la orden
 * @returns {number} - Tiempo en minutos
 */
function calculateTotalTime(orderId) {
  try {
    const order = state.allOrders.find(o => o.id === orderId);
    if (!order || !order.tracking_data || order.tracking_data.length < 2) return 0;
    
    // Buscar el primer estado de tracking
    const firstStatus = order.tracking_data[0];
    const startTime = new Date(firstStatus.date).getTime();
    const endTime = new Date().getTime();
    
    // Retornar tiempo en minutos
    return Math.round((endTime - startTime) / 60000);
  } catch (err) {
    console.error('[Métricas] Error al calcular tiempo:', err);
    return 0;
  }
}

/**
 * Función para guardar métricas de finalización
 * @param {Object} metrics - Métricas a guardar
 * @param {number} orderId - ID de la orden
 */
function saveCompletionMetrics(metrics, orderId) {
  try {
    // Guardar en localStorage para análisis local
    const key = `tlc_metrics_order_${orderId}`;
    localStorage.setItem(key, JSON.stringify(metrics));
    
    // Opcionalmente enviar a Supabase para análisis centralizado
    // TODO: Implementar endpoint para guardar métricas
  } catch (err) {
    console.error('[Métricas] Error al guardar:', err);
  }
}

/**
 * Función para enviar notificación al cliente sobre cambio de estado
 * @param {number} orderId - ID de la orden
 * @param {string} status - Nuevo estado
 */
function notifyClient(orderId, status) {
  try {
    const order = state.allOrders.find(o => o.id === orderId);
    if (!order) return;
    
    // Enviar notificación push si hay un token registrado
    if (order.client_notification_token) {
      console.log(`[Notificaciones] Enviando notificación push al cliente para orden #${orderId}`);
      
      // Usar la función de notificación del navegador como fallback
      showBrowserNotification(
        `Actualización de tu servicio #${orderId}`,
        `Tu servicio ha sido actualizado a: ${STATUS_MAP[status]?.label || status}`
      );
    }
  } catch (err) {
    console.error('[Notificaciones] Error al notificar al cliente:', err);
  }
}

/**
 * Cambia el estado de una orden, actualiza la base de datos y notifica al cliente.
 * @param {number} orderId - El ID de la orden a actualizar.
 * @param {string} newKey - La nueva clave de estado (ej. 'en_camino_recoger').
 */
async function changeStatus(orderId, newKey) {
  // COMENTARIO: Esta función ahora actúa como un intermediario (wrapper) hacia el OrderManager.
  console.log(`[Colaborador] Solicitando cambio de estado para orden #${orderId} a "${newKey}"`);
  const additionalData = {};
  const startTime = performance.now(); // Medición de rendimiento

  // Si el colaborador marca como 'entregado', esto se traduce a 'Completado' en el estado general.
  if (newKey === 'entregado') {
    additionalData.status = 'Completado';
    additionalData.completed_at = new Date().toISOString();
    additionalData.completed_by = state.collabSession.user.id;
    /**
     * Calcula el tiempo total que tomó completar una orden
     * @param {number} orderId - ID de la orden
     * @returns {number} - Tiempo en minutos
     */
    function calculateTotalTime(orderId) {
      try {
        const order = state.allOrders.find(o => o.id === orderId);
        if (!order || !order.tracking_data || order.tracking_data.length < 2) return 0;
        
        // Buscar el primer estado de tracking
        const firstStatus = order.tracking_data[0];
        const startTime = new Date(firstStatus.date).getTime();
        const endTime = new Date().getTime();
        
        // Retornar tiempo en minutos
        return Math.round((endTime - startTime) / 60000);
      } catch (err) {
        console.error('[Métricas] Error al calcular tiempo:', err);
        return 0;
      }
    }

    // Registrar métricas de finalización
    try {
      const metrics = {
        colaborador_id: state.collabSession.user.id,
        tiempo_total: calculateTotalTime(orderId),
        fecha_completado: new Date().toISOString()
      };
      console.log('[Métricas] Registrando finalización:', metrics);
      // Guardar métricas en localStorage para análisis
      saveCompletionMetrics(metrics, orderId);
    } catch (err) {
      console.error('[Métricas] Error al registrar:', err);
    }
  } else if (newKey === 'en_camino_recoger' || newKey === 'cargando' || newKey === 'en_camino_entregar') {
    // Cuando el colaborador inicia el trabajo, actualizar el estado global a "En proceso"
    additionalData.status = 'En proceso';
  }

  // Dentro de la función changeStatus, justo después de la llamada a OrderManager
  const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, newKey, additionalData);

  if (success) {
    // Notificar al cliente sobre el cambio de estado
    notifyClient(orderId, newKey);
    
    // Actualizar localmente el último estado del colaborador y el tracking
    const idx = state.allOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      const prev = state.allOrders[idx];
      const prevTracking = Array.isArray(prev.tracking_data) ? prev.tracking_data : [];
      state.allOrders[idx] = {
        ...prev,
        last_collab_status: newKey,
        tracking_data: [...prevTracking, { status: newKey, date: new Date().toISOString() }]
      };
    }
    updateActiveJobView();
    
    // Si el trabajo se completó, invocar la función para incrementar el contador
    if (newKey === 'entregado') {
      try {
        await supabaseConfig.client.functions.invoke('increment-completed-jobs', {
          body: { userId: state.collabSession.user.id }
        });
        
        // Registrar métricas de finalización
        try {
          const metrics = {
            colaborador_id: state.collabSession.user.id,
            tiempo_total: calculateTotalTime(orderId),
            fecha_completado: new Date().toISOString()
          };
          console.log('[Métricas] Registrando finalización:', metrics);
          saveCompletionMetrics(metrics, orderId);
        } catch (err) {
          console.error('[Métricas] Error al registrar métricas:', err);
        }
      } catch (invokeErr) {
        console.warn('No se pudo incrementar el contador de trabajos completados:', invokeErr);
      }
    
      // Limpiar el trabajo activo de la vista
      state.activeJobId = null;
      localStorage.removeItem('tlc_collab_active_job');
      document.getElementById('activeJobSection').classList.add('hidden');
      
      // Mostrar mensaje de éxito
      showSuccess('¡Trabajo finalizado con éxito!', 'La solicitud ha sido marcada como completada y enviada al historial.');
      
      // Redirigir a historial-solicitudes.html después de 1.5 segundos
      setTimeout(() => {
        window.location.href = 'historial-solicitudes.html?completed=' + orderId;
      }, 1500);
    }

    showSuccess('Estado actualizado', STATUS_MAP[newKey]?.label || newKey);
    // Forzar una recarga de datos para asegurar sincronización completa.
    await loadInitialOrders();

  } else {
    showError('No se pudo actualizar el estado', error);
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
  if (badge) badge.textContent = statusLabel;
  // Proteger acceso a `jobProgressBar` (puede no existir en el DOM).
  const progressBar = document.getElementById('jobProgressBar');
  const currentWidth = progressBar && progressBar.style && progressBar.style.width ? progressBar.style.width : '25%';
  const progressValues = {
    'en_camino_recoger': '25%',
    'cargando': '50%',
    'en_camino_entregar': '75%',
    'entregado': '100%',
    'retraso_tapon': currentWidth // Mantener el progreso actual en caso de retraso
  };
  if (progressBar && progressBar.style) {
    progressBar.style.width = progressValues[statusKey] || '25%';
  }

  // ✅ MEJORA: Usar Leaflet directamente en lugar de un iframe
  const mapContainer = document.getElementById('activeJobMap');
  const hintEl = document.getElementById('activeJobMapHint');

  // Use Google Maps helpers defined in the HTML (initActiveJobMap / updateActiveJobMap)
  const origin = order.origin_coords;
  const destination = order.destination_coords;
  let targetLatLng, hintText;

  if (statusKey === 'cargando' || statusKey === 'en_camino_entregar' || statusKey === 'entregado') {
    targetLatLng = destination ? { lat: destination.lat, lng: destination.lng } : null;
    hintText = 'Dirígete a la dirección de entrega';
  } else {
    targetLatLng = origin ? { lat: origin.lat, lng: origin.lng } : null;
    hintText = 'Dirígete a la dirección de recogida';
  }

  hintEl.textContent = hintText;

  try {
    if (typeof updateActiveJobMap === 'function') {
      updateActiveJobMap(origin, destination, targetLatLng);
    } else {
      // If Google Maps helpers aren't available, fall back gracefully.
      console.warn('Google Maps helpers not available; map will not update.');
    }
  } catch (e) {
    console.warn('Failed to update active job map:', e);
  }
}

function renderPhotoGallery(photos) {
  const gallery = document.getElementById('photoGallery');
  if (!gallery) return;
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
  // Note: 'assignedOrdersContainer' was removed from the HTML. All cards render into ordersCardContainer.

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
  // Búsqueda y filtrado deshabilitados en este panel para evitar problemas de layout.
  const term = '';
  const statusFilter = '';
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

// === Lógica Unificada del Sidebar (Móvil y Escritorio) ===
function setupSidebarToggles() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCollapseBtn');
    const desktopOpenBtn = document.getElementById('desktopMenuBtn');
    const overlay = document.getElementById('sidebarOverlay');
    const body = document.body;

    if (!mobileMenuBtn || !sidebarCloseBtn || !desktopOpenBtn || !overlay) {
        console.error("One or more sidebar control elements are missing.");
        return;
    }

    const updateUI = () => {
        const isDesktop = window.innerWidth >= 768;

        // Manage state transitions on resize
        if (isDesktop) {
            body.classList.remove('sidebar-mobile-open');
            // Default to open sidebar on desktop if no state is set
            if (!body.classList.contains('sidebar-desktop-open') && !body.classList.contains('sidebar-desktop-closed')) {
                body.classList.add('sidebar-desktop-open');
            }
        }

        // Centralize the logic for the desktop "open" button's visibility
        const isSidebarClosed = body.classList.contains('sidebar-desktop-closed');
        if (isDesktop && isSidebarClosed) {
            desktopOpenBtn.classList.remove('hidden');
        } else {
            desktopOpenBtn.classList.add('hidden');
        }
    };

    // --- Event Listeners only modify state, then call updateUI ---

    // Open sidebar on mobile
    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        body.classList.add('sidebar-mobile-open');
        // No UI update needed here as it only affects mobile overlay
    });

    // Close sidebar with the button inside it (works for both views)
    sidebarCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.innerWidth >= 768) { // isDesktop
            body.classList.remove('sidebar-desktop-open');
            body.classList.add('sidebar-desktop-closed');
        } else {
            body.classList.remove('sidebar-mobile-open');
        }
        updateUI(); // Update UI based on new state
    });

    // Close sidebar on mobile via overlay
    overlay.addEventListener('click', () => {
        body.classList.remove('sidebar-mobile-open');
    });

    // Re-open sidebar on desktop
    desktopOpenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        body.classList.remove('sidebar-desktop-closed');
        body.classList.add('sidebar-desktop-open');
        updateUI(); // Update UI based on new state
    });

    // --- Initialization ---
    window.addEventListener('resize', updateUI);
    updateUI(); // Set initial state on page load
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

  // ✅ CORRECCIÓN: Guardar el nombre del colaborador actual en la caché para mostrarlo en el trabajo activo.
  collabNameCache.set(user.id, name);
  
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
    // y derivar last_collab_status desde tracking/tracking_data si no existe
    const deriveLastStatus = (order) => {
      const track = Array.isArray(order.tracking_data) ? order.tracking_data
        : (Array.isArray(order.tracking) ? order.tracking : []);
      const keys = Object.keys(STATUS_MAP);
      for (let i = track.length - 1; i >= 0; i--) {
        const s = track[i]?.status;
        if (s && keys.includes(s)) return s;
      }
      if (order.status === 'En proceso' && order.assigned_to) return 'en_camino_recoger';
      return undefined;
    };

    state.allOrders = (data || []).map(order => ({
      ...order,
      service: order.service?.name || order.service || 'Sin servicio',
      vehicle: order.vehicle?.name || order.vehicle || 'Sin vehículo',
      last_collab_status: order.last_collab_status || deriveLastStatus(order)
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

  // Render icons as soon as the DOM is ready to prevent issues with icon-based buttons.
  if (window.lucide) {
    try {
      lucide.createIcons();
    } catch (e) {
      console.error('Error creating lucide icons on initial load:', e);
    }
  }

  // Configurar la lógica del sidebar unificado
  try {
    setupSidebarToggles();
  } catch(e) {
    console.error('Error al inicializar el sidebar:', e);
  }

  // Suscribirse a cambios de auth para mantener sesión fresca
  supabaseConfig.client.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) {
      state.collabSession = newSession;
    }
  });
    
  // Actualizar perfil del colaborador
  updateCollaboratorProfile(session);

  // Search and status filter removed for this panel. Listeners intentionally omitted.

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

  // ✅ NUEVO: Conectar los botones de acción del trabajo activo.
  const actionButtonsContainer = document.getElementById('activeJobActionButtons');
  if (actionButtonsContainer) {
    actionButtonsContainer.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (button && button.dataset.status) {
        const newStatus = button.dataset.status;
        if (state.activeJobId) {
          changeStatus(state.activeJobId, newStatus);
        } else {
          showError('Error', 'No hay un trabajo activo seleccionado.');
        }
      }
    });
  }

  document.getElementById('confirmAcceptBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!state.selectedOrderIdForAccept) {
      closeAcceptModal();
      return;
    }

    const orderId = state.selectedOrderIdForAccept;
    const myId = state.collabSession.user.id;

    // COMENTARIO: Se centraliza la lógica de aceptación usando OrderManager.
    console.log(`[Colaborador] Aceptando orden #${orderId}`);

    const additionalData = {
      assigned_to: myId,
      assigned_at: new Date().toISOString(),
      status: 'En proceso' // Al aceptar, el estado general cambia a 'En proceso'.
    };

    // La función centralizada se encarga de actualizar el tracking y notificar.
    const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, 'en_camino_recoger', additionalData);

    if (success) {
      showSuccess('¡Solicitud aceptada!', 'El trabajo ahora es tuyo.');
      
      // Guardar como trabajo activo y forzar recarga.
      state.activeJobId = orderId;
      localStorage.setItem('tlc_collab_active_job', String(orderId));
      await loadInitialOrders();
      const order = state.allOrders.find(o => o.id === orderId);
      if (order) {
        showActiveJob(order);
      }

    } else {
      showError('Error al aceptar la solicitud', error);
    }

    closeAcceptModal();
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