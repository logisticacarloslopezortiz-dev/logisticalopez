// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};
let modalFilled = false; // Nueva variable para controlar si el modal fue llenado

function getClientId() {
  let clientId = localStorage.getItem('client_id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem('client_id', clientId);
    console.log('[Cliente] Nuevo client_id generado:', clientId);
  }
  return clientId;
}

// Utilidad: escapar texto para evitar inyección HTML al insertar en innerHTML
function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/[&<>"']/g, function(s) {
    const entityMap = {
      "&": "&",
      "<": "<",
      ">": ">",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entityMap[s];
  });
}

async function getPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Service Worker o Push Manager no disponible');
      return null;
    }

    const currentPerm = Notification.permission;
    const permission = currentPerm === 'default' ? await Notification.requestPermission() : currentPerm;
    if (permission !== 'granted') {
      console.warn('[Push] Permiso de notificaciones no concedido');
      return null;
    }

    const registration = await navigator.serviceWorker.ready;
    let vapidKey = null;
    try {
      let resp = await supabaseConfig.client.functions.invoke('getVapidKey');
      if (resp.error || !resp.data?.key) {
        resp = await supabaseConfig.client.functions.invoke('get-vapid-key');
      }
      const { data, error } = resp;
      if (error) console.warn('No se pudo obtener VAPID por función:', error.message);
      vapidKey = data?.key || null;
    } catch (e) {
      console.warn('Fallo al invocar getVapidKey/get-vapid-key:', e?.message || String(e));
    }
    if (!vapidKey || typeof vapidKey !== 'string') {
      console.warn('VAPID pública no disponible');
      return null;
    }
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);

    if (window.__push_subscribing) return null;
    window.__push_subscribing = true;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      window.__push_subscribing = false;
      const json = typeof existing.toJSON === 'function' ? existing.toJSON() : existing;
      console.log('[Push] Suscripción existente reutilizada:', json);
      return json;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    window.__push_subscribing = false;
    console.log('[Push] Suscripción obtenida:', subscription);
    return typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
  } catch (error) {
    console.warn('[Push] Error al obtener suscripción:', error);
    return null;
  }
}

// Variables para el mapa
let map;
let originMarker;
let destinationMarker;
let previewMarker;
let pickupInput;
let deliveryInput;
let isOriginSet = false; // Controla si el origen ya fue establecido
let mapStep = 'awaiting_origin'; // awaiting_origin | awaiting_destination | complete
let providerForSearch = null;
let rdBounds = null;
let lastLatLng = null;
let originIcon = null;
let destinationIcon = null;
let previewIcon = null;

let awaitingDestination = false; // Estado: esperando marcar destino tras fijar origen
let mapInitialized = false; // ✅ NUEVO: Control para evitar inicializaciones múltiples del mapa.

// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar, helpText;
let mapContainer = null;

const formSection = document.getElementById('form-section');
// mapContainer is already declared at the top level; reuse it instead of re-declaring
mapContainer = document.getElementById('map-container');

function showStep(step) {
  steps.forEach(s => s.classList.add('hidden'));
  document.querySelector(`.step[data-step="${step}"]`).classList.remove('hidden');
  prevBtn.classList.toggle('hidden', step === 1);
  const isLastStep = step === steps.length;
  nextBtn.classList.toggle('hidden', isLastStep);

  // Lógica para mostrar/ocultar el mapa a pantalla completa
  if (step === 4) {
    if (formSection) { formSection.classList.add('z-50'); }
  } else {
    if (formSection) { formSection.classList.remove('z-50'); }
  }

  // Si es el último paso, mostrar el resumen
  if (isLastStep) {
    displayOrderSummary();
  }

  // ✅ SOLUCIÓN MEJORADA: Inicializar el mapa solo cuando el paso 4 es visible por primera vez.
  if (step === 4) {
    resetRouteSelection();
  }
  if (step === 4 && !mapInitialized) { // Si estamos en el paso 4 y el mapa NO ha sido inicializado
    mapInitialized = true; // Marcar como inicializado para no volver a ejecutar
    initMap();
  } else if (step === 4 && map) { // Si ya existe, solo refresca su tamaño
    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }
  const dateEl = document.getElementById('orderDate');
  const timeEl = document.getElementById('orderTime');
  const isStep5 = step === 5;
  if (dateEl) { dateEl.required = isStep5; }
  if (timeEl) { timeEl.required = isStep5; }
  if (progressBar) { progressBar.style.width = ((step-1)/(steps.length-1))*100 + '%'; }
  updateHelpText(step);
}

function resetRouteSelection(){
  try {
    if (originMarker && map) { map.removeLayer(originMarker); }
    if (destinationMarker && map) { map.removeLayer(destinationMarker); }
  } catch(_) {}
  originMarker = null;
  destinationMarker = null;
  isOriginSet = false;
  mapStep = 'awaiting_origin';
  const originCard = document.getElementById('origin-card');
  const originDisp = document.getElementById('origin-address-display');
  const destCard = document.getElementById('destination-card');
  const destDisp = document.getElementById('destination-address-display');
  const distanceContainer = document.getElementById('distance-container');
  const pickupLabel = document.getElementById('pickup-label');
  const deliveryLabel = document.getElementById('delivery-label');
  const routeInputs = document.getElementById('route-inputs');
  if (originCard) originCard.classList.add('hidden');
  if (destCard) destCard.classList.add('hidden');
  if (distanceContainer) distanceContainer.classList.add('hidden');
  if (pickupLabel) pickupLabel.classList.remove('hidden');
  if (deliveryLabel) deliveryLabel.classList.remove('hidden');
  if (routeInputs) routeInputs.classList.add('hidden');
  if (pickupInput) { pickupInput.disabled = false; }
  if (deliveryInput) { deliveryInput.disabled = true; deliveryInput.value = ''; }
  const instr = document.getElementById('map-instruction-text');
  if (instr) instr.textContent = 'Primero, define tu punto de recogida.';
}

function resetOriginOnly(){
  try { if (originMarker && map) map.removeLayer(originMarker); } catch(_){}
  originMarker = null;
  isOriginSet = false;
  mapStep = 'awaiting_origin';
  const originCard = document.getElementById('origin-card');
  const distanceContainer = document.getElementById('distance-container');
  if (originCard) originCard.classList.add('hidden');
  if (distanceContainer) distanceContainer.classList.add('hidden');
  if (deliveryInput) deliveryInput.disabled = true;
  const instr = document.getElementById('map-instruction-text');
  if (instr) instr.textContent = 'Primero, define tu punto de recogida.';
}

function resetDestinationOnly(){
  try { if (destinationMarker && map) map.removeLayer(destinationMarker); } catch(_){}
  destinationMarker = null;
  mapStep = isOriginSet ? 'awaiting_destination' : 'awaiting_origin';
  const destCard = document.getElementById('destination-card');
  const distanceContainer = document.getElementById('distance-container');
  if (destCard) destCard.classList.add('hidden');
  if (distanceContainer) distanceContainer.classList.add('hidden');
  if (deliveryInput) { deliveryInput.disabled = false; deliveryInput.value = ''; }
  const instr = document.getElementById('map-instruction-text');
  if (instr) instr.textContent = 'Ahora, define tu punto de entrega.';
}

