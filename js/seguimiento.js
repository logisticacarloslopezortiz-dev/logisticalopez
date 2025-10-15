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

    // --- Event Listeners ---
    trackButton.addEventListener('click', findOrder);
    orderIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') findOrder();
    });
    newOrderButton.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // --- Main Logic ---

    // Función para buscar la orden en Supabase
    async function findOrder() {
        const orderId = orderIdInput.value.trim().toUpperCase();
        if (!orderId) {
            showError('Por favor, ingresa un ID de orden.');
            return;
        }

        // Mostrar un estado de carga
        trackButton.disabled = true;
        trackButton.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 inline mr-2 animate-spin"></i> Buscando...';
        lucide.createIcons();
        hideError();

        // Cancelar suscripción anterior si existe
        if (currentSubscription) {
            supabaseConfig.client.removeChannel(currentSubscription);
            currentSubscription = null;
        }

        try {
            const { data: order, error } = await supabaseConfig.client
                .from('orders')
                .select('*')
                .eq('id', orderId)
                .single(); // .single() espera un solo resultado o ninguno

            if (error || !order) {
                throw new Error('No se encontró ninguna solicitud con ese ID.');
            }

            // Orden encontrada, mostrar detalles
            displayOrderDetails(order);

            // Suscribirse a cambios en tiempo real para esta orden
            subscribeToOrderUpdates(orderId);

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
        currentSubscription = supabaseConfig.client
            .channel(`public:orders:id=eq.${orderId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                    filter: `id=eq.${orderId}`
                },
                (payload) => {
                    displayOrderDetails(payload.new);
                }
            ).subscribe();
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
                <p class="font-semibold text-gray-800">${order.service}</p>
            </div>
            <div>
                <p class="text-sm text-gray-500">Vehículo</p>
                <p class="font-semibold text-gray-800">${order.vehicle}</p>
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

        const statuses = [
            { name: 'Solicitud Creada', date: order.created_at, active: true, isMain: true },
            { name: 'Servicio Asignado', date: order.assigned_at, active: !!order.assigned_at, isMain: true },
            { name: 'En camino a recoger', date: order.last_collab_status === 'en_camino_recoger' ? new Date() : null, active: order.last_collab_status === 'en_camino_recoger', isMain: false },
            { name: 'En camino a entregar', date: order.last_collab_status === 'en_camino_entregar' ? new Date() : null, active: order.last_collab_status === 'en_camino_entregar', isMain: false },
            { name: 'Servicio Completado', date: order.completed_at, active: !!order.completed_at, isMain: true }
        ];

        statuses.forEach(status => {
            if (status.active && status.date) {
                const item = document.createElement('div');
                item.className = 'timeline-item active';
                item.innerHTML = `
                    <h4 class="font-semibold text-gray-800">${status.name}</h4>
                    <p class="text-sm text-gray-500">${new Date(status.date).toLocaleString('es-ES')}</p>
                `;
                timelineContainer.appendChild(item);
            }
        });
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