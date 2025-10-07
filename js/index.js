// Variables para PWA
let deferredPrompt;

// Registrar el Service Worker para PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(async registration => {
        console.log('Service Worker registrado con éxito:', registration.scope);
        // Inicializar suscripción a Push si es posible
        try {
          await initPushSubscription(registration);
        } catch (e) {
          console.warn('No se pudo inicializar la suscripción Push:', e);
        }
      })
      .catch(error => {
        console.log('Error al registrar el Service Worker:', error);
      });
  });
}

// Inicializar iconos de Lucide
lucide.createIcons();

// Pesos aproximados de los artículos (en kg)
const ITEM_WEIGHTS = {
  beds: 70,      // Cama promedio
  tables: 25,    // Mesa promedio
  chairs: 5,     // Silla promedio
  sofas: 60,     // Sofá promedio
  fridge: 90,    // Refrigerador promedio
  washer: 65,    // Lavadora promedio
  stove: 45,     // Estufa promedio
  gasTank: 30    // Tanque de gas promedio
};

// Variables globales
const form = document.getElementById('orderForm');
const movingModal = document.getElementById('movingModal');
const movingForm = document.getElementById('movingForm');
const closeMovingModal = document.getElementById('closeMovingModal');
const cancelMoving = document.getElementById('cancelMoving');
const totalWeight = document.getElementById('totalWeight');
const itemInputs = movingForm.querySelectorAll('input[type="number"]');
let currentMovingDetails = null;
const confirmModal = document.getElementById('confirmModal');
const trackingModal = document.getElementById('trackingModal');
const rncModal = document.getElementById('rncModal');
const closeConfirm = document.getElementById('closeConfirm');
const closeTracking = document.getElementById('closeTracking');
const closeRNC = document.getElementById('closeRNC');
const cancelRNC = document.getElementById('cancelRNC');
const saveRNC = document.getElementById('saveRNC');
const quoteSection = document.getElementById('quoteSection');
const estimatedPrice = document.getElementById('estimatedPrice');
const submitBtn = form.querySelector('button[type="submit"]');
const submitText = document.getElementById('submitText');
const submitSpinner = document.getElementById('submitSpinner');
const orderNumber = document.getElementById('orderNumber');
const pickupMapBtn = document.getElementById('pickupMapBtn');
const deliveryMapBtn = document.getElementById('deliveryMapBtn');
const mapContainer = document.getElementById('mapContainer');
const googleMap = document.getElementById('googleMap');
const pickupAddressInput = document.getElementById('pickupAddress');
const deliveryAddressInput = document.getElementById('deliveryAddress');

// Variables para el panel de estado
const activeServicesList = document.getElementById('activeServicesList');
const availableVehiclesList = document.getElementById('availableVehiclesList');
const activeServicesCount = document.getElementById('activeServicesCount');
const availableVehiclesCount = document.getElementById('availableVehiclesCount');
const totalOrdersToday = document.getElementById('totalOrdersToday');
const completedOrdersToday = document.getElementById('completedOrdersToday');
const pendingOrdersToday = document.getElementById('pendingOrdersToday');
const activeVehiclesCount = document.getElementById('activeVehiclesCount');

// Funciones utilitarias
function genId() {
  const orders = loadOrders();
  const lastId = orders.length > 0 ? orders[0].id : 'TLC00';
  const lastNumber = parseInt(lastId.replace('TLC', '')) || 0;
  const nextNumber = lastNumber + 1;
  return 'TLC' + nextNumber.toString().padStart(2, '0');
}
function loadOrders(){ return JSON.parse(localStorage.getItem('tlc_orders')||'[]'); }
function saveOrders(arr){
  // Agregar detalles de mudanza si existen
  arr = arr.map(order => {
    if (order.serviceType === 'Mudanza' && currentMovingDetails) {
      order.movingDetails = currentMovingDetails;
      currentMovingDetails = null; // Limpiar después de usar
    }
    return order;
  });
  localStorage.setItem('tlc_orders', JSON.stringify(arr));
}
function loadVehicles(){ return JSON.parse(localStorage.getItem('tlc_vehicles')||'[]'); }
function saveVehicles(arr){ localStorage.setItem('tlc_vehicles', JSON.stringify(arr)); }
function loadCollaborators(){ return JSON.parse(localStorage.getItem('tlc_collaborators')||'[]'); }
function saveCollaborators(arr){ localStorage.setItem('tlc_collaborators', JSON.stringify(arr)); }

// Variables para Google Maps
let map;
let pickupMarker;
let deliveryMarker;
let currentAddressType = null; // 'pickup' o 'delivery'
let pickupLocation = null;
let deliveryLocation = null;

// Event listener para detectar cuando se selecciona el servicio de mudanza
document.addEventListener('change', (e) => {
  if (e.target.name === 'serviceType' && e.target.value === 'Mudanza') {
    showMovingModal();
  }
});