function updateHelpText(step) {
  if (!helpText) return;
  let message = '';
  switch(step) {
    case 1:
      message = 'Ingresa tus datos de contacto. Nos comunicaremos contigo a través de estos medios.';
      break;
    case 2:
      message = 'Selecciona el tipo de servicio que necesitas. Aparecerán preguntas adicionales si es necesario.';
      break;
    case 3:
      message = 'Elige el vehículo que mejor se adapte a tu carga. Esto nos ayuda a asignar el equipo correcto.';
      break;
    case 4:
      message = 'Usa el mapa para marcar el punto de recogida y el de entrega. Puedes buscar por dirección o usar tu ubicación actual.';
      break;
    case 5:
      message = 'Indícanos cuándo necesitas el servicio. Haremos lo posible por cumplir con tu horario.';
      break;
    case 6:
      message = '¡Casi listo! Revisa que toda la información sea correcta antes de enviar tu solicitud.';
      break;
  }
  helpText.textContent = message;
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
         data-service-name="${service.name}"
         data-service-description="${service.description || ''}">
      <div class="relative mb-2 h-32 w-full rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
          <img src="${service.image_url || 'img/1vertical.png'}" alt="${service.name}" class="h-28 w-auto object-contain transition-transform duration-300 group-hover:scale-110" onerror="this.src='img/1vertical.png'">
      </div>
      <div class="p-2 text-left">
        <span class="block truncate font-semibold text-gray-700 group-hover:text-azulOscuro">${service.name}</span>
        <!-- ✅ NUEVO: Contenedor para la descripción con animación -->
        <div class="marquee-container text-xs text-gray-500 mt-1">
          <p class="marquee-text">${service.description || ''}</p>
        </div>
      </div>
      <div class="check-indicator absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-azulClaro text-white transition-transform duration-300 scale-0">
        <i class="fa-solid fa-check text-xs"></i> 
      </div>
    </div>
  `).join('');
  
  // ✅ NUEVO: Comprobar y aplicar animación a las descripciones que lo necesiten
  checkAndAnimateDescriptions();

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
        document.documentElement.classList.add('overflow-hidden');
        document.body.classList.add('overflow-hidden');
      }
    });
  });
}

/**
 * ✅ NUEVO: Revisa las descripciones de los servicios y aplica una clase de animación
 * solo a aquellas cuyo texto es más largo que el contenedor.
 */
function checkAndAnimateDescriptions() {
  const serviceItems = document.querySelectorAll('.service-item');
  serviceItems.forEach(item => {
    const container = item.querySelector('.marquee-container');
    const text = item.querySelector('.marquee-text');
    if (container && text) {
      // Comprueba si el ancho del contenido del texto es mayor que el ancho visible del contenedor
      if (text.scrollWidth > container.clientWidth) {
        container.classList.add('needs-animation');
      } else {
        container.classList.remove('needs-animation');
      }
    }
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
        <i class="fa-solid fa-check text-xs"></i> 
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
    const nombreInput = document.getElementById('clientName');
    const telefonoInput = document.getElementById('clientPhone');
    const emailInput = document.getElementById('clientEmail');
    
    // Guarda de seguridad: si los elementos no existen, la validación falla.
    if (!nombreInput || !telefonoInput || !emailInput) {
      console.error("Error de validación: Uno o más campos del paso 1 no se encontraron en el DOM.");
      return false;
    }

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
    const pickupEl = document.getElementById('pickupAddress');
    const deliveryEl = document.getElementById('deliveryAddress');
    const origen = pickupEl && pickupEl.value ? String(pickupEl.value).trim() : '';
    const destino = deliveryEl && deliveryEl.value ? String(deliveryEl.value).trim() : '';

    if (!origen || !destino) {
      notifications.warning('Debes establecer una dirección de origen y una de destino en el mapa.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 5) {
    const fechaEl = document.getElementById('orderDate');
    const horaEl = document.getElementById('orderTime');
    const fecha = fechaEl ? fechaEl.value : '';
    const hora = horaEl ? horaEl.value : '';
    
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
  const nameEl = document.getElementById('clientName');
  const phoneEl = document.getElementById('clientPhone');
  const emailEl = document.getElementById('clientEmail');
  const rncEl = document.querySelector('input[name="rnc"]');
  const empresaEl = document.querySelector('input[name="empresa"]');
  const name = nameEl ? nameEl.value : '';
  const phone = phoneEl ? phoneEl.value : '';
  const email = emailEl ? emailEl.value : '';
  const rnc = rncEl ? rncEl.value : '';
  const empresa = empresaEl ? empresaEl.value : '';

  const service = selectedService ? selectedService.name : 'No seleccionado';
  
  const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
  const vehicle = selectedVehicleCard ? selectedVehicleCard.dataset.vehicleName : 'No seleccionado';

  const pickupEl = document.getElementById('pickupAddress');
  const deliveryEl = document.getElementById('deliveryAddress');
  const pickup = pickupEl ? pickupEl.value : '';
  const delivery = deliveryEl ? deliveryEl.value : '';

  // Obtener datos del mapa en el momento de mostrar el resumen
  const distance = document.getElementById('distance-value').textContent;
  const originCoords = originMarker ? originMarker.getLatLng() : null;
  const destinationCoords = destinationMarker ? destinationMarker.getLatLng() : null;

  const dateEl = document.getElementById('orderDate');
  const timeEl = document.getElementById('orderTime');
  const date = dateEl ? dateEl.value : '';
  const time = timeEl ? timeEl.value : '';

  // Construir el HTML del resumen (sanitizando entradas de usuario)
  const esc = escapeHtml;
  const escName = esc(name);
  const escPhone = esc(phone);
  const escEmail = esc(email);
  const escRnc = rnc ? esc(rnc) : '';
  const escEmpresa = empresa ? esc(empresa) : '';
  const escService = esc(service);
  const escVehicle = esc(vehicle);
  const escPickup = esc(pickup);
  const escDelivery = esc(delivery);
  const escDate = esc(date);
  const escTime = esc(time);

  let summaryHTML = `
    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mb-2 border-b pb-1">Datos del Cliente</h5>
      <p><strong>Nombre:</strong> ${escName}</p>
      <p><strong>Teléfono:</strong> ${escPhone}</p>
      <p><strong>Correo:</strong> ${escEmail}</p>
      ${escRnc ? `<p><strong>RNC:</strong> ${escRnc}</p>` : ''}
      ${escEmpresa ? `<p><strong>Empresa:</strong> ${escEmpresa}</p>` : ''}
    </div>

    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mt-4 mb-2 border-b pb-1">Detalles del Servicio</h5>
      <p><strong>Servicio:</strong> ${escService}</p>
      <p><strong>Vehículo:</strong> ${escVehicle}</p>`;

  // Añadir preguntas del modal si existen, con formato especial para Mudanza
  if (Object.keys(serviceQuestions).length > 0) {
    summaryHTML += `<div class="mt-2 pl-4 border-l-2 border-gray-200">`;

    // Detectar y formatear items de mudanza con cantidades
    const entries = Object.entries(serviceQuestions);
    const mudanzaItems = entries.filter(([k, v]) => /^item_.+_qty$/.test(k) && Number(v) > 0);
    if (mudanzaItems.length > 0) {
      const labelMap = {
        item_camas_qty: 'Camas',
        item_sofas_qty: 'Sofás',
        item_mesas_qty: 'Mesas',
        item_sillas_qty: 'Sillas',
        item_cajas_qty: 'Cajas',
        item_neveras_qty: 'Neveras',
        item_lavadoras_qty: 'Lavadoras',
        item_estufas_qty: 'Estufas',
        item_tv_qty: 'TV',
        item_escritorios_qty: 'Escritorios',
        item_armarios_qty: 'Armarios/Roperos'
      };
      const itemsText = mudanzaItems
        .map(([k, v]) => `${labelMap[k] || k}: ${escapeHtml(String(v))}`)
        .join(', ');
      summaryHTML += `<p><strong>Objetos y cantidades:</strong> ${itemsText}</p>`;
    }

    // Mostrar el resto de entries excluyendo los items de mudanza ya resumidos
    for (const [key, value] of entries) {
      if (/^item_.+_qty$/.test(key)) continue;
      const questionText = escapeHtml(key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
      summaryHTML += `<p><strong>${questionText}:</strong> ${escapeHtml(String(value))}</p>`;
    }

    summaryHTML += `</div>`;
  }
  summaryHTML += `</div>`;

  summaryHTML += `
    <div class="summary-section">
      <h5 class="font-bold text-azulOscuro mt-4 mb-2 border-b pb-1">Ruta y Horario</h5>
      <p><strong>Origen:</strong> ${escPickup}</p>
      <p><strong>Destino:</strong> ${escDelivery}</p>
      ${distance !== '--' ? `<p><strong>Distancia:</strong> ${escapeHtml(String(distance))} km</p>` : ''}
      ${originCoords ? `<p class="text-xs text-gray-500">Coords. Origen: ${escapeHtml(String(originCoords.lat.toFixed(4)))}, ${escapeHtml(String(originCoords.lng.toFixed(4)))}</p>` : ''}
      ${destinationCoords ? `<p class="text-xs text-gray-500">Coords. Destino: ${escapeHtml(String(destinationCoords.lat.toFixed(4)))}, ${escapeHtml(String(destinationCoords.lng.toFixed(4)))}</p>` : ''}
      <p><strong>Fecha:</strong> ${escDate}</p>
      <p><strong>Hora:</strong> ${escTime}</p>
    </div>
  `;

  summaryContainer.innerHTML = summaryHTML;
}


// Función para manejar el checkbox de RNC
function toggleRNCField() {
  const rncCheckbox = document.getElementById('hasRNC');
  const rncFields = document.getElementById('rncFields');
  const itbisMessage = document.getElementById('itbisMessage');
  const rncInput = document.getElementById('clientRNC');
  const empresaInput = document.getElementById('clientCompany');
  
  if (rncCheckbox && rncFields) {
    if (rncCheckbox.checked) {
      rncFields.classList.remove('hidden');
      itbisMessage.classList.remove('hidden');
      if (rncInput) rncInput.required = true;
      if (empresaInput) empresaInput.required = true;
    } else {
      rncFields.classList.add('hidden');
      itbisMessage.classList.add('hidden');
      // Limpiar campos cuando se ocultan
      if (rncInput) { rncInput.value = ''; rncInput.required = false; }
      if (empresaInput) { empresaInput.value = ''; empresaInput.required = false; }
    }
  }
}

// --- Funciones del Mapa (Leaflet) ---

// --- Bottom Sheet Helpers (móvil) ---
function ensureBottomSheet(){
  if (document.getElementById('mobileBottomSheet')) return;
  const sheet = document.createElement('div');
  sheet.id = 'mobileBottomSheet';
  sheet.className = 'fixed inset-x-0 bottom-0 z-[120] bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 translate-y-full md:static md:translate-y-0 md:rounded-none md:shadow-none md:hidden';
  sheet.innerHTML = `
    <div class="w-full flex justify-center pt-2"><div class="w-12 h-1.5 bg-gray-300 rounded-full"></div></div>
    <div id="mbsContent" class="p-2"></div>
    <button type="button" id="mbsClose" class="absolute top-2 right-3 text-gray-400 hover:text-gray-600" aria-label="Cerrar hoja">&times;</button>
  `;
  document.body.appendChild(sheet);
  document.getElementById('mbsClose').onclick = () => hideBottomSheet();
}
function showBottomSheet(){ const s = document.getElementById('mobileBottomSheet'); if (s) s.classList.remove('translate-y-full'); }
function hideBottomSheet(){ const s = document.getElementById('mobileBottomSheet'); if (s) s.classList.add('translate-y-full'); }
function setBottomSheetInstruction(){ ensureBottomSheet(); const c = document.getElementById('mbsContent'); if (c) c.innerHTML = '<div class="p-4 text-sm text-gray-700">Escribe una dirección o toca el mapa para fijar el punto de origen.</div>'; showBottomSheet(); }
function setBottomSheetForOrigin(address){
  ensureBottomSheet();
  const c = document.getElementById('mbsContent');
  if (c) {
    c.innerHTML = `
      <div class="p-4 space-y-3">
        <label class="text-xs text-gray-500">Dirección de origen</label>
        <input id="mbsOriginInput" type="text" class="w-full border rounded p-2" value="${address ? String(address).replace(/"/g,'&quot;') : ''}" />
        <div class="flex justify-end">
          <button id="mbsContinueBtn" class="px-4 py-2 bg-azulClaro text-white rounded">Continuar con destino</button>
        </div>
      </div>`;
    const btn = document.getElementById('mbsContinueBtn');
    if (btn){
      btn.onclick = () => {
        const val = document.getElementById('mbsOriginInput')?.value;
        const pickupInput = document.getElementById('pickupAddress');
        if (pickupInput && val) pickupInput.value = val;
        awaitingDestination = true;
        hideBottomSheet();
      };
    }
  }
  showBottomSheet();
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
  
  rdBounds = L.latLngBounds(
    L.latLng(17.47004, -72.00742), // Suroeste RD
    L.latLng(19.93298, -68.32254)  // Noreste RD
  );
  const sanCristobalCenter = [18.4160, -70.1090];

  map = L.map(mapElement, {
    maxBounds: rdBounds,
    maxBoundsViscosity: 1.0
  }).setView(sanCristobalCenter, 12);

  if (map && typeof map.invalidateSize === 'function') { setTimeout(() => map.invalidateSize(), 100); }
  mapElement.style.background = '#eef2ff';
  mapElement.style.position = 'relative';
  function ensureResponsiveMapHeight(){
    const h = Math.max(360, Math.floor(window.innerHeight * 0.75));
    mapElement.style.height = h + 'px';
    if (map && typeof map.invalidateSize === 'function') { setTimeout(() => map.invalidateSize(), 50); }
  }
  ensureResponsiveMapHeight();
  window.addEventListener('resize', ensureResponsiveMapHeight);
  window.addEventListener('orientationchange', ensureResponsiveMapHeight);
  // pickupInput already declared earlier; reuse it here
  // deliveryInput ya declarado más arriba; se reutiliza aquí

  if (pickupInput) { pickupInput.classList.remove('hidden'); pickupInput.disabled = false; pickupInput.placeholder = 'Escribe o selecciona en el mapa'; }
  if (deliveryInput) { deliveryInput.classList.remove('hidden'); deliveryInput.disabled = true; deliveryInput.placeholder = 'Escribe o selecciona en el mapa'; }
  let lastLatLng = { lat: 18.416, lng: -70.112 };

  let layersControl = null;
  let layersHidden = false;
  const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  });
  const stadiaOutdoors = L.tileLayer('https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png', {
    attribution: 'Map tiles by Stadia Maps, Data by OpenMapTiles & OpenStreetMap contributors',
    maxZoom: 20
  });
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  });
  // Preferir Stadia Outdoors por defecto y ocultar loader cuando cargue; fallback a CARTO si falla
  let baseLoaded = false;
  const baseLayer = stadiaOutdoors.addTo(map);
  if (baseLayer && typeof baseLayer.on === 'function') {
    baseLayer.on('load', () => { loader.style.display = 'none'; mapElement.style.background = ''; baseLoaded = true; });
    baseLayer.on('tileerror', () => {
      if (!baseLoaded) {
        const cartoLayer = cartoVoyager.addTo(map);
        if (cartoLayer && typeof cartoLayer.on === 'function') {
          cartoLayer.on('load', () => { loader.style.display = 'none'; mapElement.style.background = ''; });
        } else {
          const osmLayer = osmStandard.addTo(map);
          if (osmLayer && typeof osmLayer.on === 'function') {
            osmLayer.on('load', () => { loader.style.display = 'none'; mapElement.style.background = ''; });
          } else {
            loader.style.display = 'none'; mapElement.style.background = '';
          }
        }
      }
    });
  } else {
    // Fallback cuando Leaflet local es un stub sin eventos
    loader.style.display = 'none';
  }
  if (L.control && typeof L.control.layers === 'function') {
    layersControl = L.control.layers({ 'Stadia Outdoors': stadiaOutdoors, 'CARTO Voyager': cartoVoyager, 'OSM Standard': osmStandard }).addTo(map);
  }
  let providerRD = null;
  if (window.GeoSearch && GeoSearch.OpenStreetMapProvider) {
    providerRD = new GeoSearch.OpenStreetMapProvider({ params: { countrycodes: 'do', "accept-language": 'es', addressdetails: 1 } });
  }
  const geoSearchProvider = providerRD;
  providerForSearch = geoSearchProvider;

  async function forwardGeocode(q){
    try{
      const { data, error } = await supabaseConfig.client.functions.invoke('forward-geocode', { body: { q, countrycodes: 'do', lang: 'es', addressdetails: 1 } });
      if (error) return null;
      const res = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      if (Array.isArray(res) && res.length > 0){
        const r = res[0];
        const lat = parseFloat(r.lat ?? r.y);
        const lon = parseFloat(r.lon ?? r.x);
        const label = r.display_name ?? r.label ?? r.name ?? q;
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lng: lon, label };
      }
      return null;
    } catch(_) { return null; }
  }


  // --- Iconos personalizados para los marcadores ---
  originIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', // ✅ CORREGIDO: Usar URL de CDN
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', // ✅ CORREGIDO: Usar URL de CDN
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  destinationIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', // ✅ CORREGIDO: Usar URL de CDN
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', // ✅ CORREGIDO: Usar URL de CDN
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  previewIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  // --- Búsqueda de direcciones ---
  let searchControl = null;
  let searchAdded = false;
  if (providerRD && window.GeoSearch && GeoSearch.GeoSearchControl && map && typeof map.addControl === 'function') {
    searchControl = new GeoSearch.GeoSearchControl({ provider: geoSearchProvider, style: 'bar', showMarker: false, autoClose: false });
    map.addControl(searchControl);
    searchAdded = true;
  }
  // Buscador interno siempre visible, debajo del menú de capas
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '10px';
  container.style.right = '10px';
  container.style.zIndex = '1000';
  container.style.background = '#fff';
  container.style.padding = '6px';
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'address-search-input';
  input.placeholder = 'Buscar lugar en República Dominicana';
  input.style.width = '220px';
  input.style.border = '1px solid #e5e7eb';
  input.style.borderRadius = '6px';
  input.style.padding = '6px 8px';
  container.appendChild(input);
    // Controles jerárquicos
    const controlsWrapper = document.createElement('div');
    controlsWrapper.style.display = 'grid';
    controlsWrapper.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    controlsWrapper.style.gap = '6px';
    controlsWrapper.style.marginTop = '6px';
    const provinceSelect = document.createElement('select');
    const municipioSelect = document.createElement('select');
    const sectorSelect = document.createElement('select');
    const centroSelect = document.createElement('select');
    [provinceSelect, municipioSelect, sectorSelect, centroSelect].forEach(sel => {
      sel.style.border = '1px solid #e5e7eb';
      sel.style.borderRadius = '6px';
      sel.style.padding = '6px 8px';
      sel.style.width = '100%';
    });
    provinceSelect.innerHTML = `<option value="">Buscar provincia ▼</option>`;
    municipioSelect.innerHTML = `<option value="">Buscar municipio ▼</option>`;
    sectorSelect.innerHTML = `<option value="">Buscar sector ▼</option>`;
    centroSelect.innerHTML = `<option value="">Centro específico ▼</option>`;
    controlsWrapper.appendChild(provinceSelect);
    controlsWrapper.appendChild(municipioSelect);
    controlsWrapper.appendChild(sectorSelect);
    controlsWrapper.appendChild(centroSelect);
    container.appendChild(controlsWrapper);

    // Índice geográfico jerárquico básico para RD (ejemplo)
    const geoIndex = [
      { id: 1, nombre: 'República Dominicana', tipo: 'pais', padre_id: null, lat: 18.7357, lng: -70.1627 },
      { id: 2, nombre: 'Santo Domingo', tipo: 'provincia', padre_id: 1, lat: 18.5, lng: -69.9 },
      { id: 3, nombre: 'San Cristóbal', tipo: 'provincia', padre_id: 1, lat: 18.416, lng: -70.112 },
      { id: 4, nombre: 'Bajos de Haina', tipo: 'municipio', padre_id: 3, lat: 18.414, lng: -70.035 },
      { id: 5, nombre: 'San Cristóbal', tipo: 'municipio', padre_id: 3, lat: 18.416, lng: -70.112 },
      { id: 6, nombre: 'Cambita Garabitos', tipo: 'municipio', padre_id: 3, lat: 18.462, lng: -70.223 },
      { id: 7, nombre: 'San Gregorio de Nigua', tipo: 'municipio', padre_id: 3, lat: 18.390, lng: -70.087 },
      { id: 8, nombre: 'Yaguate', tipo: 'municipio', padre_id: 3, lat: 18.335, lng: -70.180 },
      { id: 9, nombre: 'Sabana Grande de Palenque', tipo: 'municipio', padre_id: 3, lat: 18.252, lng: -70.100 },
      { id: 10, nombre: 'Villa Altagracia', tipo: 'municipio', padre_id: 3, lat: 18.649, lng: -70.171 },
      { id: 11, nombre: 'Los Cacaos', tipo: 'municipio', padre_id: 3, lat: 18.750, lng: -70.350 },
      { id: 12, nombre: 'Haina Centro', tipo: 'sector', padre_id: 4, lat: 18.414, lng: -70.035 },
      { id: 13, nombre: 'Madre Vieja Norte', tipo: 'sector', padre_id: 5, lat: 18.417, lng: -70.103 },
      { id: 14, nombre: 'Madre Vieja Sur', tipo: 'sector', padre_id: 5, lat: 18.405, lng: -70.110 },
      { id: 15, nombre: 'Centro Médico Haina', tipo: 'centro', padre_id: 12, lat: 18.413, lng: -70.030 }
    ];

    function fillSelect(select, items){
      const currentFirst = select.firstElementChild ? select.firstElementChild.outerHTML : '';
      select.innerHTML = currentFirst || '';
      items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = String(it.id);
        opt.textContent = it.nombre;
        select.appendChild(opt);
      });
    }
    // Poblar provincias
    fillSelect(provinceSelect, geoIndex.filter(x => x.tipo === 'provincia'));

    provinceSelect.addEventListener('change', () => {
      const pid = provinceSelect.value ? Number(provinceSelect.value) : null;
      const municipios = geoIndex.filter(x => x.tipo === 'municipio' && x.padre_id === pid);
      fillSelect(municipioSelect, municipios);
      sectorSelect.innerHTML = `<option value="">Buscar sector ▼</option>`;
      centroSelect.innerHTML = `<option value="">Centro específico ▼</option>`;
      const prov = geoIndex.find(x => x.id === pid);
      if (prov) { map.flyTo([prov.lat, prov.lng], 9, { animate: true, duration: 1.2 }); }
    });
    municipioSelect.addEventListener('change', () => {
      const mid = municipioSelect.value ? Number(municipioSelect.value) : null;
      const sectores = geoIndex.filter(x => x.tipo === 'sector' && x.padre_id === mid);
      fillSelect(sectorSelect, sectores);
      centroSelect.innerHTML = `<option value="">Centro específico ▼</option>`;
      const mun = geoIndex.find(x => x.id === mid);
      if (mun) { map.flyTo([mun.lat, mun.lng], 12, { animate: true, duration: 1.2 }); }
    });
    sectorSelect.addEventListener('change', () => {
      const sid = sectorSelect.value ? Number(sectorSelect.value) : null;
      const centros = geoIndex.filter(x => x.tipo === 'centro' && x.padre_id === sid);
      fillSelect(centroSelect, centros);
      const sec = geoIndex.find(x => x.id === sid);
      if (sec) { map.flyTo([sec.lat, sec.lng], 15, { animate: true, duration: 1.2 }); }
    });
    centroSelect.addEventListener('change', () => {
      const cid = centroSelect.value ? Number(centroSelect.value) : null;
      const cen = geoIndex.find(x => x.id === cid);
      if (cen) { map.flyTo([cen.lat, cen.lng], 15, { animate: true, duration: 1.2 }); }
    });

    const resultsHeader = document.createElement('div');
    resultsHeader.textContent = 'Resultados:';
    resultsHeader.style.marginTop = '6px';
    resultsHeader.style.fontSize = '12px';
    resultsHeader.style.color = '#6b7280';
    container.appendChild(resultsHeader);

    const suggestions = document.createElement('ul');
    suggestions.style.marginTop = '6px';
    suggestions.style.maxHeight = '180px';
    suggestions.style.overflowY = 'auto';
    suggestions.style.borderTop = '1px solid #e5e7eb';
    suggestions.style.listStyle = 'none';
    suggestions.style.padding = '0';
    container.appendChild(suggestions);
  container.style.pointerEvents = 'auto';
  mapElement.appendChild(container);
  // Reposicionar debajo del menú de capas si existe
  try {
    const layersEl = mapElement.querySelector('.leaflet-control-layers');
    const h = layersEl ? (layersEl.getBoundingClientRect().height || 48) : 48;
    container.style.top = (10 + h + 8) + 'px';
  } catch(_) {}
  if (window.L && L.DomEvent && typeof L.DomEvent.disableClickPropagation === 'function') {
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
  }
  ['click','mousedown','touchstart','pointerdown'].forEach(evt => {
    container.addEventListener(evt, (e) => { e.stopPropagation(); });
    input.addEventListener(evt, (e) => { e.stopPropagation(); });
  });

    function normalize(str){
      return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    function rankResults(q){
      const nq = normalize(q);
      const scored = geoIndex
        .map(item => {
          const name = normalize(item.nombre);
          let score = 0;
          if (name === nq) score = 100; // coincidencia exacta
          else if (name.startsWith(nq)) score = 80;
          else if (name.includes(nq)) score = 60;
          // prioridad por tipo
          const typeWeight = item.tipo === 'municipio' ? 20 : item.tipo === 'sector' ? 15 : item.tipo === 'centro' ? 10 : item.tipo === 'provincia' ? 25 : 5;
          score += typeWeight;
          return { item, score };
        })
        .filter(x => x.score > 0)
        .sort((a,b) => b.score - a.score)
        .map(x => x.item);
      return scored;
    }
    function renderSuggestions(list){
      suggestions.innerHTML = '';
      list.slice(0,8).forEach(item => {
        const li = document.createElement('li');
        li.textContent = `${item.nombre} (${item.tipo.charAt(0).toUpperCase() + item.tipo.slice(1)})`;
        li.style.padding = '6px 8px';
        li.style.cursor = 'pointer';
        li.addEventListener('mouseenter', () => {
          const p = { lat: item.lat, lng: item.lng };
          if (rdBounds.contains(p)){
            const z = item.tipo === 'provincia' ? 9 : item.tipo === 'municipio' ? 12 : 15;
            map.setView([p.lat, p.lng], z);
            if (!previewMarker) {
              previewMarker = L.marker([p.lat, p.lng], { icon: previewIcon, opacity: 0.6 }).addTo(map);
            } else {
              previewMarker.setLatLng([p.lat, p.lng]);
            }
          }
        });
        li.addEventListener('click', () => {
          const p = { lat: item.lat, lng: item.lng };
          if (!rdBounds.contains(p)) return;
          const z = item.tipo === 'provincia' ? 9 : item.tipo === 'municipio' ? 12 : 15;
          map.flyTo([p.lat, p.lng], z, { animate: true, duration: 1.2 });
          input.value = item.nombre;
          lastLatLng = { lat: p.lat, lng: p.lng };
          updateMarkerAndAddress(p, item.nombre);
          if (previewMarker) { try { map.removeLayer(previewMarker); } catch(_){} previewMarker = null; }
          suggestions.innerHTML = '';
        });
        suggestions.appendChild(li);
      });
    }
    input.addEventListener('input', () => {
      const mode = (mapStep === 'awaiting_origin') ? 'origin' : 'destination';
      const q = input.value.trim().toLowerCase();
      const filtered = q.length >= 2 ? rankResults(q) : [];
      renderSuggestions(filtered);
      debouncedSearch(input, mode);
    });
    input.addEventListener('keydown', async function(e){
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q || q.length < 3) return;
      try {
        let placed = false;
        const fg = await forwardGeocode(q);
          if (fg) {
            const p = { lat: fg.lat, lng: fg.lng };
            if (!rdBounds.contains(p)) { notifications.error('Resultado fuera de República Dominicana'); }
            else {
              map.setView([p.lat, p.lng], 15);
              lastLatLng = { lat: p.lat, lng: p.lng };
              updateMarkerAndAddress(p, fg.label);
              if (previewMarker) { try { map.removeLayer(previewMarker); } catch(_){} previewMarker = null; }
              placed = true;
            }
          }
        if (!placed) {
          const photonUrl = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&lang=es';
          try {
            const pr = await fetch(photonUrl, { headers: { 'Accept': 'application/json' } });
            if (pr.ok) {
              const pj = await pr.json();
              const f = Array.isArray(pj.features) ? pj.features[0] : null;
              if (f && f.geometry && Array.isArray(f.geometry.coordinates)) {
                const lat = f.geometry.coordinates[1];
                const lon = f.geometry.coordinates[0];
                const label = f.properties && (f.properties.label || f.properties.name || '') || q;
                const p = { lat, lng: lon };
                if (!rdBounds.contains(p)) { notifications.error('Resultado fuera de República Dominicana'); }
                else {
                  map.setView([lat, lon], 15);
                  lastLatLng = { lat, lng: lon };
                  updateMarkerAndAddress(p, label);
                  if (previewMarker) { try { map.removeLayer(previewMarker); } catch(_){} previewMarker = null; }
                  placed = true;
                }
              }
            }
          } catch(_) { }
        }
        if (!placed) {
          const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=do&q=' + encodeURIComponent(q);
          const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
          const results = await r.json();
          if (Array.isArray(results) && results.length > 0) {
            const best = results[0];
            const lat = parseFloat(best.lat);
            const lon = parseFloat(best.lon);
            const p = { lat, lng: lon };
            if (!rdBounds.contains(p)) { notifications.error('Resultado fuera de República Dominicana'); }
            else {
              map.setView([lat, lon], 15);
              lastLatLng = { lat, lng: lon };
              updateMarkerAndAddress(p, best.display_name);
              if (previewMarker) { try { map.removeLayer(previewMarker); } catch(_){} previewMarker = null; }
            }
          }
        }
      } catch(_){ }
    });
    searchAdded = true;
  }

  if (window.GeoSearch) {
    map.on('geosearch/showlocation', (result) => {
      lastLatLng = { lat: result.location.y, lng: result.location.x };
      updateMarkerAndAddress({ lat: result.location.y, lng: result.location.x }, result.location.label);
    });
  }

  // --- Inputs y listeners ---
  pickupInput = document.getElementById('pickupAddress');
  deliveryInput = document.getElementById('deliveryAddress');
  const pickupLabel = document.getElementById('pickup-label');
  const deliveryLabel = document.getElementById('delivery-label');
  const routeInputs = document.getElementById('route-inputs');
  const instructionText = document.getElementById('map-instruction-text');
  mapContainer = document.getElementById('map-container');
  const mapEl = document.getElementById('map');
  const searchInput = document.getElementById('address-search-input');

  // --- INICIO: Mejoras para mapa en móvil ---
  const expandMapBtn = document.getElementById('expand-map-btn');
  function expandMap() {
    if (mapEl) {
      mapEl.style.height = window.innerHeight + 'px';
      setTimeout(() => map.invalidateSize(), 50);
    }
  }
  if (expandMapBtn) { expandMapBtn.addEventListener('click', () => { expandMap(); }); }
  window.addEventListener('resize', () => { setTimeout(() => { if (map && typeof map.invalidateSize === 'function') map.invalidateSize(); }, 50); });
  window.addEventListener('orientationchange', () => { setTimeout(() => { if (map && typeof map.invalidateSize === 'function') map.invalidateSize(); }, 50); });
  if (pickupInput) { pickupInput.addEventListener('focus', () => { expandMap(); }); }
  if (deliveryInput) { deliveryInput.addEventListener('focus', () => { expandMap(); }); }

  // Vincular búsquedas por texto con debounce
  const provider = providerForSearch;
  let debounceTimer;
  const debouncedSearch = async (inputEl, mode) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const q = (inputEl && inputEl.value ? inputEl.value : '').trim();
      if (q.length < 3) return;
      try {
        let latlng = null, label = null;
        if (provider && provider.search) {
          const results = await provider.search({ query: q, countrycodes: 'do' });
          if (results && results.length > 0) {
            latlng = { lat: results[0].y, lng: results[0].x };
            label = results[0].label;
          }
        }
        if (!latlng) {
          const fg = await forwardGeocode(q);
          if (fg) { latlng = { lat: fg.lat, lng: fg.lng }; label = fg.label; }
        }
        if (!latlng) {
          const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=do&q=' + encodeURIComponent(q);
          const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
          const results = await r.json();
          if (Array.isArray(results) && results.length > 0) {
            latlng = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
            label = results[0].display_name;
          }
        }
        if (!latlng) {
          const photonUrl = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&lang=es';
          try {
            const pr = await fetch(photonUrl, { headers: { 'Accept': 'application/json' } });
            if (pr.ok) {
              const pj = await pr.json();
              const f = Array.isArray(pj.features) ? pj.features[0] : null;
              if (f && f.geometry && Array.isArray(f.geometry.coordinates)) {
                latlng = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
                label = f.properties && (f.properties.label || f.properties.name || '') || q;
              }
            }
          } catch(_) { /* noop */ }
        }
        if (latlng) {
          if (rdBounds && !rdBounds.contains(latlng)) { notifications.error('Resultado fuera de República Dominicana'); return; }
          map.setView([latlng.lat, latlng.lng], 16);
          if (!previewMarker) {
            previewMarker = L.marker([latlng.lat, latlng.lng], { icon: previewIcon, opacity: 0.6 }).addTo(map);
          } else {
            previewMarker.setLatLng([latlng.lat, latlng.lng]);
          }
        }
      } catch(_){ }
    }, 350);
  };
  if (pickupInput) pickupInput.addEventListener('input', () => debouncedSearch(pickupInput, 'origin'));
  if (deliveryInput) deliveryInput.addEventListener('input', () => debouncedSearch(deliveryInput, 'destination'));

  // Botón usar ubicación actual
  const useLocBtn = document.getElementById('use-current-location');
  if (useLocBtn) {
    useLocBtn.classList.remove('hidden');
    useLocBtn.addEventListener('click', () => {
      if (navigator.geolocation && mapStep === 'awaiting_origin') {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            updateMarkerAndAddress(latlng);
          },
          () => { /* silencioso */ }
        );
      }
    });
  }

  if (map && typeof map.on === 'function') {
    function handleMapClick(latlng) { updateMarkerAndAddress(latlng); }
    map.on('click', (e) => { handleMapClick(e.latlng); });
  } else {
    const fallbackMapEl = mapEl || document.getElementById('map');
    if (fallbackMapEl) {
      function handleMapClick(latlng) { updateMarkerAndAddress(latlng); }
      fallbackMapEl.addEventListener('click', () => {
        let ll = lastLatLng;
        if (!ll) {
          try { ll = map && typeof map.getCenter === 'function' ? map.getCenter() : null; } catch(_){}
        }
        if (!ll) ll = { lat: 18.4160, lng: -70.1090 };
        handleMapClick(ll);
      });
    }
  }

  

  // Lógica principal para actualizar marcadores
async function updateMarkerAndAddress(latlng, label = null) {
  try { lastLatLng = latlng; } catch(_){ }
  if (previewMarker) { try { map.removeLayer(previewMarker); } catch(_){} previewMarker = null; }
  if (rdBounds && !rdBounds.contains(latlng)) {
    notifications.error('La ubicación seleccionada está fuera de República Dominicana.', { title: 'Ubicación Inválida' });
    return;
  }

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
      isOriginSet = true;
      mapStep = 'awaiting_destination';
      if (deliveryInput) { deliveryInput.disabled = false; deliveryInput.placeholder = 'Escribe o selecciona en el mapa'; }
      const originCard = document.getElementById('origin-card');
      const originDisp = document.getElementById('origin-address-display');
      if (originCard) originCard.classList.remove('hidden');
      if (originDisp) originDisp.textContent = label || currentInput.value || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
      const instr = document.getElementById('map-instruction-text');
    if (instr) instr.textContent = 'Ahora, define tu punto de entrega.';
    if (originCard && !document.getElementById('origin-edit-btn')) {
      const btn = document.createElement('button');
      btn.id = 'origin-edit-btn';
      btn.type = 'button';
      btn.className = 'ml-2 text-xs text-azulClaro underline';
      btn.textContent = 'Editar origen';
      btn.addEventListener('click', () => { resetOriginOnly(); });
      originCard.appendChild(btn);
    }
    if (destinationMarker) {
      mapStep = 'complete';
      calculateAndDisplayDistance();
      fitMapToBounds();
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
      mapStep = 'complete';
      const destCard = document.getElementById('destination-card');
      const destDisp = document.getElementById('destination-address-display');
      if (destCard) destCard.classList.remove('hidden');
      if (destDisp) destDisp.textContent = label || currentInput.value || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
      calculateAndDisplayDistance();
      fitMapToBounds();
      const instr = document.getElementById('map-instruction-text');
    if (instr) instr.textContent = 'Origen y destino definidos. Puedes continuar.';
    if (destCard && !document.getElementById('destination-edit-btn')) {
      const btn = document.createElement('button');
      btn.id = 'destination-edit-btn';
      btn.type = 'button';
      btn.className = 'ml-2 text-xs text-azulClaro underline';
      btn.textContent = 'Editar destino';
      btn.addEventListener('click', () => { resetDestinationOnly(); });
      destCard.appendChild(btn);
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
      if (deliveryInput) {
        deliveryInput.disabled = false;
        deliveryInput.placeholder = "Escribe o selecciona en el mapa";
        if (typeof deliveryInput.focus === 'function') {
          deliveryInput.focus();
        }
      }
      if (instructionText) {
        instructionText.innerHTML = "¡Perfecto! Ahora, establece el <strong>punto de destino</strong>.";
        // Cambiar el placeholder del buscador para el destino
        const searchInputEl = document.getElementById('address-search-input');
        if (searchInputEl) {
          searchInputEl.placeholder = "Buscar dirección de destino...";
        }
      }
      // Mostrar hoja inferior para confirmar origen y continuar a destino (móvil)
      setBottomSheetForOrigin(currentInput.value);
    }

    calculateAndDisplayDistance();
    fitMapToBounds();

  if (originMarker && destinationMarker) {
      if (routeInputs) routeInputs.classList.remove('hidden');
      if (pickupLabel) pickupLabel.classList.remove('hidden');
      if (deliveryLabel) deliveryLabel.classList.remove('hidden');
      if (pickupInput) pickupInput.classList.remove('hidden');
      if (deliveryInput) deliveryInput.classList.remove('hidden');
      loadPOIsForBounds();
      if (!map._poiMoveHandlerAttached) {
        map.on('moveend', () => { loadPOIsForBounds(); });
        map._poiMoveHandlerAttached = true;
      }
    }
  }
  

function calculateAndDisplayDistance() {
  const distanceContainer = document.getElementById('distance-container');
  const distanceValueEl = document.getElementById('distance-value');

  if (originMarker && destinationMarker && map && typeof map.distance === 'function') {
    const distanceInMeters = map.distance(originMarker.getLatLng(), destinationMarker.getLatLng());
    const distanceInKm = (distanceInMeters / 1000).toFixed(2);
    distanceValueEl.textContent = distanceInKm;
    distanceContainer.classList.remove('hidden');
  } else {
    distanceContainer.classList.add('hidden');
  }
}

function fitMapToBounds() {
  const pts = [];
  if (originMarker) pts.push(originMarker.getLatLng());
  if (destinationMarker) pts.push(destinationMarker.getLatLng());
  if (pts.length === 1) { map.setView(pts[0], Math.max(map.getZoom() || 14, 15)); return; }
  if (pts.length === 2) {
    const b = L.latLngBounds(pts[0], pts[1]);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
  }
}
let poiLayer = null;
let lastPoiFetchAt = 0;
let poiFetchInFlight = false;
function loadPOIsForBounds() {
  const now = Date.now();
  if (poiFetchInFlight) return;
  if (now - lastPoiFetchAt < 25000) return;
  lastPoiFetchAt = now;
  poiFetchInFlight = true;
  if (!map || typeof map.getBounds !== 'function') { poiFetchInFlight = false; return; }
  const b = map.getBounds();
  const s = Number(b.getSouth());
  const w = Number(b.getWest());
  const n = Number(b.getNorth());
  const e = Number(b.getEast());
  const areValid = [s,w,n,e].every(v => Number.isFinite(v));
  if (!areValid) { poiFetchInFlight = false; return; }
  const query = `[
    out:json][timeout:25];(
    node["amenity"~"school|hospital|clinic|university|police|fire_station"](${s},${w},${n},${e});
    node["shop"~"mall|supermarket"](${s},${w},${n},${e});
    node["leisure"~"park"](${s},${w},${n},${e});
  );out center;`;
  const payload = String(query || '').trim();
  if (!payload) { poiFetchInFlight = false; return; }
  fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: payload
  }).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }).then(json => {
    if (!poiLayer) { poiLayer = L.layerGroup().addTo(map); } else { poiLayer.clearLayers(); }
    const iconFor = (tags) => {
      if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return L.divIcon({ html: '<i class="fa-solid fa-hospital text-red-600"></i>', className: 'poi-icon' });
      if (tags.amenity === 'school' || tags.amenity === 'university') return L.divIcon({ html: '<i class="fa-solid fa-school text-blue-600"></i>', className: 'poi-icon' });
      if (tags.shop === 'mall') return L.divIcon({ html: '<i class="fa-solid fa-bag-shopping text-pink-600"></i>', className: 'poi-icon' });
      if (tags.shop === 'supermarket') return L.divIcon({ html: '<i class="fa-solid fa-store text-green-600"></i>', className: 'poi-icon' });
      if (tags.leisure === 'park') return L.divIcon({ html: '<i class="fa-solid fa-tree text-green-700"></i>', className: 'poi-icon' });
      if (tags.amenity === 'police') return L.divIcon({ html: '<i class="fa-solid fa-shield-halved text-gray-700"></i>', className: 'poi-icon' });
      if (tags.amenity === 'fire_station') return L.divIcon({ html: '<i class="fa-solid fa-fire-extinguisher text-orange-600"></i>', className: 'poi-icon' });
      return L.divIcon({ html: '<i class="fa-solid fa-location-dot text-azulClaro"></i>', className: 'poi-icon' });
    };
    json.elements.forEach(el => {
      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      if (!lat || !lon) return;
      const tags = el.tags || {};
      const name = tags.name || 'Sin nombre';
      const marker = L.marker([lat, lon], { icon: iconFor(tags) }).bindTooltip(name, { permanent: false });
      poiLayer.addLayer(marker);
    });
  }).catch((err) => {
    console.warn('POI fetch failed (non-critical):', err);
  }).finally(() => { poiFetchInFlight = false; });
}

// --- Lógica de Notificaciones Push ---

/**
 * Pide permiso al usuario para notificaciones y guarda la suscripción en la orden.
 * @param {string} orderId - El ID de la orden recién creada.
 */
async function askForNotificationPermission(savedOrder) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.log('Este navegador no soporta notificaciones push.');
    return;
  }
  showPushOptInCard(savedOrder);
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

async function subscribeUserToPush(savedOrder) {
  try {
    const registration = await navigator.serviceWorker.ready;
    console.log("Service Worker listo para suscripción");
    
    // Obtener la clave VAPID válida desde el servidor
    let vapidKey = null;
    try {
      const { data, error } = await supabaseConfig.client.functions.invoke('getVapidKey');
      if (error) {
        console.warn('No se pudo obtener VAPID por función:', error.message);
      }
      vapidKey = data?.key || null;
    } catch (e) {
      console.warn('Fallo al invocar getVapidKey:', e?.message || String(e));
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

    let subscription = null;
    let existing = null;
    try {
      existing = await registration.pushManager.getSubscription();
      if (existing) {
        subscription = existing;
        console.log('[Push] Suscripción existente reutilizada:', subscription);
      } else {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      }
    } catch (subErr) {
      if (String(subErr?.message || '').includes('applicationServerKey') || String(subErr?.name || '') === 'InvalidStateError') {
        try {
          existing = await registration.pushManager.getSubscription();
          if (existing) await existing.unsubscribe();
        } catch (_) {}
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      } else {
        throw subErr;
      }
    }
    
    // Guardar suscripción en Supabase
    // Preferir tabla push_subscriptions por usuario; si no hay usuario, guardar para contacto anónimo
    try {
      let userId = null;
      if (supabaseConfig && supabaseConfig.client && supabaseConfig.client.auth && typeof supabaseConfig.client.auth.getSession === 'function') {
        const { data: sessionData } = await supabaseConfig.client.auth.getSession();
        userId = sessionData?.session?.user?.id || null;
      }

      if (userId) {
        // Inserta o actualiza en push_subscriptions usando formato de keys JSON { p256dh, auth }
        const payload = {
          user_id: userId,
          endpoint: String(subscription?.endpoint || '').trim().replace(/`/g, ''),
          keys: {
            p256dh: String((subscription?.keys?.p256dh || (subscription?.toJSON?.().keys?.p256dh) || '')).trim(),
            auth: String((subscription?.keys?.auth || (subscription?.toJSON?.().keys?.auth) || '')).trim()
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
      } else if (savedOrder && savedOrder.client_contact_id) {
        const payloadAnon = {
          client_contact_id: savedOrder.client_contact_id,
          endpoint: String(subscription?.endpoint || '').trim().replace(/`/g, ''),
          keys: {
            p256dh: String((subscription?.keys?.p256dh || (subscription?.toJSON?.().keys?.p256dh) || '')).trim(),
            auth: String((subscription?.keys?.auth || (subscription?.toJSON?.().keys?.auth) || '')).trim()
          }
        };
        const { error: upsertAnonErr } = await supabaseConfig.client
          .from('push_subscriptions')
          .upsert(payloadAnon, { onConflict: 'client_contact_id,endpoint' });
        if (upsertAnonErr) {
          console.warn('Fallo upsert en push_subscriptions (anon), probando insert:', upsertAnonErr?.message || upsertAnonErr);
          await supabaseConfig.client.from('push_subscriptions').insert(payloadAnon);
        }
        try { localStorage.setItem('tlc_client_contact_id', String(savedOrder.client_contact_id)); } catch(_){ }
        console.log('Suscripción guardada en push_subscriptions para contacto:', savedOrder.client_contact_id);
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
function showPushOptInCard(savedOrder) {
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
        const subscription = await subscribeUserToPush(savedOrder);
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
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => {
        showSuccess('ID copiado al portapapeles');
      }).catch(() => {
        showError('No se pudo copiar el ID');
      });
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-1000px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      showSuccess('ID copiado al portapapeles');
    } else {
      showError('No se pudo copiar el ID');
    }
  } catch {
    showError('No se pudo copiar el ID');
  }
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  
  // Inicializar elementos del DOM
  steps = document.querySelectorAll('.step');
  nextBtn = document.getElementById('nextBtn');
  prevBtn = document.getElementById('prevBtn');
  progressBar = document.getElementById('progress-bar');
  helpText = document.getElementById('help-text');
  // Evitar doble envío del formulario
  let isSubmittingOrder = false;
  let hasSubmittedOrder = false;
  
  // Cargar datos dinámicos
  loadServices();
  loadVehicles();

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
  // Restringir calendario a fechas futuras o de hoy
  const dateInput = document.querySelector('input[type="date"]');
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.min = `${yyyy}-${mm}-${dd}`;
    if (dateInput.value && dateInput.value < dateInput.min) {
      dateInput.value = dateInput.min;
    }
  }

  // Añadir validación en tiempo real para el paso 1
  const nombreInput = document.querySelector('input[placeholder="Nombre completo"]');
  const telefonoInput = document.querySelector('input[placeholder="Teléfono"]');
  const emailInput = document.querySelector('input[placeholder="Correo electrónico"]');

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
      const overlay = this.closest('.fixed');
      if (overlay) overlay.classList.add('hidden');
      document.documentElement.classList.remove('overflow-hidden');
      document.body.classList.remove('overflow-hidden');
    });
  });

  // Manejar envío de formularios de modales
  document.querySelectorAll('[id^="form-"]').forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Guardar respuestas del servicio
      const formEl = e.currentTarget && e.currentTarget.nodeName === 'FORM'
        ? e.currentTarget
        : (e.target && typeof e.target.closest === 'function' ? e.target.closest('form') : null);

      if (!formEl || formEl.nodeName !== 'FORM') {
        console.warn('Submit listener invocado sin un formulario válido');
        return;
      }

      const formData = new FormData(formEl);
      serviceQuestions = {}; // Reiniciar por si el usuario cambia de opinión
      
      for (let [key, value] of formData.entries()) {
        serviceQuestions[key] = value;
      }

      // Manejo especial para Mudanza: agregar resumen de cantidades
      if (this.id === 'form-mudanza') {
        const labelMap = {
          item_camas_qty: 'Camas',
          item_sofas_qty: 'Sofás',
          item_mesas_qty: 'Mesas',
          item_sillas_qty: 'Sillas',
          item_cajas_qty: 'Cajas',
          item_neveras_qty: 'Neveras',
          item_lavadoras_qty: 'Lavadoras',
          item_estufas_qty: 'Estufas',
          item_tv_qty: 'TV',
          item_escritorios_qty: 'Escritorios',
          item_armarios_qty: 'Armarios/Roperos'
        };
        const itemsSummary = Object.entries(serviceQuestions)
          .filter(([k, v]) => /^item_.+_qty$/.test(k) && Number(v) > 0)
          .map(([k, v]) => `${labelMap[k] || k}: ${v}`)
          .join(', ');
        if (itemsSummary) {
          serviceQuestions.mudanza_items_summary = itemsSummary;
        }
      }
      
      modalFilled = true; // Marcar que el modal fue completado
      showSuccess('Información del servicio guardada.'); // Notificación opcional

      // Solo cerrar el modal, no avanzar de paso
      const overlay = formEl.closest('.fixed');
      if (overlay) overlay.classList.add('hidden');
      document.documentElement.classList.remove('overflow-hidden');
      document.body.classList.remove('overflow-hidden');
    });
  });

  // Lógica para el modal de mudanza (mostrar/ocultar descripción de frágiles)
  const tieneFragilesSelect = document.getElementById('tiene_fragiles');
  const descripcionFragilesContainer = document.getElementById('descripcion_fragiles_container');
  
  if (tieneFragilesSelect && descripcionFragilesContainer) {
    tieneFragilesSelect.addEventListener('change', function() {
      if (this.value === 'si') {
        descripcionFragilesContainer.classList.remove('hidden');
      } else {
        descripcionFragilesContainer.classList.add('hidden');
      }
    });
  }

  // Lógica para los botones de cantidad +/- en el modal de mudanza
  document.querySelectorAll('#form-mudanza .qty-btn').forEach(button => {
    button.addEventListener('click', function() {
      const input = this.parentElement.querySelector('input[type="number"]');
      let currentValue = parseInt(input.value, 10);
      if (this.textContent === '+') {
        currentValue++;
      } else {
        currentValue = Math.max(0, currentValue - 1); // No permitir valores negativos
      }
      input.value = currentValue;
      // Disparar un evento de 'input' para que cualquier otro listener reaccione si es necesario
      input.dispatchEvent(new Event('input', { bubbles: true }));
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

      if (hasSubmittedOrder) {
        notifications.info('La solicitud ya fue enviada.', { title: 'Ya enviado' });
        return;
      }

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
          name: (document.getElementById('clientName') || { value: '' }).value,
          phone: (document.getElementById('clientPhone') || { value: '' }).value,
          email: (document.getElementById('clientEmail') || { value: '' }).value,
          rnc: document.querySelector('input[name="rnc"]')?.value || null,
          empresa: document.querySelector('input[name="empresa"]')?.value || null,
          // Detalles del servicio (Pasos 2 y 3)
          service_id: selectedService ? parseInt(selectedService.id, 10) : null,
          vehicle_id: selectedVehicleCard ? parseInt(selectedVehicleCard.dataset.vehicleId, 10) : null,
          service_questions: serviceQuestions,
          // Detalles de la ruta (Paso 4)
          pickup: (document.getElementById('pickupAddress') || { value: '' }).value,
          delivery: (document.getElementById('deliveryAddress') || { value: '' }).value,
          origin_coords: originCoords ? { lat: originCoords.lat, lng: originCoords.lng } : null,
          destination_coords: destinationCoords ? { lat: destinationCoords.lat, lng: destinationCoords.lng } : null,
          // Fecha y Hora (Paso 5)
          "date": (document.getElementById('orderDate') || { value: '' }).value,
          "time": (document.getElementById('orderTime') || { value: '' }).value,
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
          tracking_data: orderData.tracking_data
        };

        

        // Obtener suscripción push para notificaciones (una vez, reutilizar)
        const pushSubscription = await getPushSubscription();
        if (pushSubscription) {
          console.log('Suscripción push obtenida');
        }

        let userId = null;
        if (supabaseConfig && supabaseConfig.client && supabaseConfig.client.auth && typeof supabaseConfig.client.auth.getSession === 'function') {
          const { data: sessionData } = await supabaseConfig.client.auth.getSession();
          userId = sessionData?.session?.user?.id || null;
        }
        baseOrder.client_id = userId || null;

        // Fallback de suscripción se guarda post-creación en orders.push_subscription

        const origin_coords2 = orderData.origin_coords;
        const destination_coords2 = orderData.destination_coords;

        if (!orderData.service_id || !orderData.vehicle_id) {
          notifications.error('Selecciona un servicio y un vehículo.', { title: 'Datos incompletos' });
          return;
        }
        if (!origin_coords2 || !destination_coords2) {
          notifications.error('Debes seleccionar origen y destino en el mapa.', { title: 'Ruta incompleta' });
          return;
        }

        const variantA = Object.assign({}, baseOrder, {
          service_id: orderData.service_id,
          vehicle_id: orderData.vehicle_id,
          origin_coords: origin_coords2,
          destination_coords: destination_coords2
        });

        

        let savedOrder;
        try {
          const { data: rpcData, error: rpcError } = await supabaseConfig.client
            .rpc('create_order_with_contact', { order_payload: variantA });
          if (rpcError) {
            throw rpcError;
          }
          savedOrder = Array.isArray(rpcData) ? rpcData[0] : rpcData;
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

        hasSubmittedOrder = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('bg-gray-300','cursor-not-allowed');
          submitBtn.classList.remove('bg-azulClaro','hover:bg-azulOscuro');
          submitBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 inline mr-2"></i> Solicitud enviada';
          if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        }

        // Mostrar tarjeta de opt-in para notificaciones push (si tenemos id)
        if (savedOrder) {
          // [CORRECCIÓN] Se elimina el bloque que intentaba guardar la suscripción desde el cliente.
          // La función RPC `create_order_with_contact` ya se encarga de esto de forma segura en el backend.
          // Esto resuelve el error 401 Unauthorized.
          askForNotificationPermission(savedOrder);
    // Eliminado: no invocar process-outbox desde el cliente
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
        // Restaurar estado del botón y guardia solo si no se envió
        if (submitBtn && !hasSubmittedOrder) {
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
