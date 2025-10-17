// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};
let modalFilled = false; // Nueva variable para controlar si el modal fue llenado

// Variables para el mapa
let map;
let originMarker;
let destinationMarker;
let isOriginSet = false; // Controla si el origen ya fue establecido

// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar;

function showStep(step) {
  steps.forEach(s => s.classList.add('hidden'));
  document.querySelector(`.step[data-step="${step}"]`).classList.remove('hidden');
  prevBtn.classList.toggle('hidden', step === 1);
  const isLastStep = step === steps.length;
  nextBtn.classList.toggle('hidden', isLastStep);
  // Si es el último paso, mostrar el resumen
  if (isLastStep) {
    displayOrderSummary();
  }
  // Si volvemos al paso 4, invalidar el mapa para que se redibuje correctamente
  if (step === 4 && map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
  progressBar.style.width = ((step-1)/(steps.length-1))*100 + '%';
}

function getServiceOrder() {
  return [
    'Transporte Comercial',
    'Paquetería',
    'Carga Pesada',
    'Flete',
    'Mudanza',
    'Grúa Vehículo',
    'Botes Mineros',
    'Grúa de Carga'
  ];
}
// --- Carga dinámica de datos desde Supabase ---

async function loadServices() {
  const serviceListContainer = document.getElementById('service-list');
  if (!serviceListContainer) return;

  const { data: services, error } = await supabaseConfig.getServices();

  if (error) {
    console.error('Error al cargar servicios:', error);
    serviceListContainer.innerHTML = '<p class="text-red-500 col-span-full">No se pudieron cargar los servicios.</p>';
    return;
  }

  const serviceOrder = getServiceOrder();
  // Ordenar los servicios según el array `serviceOrder`
  services.sort((a, b) => {
    return serviceOrder.indexOf(a.name) - serviceOrder.indexOf(b.name);
  });

  serviceListContainer.innerHTML = services.map(service => `
    <div class="service-item group relative cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white text-center shadow-md transition-all duration-300 ease-in-out hover:shadow-xl hover:border-azulClaro hover:-translate-y-1" 
         data-service-id="${service.id}" 
         data-service-name="${service.name}">
      <div class="relative mb-2 h-32 w-full rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
          <img src="${service.image_url || 'img/1vertical.png'}" alt="${service.name}" class="h-28 w-auto object-contain transition-transform duration-300 group-hover:scale-110" onerror="this.src='img/1vertical.png'">
      </div>
      <div class="p-2">
        <span class="block truncate font-semibold text-gray-700 group-hover:text-azulOscuro">${service.name}</span>
      </div>
      <div class="check-indicator absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-azulClaro text-white transition-transform duration-300 scale-0">
        <i class="fas fa-check text-xs"></i> 
      </div>
    </div>
  `).join('');
  
  // Asignar listeners a los nuevos elementos
  document.querySelectorAll('.service-item').forEach(card => {
    card.addEventListener('click', function() {
      // Reiniciar estado de selección y validación de modal
      modalFilled = false; 
      document.querySelectorAll('.service-item').forEach(c => {
        c.classList.remove('selected', 'border-azulClaro', 'shadow-lg');
        c.querySelector('.check-indicator').classList.add('hidden', 'scale-0');
      });

      // Marcar el nuevo servicio como seleccionado
      this.classList.add('selected', 'border-azulClaro', 'shadow-lg');
      this.querySelector('.check-indicator').classList.remove('hidden');
      this.querySelector('.check-indicator').classList.add('scale-100');
      
      selectedService = { id: this.dataset.serviceId, name: this.dataset.serviceName };

      // Normalizar el nombre para crear un ID de modal seguro
      const normalizedName = this.dataset.serviceName
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Eliminar tildes
        .replace(/ /g, '-'); // Reemplazar espacios con guiones

      const modal = document.getElementById(`modal-${normalizedName}`);
      if (modal) {
        modal.classList.remove('hidden');
      }
    });
  });
}

async function loadVehicles() {
  const vehicleListContainer = document.getElementById('vehicle-list');
  if (!vehicleListContainer) return;

  const { data: vehicles, error } = await supabaseConfig.getVehicles();

  if (error) {
    console.error('Error al cargar vehículos:', error);
    vehicleListContainer.innerHTML = '<p class="text-red-500 col-span-full">No se pudieron cargar los vehículos.</p>';
    return;
  }

  vehicleListContainer.innerHTML = vehicles.map(vehicle => `
    <div class="vehicle-item group relative cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white text-center shadow-md transition-all duration-300 ease-in-out hover:shadow-xl hover:border-azulClaro hover:-translate-y-1" 
         data-vehicle-id="${vehicle.id}" 
         data-vehicle-name="${vehicle.name}">
      <div class="relative mb-2 h-32 w-full rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
          <img src="${vehicle.image_url || 'img/1vertical.png'}" alt="${vehicle.name}" class="h-28 w-auto object-contain transition-transform duration-300 group-hover:scale-110" onerror="this.src='img/1vertical.png'">
      </div>
      <div class="p-2">
        <span class="block truncate font-semibold text-gray-700 group-hover:text-azulOscuro">${vehicle.name}</span>
      </div>
      <div class="check-indicator absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-azulClaro text-white transition-transform duration-300 scale-0">
        <i class="fas fa-check text-xs"></i> 
      </div>
    </div>
  `).join('');

  // Asignar listeners a los nuevos elementos
  document.querySelectorAll('.vehicle-item').forEach(card => {
    card.addEventListener('click', function() {
      document.querySelectorAll('.vehicle-item').forEach(c => {
        c.classList.remove('selected', 'border-azulClaro', 'shadow-lg');
        c.querySelector('.check-indicator').classList.add('hidden', 'scale-0');
      });

      this.classList.add('selected', 'border-azulClaro', 'shadow-lg');
      this.querySelector('.check-indicator').classList.remove('hidden');
      this.querySelector('.check-indicator').classList.add('scale-100');
    });
  });
}

// Función para generar ID consecutivo
function generateOrderId() {
  // Genera un ID más único basado en la fecha y un número aleatorio
  return `TLC-${Date.now().toString().slice(-6)}`;
}

// Función para validar paso actual
function validateCurrentStep() {
  if (currentStep === 1) {
    const nombreInput = document.querySelector('input[placeholder="Nombre completo"]');
    const telefonoInput = document.querySelector('input[placeholder="Teléfono"]');
    const emailInput = document.querySelector('input[placeholder="Correo"]');
    
    const isNombreValid = /^[a-zA-Z\s\u00C0-\u024F]+$/.test(nombreInput.value) && nombreInput.value.trim().length > 2;
    const isTelefonoValid = /^[\d\s()-]+$/.test(telefonoInput.value) && telefonoInput.value.length > 6;
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value);

    // Actualizar UI de validación
    nombreInput.classList.toggle('border-red-500', !isNombreValid);
    nombreInput.classList.toggle('border-green-500', isNombreValid);
    telefonoInput.classList.toggle('border-red-500', !isTelefonoValid);
    telefonoInput.classList.toggle('border-green-500', isTelefonoValid);
    emailInput.classList.toggle('border-red-500', !isEmailValid);
    emailInput.classList.toggle('border-green-500', isEmailValid);

    if (!isNombreValid || !isTelefonoValid || !isEmailValid) {
      let errorMessage = 'Por favor, corrija los siguientes campos:\n';
      if (!isNombreValid) errorMessage += '- Nombre: debe tener más de 2 letras y solo puede contener letras y espacios.\n';
      if (!isTelefonoValid) errorMessage += '- Teléfono: debe ser un número válido.\n';
      if (!isEmailValid) errorMessage += '- Correo: debe ser un correo electrónico válido.\n';
      alert(errorMessage);
      return false;
    }
  }
  
  if (currentStep === 2 && (!selectedService || !selectedService.name)) {
    alert('Por favor seleccione un servicio');
    return false;
  }

  // Nueva validación: Asegurarse de que el modal del servicio fue llenado
  if (currentStep === 2) {
    const modalId = `modal-${selectedService.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-')}`;
    if (document.getElementById(modalId) && !modalFilled) {
      alert('Por favor, complete la información adicional del servicio seleccionado antes de continuar.');
      return false;
    }
  }
  
  if (currentStep === 3) {
    const selectedVehicle = document.querySelector('.vehicle-item.selected');
    if (!selectedVehicle) {
      alert('Por favor seleccione un vehículo');
      return false;
    }
  }
  
  if (currentStep === 4) {
    const origen = document.getElementById('pickupAddress').value;
    const destino = document.getElementById('deliveryAddress').value;
    
    if (!origen || !destino) {
      alert('Por favor complete las direcciones de origen y destino');
      return false;
    }
  }
  
  if (currentStep === 5) {
    const fecha = document.querySelector('input[type="date"]').value;
    const hora = document.querySelector('input[type="time"]').value;
    
    if (!fecha || !hora) {
      alert('Por favor seleccione fecha y hora');
      return false;
    }
  }
  
  return true;
}