// Datos de vehículos por defecto
function initializeDefaultVehicles() {
  const vehicles = loadVehicles();
  if (vehicles.length === 0) {
    const defaultVehicles = [
      { id: 'VEH-001', type: 'Camión Pequeño', plate: 'ABC-123', driver: 'Carlos López', status: 'disponible', icon: 'truck' },
      { id: 'VEH-002', type: 'Camioneta', plate: 'DEF-456', driver: 'María García', status: 'en_servicio', icon: 'car' },
      { id: 'VEH-003', type: 'Furgón', plate: 'GHI-789', driver: 'Juan Pérez', status: 'disponible', icon: 'bus' },
      { id: 'VEH-004', type: 'Camión Grande', plate: 'JKL-012', driver: 'Ana Rodríguez', status: 'mantenimiento', icon: 'truck' }
    ];
    saveVehicles(defaultVehicles);
  }
  
  // Inicializar colaboradores por defecto si no existen
  const collaborators = loadCollaborators();
  if (collaborators.length === 0) {
    const defaultCollaborators = [
      { id: 'COL-001', name: 'Carlos López', email: 'carlos@tlc.com', phone: '300-123-4567', role: 'admin', active: true },
      { id: 'COL-002', name: 'María García', email: 'maria@tlc.com', phone: '300-765-4321', role: 'driver', active: true },
      { id: 'COL-003', name: 'Juan Pérez', email: 'juan@tlc.com', phone: '300-987-6543', role: 'driver', active: true },
      { id: 'COL-004', name: 'Ana Rodríguez', email: 'ana@tlc.com', phone: '300-654-3210', role: 'driver', active: true }
    ];
    saveCollaborators(defaultCollaborators);
  }
}

// Funciones para el panel de estado
// Funciones para el modal de mudanza
function showMovingModal() {
  movingModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideMovingModal() {
  movingModal.classList.add('hidden');
  document.body.style.overflow = '';
  movingForm.reset();
  currentMovingDetails = null;
}

function calculateTotalWeight() {
  let total = 0;
  itemInputs.forEach(input => {
    const itemType = input.name;
    const quantity = parseInt(input.value) || 0;
    total += ITEM_WEIGHTS[itemType] * quantity;
  });
  totalWeight.textContent = `${total} kg`;
  
  // Actualizar cotización si hay distancia disponible
  if (pickupLocation && deliveryLocation) {
    const distance = google.maps.geometry.spherical.computeDistanceBetween(pickupLocation, deliveryLocation) / 1000; // Convertir a kilómetros
    const config = JSON.parse(localStorage.getItem('quotationConfig') || '{}');
    const quotation = calculateQuotation(distance, total);
    if (estimatedPrice) {
      estimatedPrice.textContent = `$${quotation.toFixed(2)}`;
    }
  }
  
  return total;
}

// Función para calcular cotización
function calculateQuotation(distance, weight) {
  const config = JSON.parse(localStorage.getItem('quotationConfig') || '{}');
  let total = 0;
  
  // Tarifa base por distancia
  total = distance * (config.baseRate || 0);
  
  // Determinar tipo de vehículo basado en peso
  let vehicleType = 'smallTruck';
  if (weight > 1000) vehicleType = 'largeTruck';
  else if (weight > 500) vehicleType = 'van';
  else if (weight > 100) vehicleType = 'pickup';
  
  // Multiplicador por tipo de vehículo
  if (config.vehicleRates) {
    const vehicleRate = config.vehicleRates[vehicleType] || 1;
    total *= vehicleRate;
  }
  
  // Multiplicador por peso
  if (config.weightRates) {
    let weightRate = 1;
    if (weight <= 100) weightRate = config.weightRates.light || 1;
    else if (weight <= 500) weightRate = config.weightRates.medium || 1.3;
    else if (weight <= 1000) weightRate = config.weightRates.heavy || 1.6;
    else weightRate = config.weightRates.veryHeavy || 2;
    
    total *= weightRate;
  }
  
  return Math.round(total * 100) / 100; // Redondear a 2 decimales
}

// Event listeners para el modal de mudanza
closeMovingModal.addEventListener('click', hideMovingModal);
cancelMoving.addEventListener('click', hideMovingModal);

itemInputs.forEach(input => {
  input.addEventListener('change', calculateTotalWeight);
  input.addEventListener('input', calculateTotalWeight);
});

// Event listener para mostrar/ocultar sección de objetos frágiles
document.addEventListener('change', (e) => {
  if (e.target.name === 'hasFragileItems') {
    const fragileSection = document.getElementById('fragileItemsSection');
    if (e.target.value === 'yes') {
      fragileSection.classList.remove('hidden');
    } else {
      fragileSection.classList.add('hidden');
      document.getElementById('fragileItemsDesc').value = '';
    }
  }
});

movingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const details = {
    items: {},
    totalWeight: calculateTotalWeight(),
    hasFragileItems: document.querySelector('input[name="hasFragileItems"]:checked').value === 'yes',
    fragileItemsDesc: document.getElementById('fragileItemsDesc').value.trim()
  };
  
  itemInputs.forEach(input => {
    details.items[input.name] = parseInt(input.value) || 0;
  });
  
  currentMovingDetails = details;
  hideMovingModal();
});

function getServiceIcon(serviceType) {
  const icons = {
    'Mudanza': 'home',
    'Transporte Comercial': 'package',
    'Carga Pesada': 'weight'
  };
  return icons[serviceType] || 'truck';
}

