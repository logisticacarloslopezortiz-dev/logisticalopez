document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // --- DOM Elements ---
    const loginScreen = document.getElementById('loginScreen');
    const trackingScreen = document.getElementById('trackingScreen');
    const orderIdInput = document.getElementById('orderIdInput');
    const trackButton = document.getElementById('trackButton');
    const errorMessage = document.getElementById('errorMessage');
    const newOrderButton = document.getElementById('newOrderButton');
    let currentSubscription = null;
    let trackingMap = null;
    let currentOrder = null; // ✅ NUEVO: Variable global para mantener el estado de la orden

    // --- Event Listeners ---
    trackButton.addEventListener('click', findOrder);
    orderIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') findOrder();
    });
    newOrderButton.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // --- Main Logic ---

    // Limpiar suscripción al salir de la página
    window.addEventListener('beforeunload', () => {
        if (currentSubscription) {
            try { if (typeof currentSubscription.unsubscribe === 'function') currentSubscription.unsubscribe(); } catch (_) {}
            currentSubscription = null;
        }
    });

    // Función para buscar la orden en Supabase
    async function findOrder() {
        const orderIdValue = orderIdInput.value.trim();
        if (!orderIdValue) {
            showError('Por favor, ingresa un ID de orden.');
            return;
        }

        // Mostrar un estado de carga
        trackButton.disabled = true;
        trackButton.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 inline mr-2 animate-spin"></i> Buscando...';
        lucide.createIcons();
        hideError();

        // Cancelar suscripción anterior si existe (usar unsubscribe si está disponible)
        if (currentSubscription) {
            try {
                if (typeof currentSubscription.unsubscribe === 'function') {
                    currentSubscription.unsubscribe();
                } else if (supabaseConfig.client && typeof supabaseConfig.client.removeChannel === 'function') {
                    // fallback a método legacy
                    supabaseConfig.client.removeChannel(currentSubscription);
                }
            } catch (e) {
                console.warn('No se pudo remover la suscripción anterior:', e);
            }
            currentSubscription = null;
        }

        try {
            // Nuevo sistema de IDs seguros:
            // - client_tracking_id: 32 caracteres hex aleatorio para clientes
            // - supabase_seq_id: ID secuencial interno (números)
            // - id: UUID primario
            const looksLikeShortId = /^ORD-\w+/i.test(orderIdValue);
            const isHex32 = /^[0-9a-f]{32}$/i.test(orderIdValue);
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdValue);
            const isNumeric = /^[0-9]+$/.test(orderIdValue);

            let query = supabaseConfig.client
                .from('orders')
                .select('*, service:services(name), vehicle:vehicles(name)');

            if (isHex32) {
                query = query.eq('client_tracking_id', orderIdValue.toLowerCase());
            } else if (isUUID) {
                query = query.eq('id', orderIdValue);
            } else if (isNumeric) {
                query = query.eq('supabase_seq_id', Number(orderIdValue));
            } else if (looksLikeShortId) {
                // Compatibilidad con formato anterior
                query = query.eq('short_id', orderIdValue);
            } else {
                throw new Error('Formato de ID no válido. Use: ID de seguimiento (32 hex), ID secuencial (números) o UUID');
            }

            // Intentar asegurar sesión fresca antes de la consulta
            try { await supabaseConfig.ensureFreshSession(); } catch (_) {}

            let { data: order, error } = await query.single(); // .single() espera un solo resultado o ninguno

            // Si fallo por JWT expirado, intentar con cliente público (anon) para lecturas públicas
            if (error && (error.code === 'PGRST303' || error.status === 401 || /jwt expired/i.test(String(error.message || '')))) {
                console.warn('JWT expirado o no autorizado para buscar orden. Reintentando con cliente anon...');
                try {
                    const publicClient = supabaseConfig.getPublicClient();
                    const publicQuery = publicClient.from('orders').select('*, service:services(name), vehicle:vehicles(name)');
                    if (isHex32) publicQuery.eq('client_tracking_id', orderIdValue.toLowerCase());
                    else if (isUUID) publicQuery.eq('id', orderIdValue);
                    else if (isNumeric) publicQuery.eq('supabase_seq_id', Number(orderIdValue));
                    else if (looksLikeShortId) publicQuery.eq('short_id', orderIdValue);
                    else throw new Error('Formato de ID no válido.');
                    const resp = await publicQuery.single();
                    order = resp.data;
                    error = resp.error;
                } catch (e) {
                    console.error('Error al intentar con cliente anon:', e);
                }
            }

            if (error || !order) {
                throw new Error('No se encontró ninguna solicitud con ese ID.');
            }

            currentOrder = order; // ✅ CORRECCIÓN: Guardar la orden en la variable global
            displayOrderDetails(currentOrder);

            // Suscribirse a cambios en tiempo real para esta orden
            // Suscribirse usando el ID primario tal cual (puede ser UUID)
            subscribeToOrderUpdates(currentOrder.id);

        } catch (err) {
            showError(err.message);
        } finally {
            // Restaurar botón
            trackButton.disabled = false;
            trackButton.innerHTML = '<i data-lucide="search" class="w-4 h-4 inline mr-2"></i> Buscar Solicitud';
            lucide.createIcons();
        }
    }

    // Función para suscribirse a los cambios de una orden específica
    function subscribeToOrderUpdates(orderId) {
        try {
            // Crear un canal único por orden para poder manejar unsubscribe fácilmente
            const channelName = `orders:watch:${orderId}`;
            const channel = supabaseConfig.client.channel(channelName);

            // Manejar INSERT / UPDATE / DELETE para la orden específica
            channel.on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${orderId}`
            }, (payload) => {
                // payload tiene .new y .old en eventos UPDATE/INSERT/DELETE
                const newRecord = payload.new || null;
                const oldRecord = payload.old || null;

                if (payload.eventType === 'UPDATE' && payload.new) {
                    // ✅ CORRECCIÓN: Actualizar la orden global y volver a renderizar
                    currentOrder = { ...currentOrder, ...payload.new };
                    displayOrderDetails(currentOrder);

                    // Opcional: notificar si el estado principal cambió
                    if (payload.new.status && payload.old.status !== payload.new.status) {
                        showStatusNotification(payload.new.status);
                    }
                }

                // En DELETE, mostrar mensaje y volver al login/inicio
                if (payload.eventType === 'DELETE') {
                    showError('La orden fue eliminada.');
                }

                // También propagar cambio al arreglo local si existe (para mantener sincronía)
                try { handleRealtimeUpdate({ eventType: payload.eventType, new: newRecord, old: oldRecord }); } catch (e) { /* noop */ }
            });

            // Suscribir y guardar referencia para poder anular más tarde
            currentSubscription = channel.subscribe();
            currentSubscription.channel = channel; // referencia al channel original
        } catch (e) {
            console.warn('No se pudo suscribir a cambios en tiempo real para la orden:', e);
        }
    }
    
    // Función para mostrar notificación de cambio de estado
    function showStatusNotification(status) {
        // Verificar si el navegador soporta notificaciones
        if (!("Notification" in window)) {
            console.log("Este navegador no soporta notificaciones de escritorio");
            return;
        }
        
        // Textos según el estado
        const statusMessages = {
            'Pendiente': 'Tu solicitud está pendiente de confirmación',
            'Aceptada': 'Un colaborador ha sido asignado a tu solicitud',
            'En curso': 'Tu servicio está en proceso',
            'Completada': 'Tu servicio ha sido completado exitosamente',
            'Cancelado': 'Tu solicitud ha sido cancelada',
            // Estados de acción del colaborador
            'en_camino_recoger': 'El colaborador está en camino a recoger',
            'cargando': 'El colaborador está cargando el servicio',
            'en_camino_entregar': 'En camino a la entrega',
            'entregado': 'Tu servicio ha sido entregado'
        };
        
        const title = '¡Actualización de tu solicitud!';
        const options = {
            body: statusMessages[status] || `Estado actualizado a: ${displayStatusText(status)}`,
            icon: 'img/logo-192.png',
            badge: 'img/badge-96.png',
            vibrate: [200, 100, 200]
        };
        
        // Verificar permiso y mostrar notificación
        if (Notification.permission === "granted") {
            new Notification(title, options);
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification(title, options);
                }
            });
        }
    }

    // Función para mostrar los detalles de la orden
    function displayOrderDetails(order) {
        loginScreen.classList.add('hidden');
        trackingScreen.classList.remove('hidden');

        // Poblar Header
        const orderLabel = (order.supabase_seq_id != null) ? `#${order.supabase_seq_id}` : `#${order.id}`;
        document.getElementById('orderTitle').textContent = `Orden ${orderLabel}`;
        document.getElementById('orderDate').textContent = `Creada el ${new Date(order.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}`;
        
        const statusBadge = document.getElementById('orderStatus');
        const statusText = displayStatusText(order.status);
        statusBadge.textContent = statusText;
        statusBadge.className = 'status-badge ' + getStatusClass(order.status);

        // Poblar Detalles
        const detailsContainer = document.getElementById('orderDetails');
        detailsContainer.innerHTML = `
            <div>
                <p class="text-sm text-gray-500">Cliente</p>
                <p class="font-semibold text-gray-800">${order.name}</p>
            </div>
            <div>
                <p class="text-sm text-gray-500">Servicio</p>
                <p class="font-semibold text-gray-800">${order.service?.name || 'No especificado'}</p>
            </div>
            <div>
                <p class="text-sm text-gray-500">Vehículo</p>
                <p class="font-semibold text-gray-800">${order.vehicle?.name || 'No especificado'}</p>
            </div>
            <div>
                <p class="text-sm text-gray-500">Fecha Programada</p>
                <p class="font-semibold text-gray-800">${order.date} a las ${order.time}</p>
            </div>
            <div class="md:col-span-2">
                <p class="text-sm text-gray-500">Ruta</p>
                <p class="font-semibold text-gray-800">
                    <span class="font-normal">Desde:</span> ${order.pickup} <br>
                    <span class="font-normal">Hasta:</span> ${order.delivery}
                </p>
            </div>
        `;

        // Poblar Timeline
        const timelineContainer = document.getElementById('timeline');
        timelineContainer.innerHTML = ''; // Limpiar

        const timelineEvents = new Map();

        // Función para añadir eventos evitando duplicados por nombre
        const addEvent = (name, date) => {
            if (name && date && !timelineEvents.has(name)) {
                const pretty = prettyTimelineLabel(name);
                timelineEvents.set(pretty, new Date(date));
            }
        };

        // 1. Añadir todos los eventos del tracking_data (fuente principal de verdad)
        if (Array.isArray(order.tracking_data)) {
            order.tracking_data.forEach(trackPoint => addEvent(trackPoint.status, trackPoint.date));
        }

        // 2. Añadir eventos clave que podrían no estar en tracking_data, como respaldo
        addEvent('Solicitud Creada', order.created_at);
        if (order.assigned_at) addEvent('Servicio Asignado', order.assigned_at);
        if (order.completed_at) addEvent('Servicio Completado', order.completed_at);

        // Convertir el mapa a un array, ordenar por fecha y renderizar
        Array.from(timelineEvents.entries())
            .sort(([, dateA], [, dateB]) => dateA - dateB)
            .forEach(([name, date]) => {
                const item = document.createElement('div');
                item.className = 'timeline-item active';
                item.innerHTML = `
                    <h4 class="font-semibold text-gray-800">${name}</h4>
                    <p class="text-sm text-gray-500">${date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                `;
                timelineContainer.appendChild(item);
            });

        // ✅ NUEVO: Inicializar el mapa con las coordenadas de la orden
        initializeMap(order);

        // ✅ NUEVO: Mostrar galería de fotos si existen
        const photoSection = document.getElementById('photoSection');
        const photoGallery = document.getElementById('photoGallery');
        const photos = order.evidence_photos || []; // Asumimos que las URLs están en un campo 'evidence_photos'

        if (photos.length > 0) {
            photoGallery.innerHTML = photos.map(url => `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="block rounded-lg overflow-hidden border-2 border-gray-200 hover:border-blue-500 transition">
                    <img src="${url}" alt="Evidencia del servicio" class="w-full h-32 object-cover">
                </a>
            `).join('');
            photoSection.classList.remove('hidden');
        } else {
            photoSection.classList.add('hidden');
        }
    }

    // ✅ NUEVO: Función para inicializar y dibujar en el mapa
    function initializeMap(order) {
        if (!trackingMap) { // Inicializar el mapa solo una vez
            trackingMap = L.map('trackingMap').setView([18.4861, -69.9312], 9); // Vista por defecto en RD
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(trackingMap);
        }

        // Limpiar marcadores y líneas anteriores
        trackingMap.eachLayer(layer => {
            if (!!layer.toGeoJSON) { // Solo remover capas de datos (marcadores, polilíneas)
                trackingMap.removeLayer(layer);
            }
        });

        const origin = order.origin_coords;
        const destination = order.destination_coords;

        if (origin && destination) {
            const originLatLng = [origin.lat, origin.lng];
            const destLatLng = [destination.lat, destination.lng];

            // Marcadores
            L.marker(originLatLng).addTo(trackingMap).bindPopup('Punto de Origen');
            L.marker(destLatLng).addTo(trackingMap).bindPopup('Punto de Destino');

            // Línea de ruta
            L.polyline([originLatLng, destLatLng], { color: '#2563eb', weight: 5 }).addTo(trackingMap);

            // Ajustar el mapa para mostrar la ruta completa
            trackingMap.fitBounds([originLatLng, destLatLng], { padding: [50, 50] });
        }
    }

    // --- Funciones de Utilidad ---
    function showError(message) {
        errorMessage.classList.remove('hidden');
        errorMessage.querySelector('p').textContent = message;
    }

    function hideError() {
        errorMessage.classList.add('hidden');
    }

    function getStatusClass(status) {
        const mapped = displayStatusText(status);
        const statusClasses = {
            'Pendiente': 'status-pending',
            'Asignado': 'status-assigned',
            'En proceso': 'status-in-progress',
            'Completado': 'status-completed',
            'Cancelado': 'status-canceled'
        };
        return statusClasses[mapped] || 'status-pending';
    }

    function displayStatusText(status) {
        if (!status) return 'Pendiente';
        if (status === 'Aceptada') return 'Asignado';
        if (status === 'En curso') return 'En proceso';
        if (status === 'Completada') return 'Completado';
        if (status === 'Pendiente') return 'Pendiente';
        if (status === 'Cancelado') return 'Cancelado';
        const actionMap = {
            'en_camino_recoger': 'En camino a recoger',
            'cargando': 'Cargando',
            'en_camino_entregar': 'En camino a entregar',
            'entregado': 'Entregado'
        };
        return actionMap[status] || status;
    }

    function prettyTimelineLabel(raw) {
        const map = {
            'en_camino_recoger': 'En camino a recoger',
            'cargando': 'Cargando',
            'en_camino_entregar': 'En camino a entregar',
            'entregado': 'Entregado',
            'Aceptada': 'Servicio Asignado',
            'Completada': 'Servicio Completado'
        };
        return map[raw] || raw;
    }

    // --- Inicialización ---
    async function init() {
        const params = new URLSearchParams(window.location.search);
        const orderIdFromUrl = params.get('order') || params.get('codigo');

        if (orderIdFromUrl) {
            orderIdInput.value = orderIdFromUrl;
            await findOrder();
        }
    }

    init();
});