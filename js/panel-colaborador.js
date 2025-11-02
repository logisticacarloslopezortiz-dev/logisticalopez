(async () => {
  "use strict";

  // Envoltura de seguridad: verificar la sesión al inicio.
  const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
  if (sessionError || !session) {
    console.warn('Sesión no encontrada, redirigiendo al login.');
    window.location.href = 'login-colaborador.html';
    return; // Detener la ejecución si no hay sesión.
  }

  const OrderManager = {
    async acceptOrder(orderId, collaboratorId) {
      try {
        const { error } = await supabaseConfig.client.rpc('accept_order', {
          order_id_param: orderId
        });
        if (error) throw error;
        return { success: true, error: null };
      } catch (err) {
        console.error('Error en OrderManager.acceptOrder:', JSON.stringify(err, null, 2));
        return { success: false, error: err.message };
      }
    },
    async cancelActiveJob(orderId) {
      try {
        const { error } = await supabaseConfig.client
          .from('orders')
          .update({ status: 'Cancelado' })
          .eq('id', orderId);
        if (error) throw error;
        return { success: true, error: null };
      } catch (err) {
        console.error('Error en OrderManager.cancelActiveJob:', JSON.stringify(err, null, 2));
        return { success: false, error: err.message };
      }
    },
    async actualizarEstadoPedido(orderId, newKey, additionalData = {}) {
      try {
        const updatePayload = { ...additionalData, last_collab_status: newKey };
        const { error } = await supabaseConfig.client
          .from('orders')
          .update(updatePayload)
          .eq('id', orderId);
        if (error) throw error;
        return { success: true, error: null };
      } catch (err) {
        console.error('Error en OrderManager.actualizarEstadoPedido:', JSON.stringify(err, null, 2));
        return { success: false, error: err.message };
      }
    }
  };

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
    if (state.activeJobMap) {
      state.activeJobMap.remove();
    }
    
    // Verificar que existan coordenadas
    if (!order.pickup_coords || !order.delivery_coords) {
      console.error('[Mapa] Error: Faltan coordenadas de origen o destino');
      // El elemento mapErrorMessage no existe, se elimina la referencia para evitar errores.
      return;
    }
    
    // Parsear coordenadas
    const pickupCoords = parseCoordinates(order.pickup_coords);
    const deliveryCoords = parseCoordinates(order.delivery_coords);
    
    if (!pickupCoords || !deliveryCoords) {
      console.error('[Mapa] Error: Formato de coordenadas inválido');
      // El elemento mapErrorMessage no existe, se elimina la referencia para evitar errores.
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
    state.activeJobMap = map;
    
    console.log('[Mapa] Mapa inicializado correctamente');
  } catch (err) {
    console.error('[Mapa] Error al inicializar mapa:', err);
    // El elemento mapErrorMessage no existe, se elimina la referencia para evitar errores.
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
 * Función para guardar métricas de finalización
 * @param {Object} metrics - Métricas a guardar
 * @param {number} orderId - ID de la orden
 */
function saveCompletionMetrics(metrics, orderId) {
  try {
    // Guardar métricas individuales de la orden
    const key = `tlc_metrics_order_${orderId}`;
    localStorage.setItem(key, JSON.stringify(metrics));

    // Actualizar métricas agregadas del colaborador
    const collaboratorEmail = state.collabSession?.user?.email;
    if (collaboratorEmail) {
      const metricsKey = 'tlc_collab_metrics';
      const existingMetrics = JSON.parse(localStorage.getItem(metricsKey) || '{}');

      if (!existingMetrics[collaboratorEmail]) {
        existingMetrics[collaboratorEmail] = {
          completedOrders: 0,
          totalTime: 0,
          serviceTypes: {}
        };
      }

      const collabMetrics = existingMetrics[collaboratorEmail];
      collabMetrics.completedOrders += 1;
      collabMetrics.totalTime += metrics.tiempo_total || 0;

      // Actualizar estadísticas por tipo de servicio
      const order = state.allOrders.find(o => o.id === orderId);
      if (order && order.servicio) {
        const serviceType = order.servicio;
        collabMetrics.serviceTypes[serviceType] = (collabMetrics.serviceTypes[serviceType] || 0) + 1;
      }

      localStorage.setItem(metricsKey, JSON.stringify(existingMetrics));
      console.log('[Métricas] Métricas del colaborador actualizadas:', collabMetrics);
    }

    // Enviar a Supabase usando la instancia consistente del config
    if (supabaseConfig.client) {
      supabaseConfig.client.from('completion_metrics').insert([{
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
    console.error('[Métricas] Error al guardar:', err);
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
 * Función para enviar notificación al cliente sobre cambio de estado
 * @param {number} orderId - ID de la orden
 * @param {string} status - Nuevo estado
 */
async function notifyClient(orderId, status) {
  try {
    const order = state.allOrders.find(o => o.id === orderId);
    if (!order) {
      console.warn(`[Notificaciones] No se encontró la orden #${orderId} para notificar`);
      return false;
    }

    console.log(`[Notificaciones] Procesando notificación para orden #${orderId}, estado: ${status}`);

    // 1) Intentar enviar notificación push mediante Edge Function
    if (supabaseConfig.client) {
      try {
        const title = `Actualización de tu servicio #${orderId}`;
        const body = `Tu servicio ha sido actualizado a: ${STATUS_MAP[status]?.label || status}`;

        const { data, error } = await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: { orderId, title, body, target: 'client' }
        });

        if (error) throw new Error(`Error en Edge Function: ${error.message}`);
        console.log('[Notificaciones] Push enviado correctamente:', data);
        return true;
      } catch (pushError) {
        console.warn('[Notificaciones] Error al enviar push mediante Edge Function:', pushError);
        // seguir con fallbacks
      }
    }

    // 2) Fallback: notificación del navegador
    const notificationSent = await showBrowserNotification(order, status);
    if (notificationSent) {
      console.log(`[Notificaciones] Notificación del navegador mostrada para orden #${orderId}`);
      return true;
    }

    // 3) Último fallback: notificación en pantalla
    if (window.notifications) {
      window.notifications.info(
        `Cliente de orden #${orderId} notificado sobre cambio a estado: ${STATUS_MAP[status]?.label || status}`,
        { title: 'Cliente notificado', duration: 3000 }
      );
      return true;
    }

    return false;
  } catch (err) {
    console.error('[Notificaciones] Error al notificar al cliente:', err);
    return false;
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
  // Validaciones previas al cambio de estado
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) {
    showError('Orden no encontrada', 'No se pudo localizar la solicitud seleccionada.');
    return;
  }
  if (newKey === 'entregado') {
    const photos = order.evidence_photos || [];
    if (photos.length === 0) {
      showError('Evidencia requerida', 'Añade al menos una foto antes de finalizar el trabajo.');
      return;
    }
    if (!order.last_collab_status) {
      showError('Inicia el trabajo primero', 'Marca "Recoger" o "Confirmar llegada" antes de finalizar.');
      return;
    }
  }

  // Si el colaborador marca como 'entregado', esto se traduce a 'Completado' en el estado general.
  if (newKey === 'entregado') {
    additionalData.status = 'Completado';
    additionalData.completed_at = new Date().toISOString();
    additionalData.completed_by = state.collabSession.user.id;

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

  const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, newKey, additionalData);

  if (success) {
    notifyClient(orderId, newKey);
    handleStatusUpdate(orderId, newKey); // Actualización optimista de la UI
    filterAndRender(); // Re-renderizar para mostrar el cambio al instante.
    if (newKey === 'entregado') {
      handleOrderCompletion(orderId);
    }
    showSuccess('Estado actualizado', STATUS_MAP[newKey]?.label || newKey);
    // await loadInitialOrders(); // Eliminado para implementar actualización optimista.
  } else {
    showError('No se pudo actualizar el estado', error);
  }
}

function returnToOrdersView() {
  state.activeJobId = null;
  localStorage.removeItem('tlc_collab_active_job');
  document.getElementById('activeJobSection').classList.add('hidden');
  document.getElementById('ordersCardContainer')?.classList.remove('hidden');
}

async function handleOrderCompletion(orderId) {
  try {
    // Incrementar contador de trabajos completados
    await supabaseConfig.client.functions.invoke('increment-completed-jobs', {
      body: { userId: state.collabSession.user.id }
    });

    // Registrar métricas de finalización
    const metrics = {
      colaborador_id: state.collabSession.user.id,
      tiempo_total: calculateTotalTime(orderId),
      fecha_completado: new Date().toISOString()
    };
    saveCompletionMetrics(metrics, orderId);

    returnToOrdersView();

    // Actualizar estadísticas del colaborador inmediatamente
    updateCollaboratorStats(state.collabSession.user.id);

    // Mostrar notificación de éxito sin acciones, ya que el historial fue eliminado.
    showSuccess(
      'La solicitud ha sido completada. Ahora puedes ver otros trabajos pendientes.',
      {
        title: '¡Trabajo finalizado con éxito!',
        duration: 8000
      }
    );

    // Actualizar datos para reflejar la orden completada
    filterAndRender();

  } catch (invokeErr) {
    console.warn('No se pudo invocar la función para incrementar trabajos completados:', invokeErr);
  }
}

// ✅ MEJORA: Agrupar variables globales en un objeto de estado para mayor claridad.
const state = {
  allOrders: [],
  filteredOrders: [],
  historialOrders: [],
  selectedOrderIdForAccept: null,
  activeJobId: Number(localStorage.getItem('tlc_collab_active_job')) || null,
  collabSession: null,
  activeJobMap: null,
  collabNameCache: new Map(),
};

function collabDisplayName(email){
  try {
    const base = (email || '').split('@')[0] || 'colaborador';
    return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Colaborador'; }
}

function openAcceptModal(order){
  // Bloquear aceptación si ya hay un trabajo activo
  if (state.activeJobId) {
    showError('Trabajo activo', 'Ya tienes un trabajo en progreso. Complétalo antes de aceptar otro.');
    return;
  }
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

  // Llamar a la función del mapa del HTML
  if (typeof updateActiveJobMap === 'function') {
    updateActiveJobMap(order.origin_coords, order.destination_coords);
  }
}

function updateActiveJobView(){
  if (!state.activeJobId) return;
  const order = state.allOrders.find(o => o.id === state.activeJobId);
  if (!order) return;

  // ✅ MEJORA: Actualizar barra de progreso y estado visual
  const statusKey = order.last_collab_status || 'en_camino_recoger';
  const statusLabel = STATUS_MAP[statusKey]?.label || statusKey;
  const badge = document.getElementById('activeJobStatus');
  if (badge) {
    badge.textContent = statusLabel;
  }
  // Se eliminó la lógica de la barra de progreso (jobProgressBar) porque el elemento no existe en el HTML.
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
function getCollaboratorName(userId){
  if (!userId) return '';
  const cached = state.collabNameCache.get(userId);
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
  
  // Función para órdenes pendientes (no completadas)
  const visibleForCollab = (o) => {
    if (!state.collabSession) return false;
    // ✅ CORRECCIÓN: Mostrar solicitudes pendientes (no asignadas) Y las asignadas a este colaborador que NO estén completadas.
    const isPendingAndUnassigned = o.status === 'Pendiente' && !o.assigned_to;
    const isAssignedToMe = o.assigned_to === state.collabSession.user.id && 
                          o.status !== 'Completado' && 
                          o.status !== 'Cancelado' && 
                          o.last_collab_status !== 'entregado';
    return isPendingAndUnassigned || isAssignedToMe;
  };

  // Función para órdenes del historial (completadas)
  const historialForCollab = (o) => {
    if (!state.collabSession) return false;
    // Mostrar órdenes completadas que fueron asignadas a este colaborador
    return o.assigned_to === state.collabSession.user.id && 
           (o.status === 'Completado' || o.last_collab_status === 'entregado');
  };

  let base = state.allOrders.filter(visibleForCollab);
  let historialBase = state.allOrders.filter(historialForCollab);
  
  // Lógica de filtrado para trabajo activo eliminada para mayor claridad.
  // La visibilidad de la sección de trabajo activo se maneja por separado.
  
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

  // Filtrar historial
  state.historialOrders = historialBase.filter(o => {
    const m1 = !term 
      || o.name.toLowerCase().includes(term) 
      || String(o.id).toLowerCase().includes(term)
      || String(o.short_id || '').toLowerCase().includes(term)
      || o.service.toLowerCase().includes(term);
    return m1;
  });

  render();
  // renderHistorial(); // Eliminado
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
    return `
      <div class="bg-white rounded-lg shadow p-4 border border-gray-100 cursor-pointer" data-order-id="${o.id}">
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
          ? `<div class='mt-3'><button class='px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded w-full' data-details-id="${o.id}">Detalles</button></div>`
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

  if (window.lucide) lucide.createIcons();
}

// === FUNCIÓN ELIMINADA: renderHistorial ===
// La funcionalidad de historial se ha eliminado de la interfaz principal.

// === FUNCIÓN ELIMINADA: renderDesktopAssignedCards ===
// Esta función ha sido eliminada porque el contenedor 'assignedOrdersContainer' 
// ya no existe en el HTML. Todas las tarjetas se renderizan ahora en 'ordersCardContainer'
// usando la función renderMobileCards que es responsiva.

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
  state.collabNameCache.set(user.id, name);
  
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
      state.collabNameCache.set(p.id, p.full_name || p.email || p.id);
    });
  } catch (err) {
    console.warn('Fallo al precargar nombres de colaboradores:', err);
  }
}

// Función para cargar órdenes
async function loadInitialOrders() {
  let timeout = null;
  const loadingIndicator = document.getElementById('loadingIndicator');

  try {
    // Iniciar temporizador de carga
    timeout = setTimeout(() => {
      if (loadingIndicator && !loadingIndicator.classList.contains('hidden')) {
        showError('Tiempo de carga excedido', 'No se pudieron cargar los datos. Por favor, recarga la página.');
        loadingIndicator.classList.add('hidden');
      }
    }, 10000); // 10 segundos

    // Helper para ejecutar la consulta
    const doQuery = async () => {
      return await supabaseConfig.client
        .from('orders')
        .select(`
          *,
          service:services(name),
          vehicle:vehicles(name)
        `)
        .or(`status.eq.Pendiente,assigned_to.eq.${state.collabSession.user.id}`)
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
      origin_coords: parseCoordinates(order.pickup_coords),
      destination_coords: parseCoordinates(order.delivery_coords),
      last_collab_status: order.last_collab_status || deriveLastStatus(order)
    }));
    await preloadCollaboratorNames(state.allOrders);
    
    filterAndRender();
  } catch (error) {
    console.error('Error al cargar órdenes iniciales:', error);
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    showError('Error de Carga', `No se pudieron cargar las solicitudes: ${errorMsg}`);
    state.allOrders = [];
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function updateCollaboratorStats(collaboratorId) {
  try {
    // Obtener estadísticas locales inmediatamente para UI responsiva
    const collaboratorOrders = state.allOrders.filter(order => order.assigned_to === collaboratorId);
    
    const activeJobs = collaboratorOrders.filter(order => 
      order.status === 'En proceso' || 
      (order.assigned_to === collaboratorId && order.status !== 'Completado' && order.status !== 'Cancelado')
    ).length;
    
    const completedJobs = collaboratorOrders.filter(order => order.status === 'Completado').length;
    const pendingRequests = state.allOrders.filter(order => order.status === 'Pendiente' && !order.assigned_to).length;
    
    // Actualizar UI inmediatamente con datos locales
    const activeJobsEl = document.getElementById('collabActiveJobs');
    const completedJobsEl = document.getElementById('collabCompletedJobs');
    const pendingRequestsEl = document.getElementById('pendingRequestsCount');
    
    if (activeJobsEl) activeJobsEl.textContent = activeJobs;
    if (completedJobsEl) completedJobsEl.textContent = completedJobs;
    if (pendingRequestsEl) pendingRequestsEl.textContent = pendingRequests;

    // Sincronizar con base de datos para obtener estadísticas precisas
    if (supabaseConfig.client) {
      const { data: realTimeStats, error } = await supabaseConfig.client
        .from('orders')
        .select('status, assigned_to')
        .or(`assigned_to.eq.${collaboratorId},status.eq.Pendiente`);

      if (!error && realTimeStats) {
        const realActiveJobs = realTimeStats.filter(order => 
          order.assigned_to === collaboratorId && 
          order.status === 'En proceso'
        ).length;
        
        const realCompletedJobs = realTimeStats.filter(order => 
          order.assigned_to === collaboratorId && 
          order.status === 'Completado'
        ).length;
        
        const realPendingRequests = realTimeStats.filter(order => 
          order.status === 'Pendiente' && !order.assigned_to
        ).length;

        // Actualizar UI con datos sincronizados si hay diferencias
        if (realActiveJobs !== activeJobs && activeJobsEl) {
          activeJobsEl.textContent = realActiveJobs;
        }
        if (realCompletedJobs !== completedJobs && completedJobsEl) {
          completedJobsEl.textContent = realCompletedJobs;
        }
        if (realPendingRequests !== pendingRequests && pendingRequestsEl) {
          pendingRequestsEl.textContent = realPendingRequests;
        }

        console.log('[Stats] Estadísticas sincronizadas:', {
          activeJobs: realActiveJobs,
          completedJobs: realCompletedJobs,
          pendingRequests: realPendingRequests
        });
      }
    }
  } catch (err) {
    console.warn('[Stats] Error al actualizar estadísticas:', err);
  }
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

function setupEventListeners() {
  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.addEventListener('click', (e) => {
      const card = e.target.closest('[data-order-id]');
      const detailsButton = e.target.closest('[data-details-id]');
      const stepButton = e.target.closest('.mob-step-btn');

      if (detailsButton) {
        e.stopPropagation();
        showServiceDetailsCollab(detailsButton.dataset.detailsId);
        return;
      }

      if (stepButton) {
        e.stopPropagation();
        changeStatus(Number(stepButton.dataset.id), stepButton.dataset.next);
        return;
      }

      if (card) {
        handleCardClick(card.dataset.orderId);
      }
    });
  }

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    supabaseConfig.client.auth.signOut();
    window.location.href = 'login-colaborador.html';
  });

  document.getElementById('cancelAcceptBtn')?.addEventListener('click', closeAcceptModal);

  document.getElementById('photoUpload')?.addEventListener('change', handlePhotoUpload);

  const actionButtonsContainer = document.getElementById('activeJobActionButtons');
  if (actionButtonsContainer) {
    actionButtonsContainer.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-status]');
      if (button) {
        if (state.activeJobId) {
          changeStatus(state.activeJobId, button.dataset.status);
        } else {
          showError('Error', 'No hay un trabajo activo seleccionado.');
        }
      }
    });
  }

  document.getElementById('confirmAcceptBtn')?.addEventListener('click', async () => {
    if (state.activeJobId) {
      showError('Trabajo activo', 'Ya tienes un trabajo en progreso. Complétalo antes de aceptar otro.');
      return closeAcceptModal();
    }
    if (!state.selectedOrderIdForAccept) return closeAcceptModal();

    const orderId = state.selectedOrderIdForAccept;
    const { success, error } = await OrderManager.acceptOrder(orderId, state.collabSession.user.id);

    if (success) {
      showSuccess('¡Solicitud aceptada!', 'El trabajo ahora es tuyo.');
      state.activeJobId = orderId;
      localStorage.setItem('tlc_collab_active_job', String(orderId));

      // Actualización optimista
      const order = state.allOrders.find(o => o.id === orderId);
      if (order) {
        order.assigned_to = state.collabSession.user.id;
        order.status = 'En proceso';
        order.last_collab_status = 'en_camino_recoger';
        showActiveJob(order);
      }
    } else {
      showError('Error al aceptar la solicitud', error);
    }
    closeAcceptModal();
  });

  const cancelBtn = document.getElementById('cancelActiveJobBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!state.activeJobId) return;
      const ok = confirm('¿Cancelar este trabajo activo? Esto marcará la solicitud como Cancelado.');
      if (!ok) return;

      const { success, error } = await OrderManager.cancelActiveJob(state.activeJobId);
      if (success) {
        returnToOrdersView();
        filterAndRender(); // Actualizar la vista
        showSuccess('Trabajo cancelado', 'La solicitud ha sido marcada como cancelada.');
      } else {
        showError('Error al cancelar', error || 'No se pudo cancelar el trabajo.');
      }
    });
  }
}

// --- INICIALIZACIÓN ---

// La sesión ya fue verificada al inicio del IIFE.
state.collabSession = session;

if (window.lucide) lucide.createIcons();

setupSidebarToggles();
setupEventListeners();
// setupTabs(); // Eliminado

supabaseConfig.client.auth.onAuthStateChange((_event, newSession) => {
  state.collabSession = newSession;
});

updateCollaboratorProfile(session);

const loadingIndicator = document.getElementById('loadingIndicator');
const cardsContainer = document.getElementById('ordersCardContainer');

loadingIndicator.classList.remove('hidden');
cardsContainer.classList.add('hidden');

await loadInitialOrders();

loadingIndicator.classList.add('hidden');
cardsContainer.classList.remove('hidden');

restoreActiveJob();

// Mover handleStatusUpdate fuera de la inicialización para un scope correcto.
function handleStatusUpdate(orderId, newStatus) {
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const idx = state.allOrders.findIndex(o => o.id === orderId);
  if (idx !== -1) {
    const prev = state.allOrders[idx];
    const prevTracking = Array.isArray(prev.tracking_data) ? prev.tracking_data : [];
    state.allOrders[idx] = {
      ...prev,
      last_collab_status: newStatus,
      tracking_data: [...prevTracking, { status: newStatus, date: new Date().toISOString() }]
    };
  }
  updateActiveJobView();
}

if (supabaseConfig.client && !supabaseConfig.useLocalStorage) {
  supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtimeUpdate)
    .subscribe();
} else {
  setInterval(filterAndRender, 5000);
}

/**
 * ✅ REFACTORIZADO: Busca y muestra el trabajo activo guardado en localStorage.
 * Si no es válido, limpia el estado y vuelve a la vista de órdenes para evitar
 * una pantalla en blanco.
 */
function restoreActiveJob() {
  if (state.activeJobId) {
    const order = state.allOrders.find(o => o.id === state.activeJobId);
    const assignedId = order?.assigned_to;
    const lastStatus = order?.last_collab_status;
    
    // Condición para un trabajo activo válido
    if (order && assignedId === state.collabSession.user.id && lastStatus !== 'entregado') {
      console.log(`[Cache] Restaurando trabajo activo #${order.id}`);
      showActiveJob(order);
      return; // Éxito: Salir de la función
    }

    // Si la condición falla, el trabajo en caché es inválido.
    console.warn(`[Cache] El trabajo activo #${state.activeJobId} ya no es válido. Limpiando.`);
  }

  // Si no hay ID de trabajo activo o el que había era inválido,
  // limpiar el estado y asegurarse de que la vista de órdenes esté visible.
  returnToOrdersView();
}

// Helper para construir el mensaje de notificación según estado
function buildStatusMessage(order, statusKey) {
  // Mapa completo de mensajes para todos los estados posibles
  const map = {
    // Estados del colaborador (panel-colaborador.js)
    en_camino_recoger: `Tu pedido #${order.id} está en camino a recoger.`,
    cargando: `Estamos cargando tu pedido #${order.id}.`,
    en_camino_entregar: `Tu pedido #${order.id} va en camino a entregar.`,
    retraso_tapon: `Tu pedido #${order.id} tiene retraso por tapón.`,
    entregado: `Tu pedido #${order.id} fue entregado. ¡Gracias!`,
    
    // Estados principales del sistema (inicio.js)
    'Pendiente': `Tu pedido #${order.id} está pendiente de confirmación.`,
    'Confirmado': `Tu pedido #${order.id} ha sido confirmado y será procesado pronto.`,
    'Asignado': `Tu pedido #${order.id} ha sido asignado a un colaborador.`,
    'En proceso': `Tu pedido #${order.id} está siendo procesado por nuestro colaborador.`,
    'Completado': `Tu pedido #${order.id} ha sido completado exitosamente. ¡Gracias!`,
    'Cancelado': `Tu pedido #${order.id} ha sido cancelado.`
  };
  
  // Si el estado existe en el mapa, usar ese mensaje, sino construir uno genérico
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
      <button id="closeDetailsModalBtn" class="mt-6 w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeButton = modal.querySelector('#closeDetailsModalBtn');
  closeButton.addEventListener('click', () => {
    modal.remove();
  });

  // Also close on overlay click
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.remove();
    }
  });
}
})();