// Función para mostrar el resumen de la orden en el paso 6
function displayOrderSummary() {
  const summaryContainer = document.getElementById('order-summary');
  if (!summaryContainer) return;

  // Recolectar todos los datos
  const name = document.querySelector('input[placeholder="Nombre completo"]').value;
  const phone = document.querySelector('input[placeholder="Teléfono"]').value;
  const email = document.querySelector('input[placeholder="Correo"]').value;
  const rnc = document.querySelector('input[name="rnc"]').value;
  const empresa = document.querySelector('input[name="empresa"]').value;

  const service = selectedService ? selectedService.name : 'No seleccionado';
  
  const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
  const vehicle = selectedVehicleCard ? selectedVehicleCard.dataset.vehicleName : 'No seleccionado';

  const pickup = document.getElementById('pickupAddress').value;
  const delivery = document.getElementById('deliveryAddress').value;

  // Obtener datos del mapa en el momento de mostrar el resumen
  const distance = document.getElementById('distance-value').textContent;
  const originCoords = originMarker ? originMarker.getLatLng() : null;
  const destinationCoords = destinationMarker ? destinationMarker.getLatLng() : null;

  const date = document.querySelector('input[type="date"]').value;
  const time = document.querySelector('input[type="time"]').value;

  // Construir el HTML del resumen
  let summaryHTML = `
    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mb-2 border-b pb-1">Datos del Cliente</h5>
      <p><strong>Nombre:</strong> ${name}</p>
      <p><strong>Teléfono:</strong> ${phone}</p>
      <p><strong>Correo:</strong> ${email}</p>
      ${rnc ? `<p><strong>RNC:</strong> ${rnc}</p>` : ''}
      ${empresa ? `<p><strong>Empresa:</strong> ${empresa}</p>` : ''}
    </div>

    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mt-4 mb-2 border-b pb-1">Detalles del Servicio</h5>
      <p><strong>Servicio:</strong> ${service}</p>
      <p><strong>Vehículo:</strong> ${vehicle}</p>`;

  // Añadir preguntas del modal si existen
  if (Object.keys(serviceQuestions).length > 0) {
    summaryHTML += `<div class="mt-2 pl-4 border-l-2 border-gray-200">`;
    for (const [key, value] of Object.entries(serviceQuestions)) {
      const questionText = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      summaryHTML += `<p><strong>${questionText}:</strong> ${value}</p>`;
    }
    summaryHTML += `</div>`;
  }
  summaryHTML += `</div>`;

  summaryHTML += `
    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mt-4 mb-2 border-b pb-1">Ruta y Horario</h5>
      <p><strong>Origen:</strong> ${pickup}</p>
      <p><strong>Destino:</strong> ${delivery}</p>
      ${distance !== '--' ? `<p><strong>Distancia:</strong> ${distance} km</p>` : ''}
      ${originCoords ? `<p class="text-xs text-gray-500">Coords. Origen: ${originCoords.lat.toFixed(4)}, ${originCoords.lng.toFixed(4)}</p>` : ''}
      ${destinationCoords ? `<p class="text-xs text-gray-500">Coords. Destino: ${destinationCoords.lat.toFixed(4)}, ${destinationCoords.lng.toFixed(4)}</p>` : ''}
      <p><strong>Fecha:</strong> ${date}</p>
      <p><strong>Hora:</strong> ${time}</p>
    </div>
  `;

  summaryContainer.innerHTML = summaryHTML;
}