function getVehicleIcon(vehicleType) {
  const icons = {
    'Camioneta': 'car',
    'Camión Pequeño': 'truck',
    'Furgón': 'bus',
    'Camión Grande': 'truck'
  };
  return icons[vehicleType] || 'car';
}

function getStatusColor(status) {
  const colors = {
    'disponible': 'green',
    'en_servicio': 'blue',
    'mantenimiento': 'yellow',
    'pendiente': 'orange',
    'completado': 'green',
    'en_camino_recoger': 'blue',
    'cargando': 'yellow',
    'en_camino_entregar': 'purple',
    'entregado': 'green'
  };
  return colors[status] || 'gray';
}

function getStatusText(status) {
  const texts = {
    'disponible': 'Disponible',
    'en_servicio': 'En Servicio',
    'mantenimiento': 'Mantenimiento',
    'pendiente': 'Pendiente',
    'completado': 'Completado',
    'en_camino_recoger': 'En camino a recoger',
    'cargando': 'Cargando',
    'en_camino_entregar': 'En camino a entregar',
    'entregado': 'Entregado'
  };
  return texts[status] || status;
}

function renderActiveServices() {
  const orders = loadOrders();
  const today = new Date().toDateString();
  const activeOrders = orders.filter(order => {
    const orderDate = new Date(order.date).toDateString();
    return orderDate === today && ['pendiente', 'en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(order.status);
  });

  // Verificar que los elementos existan antes de usarlos
  if (activeServicesCount) {
    activeServicesCount.textContent = activeOrders.length;
  }
  
  if (activeServicesList) {
    if (activeOrders.length === 0) {
      activeServicesList.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
          <p class="text-sm">No hay servicios activos hoy</p>
        </div>
      `;
    } else {
      activeServicesList.innerHTML = activeOrders.map(order => {
      const statusColor = getStatusColor(order.status);
      const serviceIcon = getServiceIcon(order.serviceType);
      
      return `
        <div class="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <i data-lucide="${serviceIcon}" class="w-4 h-4 text-${statusColor}-600"></i>
              <span class="font-medium text-gray-800">${order.serviceType}</span>
            </div>
            <span class="bg-${statusColor}-100 text-${statusColor}-800 text-xs font-medium px-2 py-1 rounded-full">
              ${getStatusText(order.status)}
            </span>
          </div>
          <div class="text-sm text-gray-600">
            <p class="truncate"><strong>Cliente:</strong> ${order.clientName}</p>
            <p class="truncate"><strong>Vehículo:</strong> ${order.vehicleType}</p>
            <p class="truncate"><strong>Orden:</strong> ${order.id}</p>
          </div>
        </div>
      `;
      }).join('');
    }
  }
  
  lucide.createIcons();
}

function renderAvailableVehicles() {
  const vehicles = loadVehicles();
  const availableVehicles = vehicles.filter(vehicle => vehicle.status === 'disponible');
  const totalActive = vehicles.filter(vehicle => vehicle.status !== 'mantenimiento').length;
  
  if (availableVehiclesCount) {
    availableVehiclesCount.textContent = availableVehicles.length;
  }
  if (activeVehiclesCount) {
    activeVehiclesCount.textContent = totalActive;
  }
  
  if (availableVehiclesList) {
    if (availableVehicles.length === 0) {
      availableVehiclesList.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i data-lucide="car-off" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
        <p class="text-sm">No hay vehículos disponibles</p>
      </div>
    `;
  } else {
    availableVehiclesList.innerHTML = availableVehicles.map(vehicle => {
      const statusColor = getStatusColor(vehicle.status);
      const vehicleIcon = getVehicleIcon(vehicle.type);
      
      return `
        <div class="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <i data-lucide="${vehicleIcon}" class="w-4 h-4 text-${statusColor}-600"></i>
              <span class="font-medium text-gray-800">${vehicle.type}</span>
            </div>
            <span class="bg-${statusColor}-100 text-${statusColor}-800 text-xs font-medium px-2 py-1 rounded-full">
              ${getStatusText(vehicle.status)}
            </span>
          </div>
          <div class="text-sm text-gray-600">
            <p><strong>Placa:</strong> ${vehicle.plate}</p>
            <p><strong>Conductor:</strong> ${vehicle.driver}</p>
          </div>
        </div>
      `;
      }).join('');
    }
  }
  
  lucide.createIcons();
}

function updateDashboardStats() {
  const orders = loadOrders();
  const today = new Date().toDateString();
  const todayOrders = orders.filter(order => new Date(order.date).toDateString() === today);
  
  const completed = todayOrders.filter(order => order.status === 'entregado').length;
  const pending = todayOrders.filter(order => ['pendiente', 'en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(order.status)).length;
  
  if (totalOrdersToday) {
    totalOrdersToday.textContent = todayOrders.length;
  }
  if (completedOrdersToday) {
    completedOrdersToday.textContent = completed;
  }
  if (pendingOrdersToday) {
    pendingOrdersToday.textContent = pending;
  }
}

function refreshDashboard() {
  renderActiveServices();
  renderAvailableVehicles();
  updateDashboardStats();
}

// Sistema de cotización
const pricingRules = {
  services: {
    'Mudanza': { base: 150000, multiplier: 1.2 },
    'Transporte Comercial': { base: 100000, multiplier: 1.0 },
    'Carga Pesada': { base: 200000, multiplier: 1.5 }
  },
  vehicles: {
    'Camioneta': { factor: 0.8 },
    'Camión Pequeño': { factor: 1.0 },
    'Furgón': { factor: 1.1 },
    'Camión Grande': { factor: 1.4 }
  }
};

function collabStatusLabel(key) {
  const map = {
    en_camino_recoger: 'En camino a recoger pedido',
    cargando: 'Cargando pedido',
    en_camino_entregar: 'En camino a entregar pedido',
    entregado: 'Pedido entregado'
  };
  return map[key] || key;
}
function calculateQuote() {
  const service = document.querySelector('input[name="serviceType"]:checked')?.value;
  const vehicle = document.querySelector('input[name="vehicleType"]:checked')?.value;
  
  if (service && vehicle) {
    const serviceData = pricingRules.services[service];
    const vehicleData = pricingRules.vehicles[vehicle];
    
    const basePrice = serviceData.base * serviceData.multiplier * vehicleData.factor;
    const finalPrice = Math.round(basePrice);
    
    estimatedPrice.textContent = `$${finalPrice.toLocaleString('es-CO')}`;
    quoteSection.classList.remove('hidden');
    
    // Animación suave
    setTimeout(() => {
      quoteSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }
}

// Validaciones en tiempo real mejoradas
function validateField(field, validationFn, errorMsg) {
  const isValid = validationFn(field.value);
  const existingError = field.parentNode.querySelector('.error-message');
  const existingSuccess = field.parentNode.querySelector('.success-message');
  
  // Limpiar mensajes anteriores
  if (existingError) existingError.remove();
  if (existingSuccess) existingSuccess.remove();
  
  if (!isValid && field.value.trim() !== '') {
    field.classList.add('border-red-500', 'bg-red-50');
    field.classList.remove('border-gray-300', 'border-green-500', 'bg-green-50');
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message text-red-600 text-sm mt-1 flex items-center';
    errorDiv.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 mr-1"></i>${errorMsg}`;
    field.parentNode.appendChild(errorDiv);
    
    // Actualizar iconos
    setTimeout(() => lucide.createIcons(), 0);
  } else if (isValid && field.value.trim() !== '') {
    field.classList.add('border-green-500', 'bg-green-50');
    field.classList.remove('border-red-500', 'border-gray-300', 'bg-red-50');
    
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message text-green-600 text-sm mt-1 flex items-center';
    successDiv.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 mr-1"></i>Campo válido`;
    field.parentNode.appendChild(successDiv);
    
    // Actualizar iconos
    setTimeout(() => lucide.createIcons(), 0);
  } else {
    field.classList.remove('border-red-500', 'border-green-500', 'bg-red-50', 'bg-green-50');
    field.classList.add('border-gray-300');
  }
  
  return isValid;
}

// Configurar validaciones
const clientName = document.getElementById('clientName');
const clientPhone = document.getElementById('clientPhone');
const clientEmail = document.getElementById('clientEmail');
const pickupAddress = document.getElementById('pickupAddress');
const deliveryAddress = document.getElementById('deliveryAddress');
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');

// Validadores
const validators = {
  name: (value) => value.length >= 2 && /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(value),
  phone: (value) => /^[\+]?[0-9\s\-\(\)]{10,}$/.test(value),
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  address: (value) => value.length >= 10,
  date: (value) => {
    const selectedDate = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDate >= today;
  },
  time: (value) => value !== ''
};

// Event listeners para validación
clientName.addEventListener('blur', () => {
  validateField(clientName, validators.name, 'Ingresa un nombre válido (solo letras)');
});

clientPhone.addEventListener('blur', () => {
  validateField(clientPhone, validators.phone, 'Ingresa un número de teléfono válido');
});

clientEmail.addEventListener('blur', () => {
  validateField(clientEmail, validators.email, 'Ingresa un correo electrónico válido');
});

pickupAddress.addEventListener('blur', () => {
  validateField(pickupAddress, validators.address, 'La dirección debe tener al menos 10 caracteres');
});

deliveryAddress.addEventListener('blur', () => {
  validateField(deliveryAddress, validators.address, 'La dirección debe tener al menos 10 caracteres');
});

dateInput.addEventListener('change', () => {
  validateField(dateInput, validators.date, 'Selecciona una fecha válida (hoy o posterior)');
});

// Inicialización de Google Maps
function initMap() {
  // Coordenadas por defecto (Colombia)
  const defaultLocation = { lat: 4.6097, lng: -74.0817 };
  
  map = new google.maps.Map(googleMap, {
    center: defaultLocation,
    zoom: 12,
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true
  });
  
  // Crear marcadores iniciales (ocultos)
  pickupMarker = new google.maps.Marker({
    position: defaultLocation,
    map: null, // No mostrar inicialmente
    draggable: true,
    title: 'Punto de recogida',
    icon: {
      url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
    }
  });
  
  deliveryMarker = new google.maps.Marker({
    position: defaultLocation,
    map: null, // No mostrar inicialmente
    draggable: true,
    title: 'Punto de entrega',
    icon: {
      url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
    }
  });
  
  // Eventos para actualizar direcciones cuando se arrastran los marcadores
  google.maps.event.addListener(pickupMarker, 'dragend', function() {
    const position = pickupMarker.getPosition();
    pickupLocation = { lat: position.lat(), lng: position.lng() };
    updateAddressFromCoordinates(position.lat(), position.lng(), 'pickup');
  });
  
  google.maps.event.addListener(deliveryMarker, 'dragend', function() {
    const position = deliveryMarker.getPosition();
    deliveryLocation = { lat: position.lat(), lng: position.lng() };
    updateAddressFromCoordinates(position.lat(), position.lng(), 'delivery');
  });
}

// Función para actualizar dirección a partir de coordenadas (geocoding inverso)
function updateAddressFromCoordinates(lat, lng, type) {
  const geocoder = new google.maps.Geocoder();
  const latlng = { lat, lng };
  
  geocoder.geocode({ location: latlng }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const address = results[0].formatted_address;
      if (type === 'pickup') {
        pickupAddressInput.value = address;
      } else {
        deliveryAddressInput.value = address;
      }
    } else {
      showNotification('error', 'Error al obtener la dirección', 'No se pudo convertir las coordenadas a una dirección.');
    }
  });
}

// Función para buscar coordenadas a partir de una dirección (geocoding)
function searchAddress(address, type) {
  const geocoder = new google.maps.Geocoder();
  
  geocoder.geocode({ address }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const location = results[0].geometry.location;
      const lat = location.lat();
      const lng = location.lng();
      
      if (type === 'pickup') {
        pickupLocation = { lat, lng };
        pickupMarker.setPosition({ lat, lng });
        pickupMarker.setMap(map);
      } else {
        deliveryLocation = { lat, lng };
        deliveryMarker.setPosition({ lat, lng });
        deliveryMarker.setMap(map);
      }
      
      map.setCenter({ lat, lng });
      map.setZoom(15);
    } else {
      showNotification('error', 'Dirección no encontrada', 'No se pudo localizar la dirección en el mapa.');
    }
  });
}

// Función para mostrar mapa interactivo
function showMapForAddress(type) {
  // Mostrar el contenedor del mapa
  mapContainer.classList.remove('hidden');
  
  // Verificar que Google Maps esté cargado
  if (!window.google || !google.maps) {
    showWarning('Google Maps aún se está cargando', 'Intenta de nuevo en unos segundos.');
    return;
  }
  
  // Inicializar el mapa si no existe
  if (!map) {
    initMap();
  }
  
  // Obtener la dirección actual del input correspondiente
  const addressInput = type === 'pickup' ? pickupAddress : deliveryAddress;
  const currentAddress = addressInput.value.trim();
  
  // Si hay una dirección, centrar el mapa en esa ubicación
  if (currentAddress) {
    searchAddress(currentAddress, type);
  } else {
    // Si no hay dirección, centrar en una ubicación por defecto
    const defaultLocation = { lat: 4.7110, lng: -74.0721 }; // Bogotá
    map.setCenter(defaultLocation);
    map.setZoom(12);
  }
  
  // Agregar listener para clics en el mapa
  const clickListener = map.addListener('click', (event) => {
    const clickedLocation = event.latLng;
    const lat = clickedLocation.lat();
    const lng = clickedLocation.lng();
    
    if (type === 'pickup') {
      pickupLocation = { lat, lng };
      if (!pickupMarker) {
        pickupMarker = new google.maps.Marker({
          position: clickedLocation,
          map: map,
          draggable: true,
          title: 'Punto de recogida',
          icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            `),
            scaledSize: new google.maps.Size(32, 32)
          }
        });
        
        pickupMarker.addListener('dragend', () => {
          const pos = pickupMarker.getPosition();
          pickupLocation = { lat: pos.lat(), lng: pos.lng() };
          updateAddressFromCoordinates(pos.lat(), pos.lng(), 'pickup');
        });
      } else {
        pickupMarker.setPosition(clickedLocation);
      }
      pickupMarker.setVisible(true);
      updateAddressFromCoordinates(lat, lng, 'pickup');
    } else {
      deliveryLocation = { lat, lng };
      if (!deliveryMarker) {
        deliveryMarker = new google.maps.Marker({
          position: clickedLocation,
          map: map,
          draggable: true,
          title: 'Punto de entrega',
          icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            `),
            scaledSize: new google.maps.Size(32, 32)
          }
        });
        
        deliveryMarker.addListener('dragend', () => {
          const pos = deliveryMarker.getPosition();
          deliveryLocation = { lat: pos.lat(), lng: pos.lng() };
          updateAddressFromCoordinates(pos.lat(), pos.lng(), 'delivery');
        });
      } else {
        deliveryMarker.setPosition(clickedLocation);
      }
      deliveryMarker.setVisible(true);
      updateAddressFromCoordinates(lat, lng, 'delivery');
    }
    
    // Remover el listener después del primer clic
    google.maps.event.removeListener(clickListener);
  });
}

