// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};
let modalFilled = false; // Nueva variable para controlar si el modal fue llenado

// Función para obtener o generar client_id
function getClientId() {
  let clientId = localStorage.getItem('client_id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem('client_id', clientId);
    console.log('[Cliente] Nuevo client_id generado:', clientId);
  }
  return clientId;
}

// Función para obtener suscripción push
async function getPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Service Worker o Push Manager no disponible');
      return null;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'BEl62iUYgUivxIkv69yViEuiBIa40HdHSWgDdXU5cp0TJpQrSr90PiZKP-Q_ZdLiRkiWHGfzjFoyBLOAGLbDzfM' // Reemplaza con tu VAPID key
    });
    
    console.log('[Push] Suscripción obtenida:', subscription);
    return subscription.toJSON();
  } catch (error) {
    console.warn('[Push] Error al obtener suscripción:', error);
    return null;
  }
}

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

// --- Carga dinámica de datos desde Supabase ---

async function loadServices() {
  const serviceListContainer = document.getElementById('service-list');
  if (!serviceListContainer) return;

  // ✅ CORRECCIÓN: La función ahora devuelve el array directamente.
  const services = await supabaseConfig.getServices();

  if (!services) {
    console.error('Error al cargar servicios: no se recibieron datos.');
    serviceListContainer.innerHTML = '<p class="text-red-500 col-span-full">No se pudieron cargar los servicios.</p>';
    return;
  }

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

  // ✅ CORRECCIÓN: La función ahora devuelve el array directamente.
  const vehicles = await supabaseConfig.getVehicles();

  if (!vehicles) {
    console.error('Error al cargar vehículos: no se recibieron datos.');
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

// Función para validar paso actual
function validateCurrentStep() {
  if (currentStep === 1) {
    const nombreInput = document.querySelector('input[placeholder="Nombre completo"]');
    const telefonoInput = document.querySelector('input[placeholder="Teléfono"]');
    const emailInput = document.querySelector('input[placeholder="Correo"]');
    
    // Validación mejorada para el nombre
    const isNombreValid = /^[a-zA-Z\s\u00C0-\u024F]+$/.test(nombreInput.value) && nombreInput.value.trim().length > 2;
    // Validación mejorada para el teléfono (formato dominicano)
    const phoneRegex = /^(\+1|1)?[-\s]?8[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{4}$/;
    const isTelefonoValid = phoneRegex.test(telefonoInput.value.replace(/[-\s]/g, ''));
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value);

    // Actualizar UI de validación
    nombreInput.classList.toggle('border-red-500', !isNombreValid);
    nombreInput.classList.toggle('border-green-500', isNombreValid);
    telefonoInput.classList.toggle('border-red-500', !isTelefonoValid);
    telefonoInput.classList.toggle('border-green-500', isTelefonoValid);
    emailInput.classList.toggle('border-red-500', !isEmailValid);
    emailInput.classList.toggle('border-green-500', isEmailValid);

    if (!isNombreValid || !isTelefonoValid || !isEmailValid) {
      notifications.warning('Por favor, revisa los campos marcados en rojo.', { title: 'Datos Personales Incompletos' });
      return false;
    }
  }
  
  if (currentStep === 2 && (!selectedService || !selectedService.name)) {
    notifications.warning('Debes seleccionar un servicio para continuar.', { title: 'Paso Incompleto' });
    return false;
  }

  // Nueva validación: Asegurarse de que el modal del servicio fue llenado
  if (currentStep === 2) {
    const modalId = `modal-${selectedService.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-')}`;
    const modalElement = document.getElementById(modalId);
    // Solo validar si el modal existe y no ha sido llenado
    if (modalElement && !modalElement.classList.contains('hidden') && !modalFilled) {
      notifications.warning('Por favor, completa y guarda la información adicional del servicio antes de continuar.', { title: 'Información Requerida' });
      return false;
    } else if (modalElement && modalElement.classList.contains('hidden') && !modalFilled) {
      // Si el modal existe pero fue cerrado sin guardar, también es inválido
      notifications.warning('Parece que no guardaste la información adicional del servicio. Por favor, haz clic en "Continuar" dentro del formulario emergente.', { title: 'Información Requerida' });
      return false;
    }
  }
  
  if (currentStep === 3) {
    const selectedVehicle = document.querySelector('.vehicle-item.selected');
    if (!selectedVehicle) {
      notifications.warning('Debes seleccionar un vehículo para continuar.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 4) {
    const origen = document.getElementById('pickupAddress').value.trim();
    const destino = document.getElementById('deliveryAddress').value.trim();
    
    if (!origen || !destino) {
      notifications.warning('Debes establecer una dirección de origen y una de destino en el mapa.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 5) {
    const fecha = document.querySelector('input[type="date"]').value;
    const hora = document.querySelector('input[type="time"]').value;
    
    if (!fecha || !hora) {
      notifications.warning('Debes seleccionar una fecha y hora para el servicio.', { title: 'Paso Incompleto' });
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
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', // ✅ CORREGIDO: Usar URL de CDN
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', // ✅ CORREGIDO: Usar URL de CDN
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const destinationIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', // ✅ CORREGIDO: Usar URL de CDN
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', // ✅ CORREGIDO: Usar URL de CDN
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
        // --- INICIO: Llamada a la Función Edge de Supabase ---
        const { data, error } = await supabaseConfig.client.functions.invoke('reverse-geocode', {
          body: { lat: latlng.lat, lon: latlng.lng }
        });

        if (error) {
          throw error;
        }

        currentInput.value = data.display_name || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
        // --- FIN: Llamada a la Función Edge de Supabase ---
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
  // Mostrar tarjeta elegante para opt-in de notificaciones
  showPushOptInCard(orderId);
}

// Utilidad: convertir Base64 URL-safe a Uint8Array para Push API
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeUserToPush(orderId) {
  try {
    const registration = await navigator.serviceWorker.ready;
    console.log("Service Worker listo para suscripción");
    
    // Obtener la clave VAPID válida desde el servidor
    let vapidKey = null;
    try {
      const { data, error } = await supabaseConfig.client.functions.invoke('get-vapid-key', { body: {} });
      if (error) {
        console.warn('No se pudo obtener VAPID por función:', error.message);
      }
      vapidKey = data?.vapidPublicKey || null;
    } catch (e) {
      console.warn('Fallo al invocar get-vapid-key:', e?.message || String(e));
    }

    if (!vapidKey || typeof vapidKey !== 'string') {
      throw new Error('VAPID pública no disponible. Contacte al administrador.');
    }

    // Validar formato de clave VAPID antes de convertir
    const raw = urlBase64ToUint8Array(vapidKey);
    if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
      console.error('Clave VAPID inválida: longitud', raw?.length, 'primer byte', raw?.[0]);
      throw new Error('Invalid raw ECDSA P-256 public key');
    }

    const applicationServerKey = raw;
    console.log("applicationServerKey generada y validada correctamente");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    
    // Guardar suscripción en Supabase
    // Preferir tabla push_subscriptions por usuario; si no hay usuario, guardar en la orden como fallback
    try {
      const { data: userData } = await supabaseConfig.client.auth.getUser();
      const userId = userData?.user?.id || null;

      if (userId) {
        // Inserta o actualiza en push_subscriptions usando formato de keys JSON { p256dh, auth }
        const payload = {
          user_id: userId,
          endpoint: subscription?.endpoint,
          keys: {
            p256dh: subscription?.keys?.p256dh,
            auth: subscription?.keys?.auth
          }
        };
        // Upsert para evitar duplicados por (user_id, endpoint) cuando el esquema lo soporta
        const { error: upsertErr } = await supabaseConfig.client
          .from('push_subscriptions')
          .upsert(payload, { onConflict: 'user_id,endpoint' });
        if (upsertErr) {
          console.warn('Fallo upsert en push_subscriptions, probando insert:', upsertErr?.message || upsertErr);
          await supabaseConfig.client.from('push_subscriptions').insert(payload);
        }
        console.log('Suscripción guardada en push_subscriptions para usuario:', userId);
      } else {
        // Fallback: guardar en la orden para clientes anónimos
        await supabaseConfig.client
          .from('orders')
          .update({ push_subscription: subscription })
          .eq('id', orderId);
        console.log('Suscripción guardada en la orden (anónimo):', orderId);
      }
    } catch (saveErr) {
      console.error('Error guardando suscripción en Supabase:', saveErr);
    }

    return subscription;
  } catch (error) {
    console.error("Error en subscribeUserToPush:", error);
    throw error;
  }
}

// --- UI elegante para opt-in de notificaciones (tarjeta blanca con logo) ---
function showPushOptInCard(orderId) {
  // Evitar duplicados
  if (document.getElementById('push-optin-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'push-optin-overlay';
  overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
      <div class="p-6 text-center">
        <img src="img/1vertical.png" alt="Logo LLO" class="h-14 w-14 mx-auto mb-3"/>
        <h3 class="text-xl font-bold text-gray-900 mb-2">¿Deseas recibir notificaciones?</h3>
        <p class="text-gray-600 mb-5">Activa las notificaciones para saber cuando tu solicitud avance de estado.</p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button id="push-decline" class="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Ahora no</button>
          <button id="push-accept" class="px-5 py-2.5 rounded-lg bg-azulClaro text-white hover:bg-azulOscuro">Sí, activar notificaciones</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeOverlay = () => overlay.remove();
  document.getElementById('push-decline').addEventListener('click', closeOverlay);
  document.getElementById('push-accept').addEventListener('click', async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const subscription = await subscribeUserToPush(orderId);
        if (subscription) {
          showSuccess('Notificaciones activadas.');
        }
      } else {
        showInfo('Podrás activarlas más tarde desde tu navegador.');
      }
    } catch (e) {
      console.error('Error al activar notificaciones:', e);
      showError('No se pudieron activar las notificaciones.');
    } finally {
      closeOverlay();
    }
  });
}

// Redirección después de copiar el ID
function handleAfterCopy(orderId) {
  try {
    sessionStorage.setItem('justSubmitted', orderId);
  } catch (_) {}
  window.location.href = 'index.html';
}

// Exponer función para acciones de notificación
window.handleAfterCopy = handleAfterCopy;

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
  // Evitar doble envío del formulario
  let isSubmittingOrder = false;
  
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

      // Botón de envío y guardia de doble clic
      const submitBtn = serviceForm.querySelector('button[type="submit"], input[type="submit"]');
      if (isSubmittingOrder) {
        notifications.info('Tu solicitud ya se está enviando...', { title: 'Procesando' });
        return;
      }
      isSubmittingOrder = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        // Guardar contenido original para restaurar luego
        // @ts-ignore
        submitBtn.dataset.originalHTML = submitBtn.innerHTML;
        // Mostrar estado de carga
        // @ts-ignore
        submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 inline mr-2 animate-spin"></i> Enviando...';
        // Refrescar iconos si está disponible
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      }

      try {
        // Verificar conexión a Supabase antes de continuar
        if (!supabaseConfig.client) {
          notifications.error('No se pudo conectar con el servidor. Verifica tu conexión a internet.', { title: 'Error de Conexión' });
          return;
        }

        // Construir el objeto de la orden para Supabase
        const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
        const originCoords = originMarker ? originMarker.getLatLng() : null;
        const destinationCoords = destinationMarker ? destinationMarker.getLatLng() : null;
        const orderData = {
          // Datos del cliente (Paso 1)
          name: document.querySelector('input[placeholder="Nombre completo"]').value,
          phone: document.querySelector('input[placeholder="Teléfono"]').value,
          email: document.querySelector('input[placeholder="Correo"]').value,
          rnc: document.querySelector('input[name="rnc"]')?.value || null,
          empresa: document.querySelector('input[name="empresa"]')?.value || null,
          // Detalles del servicio (Pasos 2 y 3)
          service_id: selectedService ? parseInt(selectedService.id, 10) : null,
          vehicle_id: selectedVehicleCard ? parseInt(selectedVehicleCard.dataset.vehicleId, 10) : null,
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
          tracking_data: [{ status: 'Solicitud Creada', date: new Date().toISOString() }],
          // Mantener compatibilidad escribiendo ambos campos
          tracking: [{ status: 'Solicitud Creada', date: new Date().toISOString() }]
        };

        // Guardar orden en Supabase con estrategia de reintento según esquema
        // Base de datos: campos comunes
        const baseOrder = {
          // Datos del cliente (Paso 1)
          name: orderData.name,
          phone: orderData.phone,
          email: orderData.email,
          rnc: orderData.rnc,
          empresa: orderData.empresa,
          // Detalles del servicio (se añadirá service_id o service según esquema)
          service_questions: orderData.service_questions,
          // Detalles de la ruta (Paso 4)
          pickup: orderData.pickup,
          delivery: orderData.delivery,
          // Fecha y Hora (Paso 5)
          date: orderData.date,
          time: orderData.time,
          // Estado y precio inicial
          status: orderData.status,
          estimated_price: orderData.estimated_price,
          tracking_data: orderData.tracking_data,
          tracking: orderData.tracking || orderData.tracking_data
        };

        // Asignar client_id (usuario autenticado o UUID generado)
        const { data: { user } } = await supabaseConfig.client.auth.getUser();
        if (user && user.id) {
          baseOrder.client_id = user.id;
          console.log('Usuario autenticado, asignando client_id:', user.id);
        } else {
          // Si no hay usuario autenticado, usar client_id generado
          baseOrder.client_id = getClientId();
          console.log('No hay usuario autenticado, usando client_id generado:', baseOrder.client_id);
        }

        // Obtener suscripción push para notificaciones
        const pushSubscription = await getPushSubscription();
        if (pushSubscription) {
          baseOrder.notification_subscription = pushSubscription;
          console.log('Suscripción push agregada a la orden');
        }

        const origin_coords2 = orderData.origin_coords;
        const destination_coords2 = orderData.destination_coords;

        const variantA = Object.assign({}, baseOrder, {
          service_id: orderData.service_id,
          vehicle_id: orderData.vehicle_id,
          origin_coords: origin_coords2,
          destination_coords: destination_coords2
        });

        // Función auxiliar para intentar insertar y devolver resultado o lanzar error
        async function tryInsert(payload) {
          // Obtener la sesión actual de forma compatible con supabase-js v2
          let session = null;
          try {
            const sessionResp = await supabaseConfig.client.auth.getSession();
            session = sessionResp?.data?.session ?? null;
          } catch (e) {
            // No bloquear: asumimos sesión nula si falla
            session = null;
          }

          // Si no hay sesión válida, intentar con cliente público (anon) para operaciones de solo lectura/escritura pública
          const usePublicClient = !session;
          const clientToUse = usePublicClient && typeof supabaseConfig.getPublicClient === 'function'
            ? supabaseConfig.getPublicClient()
            : supabaseConfig.client;

          // Intentar insertar; si falla por columna inexistente (p.ej. 'tracking'), reintentar sin ese campo
          async function insertWithSanitize(candidatePayload) {
            // Intento principal: insert + select (requiere política SELECT para órdenes pendientes)
            let resp = await clientToUse.from('orders').insert([candidatePayload]).select();
            if (resp.error) {
              const err = resp.error;
              const msg = String(err.message || '').toLowerCase();
              const code = err.code || '';
              const status = err.status || 0;

              // Si la columna 'tracking' no existe en el esquema, reintentar sin ese campo
              if (
                code === 'PGRST204' ||
                /could not find the 'tracking' column/i.test(err.message || '') ||
                msg.includes("column \"tracking\"") ||
                /tracking column/i.test(msg)
              ) {
                const sanitized = { ...candidatePayload };
                delete sanitized.tracking;
                resp = await clientToUse.from('orders').insert([sanitized]).select();
                if (resp.error) throw resp.error;
                if (!resp.data || resp.data.length === 0) throw new Error('No se recibió confirmación al guardar la orden.');
                return resp.data[0];
              }

              // Si falla por RLS/401, hacer insert con retorno mínimo como fallback
              if (status === 401 || code === 'PGRST303' || /rls|not authorized|permission/i.test(msg)) {
                const sanitized = { ...candidatePayload };
                delete sanitized.tracking;
                const minimal = await clientToUse.from('orders').insert([sanitized], { returning: 'minimal' });
                if (minimal.error) throw minimal.error;
                // No podemos leer la fila por RLS; devolvemos marcador para flujos de UI
                return { id: null, short_id: null, __noSelect: true };
              }

              throw err;
            }
            if (!resp.data || resp.data.length === 0) throw new Error('No se recibió confirmación al guardar la orden.');
            return resp.data[0];
          }

          // Ejecutar inserción
          return await insertWithSanitize(payload);
        }

        let savedOrder;
        try {
          savedOrder = await tryInsert(variantA);
        } catch (err) {
          console.error('Error al guardar la solicitud:', err);
          let errorMsg = 'Hubo un error al enviar tu solicitud. Por favor, inténtalo de nuevo.';
          if (err && typeof err === 'object') {
            if (err.message && err.message.includes('duplicate key')) {
              errorMsg = 'Ya existe una solicitud con estos datos. Verifica la información.';
            } else if (err.message) {
              errorMsg = `Error específico: ${err.message}`;
            } else if (err.code) {
              errorMsg = `Error de código: ${err.code}`;
            }
          }
          notifications.error(errorMsg, { title: 'Error al Guardar Solicitud' });
          return;
        }

        // Si llegamos aquí, savedOrder está presente (puede no traer ID si hubo fallback RLS)
        const displayCode = (savedOrder && (savedOrder.short_id || savedOrder.id)) ? (savedOrder.short_id || savedOrder.id) : null;
        if (!displayCode) {
          console.warn('Orden creada sin datos de retorno por RLS. Mostrando confirmación genérica.');
          notifications.persistent(
            'Tu solicitud fue enviada. Te enviaremos el código de seguimiento por correo.',
            'success',
            { title: '¡Solicitud Enviada!' }
          );
        } else {
          const trackingUrl = `${window.location.origin}/seguimiento.html?codigo=${displayCode}`;
          // No actualizar tracking_url manualmente: el trigger del backend ya lo establece
          notifications.persistent(
            `Guarda este código para dar seguimiento: <strong>${displayCode}</strong>`,
            'success',
            {
              title: '¡Solicitud Enviada con Éxito!',
              copyText: displayCode,
              onCopy: () => { window.location.href = trackingUrl; }
            }
          );
        }

        // Mostrar tarjeta de opt-in para notificaciones push (si tenemos id)
        if (savedOrder && savedOrder.id) {
          askForNotificationPermission(savedOrder.id);
        }

      } catch (error) {
        // Log detallado del error para debugging
        const errorDetails = {
          error,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          response: error.response,
          data: error.data,
          status: error.status
        };
        console.error('Error al guardar la solicitud:', errorDetails);

        // Mostrar error detallado en desarrollo
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          notifications.error(
            `Error técnico: ${error.message || 'Error desconocido'}
            ${error.hint ? `\nSugerencia: ${error.hint}` : ''}
            ${error.code ? `\nCódigo: ${error.code}` : ''}`,
            { title: 'Error al Guardar (Debug)' }
          );
        } else {
          // Mensaje amigable en producción
          notifications.error('Hubo un error al enviar tu solicitud. Por favor, inténtalo de nuevo.', 
            { title: 'Error Inesperado' });
        }
      } finally {
        // Restaurar estado del botón y guardia
        if (submitBtn) {
          submitBtn.disabled = false;
          // @ts-ignore
          submitBtn.innerHTML = submitBtn.dataset.originalHTML || submitBtn.innerHTML;
        }
        isSubmittingOrder = false;
      }
    });
  }

  // Mostrar primer paso
  if (steps && steps.length > 0) {
    showStep(currentStep);
  }
});
