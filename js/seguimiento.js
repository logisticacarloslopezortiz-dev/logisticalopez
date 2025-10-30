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
    let currentSubscription = null; // Para gestionar la suscripción en tiempo real
    let trackingMap = null; // ✅ NUEVO: Variable para la instancia del mapa

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
            // Detectar si el input parece un short_id (ej. "ORD-1234") o un id numérico
            const looksLikeShortId = /^ORD-\w+/i.test(orderIdValue);
            const numericId = Number(orderIdValue);

            let query = supabaseConfig.client
                .from('orders')
                .select('*, service:services(name), vehicle:vehicles(name)');

            if (looksLikeShortId) {
                query = query.eq('short_id', orderIdValue);
            } else if (!Number.isNaN(numericId)) {
                query = query.eq('id', numericId);
            } else {
                // Último recurso: intentar por short_id si el formato no es numérico
                query = query.eq('short_id', orderIdValue);
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
                    if (looksLikeShortId) publicQuery.eq('short_id', orderIdValue);
                    else if (!Number.isNaN(numericId)) publicQuery.eq('id', numericId);
                    else publicQuery.eq('short_id', orderIdValue);
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

            // Orden encontrada, mostrar detalles
            displayOrderDetails(order);

            // Suscribirse a cambios en tiempo real para esta orden (usar el id numérico real)
            const orderNumericId = Number(order.id || numericId);
            subscribeToOrderUpdates(orderNumericId);

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

                // En UPDATE o INSERT, refrescar detalles en pantalla
                if (newRecord) {
                    // Si hay cambio de estado, notificar al usuario
                    const newStatus = newRecord.status;
                    const oldStatus = oldRecord?.status;
                    if (newStatus && newStatus !== oldStatus) showStatusNotification(newStatus);

                    // Si actualmente estamos viendo esa orden, actualizar la UI
                    displayOrderDetails(newRecord);
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
            'pendiente': 'Tu solicitud está pendiente de confirmación',
            'confirmado': 'Tu solicitud ha sido confirmada',
            'asignado': 'Un colaborador ha sido asignado a tu solicitud',
            'en_ruta_recoger': 'El colaborador está en camino a recoger',
            'recogido': 'El servicio ha sido recogido',
            'en_ruta_entrega': 'En camino a la entrega',
            'completado': 'Tu servicio ha sido completado exitosamente',
            'cancelado': 'Tu solicitud ha sido cancelada'
        };
        
        const title = '¡Actualización de tu solicitud!';
        const options = {
            body: statusMessages[status] || `Estado actualizado a: ${status}`,
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
        document.getElementById('orderTitle').textContent = `Orden #${order.id}`;
        document.getElementById('orderDate').textContent = `Creada el ${new Date(order.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}`;
        
        const statusBadge = document.getElementById('orderStatus');
        statusBadge.textContent = order.status;
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

        // ✅ MEJORA: Lógica de timeline más robusta y precisa
        const timelineEvents = [];
        
        // 1. Solicitud Creada (siempre existe)
        timelineEvents.push({ name: 'Solicitud Creada', date: order.created_at });

        // 2. Servicio Asignado
        if (order.assigned_at) {
            timelineEvents.push({ name: 'Servicio Asignado', date: order.assigned_at });
        }

        // 3. Estados del colaborador (si existen en el tracking_data)
        if (order.tracking_data && Array.isArray(order.tracking_data)) {
            order.tracking_data.forEach(trackPoint => {
                timelineEvents.push({ name: trackPoint.status, date: trackPoint.date });
            });
        }

        // 4. Servicio Completado
        if (order.completed_at) {
            timelineEvents.push({ name: 'Servicio Completado', date: order.completed_at });
        }

        // Ordenar y renderizar
        timelineEvents.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(event => {
            const item = document.createElement('div');
            item.className = 'timeline-item active';
            item.innerHTML = `
                <h4 class="font-semibold text-gray-800">${event.name}</h4>
                <p class="text-sm text-gray-500">${new Date(event.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</p>
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
        switch (status) {
            case 'Pendiente': return 'status-pending';
            case 'En proceso': return 'status-in-progress';
            case 'Completado': return 'status-completed';
            case 'Cancelado': return 'status-cancelled';
            default: return 'status-pending';
        }
    }

    // --- Inicialización ---
    async function init() {
        const params = new URLSearchParams(window.location.search);
        const orderIdFromUrl = params.get('order');

        if (orderIdFromUrl) {
            orderIdInput.value = orderIdFromUrl;
            await findOrder();
        }
    }

    init();
});