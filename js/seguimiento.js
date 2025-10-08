// Variables para PWA
let deferredPrompt;

// Registrar el Service Worker para PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(async registration => {
        console.log('Service Worker registrado con éxito:', registration.scope);
      })
      .catch(error => {
        console.log('Error al registrar el Service Worker:', error);
      });
  });
}

// Inicializar iconos de Lucide
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initializeTracking();
});

// Elementos del DOM
const loginScreen = document.getElementById('loginScreen');
const trackingScreen = document.getElementById('trackingScreen');
const orderIdInput = document.getElementById('orderIdInput');
const trackButton = document.getElementById('trackButton');
const errorMessage = document.getElementById('errorMessage');
const newOrderButton = document.getElementById('newOrderButton');
const pwaModal = document.getElementById('pwaModal');
const installPWA = document.getElementById('installPWA');
const cancelPWA = document.getElementById('cancelPWA');

// Estados de las órdenes
const ORDER_STATES = {
  'pending': { label: 'Pendiente', class: 'status-pending' },
  'confirmed': { label: 'Confirmada', class: 'status-confirmed' },
  'in-progress': { label: 'En Progreso', class: 'status-in-progress' },
  'completed': { label: 'Completada', class: 'status-completed' },
  'cancelled': { label: 'Cancelada', class: 'status-cancelled' }
};

// Funciones utilitarias
function loadOrders() { 
  return JSON.parse(localStorage.getItem('tlc_orders') || '[]'); 
}

function saveOrders(arr) {
  localStorage.setItem('tlc_orders', JSON.stringify(arr));
}

function getCurrentTrackingOrder() {
  return localStorage.getItem('tlc_current_tracking');
}

function setCurrentTrackingOrder(orderId) {
  localStorage.setItem('tlc_current_tracking', orderId);
}

function clearCurrentTrackingOrder() {
  localStorage.removeItem('tlc_current_tracking');
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Inicializar la aplicación de seguimiento
function initializeTracking() {
  // Event listeners
  trackButton.addEventListener('click', searchOrder);
  orderIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchOrder();
  });
  newOrderButton.addEventListener('click', () => {
    clearCurrentTrackingOrder();
    window.location.href = '/index.html';
  });

  // PWA Modal events
  cancelPWA.addEventListener('click', () => hideModal(pwaModal));
  installPWA.addEventListener('click', installApp);

  // Verificar si hay una orden en seguimiento
  const currentOrder = getCurrentTrackingOrder();
  if (currentOrder) {
    const order = findOrder(currentOrder);
    if (order && !isOrderFinished(order)) {
      showTrackingScreen(order);
      return;
    } else {
      clearCurrentTrackingOrder();
    }
  }

  // Mostrar pantalla de login
  showLoginScreen();
}

// Buscar orden
function searchOrder() {
  const orderId = orderIdInput.value.trim().toUpperCase();
  
  if (!orderId) {
    showError('Por favor ingresa un ID de orden');
    return;
  }

  const order = findOrder(orderId);
  
  if (!order) {
    showError('No se encontró ninguna orden con ese ID');
    return;
  }

  setCurrentTrackingOrder(orderId);
  showTrackingScreen(order);
}

// Encontrar orden por ID
function findOrder(orderId) {
  const orders = loadOrders();
  return orders.find(order => order.id === orderId);
}

// Verificar si la orden está finalizada
function isOrderFinished(order) {
  return order.status === 'completed' || order.status === 'cancelled';
}

// Mostrar pantalla de login
function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  trackingScreen.classList.add('hidden');
  hideError();
  orderIdInput.value = '';
  orderIdInput.focus();
}

// Mostrar pantalla de seguimiento
function showTrackingScreen(order) {
  loginScreen.classList.add('hidden');
  trackingScreen.classList.remove('hidden');
  
  displayOrderDetails(order);
  displayTimeline(order);
  
  // Mostrar modal PWA si es la primera vez
  if (!localStorage.getItem('pwa_prompt_shown')) {
    setTimeout(() => {
      showModal(pwaModal);
      localStorage.setItem('pwa_prompt_shown', 'true');
    }, 2000);
  }
}

// Mostrar detalles de la orden
function displayOrderDetails(order) {
  document.getElementById('orderTitle').textContent = `Orden #${order.id}`;
  document.getElementById('orderDate').textContent = `Creada el ${formatDate(order.createdAt)}`;
  
  const statusElement = document.getElementById('orderStatus');
  const state = ORDER_STATES[order.status] || ORDER_STATES['pending'];
  statusElement.textContent = state.label;
  statusElement.className = `status-badge ${state.class}`;
  
  const detailsContainer = document.getElementById('orderDetails');
  detailsContainer.innerHTML = `
    <div class="space-y-3">
      <h3 class="font-semibold text-gray-800 mb-2">Información del Cliente</h3>
      <div class="text-sm space-y-1">
        <p><span class="font-medium">Nombre:</span> ${order.clientData.name}</p>
        <p><span class="font-medium">Teléfono:</span> ${order.clientData.phone}</p>
        ${order.clientData.email ? `<p><span class="font-medium">Email:</span> ${order.clientData.email}</p>` : ''}
        ${order.rncData ? `<p><span class="font-medium">RNC:</span> ${order.rncData.rncNumber} - ${order.rncData.companyName}</p>` : ''}
      </div>
    </div>
    
    <div class="space-y-3">
      <h3 class="font-semibold text-gray-800 mb-2">Detalles del Servicio</h3>
      <div class="text-sm space-y-1">
        <p><span class="font-medium">Servicio:</span> ${order.serviceData.serviceType}</p>
        <p><span class="font-medium">Vehículo:</span> ${order.serviceData.vehicleType}</p>
        ${order.serviceData.description ? `<p><span class="font-medium">Descripción:</span> ${order.serviceData.description}</p>` : ''}
      </div>
    </div>
    
    <div class="space-y-3 md:col-span-2">
      <h3 class="font-semibold text-gray-800 mb-2">Ubicación y Horario</h3>
      <div class="text-sm space-y-1">
        <p><span class="font-medium">Recogida:</span> ${order.locationData.pickupAddress}</p>
        <p><span class="font-medium">Entrega:</span> ${order.locationData.deliveryAddress}</p>
        <p><span class="font-medium">Fecha:</span> ${formatDate(order.locationData.serviceDate + 'T' + order.locationData.serviceTime)}</p>
      </div>
    </div>
  `;
}