// Event listeners para cotización
document.querySelectorAll('input[name="serviceType"], input[name="vehicleType"]').forEach(input => {
  input.addEventListener('change', calculateQuote);
});

// Configurar fecha mínima
const today = new Date().toISOString().split('T')[0];
dateInput.setAttribute('min', today);

// Mejorar validación de tiempo para permitir selecciones del mismo día
function validateDateTime() {
  const selectedDate = dateInput.value;
  const selectedTime = timeInput.value;
  
  if (!selectedDate || !selectedTime) return true;
  
  const now = new Date();
  const selected = new Date(selectedDate + 'T' + selectedTime);
  const todayStr = now.toISOString().split('T')[0];
  
  // Si es el mismo día, permitir cualquier hora (incluso futuras)
  if (selectedDate === todayStr) {
    timeInput.style.borderColor = '#10b981'; // Verde
    return true;
  }
  
  // Si es fecha futura, permitir
  if (selected > now) {
    timeInput.style.borderColor = '#10b981'; // Verde
    return true;
  }
  
  // Si es fecha pasada, marcar como inválido
  timeInput.style.borderColor = '#ef4444'; // Rojo
  return false;
}

// Agregar validación en tiempo real
dateInput.addEventListener('change', validateDateTime);
timeInput.addEventListener('change', validateDateTime);

