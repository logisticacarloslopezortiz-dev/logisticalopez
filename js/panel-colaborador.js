(async () => {
  "use strict";

  // Envoltura de seguridad: verificar la sesión al inicio.
  if (!window.supabaseConfig || !supabaseConfig.client) {
    console.warn('Cliente de Supabase no inicializado, redirigiendo al login.');
    window.location.href = 'login-colaborador.html';
    return;
  }
  const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
  if (sessionError || !session) {
    console.warn('Sesión no encontrada, redirigiendo al login.');
    window.location.href = 'login-colaborador.html';
    return; // Detener la ejecución si no hay sesión.
  }

  try {
    const { data: collab, error: collabErr } = await supabaseConfig.client
      .from('collaborators')
      .select('id, role, status')
      .eq('id', session.user.id)
      .maybeSingle();
    if (collabErr || !collab || String(collab.status || '').toLowerCase() !== 'activo') {
      console.warn('Perfil de colaborador no activo o inexistente. Redirigiendo.');
      window.location.href = 'login-colaborador.html';
      return;
    }
  } catch (_) {
    window.location.href = 'login-colaborador.html';
    return;
  }

  function setupAriaCurrent(){
    try {
      const links = document.querySelectorAll('#collabSidebar nav a[href]');
      const current = (window.location.pathname.split('/').pop() || '').toLowerCase();
      links.forEach(a => a.removeAttribute('aria-current'));
      let active = null;
      active = Array.from(links).find(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        if (!href || href === '#') return current.includes('panel-colaborador');
        return current.endsWith(href);
      }) || document.getElementById('sidebar-activos-btn');
      if (active) active.setAttribute('aria-current', 'page');
    } catch(_) {}
  }

  // Usar OrderManager global importado desde order-manager.js

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
  // Usar nombres de columnas del esquema: origin_coords y destination_coords
  if (!order.origin_coords || !order.destination_coords) {
      console.error('[Mapa] Error: Faltan coordenadas de origen o destino');
      // El elemento mapErrorMessage no existe, se elimina la referencia para evitar errores.
      return;
    }
    
    // Parsear coordenadas
  const pickupCoords = parseCoordinates(order.origin_coords);
  const deliveryCoords = parseCoordinates(order.destination_coords);
    
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
  pickupMarker.bindPopup('<strong>Origen:</strong> ' + (order.pickup || 'Origen')).openPopup();
    
    const deliveryMarker = L.marker([deliveryCoords.lat, deliveryCoords.lng], {
      icon: createCustomIcon('red', 'B')
    }).addTo(map);
  deliveryMarker.bindPopup('<strong>Destino:</strong> ' + (order.delivery || 'Destino'));
    
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
 * Guarda el trabajo activo en localStorage para persistencia
 * @param {Object} activeJob - Datos del trabajo activo
 */
function saveActiveJob(activeJob) {
  if (!activeJob || !activeJob.id) return;
  try {
    const collaboratorId = state.collabSession?.user?.id;
    if (collaboratorId) {
      const key = `tlc_active_job_${collaboratorId}`;
      const jobData = {
        orderId: activeJob.id,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(key, JSON.stringify(jobData));
      console.log('[Persistencia] Trabajo activo guardado:', activeJob.id);
    }
  } catch (err) {
    console.error('[Persistencia] Error al guardar trabajo activo:', err);
  }
}

/**
 * Recupera el trabajo activo desde localStorage
 * @returns {Object|null} - Datos del trabajo activo o null
 */
function loadActiveJob() {
  try {
    const collaboratorId = state.collabSession?.user?.id;
    if (collaboratorId) {
      const key = `tlc_active_job_${collaboratorId}`;
      const savedJob = localStorage.getItem(key);
      if (savedJob) {
        const jobData = JSON.parse(savedJob);
        // Verificar que no sea muy antiguo (más de 24 horas)
        const savedAt = new Date(jobData.savedAt);
        const now = new Date();
        const hoursDiff = (now - savedAt) / (1000 * 60 * 60);
        
        if (hoursDiff < 720) {
          console.log('[Persistencia] Trabajo activo recuperado:', jobData.orderId);
          return jobData;
        } else {
          // Limpiar trabajo antiguo
          localStorage.removeItem(key);
          console.log('[Persistencia] Trabajo activo expirado, eliminado');
        }
      }
    }
    return null;
  } catch (err) {
    console.error('[Persistencia] Error al cargar trabajo activo:', err);
    return null;
  }
}

/**
 * Elimina el trabajo activo guardado
 */
function clearActiveJob() {
  state.activeJobId = null;
  try {
    const collaboratorId = state.collabSession?.user?.id;
    if (collaboratorId) {
      const key = `tlc_active_job_${collaboratorId}`;
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.error('[Persistencia] Error al limpiar trabajo activo:', err);
  }
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
      // Tu esquema no tiene completion_metrics; las métricas agregadas se gestionan por triggers/RPC
      // Aquí solo refrescamos la vista agregada después de completar.
      try {
        const collabId = metrics.colaborador_id || state.collabSession?.user?.id;
        if (collabId) {
          refreshPerformanceFor(collabId);
        }
      } catch (aggErr) {
        console.warn('[Métricas] No se pudo refrescar agregados:', aggErr);
      }
    }
  } catch (err) {
    console.error('[Métricas] Error al guardar:', err);
  }
}

/**
 * Upsert diario en collaborator_performance con incremento de jobs_completed
 * y actualización de avg_completion_minutes.
 */
async function refreshPerformanceFor(collaborator_id) {
  try {
    // Consulta vista diaria entre fechas (hoy como ejemplo)
    const today = new Date();
    const d = today.toISOString().slice(0,10);
    const { data, error } = await supabaseConfig.client
      .from('collaborator_performance_view')
      .select('*')
      .eq('collaborator_id', collaborator_id)
      .eq('metric_date', d)
      .limit(1);
    if (error) {
      console.warn('[Perf] Error al consultar vista de rendimiento:', error.message);
      return null;
    }
    console.log('[Perf] Métricas diarias (vista):', data);
    return data;
  } catch (err) {
    console.error('[Perf] Error al refrescar rendimiento:', err);
    return null;
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
  console.log(`[Colaborador] Solicitando cambio de estado para orden #${orderId} a "${newKey}"`);

  // Validaciones previas
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) {
    showError('Orden no encontrada', 'No se pudo localizar la solicitud seleccionada.');
    return;
  }
  if (newKey === 'entregado') {
    if ((order.evidence_photos || []).length === 0) {
      showError('Evidencia requerida', 'Añade al menos una foto antes de finalizar.');
      return;
    }
    if (!order.last_collab_status) {
      showError('Inicia el trabajo primero', 'Debes marcar un estado inicial antes de finalizar.');
      return;
    }
  }

  // Guardar el estado actual en localStorage antes de intentar actualizar
  const statusUpdate = {
    orderId: orderId,
    newStatus: newKey,
    previousStatus: order.last_collab_status,
    timestamp: new Date().toISOString(),
    collaboratorId: state.collabSession.user.id
  };
  
  // Guardar en localStorage para recuperación en caso de fallo de conexión
  localStorage.setItem(`tlc_pending_status_${orderId}`, JSON.stringify(statusUpdate));

  try {
    // Centralizar la lógica de negocio en el OrderManager.
    // El OrderManager ahora decidirá si el estado global debe cambiar.
    const { success, error } = await OrderManager.actualizarEstadoPedido(orderId, newKey, {
      collaborator_id: state.collabSession.user.id
    });

    if (success) {
      // Si la actualización fue exitosa, eliminar el estado pendiente guardado
      localStorage.removeItem(`tlc_pending_status_${orderId}`);
      
      notifyClient(orderId, newKey);
      handleStatusUpdate(orderId, newKey); // UI optimista
      filterAndRender();

      if (newKey === 'entregado') {
        // Registrar métricas de finalización
        try {
          const metrics = {
            colaborador_id: state.collabSession.user.id,
            tiempo_total: calculateTotalTime(orderId),
            fecha_completado: new Date().toISOString()
          };
          saveCompletionMetrics(metrics, orderId);
        } catch (err) {
          console.error('[Métricas] Error al registrar:', err);
        }
        handleOrderCompletion(orderId);
      }

      showSuccess('Estado actualizado', STATUS_MAP[newKey]?.label || newKey);
    } else {
      // Si falló la actualización, mantener el estado guardado para sincronización posterior
      console.error('[Estado] Error al actualizar estado - se guardó para sincronización posterior:', error);
      showError('No se pudo actualizar el estado', 'El cambio se guardó localmente y se sincronizará cuando esté disponible.');
      
      // Aunque falló en el servidor, actualizar localmente para continuar el flujo
      handleStatusUpdate(orderId, newKey);
      filterAndRender();
    }
  } catch (err) {
    // Error de red o conexión - mantener el estado guardado
    console.error('[Estado] Error de conexión - estado guardado para sincronización:', err);
    showWarning('Sin conexión', 'El cambio se guardó localmente y se sincronizará cuando esté disponible.');
    
    // Actualizar localmente para continuar el flujo
    handleStatusUpdate(orderId, newKey);
    filterAndRender();
  }
}

function returnToOrdersView() {
  clearActiveJob();
  document.getElementById('activeJobSection').classList.add('hidden');

  // Asegurarse de que los contenedores de listas de órdenes sean visibles
  const ordersContainer = document.getElementById('ordersCardContainer');
  const pendingContainer = document.getElementById('pendingSection');
  if (ordersContainer) ordersContainer.classList.remove('hidden');
  if (pendingContainer) pendingContainer.classList.remove('hidden');

  // Re-renderizar para asegurar que la vista es consistente
  filterAndRender();
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

// Objeto para cachear elementos del DOM y evitar búsquedas repetitivas
const ui = {
  loadingIndicator: document.getElementById('loadingIndicator'),
  ordersCardContainer: document.getElementById('ordersCardContainer'),
  pendingSection: document.getElementById('pendingSection'),
  pendingCardContainer: document.getElementById('pendingCardContainer'),
  activeJobSection: document.getElementById('activeJobSection'),
  activeJobInfo: document.getElementById('activeJobInfo'),
  activeJobStatus: document.getElementById('activeJobStatus'),
  photoGallery: document.getElementById('photoGallery'),
  acceptModal: document.getElementById('acceptModal'),
  acceptModalBody: document.getElementById('acceptModalBody'),
};

const state = {
  allOrders: [],
  historialOrders: [],
  selectedOrderIdForAccept: null,
  activeJobId: null, // Se inicializa en null y se restaura desde el localStorage específico del usuario más adelante
  collabSession: null,
  activeJobMap: null,
  collabNameCache: new Map(),
  isOnline: true,
  connectionCheckInterval: null
};

function collabDisplayName(email){
  try {
    const base = (email || '').split('@')[0] || 'colaborador';
    return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Colaborador'; }
}

function openAcceptModal(order){
  // Permitir aceptar si el trabajo activo es la misma orden; bloquear solo si es distinta
  if (state.activeJobId && Number(state.activeJobId) !== Number(order.id)) {
    showError('Trabajo activo', 'Ya tienes un trabajo en progreso. Complétalo antes de aceptar otro.');
    return;
  }
  state.selectedOrderIdForAccept = order.id;
  ui.acceptModalBody.innerHTML = `
    <div class="space-y-1">
      <div><span class="font-semibold">ID:</span> ${order.id}</div>
      <div><span class="font-semibold">Cliente:</span> ${order.name} (${order.phone})</div>
      <div><span class="font-semibold">Servicio:</span> ${order.service} — ${order.vehicle}</div>
      <div><span class="font-semibold">Ruta:</span> ${order.pickup} → ${order.delivery}</div>
      <div><span class="font-semibold">Fecha/Hora:</span> ${order.date} ${order.time}</div>
    </div>
  `;
  ui.acceptModal.classList.remove('hidden');
  ui.acceptModal.classList.add('flex');
  if (window.lucide) lucide.createIcons();
}

function closeAcceptModal(){
  ui.acceptModal.classList.add('hidden');
  ui.acceptModal.classList.remove('flex');
  state.selectedOrderIdForAccept = null;
}

// Decide la acción al hacer clic en una tarjeta: aceptar (pendiente) o mostrar trabajo activo (asignado)
function handleCardClick(orderId) {
  const order = state.allOrders.find(o => o.id === Number(orderId));
  if (!order) return;
  
  const collabId = state.collabSession?.user?.id;

  // Si la orden está asignada a mí y no está completada/cancelada, la mostramos
  if (order.assigned_to === collabId && order.status !== 'Completada' && order.status !== 'Cancelada') {
    showActiveJob(order);
    document.getElementById('ordersCardContainer')?.classList.add('hidden');
    document.getElementById('pendingSection')?.classList.add('hidden');
  }
  // Si la orden está pendiente, mostramos el modal para aceptar
  else if (order.status === 'Pendiente' && !order.assigned_to) {
    openAcceptModal(order);
  }
}

function showWarning(title, message) {
  try {
    if (window.notifications && window.notifications.warning) {
      window.notifications.warning(message, { title });
    } else {
      alert(`${title}: ${message}`);
    }
  } catch (err) {
    console.warn('[Notificación] Error al mostrar advertencia:', err);
    alert(`${title}: ${message}`);
  }
}

function showActiveJob(order){
  // Solo mostrar el trabajo activo si está asignado al colaborador actual o si acaba de ser aceptado
  const assignedId = order.assigned_to;
  if (assignedId && assignedId !== state.collabSession.user.id) {
    return; // No mostrar si está asignado a otro colaborador
  }
  
  state.activeJobId = Number(order.id);
  saveActiveJob(order); // Guardar el trabajo activo de forma robusta
  ui.activeJobSection.classList.remove('hidden');

  // ✅ MEJORA: Diseño de información de trabajo activo más limpio y organizado
  ui.activeJobInfo.innerHTML = /*html*/`
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

  const originBtn = document.getElementById('viewLocationBtn');
  const routeBtn = document.getElementById('viewRouteBtn');
  if (originBtn) originBtn.onclick = handleViewOrigin;
  if (routeBtn) routeBtn.onclick = handleViewRoute;
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

// Obtener datos de origen/destino para el trabajo activo
async function fetchActiveOrderCoordsAndAddresses() {
  if (!state.activeJobId) throw new Error('No hay trabajo activo');
  const { data, error } = await supabaseConfig.client
    .from('orders')
    .select('origin_coords, destination_coords, pickup, delivery')
    .eq('id', state.activeJobId)
    .single();
  if (error) throw error;
  return data || {};
}

// Abrir origen en Google Maps
async function handleViewOrigin() {
  try {
    const data = await fetchActiveOrderCoordsAndAddresses();
    const order = state.allOrders.find(o => o.id === state.activeJobId) || {};
    const origin = data.origin_coords || order.origin_coords;
    const pickupText = data.pickup || order.pickup;

    if (origin && typeof origin.lat === 'number' && typeof origin.lng === 'number') {
      const url = `https://www.google.com/maps?q=${origin.lat},${origin.lng}`;
      window.open(url, '_blank');
    } else if (pickupText) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickupText)}`;
      window.open(url, '_blank');
    } else {
      showError('Sin datos', 'No hay datos de origen disponibles.');
    }
  } catch (err) {
    console.error('Error al abrir origen en Maps:', err);
    showError('Error', 'No se pudo obtener el origen desde Supabase.');
  }
}

// Abrir ruta en Google Maps
async function handleViewRoute() {
  try {
    const data = await fetchActiveOrderCoordsAndAddresses();
    const order = state.allOrders.find(o => o.id === state.activeJobId) || {};
    const origin = data.origin_coords || order.origin_coords;
    const destination = data.destination_coords || order.destination_coords;
    const pickupText = data.pickup || order.pickup;
    const deliveryText = data.delivery || order.delivery;

    if (origin && destination && typeof origin.lat === 'number' && typeof origin.lng === 'number' && typeof destination.lat === 'number' && typeof destination.lng === 'number') {
      const url = `https://www.google.com/maps/dir/${origin.lat},${origin.lng}/${destination.lat},${destination.lng}`;
      window.open(url, '_blank');
    } else if (pickupText && deliveryText) {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickupText)}&destination=${encodeURIComponent(deliveryText)}`;
      window.open(url, '_blank');
    } else {
      showError('Sin datos', 'No hay datos suficientes para la ruta.');
    }
  } catch (err) {
    console.error('Error al abrir ruta en Maps:', err);
    showError('Error', 'No se pudo obtener la ruta desde Supabase.');
  }
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

/**
 * Filtra las órdenes según los criterios de búsqueda y estado, y luego las renderiza.
 * Esta función es el punto central para actualizar la vista de la tabla.
 */
function filterAndRender(){
  // Búsqueda y filtrado deshabilitados en este panel para evitar problemas de layout.
  const term = '';
  const statusFilter = '';
  
  // Verificar si hay un trabajo activo guardado
  const activeJob = loadActiveJob();
  const collabId = state.collabSession?.user?.id;
  const all = state.allOrders || [];
  const pendingOrders = all.filter(o => o.status === 'Pendiente' && !o.assigned_to);
  const myAssigned = all.filter(o => o.assigned_to === collabId && o.status !== 'Completada' && o.status !== 'Cancelada');
  
  if (activeJob) {
    const activeOrder = state.allOrders.find(order => order.id === activeJob.orderId);
    if (activeOrder) {
      showActiveJob(activeOrder);
      if (ui.ordersCardContainer) ui.ordersCardContainer.classList.add('hidden');
      if (ui.pendingSection) ui.pendingSection.classList.add('hidden');
      return;
    } else {
      clearActiveJob();
    }
  }
  
  if (ui.ordersCardContainer) ui.ordersCardContainer.classList.toggle('hidden', myAssigned.length === 0);
  if (ui.pendingSection) ui.pendingSection.classList.toggle('hidden', pendingOrders.length === 0);
  renderAssignedCards(myAssigned);
  renderPendingCards(pendingOrders);
  
  // Función para órdenes del historial (completadas) - se mantiene igual
  const historialForCollab = (o) => {
    if (!state.collabSession) return false;
    // Mostrar órdenes completadas que fueron asignadas a este colaborador
    return o.assigned_to === state.collabSession.user.id && 
           (o.status === 'Completada' || o.last_collab_status === 'entregado');
  };

  let historialBase = state.allOrders.filter(historialForCollab);
  
  // Filtrar historial
  state.historialOrders = historialBase.filter(o => {
    const m1 = !term 
      || o.name.toLowerCase().includes(term) 
      || String(o.id).toLowerCase().includes(term)
      || String(o.short_id || '').toLowerCase().includes(term)
      || o.service.toLowerCase().includes(term);
    return m1;
  });

  updateCollaboratorStats(state.collabSession.user.id);
}

// === Soporte móvil: tarjetas de solicitudes asignadas ===
function ensureMobileContainer(){
  // El contenedor ya existe en el HTML refactorizado
  return document.getElementById('ordersCardContainer');
}

function renderAssignedCards(orders){
  const container = ensureMobileContainer();
  if (!container) return;
  if (!orders || orders.length === 0){
    container.innerHTML = `
      <div class="col-span-full">
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center">
          <i data-lucide="inbox" class="w-6 h-6 text-gray-400 mx-auto mb-3"></i>
          <p class="text-gray-600">Sin solicitudes asignadas</p>
        </div>
      </div>`;
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
        <div class="mt-3">
          <button data-view-id="${o.id}" class="w-full px-2 py-2 text-xs bg-blue-600 text-white rounded">Ver</button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function ensurePendingContainer(){
  return document.getElementById('pendingCardContainer');
}

function renderPendingCards(orders){
  const container = ensurePendingContainer();
  if (!container) return;
  if (!orders || orders.length === 0){
    container.innerHTML = `
      <div class="col-span-full">
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center">
          <i data-lucide="inbox" class="w-6 h-6 text-gray-400 mx-auto mb-3"></i>
          <p class="text-gray-600">Sin solicitudes pendientes</p>
        </div>
      </div>`;
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
          <button data-view-id="${o.id}" class="px-2 py-2 text-xs bg-gray-100 text-gray-800 rounded">Ver</button>
          <button data-id="${o.id}" class="px-2 py-2 text-xs bg-blue-600 text-white rounded">Aceptar</button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// Adaptador para compatibilidad: algunas rutas siguen llamando a renderOrders
function renderOrders(orders){
  try {
    const container = ensureMobileContainer();
    if (!container) return;
    if (!orders || orders.length === 0) {
      container.classList.remove('hidden');
      container.innerHTML = '<div class="text-center py-6 text-gray-500">Sin solicitudes</div>';
      return;
    }
    container.classList.remove('hidden');
    renderAssignedCards(orders);
  } catch (err) {
    console.error('Error en renderOrders:', err);
  }
}

// === FUNCIÓN ELIMINADA: renderHistorial ===
// La funcionalidad de historial se ha eliminado de la interfaz principal.

// === FUNCIÓN ELIMINADA: renderDesktopAssignedCards ===
// Esta función ha sido eliminada porque el contenedor 'assignedOrdersContainer' 
// ya no existe en el HTML. Todas las tarjetas se renderizan ahora en 'ordersCardContainer'
// usando la función renderMobileCards que es responsiva.

// === Lógica Unificada del Sidebar (Móvil y Escritorio) ===
// La lógica del sidebar fue eliminada de este archivo para evitar duplicidad.
// El archivo `js/sidebar-collab.js` ya se encarga de esta funcionalidad.

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
async function syncPendingStatusUpdates() {
  try {
    const pendingUpdates = Object.keys(localStorage)
      .filter(key => key.startsWith('tlc_pending_status_'))
      .map(key => {
        const orderId = key.replace('tlc_pending_status_', '');
        const data = JSON.parse(localStorage.getItem(key));
        return { orderId, ...data };
      });

    if (pendingUpdates.length === 0) return;

    console.log(`[Sincronización] Encontrados ${pendingUpdates.length} estados pendientes`);

    for (const update of pendingUpdates) {
      try {
        await OrderManager.actualizarEstadoPedido(update.orderId, update.newStatus, update.collaboratorId);
        localStorage.removeItem(`tlc_pending_status_${update.orderId}`);
        console.log(`[Sincronización] Estado sincronizado para orden ${update.orderId}`);
      } catch (error) {
        console.error(`[Sincronización] Error al sincronizar orden ${update.orderId}:`, error);
      }
    }

    if (pendingUpdates.length > 0) {
      showSuccess('Sincronización completada', `${pendingUpdates.length} actualizaciones sincronizadas`);
    }
  } catch (error) {
    console.error('[Sincronización] Error general:', error);
  }
}

async function loadInitialOrders() {
  let timeout = null;

  try {
    // Iniciar temporizador de carga
    timeout = setTimeout(() => {
      if (loadingIndicator && !loadingIndicator.classList.contains('hidden')) {
        showError('Tiempo de carga excedido', 'No se pudieron cargar los datos. Por favor, recarga la página.');
        loadingIndicator.classList.add('hidden');
      }    }, 10000); // 10 segundos

    // Helper para ejecutar la consulta
    const doQuery = async () => {
      return await supabaseConfig.client
        .from('orders')
        .select(`
          *,
          service:services(name),
          vehicle:vehicles(name)
        `)
        .or(`status.eq.Pendiente,and(assigned_to.eq.${state.collabSession.user.id},status.neq.Completada,status.neq.Cancelada)`)
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
    origin_coords: parseCoordinates(order.origin_coords),
    destination_coords: parseCoordinates(order.destination_coords),
      last_collab_status: order.last_collab_status || deriveLastStatus(order)
    }));
    await preloadCollaboratorNames(state.allOrders);
    
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('orderId') || params.get('order');
      if (raw) {
        let target = null;
        const num = Number(raw);
        if (!Number.isNaN(num)) {
          target = state.allOrders.find(o => Number(o.id) === num) || null;
        }
        if (!target) {
          const s = String(raw);
          target = state.allOrders.find(o => String(o.short_id || '') === s) || null;
        }
        if (target) {
          state.activeJobId = target.id;
        }
      }
    } catch(_) {}
    
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
async function fetchAndInjectOrder(orderId) {
  try {
    const { data: order, error } = await supabaseConfig.client
      .from('orders')
      .select('*, service:services(name), vehicle:vehicles(name)')
      .eq('id', orderId)
      .single();

    if (error) throw error;

    if (order) {
      // Normalizar y añadir a la lista si no existe
      const existingIndex = state.allOrders.findIndex(o => o.id === order.id);
      if (existingIndex === -1) {
        const normalized = {
          ...order,
          service: order.service?.name || order.service || 'Sin servicio',
          vehicle: order.vehicle?.name || order.vehicle || 'Sin vehículo'
        };
        state.allOrders.unshift(normalized);
        return true; // Indica que se añadió una orden
      }
    }
  } catch (err) {
    console.error(`[Realtime] Error al buscar la orden inyectada #${orderId}:`, err);
  }
  return false; // No se añadió nada
}