// Función para manejar el checkbox de RNC
function toggleRNCField() {
  const rncCheckbox = document.getElementById('hasRNC');
  const rncFields = document.getElementById('rncFields');
  const itbisMessage = document.getElementById('itbisMessage');
  
  if (rncCheckbox && rncFields) {
    if (rncCheckbox.checked) {
      rncFields.classList.remove('hidden');
      itbisMessage.classList.remove('hidden');
    } else {
      rncFields.classList.add('hidden');
      itbisMessage.classList.add('hidden');
      // Limpiar campos cuando se ocultan
      document.querySelector('input[name="rnc"]').value = '';
      document.querySelector('input[name="empresa"]').value = '';
    }
  }
}

// --- Funciones del Mapa (Leaflet) ---

/**
 * Obtiene la ubicación actual del usuario y la establece como origen.
 */
function locateUserAndSetOrigin() {
  const loader = document.getElementById('map-loader');
  const loaderText = document.getElementById('map-loader-text');
  if (!navigator.geolocation) {
    alert('La geolocalización no es soportada por tu navegador.');
    return;
  }

  // Mostrar spinner de geolocalización
  loader.style.display = 'flex';
  loaderText.textContent = 'Obteniendo ubicación...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      // Activar el input de origen antes de llamar a la función de actualización
      document.getElementById('pickupAddress').focus();
      // Llamar a la función que actualiza el marcador y la dirección
      updateMarkerAndAddress({ lat: latitude, lng: longitude });
      // Centrar el mapa en la nueva ubicación
      map.setView([latitude, longitude], 15);
      loader.style.display = 'none'; // Ocultar spinner al encontrar
    },
    () => {
      alert('No se pudo obtener tu ubicación. Asegúrate de haber concedido los permisos.');
      loader.style.display = 'none'; // Ocultar spinner si hay error
    }
  );
}