// Envío del formulario
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Mostrar spinner
  submitText.textContent = 'Enviando...';
  submitSpinner.classList.remove('hidden');
  submitBtn.disabled = true;
  
  // Simular delay de envío
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const orderId = genId();
  const order = {
    id: orderId,
    name: clientName.value,
    phone: clientPhone.value,
    email: clientEmail.value,
    service: document.querySelector('input[name="serviceType"]:checked').value,
    vehicle: document.querySelector('input[name="vehicleType"]:checked').value,
    items: document.getElementById('itemsDesc').value,
    pickup: pickupAddress.value,
    delivery: deliveryAddress.value,
    pickupLocation: pickupLocation,
    deliveryLocation: deliveryLocation,
    date: dateInput.value,
    time: timeInput.value,
    estimatedPrice: estimatedPrice.textContent,
    status: 'Pendiente',
    createdAt: new Date().toISOString(),
    // Datos de RNC si fueron proporcionados
    rncData: form.rncData || null,
    // Detalles de mudanza si aplica
    movingDetails: currentMovingDetails,
    // Guarda la suscripción push del cliente si existe (para notificaciones en segundo plano)
    pushSubscription: JSON.parse(localStorage.getItem('tlc_push_subscription')||'null')
  };
  // Guarda el último número de orden para autocargar seguimiento después
  localStorage.setItem('tlc_last_order_id', orderId);
  const orders = loadOrders();
  orders.unshift(order);
  saveOrders(orders);
  
  // Actualizar dashboard
  refreshDashboard();
  
  // Mostrar notificación de éxito
  showSuccess('¡Solicitud enviada correctamente!', {
    title: 'Pedido Confirmado',
    duration: 5000
  });
  
  // Mostrar modal de confirmación
  orderNumber.textContent = orderId;
  confirmModal.classList.remove('hidden');
  confirmModal.classList.add('flex');
  
  // Enviar correo de confirmación (simulado)
  sendConfirmationEmail(order);
  
  // Resetear formulario
  form.reset();
  quoteSection.classList.add('hidden');
  mapContainer.classList.add('hidden');
  
  // Resetear marcadores del mapa
  if (pickupMarker) pickupMarker.setMap(null);
  if (deliveryMarker) deliveryMarker.setMap(null);
  pickupLocation = null;
  deliveryLocation = null;
  
  // Resetear botón
  submitText.textContent = 'Enviar solicitud';
  submitSpinner.classList.add('hidden');
  submitBtn.disabled = false;
});

