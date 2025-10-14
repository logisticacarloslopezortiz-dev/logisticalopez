document.addEventListener('DOMContentLoaded', () => {
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
    const timeline = document.getElementById('timeline');
    const photoSection = document.getElementById('photoSection');
    const photoGallery = document.getElementById('photoGallery');

    // Elementos para notificaciones push
    const pwaModal = document.getElementById('pwaModal');

    lucide.createIcons();

    function findOrder(orderId) {
        const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
        return orders.find(o => o.id.toLowerCase() === orderId.toLowerCase());
    }

    async function displayOrder(order) {
        loginScreen.classList.add('hidden');
        trackingScreen.classList.remove('hidden');

        // Información general
        document.title = `Seguimiento Orden #${order.id} — TLC`;
        orderTitle.textContent = `Orden #${order.id}`;
        orderDate.textContent = `Creada el ${new Date(order.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        
        const statusKey = order.lastCollabStatus || order.status;
        const statusInfo = getStatusInfo(statusKey);
        orderStatus.textContent = statusInfo.label;
        orderStatus.className = `status-badge ${statusInfo.badge}`;

        // Detalles de la orden
        orderDetails.innerHTML = `
            <div>
                <p class="text-sm text-gray-500">Cliente</p>
                <p class="font-medium text-gray-800">${order.name}</p>
            </div>
            <div>
                <p class="text-sm text-gray-500">Servicio</p>
                <p class="font-medium text-gray-800">${order.service}</p>
            </div>
            <div class="md:col-span-2">
                <p class="text-sm text-gray-500">Ruta</p>
                <p class="font-medium text-gray-800">${order.pickup} → ${order.delivery}</p>
            </div>
        `;

        // Timeline
        timeline.innerHTML = '';
        const trackingEvents = order.tracking || [];
        if (trackingEvents.length === 0) {
            trackingEvents.push({ status: 'Pendiente', at: order.createdAt });
        }
        
        trackingEvents.forEach((event, index) => {
            const item = document.createElement('div');
            item.className = `timeline-item ${index === 0 ? 'active' : ''}`;
            item.innerHTML = `
                <h4 class="font-semibold text-gray-800">${event.status}</h4>
                <p class="text-sm text-gray-500">${new Date(event.at).toLocaleString('es-ES')}</p>
            `;
            timeline.appendChild(item);
        });

        // Galería de fotos
        if (order.photos && order.photos.length > 0) {
            photoSection.classList.remove('hidden');
            photoGallery.innerHTML = '';
            order.photos.forEach(photoSrc => {
                const imgContainer = document.createElement('a');
                imgContainer.href = photoSrc;
                imgContainer.target = '_blank';
                imgContainer.className = 'block aspect-square bg-gray-100 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow';
                imgContainer.innerHTML = `<img src="${photoSrc}" class="w-full h-full object-cover">`;
                photoGallery.appendChild(imgContainer);
            });
        } else {
            photoSection.classList.add('hidden');
        }

        // Después de mostrar la orden, verificar si se puede suscribir a notificaciones
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            await setupPushNotifications(order);
        }
    }

    function getStatusInfo(statusKey) {
        const statusMap = {
            'Pendiente': { label: 'Pendiente', badge: 'status-pending' },
            'En proceso': { label: 'En Proceso', badge: 'status-confirmed' },
            'en_camino_recoger': { label: 'En camino a recoger', badge: 'status-in-progress' },
            'cargando': { label: 'Cargando pedido', badge: 'status-in-progress' },
            'en_camino_entregar': { label: 'En camino a entregar', badge: 'status-in-progress' },
            'retraso_tapon': { label: 'Retraso por tráfico', badge: 'status-cancelled' },
            'entregado': { label: 'Completado', badge: 'status-completed' },
            'Completado': { label: 'Completado', badge: 'status-completed' }
        };
        return statusMap[statusKey] || { label: statusKey, badge: 'status-pending' };
    }

    trackButton.addEventListener('click', async () => {
        const orderId = orderIdInput.value.trim();
        if (!orderId) {
            errorMessage.querySelector('p').textContent = 'Por favor, ingresa un ID de orden.';
            errorMessage.classList.remove('hidden');
            return;
        }

        const order = findOrder(orderId);
        if (order) {
            errorMessage.classList.add('hidden');
            await displayOrder(order);
        } else {
            errorMessage.querySelector('p').textContent = 'No se encontró ninguna orden con ese ID.';
            errorMessage.classList.remove('hidden');
        }
    });

    document.getElementById('newOrderButton').addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // Comprobar si hay un ID de orden en la URL
    async function checkUrlForOrder() {
        const urlParams = new URLSearchParams(window.location.search);
        const orderIdFromUrl = urlParams.get('order');
        if (orderIdFromUrl) {
            const order = findOrder(orderIdFromUrl);
            if (order) {
                await displayOrder(order);
            }
        }
    }

    // --- Lógica de Notificaciones Push ---
    async function setupPushNotifications(order) {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        // Si no está suscrito y no se le ha preguntado antes, mostrar modal
        if (!subscription && Notification.permission === 'default') {
            pwaModal.classList.remove('hidden');
            document.getElementById('installPWA').onclick = async () => {
                pwaModal.classList.add('hidden');
                await subscribeUser(order);
            };
            document.getElementById('cancelPWA').onclick = () => {
                pwaModal.classList.add('hidden');
            };
        } else if (!subscription && Notification.permission === 'granted') {
            // Si dio permiso pero no hay suscripción (raro, pero puede pasar), intentar suscribir
            await subscribeUser(order);
        }
    }

    async function subscribeUser(order) {
        const registration = await navigator.serviceWorker.ready;
        try {
            // La VAPID public key debe ser generada y almacenada de forma segura
            const vapidPublicKey = 'REEMPLAZA_CON_TU_VAPID_PUBLIC_KEY';
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
            });

            // Guardar la suscripción en la base de datos asociada a la orden
            await supabaseConfig.updateOrder(order.id, { push_subscription: subscription });
            console.log('Usuario suscrito a notificaciones push.');

        } catch (error) {
            console.error('Error al suscribir al usuario:', error);
        }
    }

    // Función para convertir la VAPID key a un formato usable
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    checkUrlForOrder();
});