async function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.log("Elemento del mapa no encontrado en esta página.");
    return;
  }

  // Mostrar spinner mientras carga el mapa
  const loader = document.getElementById('map-loader');
  const loaderText = document.getElementById('map-loader-text');
  loader.style.display = 'flex';

  map = L.map(mapElement).setView([18.4273, -70.0976], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map).on('load', () => loader.style.display = 'none');


  // --- Iconos personalizados para los marcadores ---
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

  // --- Búsqueda de direcciones ---
  const searchControl = new GeoSearch.GeoSearchControl({
    provider: new GeoSearch.OpenStreetMapProvider(),
    style: 'bar',
    showMarker: false,
    autoClose: true,
  });
  map.addControl(searchControl);

  map.on('geosearch/showlocation', (result) => {
    updateMarkerAndAddress({ lat: result.location.y, lng: result.location.x }, result.location.label);
  });

  // --- Inputs y listeners ---
  const pickupInput = document.getElementById('pickupAddress');
  const deliveryInput = document.getElementById('deliveryAddress');
  const useCurrentLocationBtn = document.getElementById('use-current-location-btn');
  const instructionText = document.getElementById('map-instruction-text');

  map.on('click', (e) => { updateMarkerAndAddress(e.latlng); });

  pickupInput.addEventListener('focus', () => {
    instructionText.innerHTML = "Busca o haz clic en el mapa para establecer el <strong>punto de origen</strong>.";
  });
  deliveryInput.addEventListener('focus', () => {
    instructionText.innerHTML = "Ahora, busca o haz clic para establecer el <strong>punto de destino</strong>.";
  });

  useCurrentLocationBtn.addEventListener('click', locateUserAndSetOrigin);

  // Lógica principal para actualizar marcadores
  async function updateMarkerAndAddress(latlng, label = null) {
    let currentMarker, currentInput, currentIcon;

    if (!isOriginSet) {
      // Estableciendo el ORIGEN
      currentMarker = originMarker;
      currentInput = pickupInput;
      currentIcon = originIcon;

      if (!currentMarker) {
        originMarker = L.marker(latlng, { icon: currentIcon, draggable: true }).addTo(map);
        originMarker.on('dragend', (e) => updateMarkerAndAddress(e.target.getLatLng()));
      } else {
        originMarker.setLatLng(latlng);
      }
    } else {
      // Estableciendo el DESTINO
      currentMarker = destinationMarker;
      currentInput = deliveryInput;
      currentIcon = destinationIcon;

      if (!currentMarker) {
        destinationMarker = L.marker(latlng, { icon: currentIcon, draggable: true }).addTo(map);
        destinationMarker.on('dragend', (e) => updateMarkerAndAddress(e.target.getLatLng()));
      } else {
        destinationMarker.setLatLng(latlng);
      }
    }

    // Obtener dirección (Geocodificación inversa)
    if (label) {
      currentInput.value = label;
    } else {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`);
        if (!response.ok) throw new Error(`Nominatim respondió con estado: ${response.status}`);
        const data = await response.json();
        currentInput.value = data.display_name || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
      } catch (error) {
        console.error("Error en geocodificación inversa:", error);
        currentInput.value = `Lat: ${latlng.lat.toFixed(5)}, Lon: ${latlng.lng.toFixed(5)}`;
      }
    }

    // Lógica de flujo secuencial
    if (!isOriginSet) {
      isOriginSet = true;
      deliveryInput.disabled = false;
      deliveryInput.placeholder = "Escribe o selecciona en el mapa";
      deliveryInput.focus(); // Mover el foco al siguiente campo
      instructionText.innerHTML = "¡Perfecto! Ahora, establece el <strong>punto de destino</strong>.";
    }

    calculateAndDisplayDistance();
    fitMapToBounds();
  }
}

function fitMapToBounds() {
  const bounds = L.latLngBounds();
  let markerCount = 0;
  if (originMarker) {
    bounds.extend(originMarker.getLatLng());
    markerCount++;
  }
  if (destinationMarker) {
    bounds.extend(destinationMarker.getLatLng());
    markerCount++;
  }
  if (markerCount > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

function calculateAndDisplayDistance() {
  const distanceContainer = document.getElementById('distance-container');
  const distanceValueEl = document.getElementById('distance-value');

  if (originMarker && destinationMarker) {
    const distanceInMeters = map.distance(originMarker.getLatLng(), destinationMarker.getLatLng());
    const distanceInKm = (distanceInMeters / 1000).toFixed(2);
    distanceValueEl.textContent = distanceInKm;
    distanceContainer.classList.remove('hidden');
  } else {
    distanceContainer.classList.add('hidden');
  }
}

// --- Lógica de Notificaciones Push ---

/**
 * Pide permiso al usuario para notificaciones y guarda la suscripción en la orden.
 * @param {string} orderId - El ID de la orden recién creada.
 */
async function askForNotificationPermission(orderId) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.log('Este navegador no soporta notificaciones push.');
    return;
  }

  if (Notification.permission === 'granted') {
    await subscribeUserToPush(orderId);
  } else if (Notification.permission !== 'denied') {
    if (confirm('¿Deseas recibir notificaciones sobre el estado de tu pedido?')) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeUserToPush(orderId);
      }
    }
  }
}

async function subscribeUserToPush(orderId) {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: supabaseConfig.vapidPublicKey // Usamos la clave desde la config
  });

  // Actualizar la orden en Supabase con la suscripción
  await supabaseConfig.client.from('orders').update({ push_subscription: subscription }).eq('id', orderId);
  console.log('Suscripción guardada para la orden:', orderId);
}

/**
 * Copia un texto al portapapeles y muestra una notificación.
 * @param {string} text - El texto a copiar.
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showSuccess('ID copiado al portapapeles');
  }).catch(err => {
    showError('No se pudo copiar el ID');
  });
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  
  // Inicializar elementos del DOM
  steps = document.querySelectorAll('.step');
  nextBtn = document.getElementById('nextBtn');
  prevBtn = document.getElementById('prevBtn');
  progressBar = document.getElementById('progress-bar');
  
  // Cargar datos dinámicos
  loadServices();
  loadVehicles();
  initMap();

  // Manejar checkbox de RNC
  const rncCheckbox = document.getElementById('hasRNC');
  if (rncCheckbox) {
    rncCheckbox.addEventListener('change', toggleRNCField);
  }

  // Manejar mensaje de hora
  const timeInput = document.querySelector('input[type="time"]');
  if (timeInput) {
      timeInput.addEventListener('change', () => document.getElementById('time-message').classList.remove('hidden'));
  }

  // Añadir validación en tiempo real para el paso 1
  const nombreInput = document.querySelector('input[placeholder="Nombre completo"]');
  const telefonoInput = document.querySelector('input[placeholder="Teléfono"]');
  const emailInput = document.querySelector('input[placeholder="Correo"]');

  nombreInput?.addEventListener('input', (e) => {
    const isValid = /^[a-zA-Z\s\u00C0-\u024F]*$/.test(e.target.value);
    e.target.classList.toggle('border-red-500', !isValid);
  });
  telefonoInput?.addEventListener('input', (e) => {
    const isValid = /^[\d\s()-]*$/.test(e.target.value);
    e.target.classList.toggle('border-red-500', !isValid);
  });
  emailInput?.addEventListener('input', (e) => {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value) || e.target.value === '';
      e.target.classList.toggle('border-red-500', !isValid && e.target.value !== '');
  });
  
  // Lógica para el modal de Botes Mineros (mostrar/ocultar campo "otro")
  const materialSelect = document.querySelector('#form-botes-mineros select[name="tipo_material"]');
  const materialOtroInput = document.querySelector('#form-botes-mineros input[name="material_otro"]');
  materialSelect?.addEventListener('change', function() {
    if (this.value === 'otro') {
      materialOtroInput.classList.remove('hidden');
      materialOtroInput.required = true;
    } else {
      materialOtroInput.classList.add('hidden');
      materialOtroInput.required = false;
    }
  });

  // Manejar cierre de modales
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', function() {
      this.closest('.fixed').classList.add('hidden');
    });
  });

  // Manejar envío de formularios de modales
  document.querySelectorAll('[id^="form-"]').forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Guardar respuestas del servicio
      const formData = new FormData(this);
      serviceQuestions = {}; // Reiniciar por si el usuario cambia de opinión
      
      for (let [key, value] of formData.entries()) {
        serviceQuestions[key] = value;
      }
      
      modalFilled = true; // Marcar que el modal fue completado
      showSuccess('Información del servicio guardada.'); // Notificación opcional

      // Solo cerrar el modal, no avanzar de paso
      this.closest('.fixed').classList.add('hidden');
    });
  });

  // Botón siguiente
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!validateCurrentStep()) return;

      // Si estamos en el paso 2, reiniciamos la validación del modal para la próxima vez que se entre
      if (currentStep === 2) {
        modalFilled = false;
      }
      
      if(currentStep < steps.length) {
        currentStep++;
        showStep(currentStep);
      }
    });
  }

  // Botón anterior
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if(currentStep > 1) {
        currentStep--;
        showStep(currentStep);
      }
    });
  }

  // Manejar envío final del formulario
  const serviceForm = document.getElementById('serviceForm');
  if (serviceForm) {
    serviceForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      if (!validateCurrentStep()) return;
      
      // Construir el objeto de la orden para Supabase
      const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
      const originCoords = originMarker ? originMarker.getLatLng() : null;
      const destinationCoords = destinationMarker ? destinationMarker.getLatLng() : null;
      const newOrderId = generateOrderId(); // Generar el ID una sola vez
      const orderData = {
        id: newOrderId,
        tracking_url: `${window.location.origin}/seguimiento.html?order=${newOrderId}`,
        // Datos del cliente (Paso 1)
        name: document.querySelector('input[placeholder="Nombre completo"]').value,
        phone: document.querySelector('input[placeholder="Teléfono"]').value,
        email: document.querySelector('input[placeholder="Correo"]').value,
        rnc: document.querySelector('input[name="rnc"]')?.value || null,
        empresa: document.querySelector('input[name="empresa"]')?.value || null,
        // Detalles del servicio (Pasos 2 y 3)
        service: selectedService.name,
        vehicle: selectedVehicleCard ? selectedVehicleCard.dataset.vehicleName : null,
        service_questions: serviceQuestions,
        // Detalles de la ruta (Paso 4)
        pickup: document.getElementById('pickupAddress').value,
        delivery: document.getElementById('deliveryAddress').value,
        origin_coords: originCoords ? { lat: originCoords.lat, lng: originCoords.lng } : null,
        destination_coords: destinationCoords ? { lat: destinationCoords.lat, lng: destinationCoords.lng } : null,
        // Fecha y Hora (Paso 5)
        "date": document.querySelector('input[type="date"]').value,
        "time": document.querySelector('input[type="time"]').value,
        // Estado y precio inicial
        status: 'Pendiente',
        estimated_price: 'Por confirmar',
        tracking: [{ status: 'Solicitud Creada', date: new Date().toISOString() }] // Añadir el campo tracking inicial
      };
      
      // Guardar orden en Supabase
      try {
        const { data, error } = await supabaseConfig.client
          .from('orders')
          .insert([orderData])
          .select();

        if (error) {
          throw error;
        }

        // Mostrar notificaciones de éxito
        showSuccess('¡Solicitud enviada exitosamente!');
        
        // Segunda notificación con el ID y botón para copiar
        showInfo(
          `Tu número de orden es: <strong>${orderData.id}</strong>. Úsalo para darle seguimiento.`, 
          {
            title: 'Guarda tu ID',
            duration: 15000, // Darle más tiempo para que lo vea
            actions: [{
              text: 'Copiar ID',
              handler: `copyToClipboard('${orderData.id}')`
            }]
          }
        );
        
        // Preguntar por permiso de notificaciones
        await askForNotificationPermission(orderData.id);
        
        // Redirigir después de un momento para que el usuario vea las notificaciones
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 5000);

      } catch (error) {
        console.error('Error al guardar la solicitud:', error);
        alert(`Hubo un error al enviar tu solicitud. Por favor, inténtalo de nuevo.\n\nError: ${error.message}`);
      }
    });
  }

  // Mostrar primer paso
  if (steps && steps.length > 0) {
    showStep(currentStep);
  }
});