// Cerrar modales
closeConfirm.onclick = () => {
  confirmModal.classList.add('hidden');
  confirmModal.classList.remove('flex');
};

closeTracking.onclick = () => {
  trackingModal.classList.add('hidden');
  trackingModal.classList.remove('flex');
};

// Cerrar modal de RNC
closeRNC.onclick = () => {
  rncModal.classList.add('hidden');
  rncModal.classList.remove('flex');
};

cancelRNC.onclick = () => {
  rncModal.classList.add('hidden');
  rncModal.classList.remove('flex');
};

// Guardar datos de RNC
saveRNC.onclick = () => {
  const rncNumber = document.getElementById('rncNumber').value.trim();
  const companyName = document.getElementById('companyName').value.trim();
  
  if (!rncNumber || !companyName) {
    alert('Por favor complete todos los campos');
    return;
  }
  
  // Guardar datos RNC en el formulario
  const form = document.getElementById('orderForm');
  form.rncData = {
    rnc: rncNumber,
    companyName: companyName
  };
  
  // Cerrar modal
  rncModal.classList.add('hidden');
  rncModal.classList.remove('flex');
  
  // Limpiar campos
  document.getElementById('rncNumber').value = '';
  document.getElementById('companyName').value = '';
  
  showSuccess('RNC guardado', 'Los datos de RNC han sido guardados correctamente');
};

