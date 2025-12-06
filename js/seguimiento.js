// Espera a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
  // --- ELEMENTOS DEL DOM ---
  const loginScreen = document.getElementById('loginScreen');
  const trackingScreen = document.getElementById('trackingScreen');
  const orderIdInput = document.getElementById('orderIdInput');
  const trackButton = document.getElementById('trackButton');
  const errorMessage = document.getElementById('errorMessage');

  // Elementos de la pantalla de seguimiento
  const orderTitle = document.getElementById('orderTitle');
  const orderDate = document.getElementById('orderDate');
  const orderStatus = document.getElementById('orderStatus');
  const orderDetails = document.getElementById('orderDetails');
  const scheduledTimeSection = document.getElementById('scheduledTimeSection');
  const scheduledTime = document.getElementById('scheduledTime');
  const timeline = document.getElementById('timeline');
  const photoSection = document.getElementById('photoSection');
  const photoGallery = document.getElementById('photoGallery');
  const mapDetails = document.getElementById('mapDetails');

  // Mapa de Leaflet
  let map = null;
  let pickupMarker = null;
  let deliveryMarker = null;
  let routeLine = null;

  // --- LÓGICA PRINCIPAL ---

  // Función para mostrar errores en la pantalla de login
  function showLoginError(message) {
    errorMessage.querySelector('p').textContent = message;
    errorMessage.classList.remove('hidden');
  }

  // Función para buscar la orden
  async function trackOrder() {
    const id = orderIdInput.value.trim();
    if (!id) {
      showLoginError('Por favor, ingresa un ID de orden.');
      return;
    }

    trackButton.disabled = true;
    trackButton.textContent = 'Buscando...';
    errorMessage.classList.add('hidden');

    try {
      await supabaseConfig.ensureFreshSession();
      // Determinar si el ID es secuencial (número) o UUID
      const isNumericId = /^\d+$/.test(id);
      const columnName = isNumericId ? 'id' : 'short_id';
      let order = null;
      let error = null;
      try {
        const r = await supabaseConfig.client
          .from('orders')
          .select(`
            *,
            service:services(name),
            vehicle:vehicles(name)
          `)
          .eq(columnName, id)
          .maybeSingle();
        order = r.data;
        error = r.error || null;
      } catch (e) {
        error = e;
      }
      if (error && (String(error.message || '').toLowerCase().includes('jwt expired') || (error.status === 401))) {
        const publicClient = supabaseConfig.getPublicClient();
        const r2 = await publicClient
          .from('orders')
          .select(`
            *,
            service:services(name),
            vehicle:vehicles(name)
          `)
          .eq(columnName, id)
          .maybeSingle();
        order = r2.data;
        error = r2.error || null;
      }
      if (error) {
        throw new Error(error.message || String(error));
      }

      if (!order) {
        showLoginError('No se encontró ninguna orden con ese ID. Verifica la información e inténtalo de nuevo.');
        return;
      }

      let collaboratorName = '';
      try {
        if (order.assigned_to) {
          const { data: collab } = await supabaseConfig.client
            .from('collaborators')
            .select('name')
            .eq('id', order.assigned_to)
            .maybeSingle();
          collaboratorName = collab?.name || '';
        }
      } catch (_) {}
      order.collaborator_name = collaboratorName;
      
      renderTrackingInfo(order);
      loginScreen.classList.add('hidden');
      trackingScreen.classList.remove('hidden');

      // Inicializar el mapa con las coordenadas de la orden
      initializeMap(order);

    } catch (error) {
      console.error('Error al buscar la orden:', error);
      showLoginError('Ocurrió un error al conectar con el servidor. Intenta más tarde.');
    } finally {
      trackButton.disabled = false;
      trackButton.textContent = 'Buscar Solicitud';
    }
  }

  // Función para renderizar toda la información de seguimiento
  function renderTrackingInfo(order) {
    // --- 1. Renderizar Título y Estado ---
    orderTitle.textContent = `Orden #${order.short_id || order.id}`;
    orderDate.textContent = `Creada el ${new Date(order.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}`;

    // Limpiar clases de estado anteriores y añadir la nueva
    orderStatus.className = 'status-badge'; // Resetea
    const statusClass = `status-${(order.status || 'Pendiente').replace(/\s+/g, '-')}`;
    orderStatus.classList.add(statusClass);
    orderStatus.textContent = order.status;

    // --- 2. Renderizar Detalles de la Orden ---
    orderDetails.innerHTML = `
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Servicio</p>
        <p class="text-gray-800">${order.service?.name || 'No especificado'}</p>
      </div>
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Cliente</p>
        <p class="text-gray-800">${order.name || 'No especificado'}</p>
      </div>
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Origen</p>
        <p class="text-gray-800 truncate" title="${order.pickup}">${order.pickup || 'No especificado'}</p>
      </div>
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Destino</p>
        <p class="text-gray-800 truncate" title="${order.delivery}">${order.delivery || 'No especificado'}</p>
      </div>
      ${order.collaborator_name ? `
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Asignado a</p>
        <p class="text-gray-800">${order.collaborator_name}</p>
      </div>` : ''}
      ${order.vehicle ? `
      <div class="detail-item">
        <p class="font-semibold text-gray-500">Vehículo</p>
        <p class="text-gray-800">${order.vehicle.name}</p>
      </div>` : ''}
    `;

    // --- 3. Mostrar Fecha Programada ---
    if (order.date) {
      scheduledTime.textContent = `${new Date(order.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${order.time ? `a las ${order.time}` : ''}`;
      scheduledTimeSection.classList.remove('hidden');
    } else {
      scheduledTimeSection.classList.add('hidden');
    }

    // --- 4. Renderizar Timeline ---
    const history = Array.isArray(order.tracking_data) ? order.tracking_data : [];
    renderTimeline(history, order.status);

    // --- 5. Renderizar Galería de Fotos ---
    const evidenceArr = Array.isArray(order.evidence_photos) ? order.evidence_photos : [];
    if (evidenceArr.length > 0) {
      photoGallery.innerHTML = '';
      evidenceArr.forEach(item => {
        let url = '';
        if (typeof item === 'string') {
          url = item;
        } else if (item && (item.url || item.public_url)) {
          url = item.url || item.public_url;
        } else if (item && item.path) {
          const b = item.bucket || (supabaseConfig.getEvidenceBucket ? supabaseConfig.getEvidenceBucket() : (supabaseConfig.buckets && supabaseConfig.buckets.evidence) ? supabaseConfig.buckets.evidence : 'order-evidence');
          try {
            const pub = supabaseConfig.client.storage.from(b).getPublicUrl(item.path);
            url = pub?.data?.publicUrl || '';
          } catch (_) { url = ''; }
        }
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.innerHTML = `<img src="${url}" alt="Evidencia del servicio" class="w-full h-32 object-cover rounded-lg shadow-md hover:shadow-xl transition-shadow">`;
        photoGallery.appendChild(a);
      });
      photoSection.classList.remove('hidden');
    } else {
      photoSection.classList.add('hidden');
    }

    // Re-inicializar iconos
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // Función para renderizar el historial de estados (Timeline)
  function renderTimeline(history, currentStatus) {
    timeline.innerHTML = ''; // Limpiar timeline
    const statusOrder = ['Pendiente', 'Aceptada', 'En camino a recoger', 'Cargando', 'En curso', 'En camino a entregar', 'En origen', 'En destino', 'Retraso por tapón', 'Completada'];
    const statusLabels = {
      'Pendiente': 'Orden Recibida',
      'Aceptada': 'Orden Aceptada',
      'En camino a recoger': 'En Camino al Origen',
      'Cargando': 'Cargando en Origen',
      'En curso': 'Servicio en Progreso',
      'En camino a entregar': 'En Camino al Destino',
      'En origen': 'Llegada al Origen',
      'En destino': 'Llegada al Destino',
      'Retraso por tapón': 'Retraso por Tráfico',
      'Completada': 'Servicio Completado'
    };

    if (!history || history.length === 0) {
      // Si no hay historial, mostrar solo el estado actual
      history = [{ status: currentStatus, at: new Date().toISOString() }];
    }

    // Normalizar y ordenar por fecha (soporta claves 'at' y 'date')
    const normalized = history.map(h => ({
      status: h.status || h.new_status || h.label || 'Pendiente',
      notes: h.notes || h.comment || null,
      timestamp: h.at || h.date || h.timestamp || h.time || new Date().toISOString()
    })).filter(h => !!h.status);
    normalized.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    normalized.forEach(event => {

      const time = new Date(event.timestamp);
      const formattedTime = time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const formattedDate = time.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

      const item = document.createElement('div');
      item.className = 'timeline-item';
      
      // Marcar como activo si es el estado actual o uno anterior en el flujo
      const currentIndex = statusOrder.indexOf(currentStatus);
      const eventIndex = statusOrder.indexOf(event.status);
      if (eventIndex !== -1 && eventIndex <= currentIndex) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <div class="font-semibold text-gray-800">${statusLabels[event.status] || event.status}</div>
        <div class="text-sm text-gray-500">${formattedDate}, ${formattedTime}</div>
        ${event.notes ? `<p class="text-xs text-gray-600 mt-1 pl-2 border-l-2 border-gray-200">${event.notes}</p>` : ''}
      `;
      timeline.appendChild(item);
    });

    // Actualizar el indicador de "última actualización" cada vez que se renderiza el timeline
    try { updateTimelineRealtimeIndicator(); } catch(_) {}
  }

  // Actualiza el indicador visual y la hora de la última actualización
  function updateTimelineRealtimeIndicator(timestamp) {
    try {
      const container = document.getElementById('timelineRealtimeIndicator');
      const lastEl = document.getElementById('timelineLastUpdated');
      const dot = container ? container.querySelector('.realtime-dot') : null;
      if (!container || !lastEl) return;
      const t = timestamp ? new Date(timestamp) : new Date();
      // Formato: HH:MM:SS (local) — se puede ajustar
      lastEl.textContent = 'Actualizado: ' + t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (dot) {
        dot.classList.remove('offline');
        dot.classList.add('pulse-flash');
        setTimeout(() => { try { dot.classList.remove('pulse-flash'); } catch(_){} }, 1200);
      }
    } catch (_) {}
  }

  // --- LÓGICA DEL MAPA ---

  // Función para inicializar el mapa de Leaflet
  function initializeMap(order) {
    // Coordenadas por defecto (Santo Domingo) si no hay datos
    const defaultCoords = { lat: 18.4861, lng: -69.9312 };
    const pickupCoords = order.pickup_coords || defaultCoords;
    const deliveryCoords = order.delivery_coords;

    if (!map) {
      map = L.map('trackingMap').setView([pickupCoords.lat, pickupCoords.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
    } else {
      // Limpiar marcadores y rutas anteriores
      if (pickupMarker) map.removeLayer(pickupMarker);
      if (deliveryMarker) map.removeLayer(deliveryMarker);
      if (routeLine) map.removeLayer(routeLine);
    }

    // Iconos personalizados
    const originIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    const destinationIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    // Añadir marcador de origen
    pickupMarker = L.marker([pickupCoords.lat, pickupCoords.lng], { icon: originIcon })
      .addTo(map)
      .bindPopup(`<b>Origen:</b><br>${order.pickup}`);

    mapDetails.innerHTML = `<p><b>📍 Origen:</b> ${order.pickup}</p>`;

    const bounds = [[pickupCoords.lat, pickupCoords.lng]];

    // Añadir marcador de destino si existe
    if (deliveryCoords && deliveryCoords.lat && deliveryCoords.lng) {
      deliveryMarker = L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: destinationIcon })
        .addTo(map)
        .bindPopup(`<b>Destino:</b><br>${order.delivery}`);
      
      mapDetails.innerHTML += `<p><b>🏁 Destino:</b> ${order.delivery}</p>`;
      
      bounds.push([deliveryCoords.lat, deliveryCoords.lng]);

      // Dibujar línea de ruta
      routeLine = L.polyline(bounds, { color: '#2563eb', weight: 5 }).addTo(map);
    }

    // Ajustar el zoom del mapa para mostrar todos los marcadores
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] }); // Añade un padding de 50px
    }
  }

  // --- EVENT LISTENERS ---

  // Listener para el botón de búsqueda
  trackButton.addEventListener('click', trackOrder);

  // Listener para la tecla "Enter" en el campo de ID
  orderIdInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      trackOrder();
    }
  });

  // --- INICIALIZACIÓN ---

  // Suscripción en tiempo real para actualizaciones de la orden
  let orderSubscription = null;
  let pollingTimer = null;
  let lastOrderIdSubscribed = null;
  async function subscribeToOrderUpdates(orderId) {
    try {
      if (orderSubscription) {
        try { supabaseConfig.client.removeChannel(orderSubscription); } catch(_) {}
      }

      // Si no hay conexión, activar modo polling y evitar abrir WebSocket
      if (!navigator.onLine) {
        try { if (pollingTimer) clearInterval(pollingTimer); } catch(_){}
        lastOrderIdSubscribed = orderId;
        pollingTimer = setInterval(async () => {
          try {
            const { data: order } = await supabaseConfig.client
              .from('orders')
              .select('*, service:services(name), vehicle:vehicles(name)')
              .eq('id', orderId)
              .maybeSingle();
            if (order) {
              renderTrackingInfo(order);
              initializeMap(order);
              try { updateTimelineRealtimeIndicator(); } catch(_){}
            }
          } catch(_){}
        }, 10000);
        return;
      } else {
        try { if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; } } catch(_){}
      }

      lastOrderIdSubscribed = orderId;
      orderSubscription = supabaseConfig.client
        .channel('public:orders_tracking_' + orderId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'id=eq.' + orderId }, async () => {
          try {
            const { data: order } = await supabaseConfig.client
              .from('orders')
              .select('*, service:services(name), vehicle:vehicles(name)')
              .eq('id', orderId)
              .maybeSingle();
            if (order) {
              renderTrackingInfo(order);
              initializeMap(order);
            }
          } catch (e) { console.warn('Realtime update failed', e); }
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            // Fallback: activar polling si el canal falla
            try { if (pollingTimer) clearInterval(pollingTimer); } catch(_){}
            pollingTimer = setInterval(async () => {
              try {
                const { data: order } = await supabaseConfig.client
                  .from('orders')
                  .select('*, service:services(name), vehicle:vehicles(name)')
                  .eq('id', orderId)
                  .maybeSingle();
                if (order) {
                  renderTrackingInfo(order);
                  initializeMap(order);
                  try { updateTimelineRealtimeIndicator(); } catch(_){}
                }
              } catch(_){}
            }, 10000);
          }
        });
    } catch (e) { console.warn('Realtime subscribe fail', e); }
  }

  // Función para verificar si hay un ID en la URL al cargar la página
  function checkUrlForOrderId() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('codigo') || params.get('id');
    if (orderId) {
      orderIdInput.value = orderId;
      trackOrder().then(() => {
        const isNumericId = /^\d+$/.test(orderId);
        const idForSub = isNumericId ? Number(orderId) : null;
        if (idForSub) subscribeToOrderUpdates(idForSub);
      });
    }
  }

  // Inicializar iconos de Lucide
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Comprobar si hay un ID en la URL al cargar
  checkUrlForOrderId();

  // Indicador online/offline: cambia el punto a naranja si está offline
  function setRealtimeDotOnline(online) {
    try {
      const dot = document.querySelector('#timelineRealtimeIndicator .realtime-dot');
      if (!dot) return;
      if (online) dot.classList.remove('offline'); else dot.classList.add('offline');
    } catch(_) {}
  }

  window.addEventListener('online', () => {
    setRealtimeDotOnline(true);
    try { updateTimelineRealtimeIndicator(); } catch(_){}
    if (lastOrderIdSubscribed) {
      // Reintentar suscripción en tiempo real al recuperar conexión
      subscribeToOrderUpdates(lastOrderIdSubscribed);
    }
  });
  window.addEventListener('offline', () => {
    setRealtimeDotOnline(false);
    try { updateTimelineRealtimeIndicator(); } catch(_){}
    if (lastOrderIdSubscribed) {
      // Cambiar a modo polling mientras está sin conexión
      subscribeToOrderUpdates(lastOrderIdSubscribed);
    }
  });
  // Estado inicial
  setRealtimeDotOnline(navigator.onLine);
});

// Indicador de latencia de notificaciones
document.addEventListener('DOMContentLoaded', () => {
  try {
    const el = document.getElementById('notifLatencyIndicator');
    if (!el) return;
    const v = localStorage.getItem('tlc_outbox_latency_ms');
    if (v) {
      const ms = parseInt(v, 10);
      if (!isNaN(ms)) el.textContent = 'Notificaciones en tiempo real (latencia: ' + ms + ' ms)';
    }
  } catch(_) {}
});

// Auto-recarga suave: cada 30s si visible
document.addEventListener('DOMContentLoaded', () => {
  let last = Date.now();
  function tick(){
    const now = Date.now();
    const diff = now - last;
    if (document.visibilityState === 'visible' && diff >= 30000) {
      location.reload();
    }
  }
  setInterval(tick, 5000);
});