function handleRealtimeUpdate(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  switch (eventType) {
    case 'INSERT':
      if (newRecord.status === 'Pendiente') {
        const normalized = {
          ...newRecord,
          service: newRecord.service?.name || newRecord.service || 'Sin servicio',
          vehicle: newRecord.vehicle?.name || newRecord.vehicle || 'Sin vehículo',
          origin_coords: parseCoordinates(newRecord.origin_coords),
          destination_coords: parseCoordinates(newRecord.destination_coords)
        };
        state.allOrders.unshift(normalized);
      }
      break;
    case 'UPDATE': {
      const collabId = state.collabSession?.user?.id;
      const index = state.allOrders.findIndex(o => Number(o.id) === Number(newRecord.id));

      if (index !== -1) {
        // La orden ya existe, la actualizamos
        const prev = state.allOrders[index];
        const merged = { ...prev, ...newRecord, service: prev.service, vehicle: prev.vehicle };
        state.allOrders[index] = merged;
      } else if (newRecord.assigned_to === collabId) {
        // La orden no existe, pero ahora está asignada a mí. La buscamos y la inyectamos.
        fetchAndInjectOrder(newRecord.id).then(injected => {
          if (injected) filterAndRender(); // Re-renderizar solo si se añadió algo
        });
      }
      break;
    }
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
      const stepButton = null;
      const acceptBtn = e.target.closest('button[data-id]');
      const viewBtn = e.target.closest('button[data-view-id]');

      if (detailsButton) {
        e.stopPropagation();
        showServiceDetailsCollab(detailsButton.dataset.detailsId);
        return;
      }

      // se elimina manejo de stepButton para tarjetas compactas

      if (card) {
        handleCardClick(card.dataset.orderId);
        return;
      }
      if (viewBtn) {
        e.stopPropagation();
        const id = Number(viewBtn.dataset.viewId);
        const order = state.allOrders.find(o => o.id === id);
        if (order) {
          showActiveJob(order);
          document.getElementById('ordersCardContainer')?.classList.add('hidden');
          document.getElementById('pendingSection')?.classList.add('hidden');
        }
        return;
      }
      if (acceptBtn) {
        e.stopPropagation();
        const id = e.target.closest('button[data-id]').dataset.id;
        const order = state.allOrders.find(o => o.id === Number(id));
        if (order && !order.assigned_to && order.status === 'Pendiente') {
          openAcceptModal(order);
        }
      }
    });
  }

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    const { error } = await supabaseConfig.client.auth.signOut();
    try {
      // ✅ MEJORA: Preservar la clave del trabajo activo al cerrar sesión.
      const keysToPreserve = ['tlc_theme']; // Mantener el tema
      const uid = state.collabSession?.user?.id;
      if (uid) {
        keysToPreserve.push(`tlc_active_job_${uid}`);
      }
      const allKeys = Object.keys(localStorage);
      for (const k of allKeys) {
        if (!keysToPreserve.includes(k)) {
          try { localStorage.removeItem(k); } catch(_){}
        }
      }
    } catch(_){}
    if (error) {
      console.error('Error al cerrar sesión:', error);
    }
    window.location.href = 'login-colaborador.html';
  });

  document.getElementById('cancelAcceptBtn')?.addEventListener('click', closeAcceptModal);

  document.getElementById('photoUpload')?.addEventListener('change', handlePhotoUpload);

  const actionButtonsContainer = document.getElementById('activeJobActionButtons');
  if (actionButtonsContainer) {
    actionButtonsContainer.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-status]');
      if (button) {
        const activeId = state.activeJobId;
        const order = activeId ? state.allOrders.find(o => o.id === activeId) : null;
        if (!order) {
          showError('Error', 'No hay un trabajo activo seleccionado.');
          return;
        }
        if (!order.assigned_to) {
          openAcceptModal(order);
          return;
        }
        changeStatus(activeId, button.dataset.status);
      }
    });
  }

  document.getElementById('confirmAcceptBtn')?.addEventListener('click', async () => {
    if (!state.selectedOrderIdForAccept) return closeAcceptModal();
    if (state.activeJobId && Number(state.activeJobId) !== Number(state.selectedOrderIdForAccept)) {
      showError('Trabajo activo', 'Ya tienes un trabajo en progreso. Complétalo antes de aceptar otro.');
      return closeAcceptModal();
    }

    const orderId = state.selectedOrderIdForAccept;
    const { success, error } = await OrderManager.acceptOrder(orderId);

    if (success) {
      showSuccess('¡Solicitud aceptada!', 'El trabajo ahora es tuyo.');
      state.activeJobId = orderId;

      // Actualización optimista
      const order = state.allOrders.find(o => o.id === orderId);
      if (order) {
        order.assigned_to = state.collabSession.user.id;
        order.status = 'En proceso';
        order.last_collab_status = 'en_camino_recoger';
        showActiveJob(order);
        saveActiveJob(order); // Guardar el trabajo activo de forma robusta
        document.getElementById('ordersCardContainer')?.classList.add('hidden');
        document.getElementById('pendingSection')?.classList.add('hidden');
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
      const ok = confirm('¿Cancelar este trabajo activo? Esto marcará la solicitud como Cancelada.');
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

// Manejo del estado de conexión y sincronización automática
function setupConnectionHandlers() {
  try {
    // Estado inicial basado en el navegador
    state.isOnline = navigator.onLine;

    // Listener: conexión restablecida
    window.addEventListener('online', async () => {
      state.isOnline = true;
      try { if (window.notifications?.success) window.notifications.success('Sincronizando cambios pendientes...', { title: 'Conexión restablecida' }); } catch(_) {}
      try { if (typeof showSuccess === 'function') showSuccess('Conexión restablecida', 'Sincronizando cambios pendientes...'); } catch(_) {}
      try {
        await syncPendingStatusUpdates();
        // Refrescar datos para reflejar posibles cambios
        await loadInitialOrders();
      } catch (err) {
        console.warn('[Conexión] Error al sincronizar tras reconexión:', err);
      }
    });

    // Listener: se pierde la conexión
    window.addEventListener('offline', () => {
      state.isOnline = false;
      try { if (typeof showWarning === 'function') showWarning('Sin conexión', 'Los cambios se guardarán localmente y se sincronizarán al volver.'); } catch(_) {}
    });

    // Chequeo periódico por si los eventos del navegador fallan
    if (state.connectionCheckInterval) clearInterval(state.connectionCheckInterval);
    state.connectionCheckInterval = setInterval(async () => {
      const nowOnline = navigator.onLine;
      if (nowOnline && !state.isOnline) {
        // Detectamos reconexión
        state.isOnline = true;
        try { if (typeof showSuccess === 'function') showSuccess('Conexión restablecida', 'Sincronizando cambios pendientes...'); } catch(_) {}
        try {
          await syncPendingStatusUpdates();
        } catch (err) {
          console.warn('[Conexión] Error en chequeo periódico de sincronización:', err);
        }
      } else if (!nowOnline && state.isOnline) {
        // Detectamos desconexión
        state.isOnline = false;
        try { if (typeof showWarning === 'function') showWarning('Sin conexión', 'Trabajarás en modo offline temporalmente.'); } catch(_) {}
      }
    }, 15000);
  } catch (err) {
    console.warn('[Conexión] No se pudo inicializar manejadores de conexión:', err);
  }
}

// --- INICIALIZACIÓN ---

// La sesión ya fue verificada al inicio del IIFE.
state.collabSession = session;

if (window.lucide) lucide.createIcons();
setupAriaCurrent();
setupEventListeners();
setupConnectionHandlers();
// setupTabs(); // Eliminado

supabaseConfig.client.auth.onAuthStateChange((_event, newSession) => {
  state.collabSession = newSession;
});

updateCollaboratorProfile(session);

ui.loadingIndicator.classList.remove('hidden');
ui.ordersCardContainer.classList.add('hidden');

// Intentar sincronizar cambios pendientes antes de cargar
await syncPendingStatusUpdates();

await loadInitialOrders();
await restoreActiveJob(); // Mover aquí para que se ejecute inmediatamente después de cargar las órdenes

ui.loadingIndicator.classList.add('hidden');

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
    // Persistir trabajo activo mientras no esté entregado ni cancelado
    try {
      if (newStatus !== 'entregado' && newStatus !== 'cancelado') {
        saveActiveJob(state.allOrders[idx]);
      } else {
        clearActiveJob();
      }
    } catch (e) {
      console.warn('[Persistencia] No se pudo guardar/limpiar trabajo activo:', e?.message);
    }
  }
  updateActiveJobView();
}

if (supabaseConfig.client && !supabaseConfig.useLocalStorage) {
  let rtTimer;
  const debouncedRealtime = (payload) => {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(() => {
      handleRealtimeUpdate(payload);
    }, 200);
  };
  supabaseConfig.client
    .channel('public:orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debouncedRealtime)
    .subscribe();
} else {
  setInterval(filterAndRender, 5000);
}

/**
 * ✅ REFACTORIZADO: Busca y muestra el trabajo activo guardado en localStorage.
 * Si no es válido, limpia el estado y vuelve a la vista de órdenes para evitar
 * una pantalla en blanco.
 */
async function restoreActiveJob() {
  // Cargar desde localStorage usando la clave específica del usuario
  const savedJob = loadActiveJob();
  if (savedJob) {
    state.activeJobId = savedJob.orderId;
    console.log(`[Persistencia] Trabajo activo cargado desde localStorage: #${state.activeJobId}`);
  }

  if (state.activeJobId) {
    let order = state.allOrders.find(o => o.id === state.activeJobId);
    const assignedId = order?.assigned_to;
    const lastStatus = order?.last_collab_status;
    
    // Condición para un trabajo activo válido
    if (order && assignedId === state.collabSession.user.id && lastStatus !== 'entregado' && order.status !== 'Completada' && order.status !== 'Cancelada') {
      console.log(`[Cache] Restaurando trabajo activo #${order.id}`);
      showActiveJob(order);
      // Guardar el trabajo activo actualizado
      saveActiveJob(order);
      document.getElementById('ordersCardContainer')?.classList.add('hidden');
      document.getElementById('pendingSection')?.classList.add('hidden');
      return; // Éxito: Salir de la función
    }

    // Fallback: si no está en memoria, intentar cargarlo desde Supabase
    try {
      const { data, error } = await supabaseConfig.client
        .from('orders')
        .select('*, service:services(name), vehicle:vehicles(name)')
        .eq('id', state.activeJobId)
        .single();
      if (!error && data && data.assigned_to === state.collabSession.user.id && (data.last_collab_status !== 'entregado')) {
        order = {
          ...data,
          service: data.service?.name || data.service || 'Sin servicio',
          vehicle: data.vehicle?.name || data.vehicle || 'Sin vehículo',
          origin_coords: parseCoordinates(data.origin_coords),
          destination_coords: parseCoordinates(data.destination_coords)
        };
        showActiveJob(order);
        saveActiveJob(order);
        document.getElementById('ordersCardContainer')?.classList.add('hidden');
        document.getElementById('pendingSection')?.classList.add('hidden');
        return;
      }
    } catch (e) { console.warn('[Continuidad] Fallback activo desde Supabase falló:', e?.message || e); }

    // Si la condición falla, el trabajo en caché es inválido.
    console.warn(`[Cache] El trabajo activo #${state.activeJobId} ya no es válido. Limpiando.`);
    clearActiveJob(); // Limpiar localStorage también
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
    'Completada': `Tu pedido #${order.id} ha sido completada exitosamente. ¡Gracias!`,
    'Cancelada': `Tu pedido #${order.id} ha sido cancelada.`
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