// Abrir modal de RNC
document.getElementById('openRNCModal').onclick = () => {
  rncModal.classList.remove('hidden');
  rncModal.classList.add('flex');
};

// Función para enviar correo de confirmación (simulada)
function sendConfirmationEmail(order) {
  console.log('Enviando correo de confirmación a:', order.email);
  // En una implementación real, aquí se haría una llamada a un servicio de correo
}

// Función para generar y enviar factura (simulada)
function generateAndSendInvoice(order) {
  console.log('Generando factura para orden:', order.id);
  // En una implementación real, aquí se generaría un PDF y se enviaría por correo
  
  // Simulación de éxito
  showSuccess('Factura enviada', `La factura de la orden ${order.id} ha sido enviada al cliente por correo electrónico y WhatsApp.`, 5000);
}

// Funcionalidad de seguimiento
document.getElementById('trackOrder').addEventListener('click', () => {
  const trackingNumber = document.getElementById('trackingInput').value.trim();
  const trackingResult = document.getElementById('trackingResult');
  
  if (!trackingNumber) {
    alert('Por favor ingresa un número de orden');
    return;
  }
  
  const orders = loadOrders();
  const order = orders.find(o => o.id === trackingNumber.toUpperCase());
  
  if (order) {
    const currentLabel = order.lastCollabStatus ? collabStatusLabel(order.lastCollabStatus) : order.status;
    const badgeClass = order.lastCollabStatus
      ? (order.lastCollabStatus === 'entregado' ? 'bg-green-100 text-green-800' :
         order.lastCollabStatus === 'en_camino_recoger' ? 'bg-blue-100 text-blue-800' :
         order.lastCollabStatus === 'cargando' ? 'bg-yellow-100 text-yellow-800' :
         'bg-indigo-100 text-indigo-800')
      : (order.status === 'Completado' ? 'bg-green-100 text-green-800' :
         order.status === 'En proceso' ? 'bg-blue-100 text-blue-800' :
         'bg-yellow-100 text-yellow-800');

    trackingResult.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between">
          <span class="font-semibold">Estado actual:</span>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${badgeClass}">${currentLabel}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Servicio:</span>
          <span>${order.service}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Vehículo:</span>
          <span>${order.vehicle}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Fecha:</span>
          <span>${order.date} ${order.time}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Precio estimado:</span>
          <span class="text-green-600 font-bold">${order.estimatedPrice || 'Por confirmar'}</span>
        </div>
        ${order.tracking && order.tracking.length ? `
        <div>
          <div class="font-semibold mb-2">Historial:</div>
          <ul class="space-y-1 text-sm text-gray-700">
            ${order.tracking.map(t => `<li>• ${t.status} — <span class="text-gray-500">${new Date(t.at).toLocaleString('es-CO')}</span></li>`).join('')}
          </ul>
        </div>` : ''}
      </div>
    `;
    trackingResult.classList.remove('hidden');
    trackingResult.classList.remove('hidden');
    lucide.createIcons();
  } else {
    trackingResult.innerHTML = `
      <div class="text-center text-red-600">
        <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i>
        <p>No se encontró ningún pedido con ese número</p>
      </div>
    `;
    trackingResult.classList.remove('hidden');
    lucide.createIcons();
  }
});

// Configurar el botón de seguimiento en el header
const headerNav = document.querySelector('header .flex.items-center.gap-3');
const trackingBtn = document.createElement('button');
trackingBtn.innerHTML = 'Seguir pedido';
trackingBtn.className = 'px-4 py-2 text-sm font-medium text-gray-700 hover:text-red-600 transition-colors duration-200';
trackingBtn.onclick = () => {
  trackingModal.classList.remove('hidden');
  trackingModal.classList.add('flex');
};
headerNav.insertBefore(trackingBtn, headerNav.firstChild);

// Inicializar el sistema
function initializeSystem() {
  initializeDefaultVehicles();
  refreshDashboard();
  
  // Configurar event listeners para botones del mapa
  if (pickupMapBtn) {
    pickupMapBtn.addEventListener('click', () => {
      showMapForAddress('pickup');
    });
  }
  
  if (deliveryMapBtn) {
    deliveryMapBtn.addEventListener('click', () => {
      showMapForAddress('delivery');
    });
  }
  
  // Actualizar dashboard cada 30 segundos
  setInterval(refreshDashboard, 30000);
  
  lucide.createIcons();
}

// Inicializar después de cargar la página
setTimeout(initializeSystem, 100);

// Manejar la instalación de PWA
const installAppButton = document.getElementById('installApp');

// Escuchar el evento beforeinstallprompt
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevenir que Chrome muestre la mini-infobar
  e.preventDefault();
  // Guardar el evento para usarlo más tarde
  deferredPrompt = e;
  // Mostrar el botón de instalación
  installAppButton.style.display = 'flex';
});

// Manejar el clic en el botón de instalación
installAppButton.addEventListener('click', async () => {
  if (!deferredPrompt) {
    // El navegador no soporta la instalación o la app ya está instalada
    alert('Esta aplicación ya está instalada o tu navegador no soporta la instalación de PWAs.');
    return;
  }
  
  // Mostrar el prompt de instalación
  deferredPrompt.prompt();
  
  // Esperar a que el usuario responda al prompt
  const { outcome } = await deferredPrompt.userChoice;
  
  // Limpiar la variable deferredPrompt después de usarla
  deferredPrompt = null;
  
  // Ocultar el botón de instalación
  installAppButton.style.display = 'none';
});

// Escuchar el evento appinstalled
window.addEventListener('appinstalled', () => {
  // La app fue instalada exitosamente
  console.log('Aplicación instalada exitosamente');
  // Ocultar el botón de instalación
  installAppButton.style.display = 'none';
});

// Helper para VAPID (si configuras Push en servidor)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function initPushSubscription(registration) {
  if (!('PushManager' in window)) return;
  // Solicitar permiso de notificaciones si no está concedido
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    try { await Notification.requestPermission(); } catch (_) {}
  }
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      localStorage.setItem('tlc_push_subscription', JSON.stringify(existing));
      return;
    }
    // Obtener clave pública VAPID desde el backend
    let VAPID_PUBLIC_KEY = null;
    try {
      const resp = await fetch('http://localhost:3000/api/vapidPublicKey');
      if (resp.ok) {
        const data = await resp.json();
        VAPID_PUBLIC_KEY = data.key || null;
      }
    } catch (e) {}
    if (!VAPID_PUBLIC_KEY) return; // Salir si no está configurada
    const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
    localStorage.setItem('tlc_push_subscription', JSON.stringify(sub));
  } catch (e) {
    console.warn('Error suscribiendo a Push:', e);
  }
}

// Función para mostrar seguimiento por número de orden y abrir modal
function showTrackingFor(trackingNumber) {
  const trackingResult = document.getElementById('trackingResult');
  const orders = loadOrders();
  const order = orders.find(o => o.id === trackingNumber.toUpperCase());
  if (order) {
    const currentLabel = order.lastCollabStatus ? collabStatusLabel(order.lastCollabStatus) : order.status;
    const badgeClass = order.lastCollabStatus
      ? (order.lastCollabStatus === 'entregado' ? 'bg-green-100 text-green-800' :
         order.lastCollabStatus === 'en_camino_recoger' ? 'bg-blue-100 text-blue-800' :
         order.lastCollabStatus === 'cargando' ? 'bg-yellow-100 text-yellow-800' :
         'bg-indigo-100 text-indigo-800')
      : (order.status === 'Completado' ? 'bg-green-100 text-green-800' :
         order.status === 'En proceso' ? 'bg-blue-100 text-blue-800' :
         'bg-yellow-100 text-yellow-800');

    trackingResult.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between">
          <span class="font-semibold">Estado actual:</span>
          <span class="px-2 py-1 rounded-full text-xs font-semibold ${badgeClass}">${currentLabel}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Servicio:</span>
          <span>${order.service}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Vehículo:</span>
          <span>${order.vehicle}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Fecha:</span>
          <span>${order.date} ${order.time}</span>
        </div>
        <div class="flex justify-between">
          <span class="font-semibold">Precio estimado:</span>
          <span class="text-green-600 font-bold">${order.estimatedPrice || 'Por confirmar'}</span>
        </div>
        ${order.tracking && order.tracking.length ? `
        <div>
          <div class="font-semibold mb-2">Historial:</div>
          <ul class="space-y-1 text-sm text-gray-700">
            ${order.tracking.map(t => `<li>• ${t.status} — <span class="text-gray-500">${new Date(t.at).toLocaleString('es-CO')}</span></li>`).join('')}
          </ul>
        </div>` : ''}
      </div>
    `;
    trackingResult.classList.remove('hidden');
    // Abrir modal de seguimiento
    trackingModal.classList.remove('hidden');
    trackingModal.classList.add('flex');
    if (window.lucide) lucide.createIcons();
  } else {
    trackingResult.innerHTML = `
      <div class="text-center text-red-600">
        <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i>
        <p>No se encontró ningún pedido con ese número</p>
      </div>
    `;
    trackingResult.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

// Click en botón "Seguir pedido"
document.getElementById('trackOrder').addEventListener('click', () => {
  const trackingNumber = document.getElementById('trackingInput').value.trim();
  if (!trackingNumber) {
    alert('Por favor ingresa un número de orden');
    return;
  }
  showTrackingFor(trackingNumber);
});

// Autoabrir seguimiento si hay parámetro en URL o si el cliente ya tiene un pedido
(function autoOpenTracking(){
  try {
    const params = new URLSearchParams(window.location.search);
    const oid = params.get('order') || params.get('oid');
    const last = localStorage.getItem('tlc_last_order_id');
    const idToOpen = oid || last;
    if (idToOpen) {
      // Prefill input y abrir modal
      const input = document.getElementById('trackingInput');
      if (input) input.value = idToOpen;
      showTrackingFor(idToOpen);
    }
  } catch (e) {
    // Ignorar errores
  }
})();