// Mostrar timeline de estados
function displayTimeline(order) {
  const timelineContainer = document.getElementById('timeline');
  
  // Estados base del timeline
  const timelineStates = [
    { key: 'pending', label: 'Solicitud Recibida', description: 'Tu solicitud ha sido recibida y está siendo procesada' },
    { key: 'confirmed', label: 'Solicitud Confirmada', description: 'Hemos confirmado tu solicitud y asignado un vehículo' },
    { key: 'in-progress', label: 'Servicio en Progreso', description: 'Nuestro equipo está en camino o realizando el servicio' },
    { key: 'completed', label: 'Servicio Completado', description: 'El servicio ha sido completado exitosamente' }
  ];
  
  // Si está cancelada, mostrar solo hasta cancelación
  if (order.status === 'cancelled') {
    timelineStates.splice(1, timelineStates.length - 1, {
      key: 'cancelled',
      label: 'Solicitud Cancelada',
      description: 'La solicitud ha sido cancelada'
    });
  }
  
  let timelineHTML = '';
  
  timelineStates.forEach((state, index) => {
    const isActive = getStateIndex(order.status) >= index;
    const isCurrent = order.status === state.key;
    
    timelineHTML += `
      <div class="timeline-item ${isActive ? 'active' : ''}">
        <div class="flex items-start">
          <div class="flex-1">
            <h4 class="font-semibold text-gray-800 ${isCurrent ? 'text-blue-600' : ''}">${state.label}</h4>
            <p class="text-sm text-gray-600 mt-1">${state.description}</p>
            ${isActive && order.timeline && order.timeline[state.key] ? 
              `<p class="text-xs text-gray-500 mt-1">${formatDate(order.timeline[state.key])}</p>` : ''}
          </div>
          ${isCurrent ? '<i data-lucide="clock" class="w-4 h-4 text-blue-600 mt-1 ml-2"></i>' : ''}
        </div>
      </div>
    `;
  });
  
  timelineContainer.innerHTML = timelineHTML;
  lucide.createIcons();
}

// Obtener índice del estado
function getStateIndex(status) {
  const stateOrder = ['pending', 'confirmed', 'in-progress', 'completed'];
  const index = stateOrder.indexOf(status);
  return index >= 0 ? index : 0;
}

// Mostrar error
function showError(message) {
  errorMessage.classList.remove('hidden');
  errorMessage.querySelector('p').textContent = message;
}

// Ocultar error
function hideError() {
  errorMessage.classList.add('hidden');
}

// Mostrar modal
function showModal(modal) {
  modal.classList.remove('hidden');
}

// Ocultar modal
function hideModal(modal) {
  modal.classList.add('hidden');
}

// Instalar PWA
function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('Usuario aceptó instalar la PWA');
      }
      deferredPrompt = null;
    });
  }
  hideModal(pwaModal);
}

// Event listener para PWA install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Actualizar estado de orden (función para uso futuro con backend)
function updateOrderStatus(orderId, newStatus) {
  const orders = loadOrders();
  const orderIndex = orders.findIndex(order => order.id === orderId);
  
  if (orderIndex >= 0) {
    orders[orderIndex].status = newStatus;
    
    // Agregar timestamp al timeline
    if (!orders[orderIndex].timeline) {
      orders[orderIndex].timeline = {};
    }
    orders[orderIndex].timeline[newStatus] = new Date().toISOString();
    
    saveOrders(orders);
    
    // Actualizar la pantalla si estamos viendo esta orden
    const currentOrder = getCurrentTrackingOrder();
    if (currentOrder === orderId) {
      displayOrderDetails(orders[orderIndex]);
      displayTimeline(orders[orderIndex]);
    }
  }
}

// Simular actualizaciones de estado (para demo)
function simulateStatusUpdates() {
  const currentOrder = getCurrentTrackingOrder();
  if (!currentOrder) return;
  
  const order = findOrder(currentOrder);
  if (!order || isOrderFinished(order)) return;
  
  // Simular progresión de estados cada 30 segundos
  setTimeout(() => {
    if (order.status === 'pending') {
      updateOrderStatus(currentOrder, 'confirmed');
    } else if (order.status === 'confirmed') {
      updateOrderStatus(currentOrder, 'in-progress');
    } else if (order.status === 'in-progress') {
      updateOrderStatus(currentOrder, 'completed');
      clearCurrentTrackingOrder(); // Limpiar cuando se complete
    }
  }, 30000);
}

// Iniciar simulación de actualizaciones (solo para demo)
// simulateStatusUpdates();