// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};
let modalFilledByService = {}; // Mapa: servicio.id -> modal completado
const DRAFT_KEY = 'tlc_draft_order';

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
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entityMap[s];
  });
}

function normalizeError(err) {
  return {
    message: err?.message || 'Error desconocido',
    code: err?.code || null,
    hint: err?.hint || null,
    details: err?.details || null
  };
}

function getSafeCoords(point) {
  return point?.latlng ? { lat: point.latlng.lat, lng: point.latlng.lng } : null;
}

/**
 * Solicita permiso para mostrar notificaciones push.
 * Se llama cuando el usuario intenta enviar la solicitud final.
 */
async function requestNotificationPermission() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported by this browser.');
      return 'unsupported';
    }
    
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    
    if (Notification.permission === 'denied') {
      notify('info', 'Las notificaciones están bloqueadas. Puedes activarlas en la configuración de tu navegador.', { title: 'Notificaciones Bloqueadas' });
      return 'denied';
    }
    
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      notify('success', '¡Gracias! Recibirás actualizaciones sobre tu solicitud.', { title: 'Permiso Concedido' });
    }
    return permission;
  } catch (error) {
    return 'error';
  }
}

async function getPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }

    // No solicitar permiso automáticamente; solo continuar si ya está concedido
    const permission = Notification.permission;
    if (permission !== 'granted') {
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
      if (error) { /* silencio: no mostrar al usuario */ }
      vapidKey = data?.key || null;
    } catch (e) {
      // silencio: no mostrar al usuario
    }
    if (!vapidKey || typeof vapidKey !== 'string') {
      return null;
    }
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);

    if (window.__push_subscribing) return null;
    window.__push_subscribing = true;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      window.__push_subscribing = false;
      const json = typeof existing.toJSON === 'function' ? existing.toJSON() : existing;
      return json;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    window.__push_subscribing = false;
    // Suscripción obtenida
    return typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
  } catch (error) {
    // silencio: no mostrar al usuario
    return null;
  }
}

// --- Push Flow Centralizado ---
const PushFlow = {
  async resolve(options = {}) {
    const { timeout = 8000 } = options;
    let permissionPromise = null;
    let pushSubscription = null;

    try {
      // 1. Request Permission
      permissionPromise = requestNotificationPermission();
      const perm = await Promise.race([
        permissionPromise,
        new Promise(r => setTimeout(() => r('timeout'), timeout))
      ]);

      if (perm === 'granted') {
        notify('info', 'Activando notificaciones...', { title: 'Permiso Concedido' });
        
        // 2. Get Subscription
        let pushPromise = (window.pushManager && typeof window.pushManager.subscribe === 'function')
          ? window.pushManager.subscribe()
          : getPushSubscription();

        pushSubscription = await Promise.race([
          pushPromise,
          new Promise(r => setTimeout(() => r(null), timeout))
        ]);
      }
    } catch (e) {
      console.warn('PushFlow error:', e);
    }
    return { permissionPromise, pushSubscription };
  }
};

// Variables para el mapa
let map;
// Usar MapState.preview como marcador de preview
let pickupInput;
let deliveryInput;
// Estado único y fuente de verdad para el mapa
const MapState = {
  mode: 'origin', // 'origin' | 'destination' | 'complete'
  origin: null,   // { marker, latlng, label }
  destination: null, // { marker, latlng, label }
  preview: null   // Leaflet marker (preview)
};
let rdBounds = null;
let originIcon = null;
let destinationIcon = null;
let previewIcon = null;
let mapInitialized = false; // ✅ NUEVO: Control para evitar inicializaciones múltiples del mapa.

// Utilidad: debounce simple para limitar frecuencia de ejecución
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Geocodificación inversa segura (Supabase Edge Function) con fallback
async function reverseGeocode(latlng) {
  try {
    if (supabaseConfig && supabaseConfig.client && supabaseConfig.client.functions) {
      const { data, error } = await supabaseConfig.client.functions.invoke('reverse-geocode', {
        body: { lat: latlng.lat, lon: latlng.lng }
      });
      if (error) throw error;
      return data.display_name || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    }
  } catch (_) {}
  return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function updateStepUI() {
  try {
    const instr = document.getElementById('map-instruction-text');
    if (instr) {
        if (MapState.mode === 'origin') instr.textContent = 'Primero, define tu punto de recogida.';
        else if (MapState.mode === 'destination') instr.textContent = 'Ahora, define tu punto de entrega.';
        else instr.textContent = 'Origen y destino definidos. Puedes continuar.';
    }
    
    if (pickupInput) pickupInput.disabled = false;
    if (deliveryInput) deliveryInput.disabled = MapState.mode === 'origin';
    
    const originCard = document.getElementById('origin-card');
    const destCard = document.getElementById('destination-card');
    const originDisp = document.getElementById('origin-address-display');
    const destDisp = document.getElementById('destination-address-display');
    
    if (originCard && originDisp) {
        if (MapState.origin) {
            originCard.classList.remove('hidden');
            originDisp.textContent = MapState.origin.label;
        } else {
            originCard.classList.add('hidden');
        }
    }
    
    if (destCard && destDisp) {
        if (MapState.destination) {
            destCard.classList.remove('hidden');
            destDisp.textContent = MapState.destination.label;
        } else {
            destCard.classList.add('hidden');
        }
    }
    
    const distanceContainer = document.getElementById('distance-container');
    if (distanceContainer) distanceContainer.classList.add('hidden'); // Calculo de distancia eliminado según reglas
  } catch(_) {}
}

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
  if (step === 4) { // Asumiendo que el paso 4 es el del mapa
    if (formSection) { formSection.classList.add('z-50'); }
  } else {
    if (formSection) { formSection.classList.remove('z-50'); }
  }

  // Si es el último paso, mostrar el resumen
  if (isLastStep) {
    displayOrderSummary();
  }

  // ✅ SOLUCIÓN MEJORADA: Inicializar el mapa solo cuando el paso 4 es visible por primera vez.
  if (step === 4 && !MapState.origin && !MapState.destination) {
    if (MapState.preview) { try { map.removeLayer(MapState.preview); } catch(_){} MapState.preview = null; }
    MapState.mode = 'origin';
    updateStepUI();
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

// Funciones de reset eliminadas según reglas


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
      // Reiniciar estado de selección y validación de modal por servicio
      const newId = this.dataset.serviceId;
      if (selectedService?.id !== newId) {
        serviceQuestions = {}; // Limpiar preguntas al cambiar servicio
        modalFilledByService[newId] = false;
      }
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
      notify('warning', 'Por favor, revisa los campos marcados en rojo.', { title: 'Datos Personales Incompletos' });
      return false;
    }
  }
  
  if (currentStep === 2 && (!selectedService || !selectedService.name)) {
    notify('warning', 'Debes seleccionar un servicio para continuar.', { title: 'Paso Incompleto' });
    return false;
  }

  // Validar que el modal del servicio actual fue llenado
  if (currentStep === 2 && selectedService?.id) {
    const filled = !!modalFilledByService[selectedService.id];
    if (!filled) {
      notify('warning', 'Completa y guarda la información adicional del servicio antes de continuar.', { title: 'Información Requerida' });
      return false;
    }
  }
  
  if (currentStep === 3) {
    const selectedVehicle = document.querySelector('.vehicle-item.selected');
    if (!selectedVehicle) {
      notify('warning', 'Debes seleccionar un vehículo para continuar.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 4) {
    const pickupEl = document.getElementById('pickupAddress');
    const deliveryEl = document.getElementById('deliveryAddress');
    const origen = pickupEl && pickupEl.value ? String(pickupEl.value).trim() : '';
    const destino = deliveryEl && deliveryEl.value ? String(deliveryEl.value).trim() : '';

    if (!origen || !destino) {
      notify('warning', 'Debes establecer una dirección de origen y una de destino en el mapa.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 5) {
    const fechaEl = document.getElementById('orderDate');
    const horaEl = document.getElementById('orderTime');
    const fecha = fechaEl ? fechaEl.value : '';
    const hora = horaEl ? horaEl.value : '';
    
    if (!fecha || !hora) {
      notify('warning', 'Debes seleccionar una fecha y hora para el servicio.', { title: 'Paso Incompleto' });
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
  const distEl = document.getElementById('distance-value');
  const distance = distEl ? distEl.textContent : '--';
  const originCoords = getSafeCoords(MapState.origin);
  const destinationCoords = getSafeCoords(MapState.destination);

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
        <input id="mbsOriginInput" type="text" class="w-full border rounded p-2" value="${address ? escapeHtml(address) : ''}" />
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
        // Pasar al estado de destino explícitamente y habilitar el input
        MapState.mode = 'destination';
        const deliveryInputLocal = document.getElementById('deliveryAddress');
        if (deliveryInputLocal) deliveryInputLocal.disabled = false;
        updateStepUI();
        hideBottomSheet();
      };
    }
  }
  showBottomSheet();
}

async function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  const loader = document.getElementById('map-loader');
  if (loader) loader.style.display = 'flex';

  rdBounds = L.latLngBounds(L.latLng(17.47004, -72.00742), L.latLng(19.93298, -68.32254));
  const sanCristobalCenter = [18.4160, -70.1090];

  // Configuración Leaflet recomendada (Regla 7)
  map = L.map(mapElement, {
    maxBounds: rdBounds,
    maxBoundsViscosity: 1.0,
    scrollWheelZoom: false, // Evita zoom accidental
    tap: true
  }).setView(sanCristobalCenter, 12);

  map.on('click', () => { map.scrollWheelZoom.enable(); });

  // Layers
  const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap & CARTO', subdomains: 'abcd', maxZoom: 19 });
  const stadiaOutdoors = L.tileLayer('https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png', { attribution: 'Map tiles by Stadia Maps', maxZoom: 20 });
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 });
  
  let baseLoaded = false;
  const baseLayer = stadiaOutdoors.addTo(map);
  if (baseLayer && typeof baseLayer.on === 'function') {
      baseLayer.on('load', () => { if(loader) loader.style.display = 'none'; mapElement.style.background = ''; baseLoaded = true; });
      baseLayer.on('tileerror', () => {
          if (!baseLoaded) {
              cartoVoyager.addTo(map).on('load', () => { if(loader) loader.style.display = 'none'; });
          }
      });
  } else { if(loader) loader.style.display = 'none'; }

  if (L.control && typeof L.control.layers === 'function') {
      L.control.layers({ 'Stadia Outdoors': stadiaOutdoors, 'CARTO Voyager': cartoVoyager, 'OSM Standard': osmStandard }).addTo(map);
  }

  // Helpers de búsqueda
  async function forwardGeocode(q){
    try{
      const { data, error } = await supabaseConfig.client.functions.invoke('forward-geocode', { body: { q, countrycodes: 'do', lang: 'es', addressdetails: 1, limit: 1 } });
      if (error) return null;
      const res = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      if (Array.isArray(res) && res.length > 0){
        const r = res[0];
        return { lat: parseFloat(r.lat ?? r.y), lng: parseFloat(r.lon ?? r.x), label: r.display_name ?? r.label ?? r.name ?? q };
      }
      return null;
    } catch(_) { return null; }
  }

async function searchPlace(query) {
  const q = String(query || '').trim();
  if (!q || q.length < 3) return null;
  
  // 1. Intentar geocodificación principal
  let res = await forwardGeocode(q);
  if (res) return res;

  // 2. Fallback a Photon (OpenStreetMap) con soporte mejorado para calles/barrios
  try {
    const qSan = q.replace(/[^\p{L}\s0-9,-]/gu, '').trim();
    if (!qSan || qSan.length < 3) return null;
    
    // Añadir contexto de país si no está presente para mejorar precisión
    const qContext = qSan.toLowerCase().includes('dominicana') ? qSan : `${qSan}, República Dominicana`;
    
    const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(qContext) + '&lang=es&limit=1';
    const r = await fetch(url);
    if (r.ok) {
      const j = await r.json();
      const f = j.features?.[0];
      if (f) {
        // Construir etiqueta más descriptiva
        const props = f.properties;
        const label = [props.name, props.street, props.city, props.state].filter(Boolean).join(', ') || q;
        return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label };
      }
    }
  } catch(_){ }
  return null;
}

  const inputLastResult = new WeakMap();
  // MEJORA: Autocompletado silencioso con debounce optimizado
  const previewSearch = debounce(async (inputEl) => {
    const q = (inputEl && inputEl.value ? inputEl.value : '').trim();
    if (q.length < 4) return; // Evitar búsquedas muy cortas

    const res = await searchPlace(q);
    if (!res) return;
    const latlng = L.latLng(res.lat, res.lng);
    
    // MEJORA: Eliminadas notificaciones rojas (silencioso)
    if (rdBounds && !rdBounds.contains(latlng)) { 
      console.debug('Resultado fuera de RD ignorado:', latlng);
      return; 
    }
    
    inputLastResult.set(inputEl, res);
    
    // MEJORA: UX fluida con animación
    map.flyTo(latlng, 16, { animate: true, duration: 1.2 });
    
    if (!MapState.preview) {
      MapState.preview = L.marker(latlng, { icon: previewIcon, opacity: 0.7, interactive: true }).addTo(map);
      // MEJORA: Selección automática al hacer click en el preview
      MapState.preview.on('click', () => confirmPoint(latlng, res.label));
    } else {
      MapState.preview.setLatLng(latlng);
      MapState.preview.setOpacity(0.7);
      MapState.preview.off('click');
      MapState.preview.on('click', () => confirmPoint(latlng, res.label));
    }
  }, 500);

  async function confirmSearch(inputEl) {
    const q = (inputEl && inputEl.value ? inputEl.value : '').trim();
    if (!q || q.length < 3) return;
    let res = inputLastResult.get(inputEl);
    if (!res) res = await searchPlace(q);
    if (res) confirmPoint(L.latLng(res.lat, res.lng), q || res.label);
  }

  // Iconos
  originIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
  destinationIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
  previewIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });

  // Inputs y Listeners
  pickupInput = document.getElementById('pickupAddress');
  deliveryInput = document.getElementById('deliveryAddress');
  
  if (pickupInput) {
    pickupInput.addEventListener('input', () => previewSearch(pickupInput));
    pickupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmSearch(pickupInput); } });
  }
  if (deliveryInput) {
    deliveryInput.addEventListener('input', () => previewSearch(deliveryInput));
    deliveryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmSearch(deliveryInput); } });
  }

  // Botón Expandir Mapa
  const expandMapBtn = document.getElementById('expand-map-btn');
  if (expandMapBtn) {
      expandMapBtn.addEventListener('click', () => {
          const layout = document.querySelector('.map-layout');
          if (layout) {
              layout.classList.toggle('map-full');
              document.body.classList.toggle('no-scroll');
              setTimeout(() => map.invalidateSize(), 300);
          }
      });
  }

  // Ubicación Actual
  const useLocBtn = document.getElementById('use-current-location');
  if (useLocBtn) {
      useLocBtn.classList.remove('hidden');
      useLocBtn.addEventListener('click', () => {
          if (navigator.geolocation && MapState.mode === 'origin') {
              navigator.geolocation.getCurrentPosition(
                  (pos) => confirmPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => notify('error', 'No se pudo obtener tu ubicación')
              );
          }
      });
  }

  // Evento Click en Mapa
  map.on('click', (e) => {
      confirmPoint(e.latlng);
  });
}

// --- Función CENTRAL del mapa (OBLIGATORIA) ---
async function confirmPoint(latlng, label = null) {
    if (!map) return;

    // 1. Validar límites de República Dominicana
    if (rdBounds && !rdBounds.contains(latlng)) {
      notify('error', 'La ubicación está fuera de República Dominicana.');
      return;
    }

    // 2. Limpiar preview si existe
    if (MapState.preview) {
      try { map.removeLayer(MapState.preview); } catch (_) {}
      MapState.preview = null;
    }

    // 3. Reverse geocoding si no hay label
    if (!label) {
      label = await reverseGeocode(latlng);
    }

    // 4. Lógica de estado (Origin -> Destination -> Complete)
    if (MapState.mode === 'complete') {
      // Reiniciar automáticamente si ya estaba completo
      resetMapState();
      MapState.mode = 'origin';
      setPoint('origin', latlng, label);
      MapState.mode = 'destination';
    } else if (MapState.mode === 'origin') {
      setPoint('origin', latlng, label);
      MapState.mode = 'destination';
    } else if (MapState.mode === 'destination') {
      setPoint('destination', latlng, label);
      MapState.mode = 'complete';
    }

    // 5. Actualizar UI
    updateStepUI();
  }

  // Reiniciar estado del mapa
  function resetMapState() {
    if (MapState.origin?.marker) map.removeLayer(MapState.origin.marker);
    if (MapState.destination?.marker) map.removeLayer(MapState.destination.marker);
    if (MapState.preview) map.removeLayer(MapState.preview);
    MapState.origin = null;
    MapState.destination = null;
    MapState.preview = null;
    MapState.mode = 'origin';
    if (pickupInput) pickupInput.value = '';
    if (deliveryInput) deliveryInput.value = '';
    updateStepUI();
  }

  if (map && typeof map.on === 'function') {
    // 3️⃣ Lo ÚNICO que debe pasar cuando el usuario hace click
    map.on('click', (e) => {
      confirmPoint(e.latlng);
    });
  }

function enableDrag(marker, type) {
  marker.on('dragend', debounce(async (e) => {
    const ll = e.target.getLatLng();
    const label = await reverseGeocode(ll);
    setPoint(type, ll, label);
  }, 600));
}

function setPoint(type, latlng, label = '') {
  if (MapState.preview) { try { map.removeLayer(MapState.preview); } catch(_){} MapState.preview = null; }
  const icon = type === 'origin' ? originIcon : destinationIcon;
  const inputEl = type === 'origin' ? pickupInput : deliveryInput;
  const cardId = type === 'origin' ? 'origin-card' : 'destination-card';
  const dispId = type === 'origin' ? 'origin-address-display' : 'destination-address-display';
  const coordsId = type === 'origin' ? 'origin-coords-display' : 'destination-coords-display';
  const editBtnId = type === 'origin' ? 'origin-edit-btn' : 'destination-edit-btn';

  if (!MapState[type] || !MapState[type].marker) {
    const marker = L.marker(latlng, { draggable: true, icon }).addTo(map);
    enableDrag(marker, type);
    MapState[type] = { marker, latlng, label };
  } else {
    MapState[type].marker.setLatLng(latlng);
    MapState[type].latlng = latlng;
    MapState[type].label = label;
  }

  if (inputEl) inputEl.value = label || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

  const card = document.getElementById(cardId);
  const disp = document.getElementById(dispId);
  if (card) card.classList.remove('hidden');
  if (disp) disp.textContent = label || `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

  // ✅ Mostrar coordenadas debajo de la dirección
  let coordsEl = document.getElementById(coordsId);
  if (!coordsEl) {
    coordsEl = document.createElement('p');
    coordsEl.id = coordsId;
    coordsEl.className = 'text-xs text-gray-500 mt-1';
    card && card.appendChild(coordsEl);
  }
  if (coordsEl) {
    coordsEl.textContent = `Coords.: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  }

  // Ajustar vista
  if (typeof fitMapToBounds === 'function') fitMapToBounds();
}

function fitMapToBounds() {
  if (!map) return;
  const pts = [];
  if (MapState.origin?.marker) pts.push(MapState.origin.latlng);
  if (MapState.destination?.marker) pts.push(MapState.destination.latlng);
  if (pts.length === 1) { map.setView(pts[0], Math.max(map.getZoom() || 14, 15)); return; }
  if (pts.length === 2) {
    const b = L.latLngBounds(pts[0], pts[1]);
    map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
  }
}

// --- Lógica de Notificaciones Push ---
// Wrapper seguro para notificaciones con soporte de mensajes persistentes
function notify(kind, message, a3, a4) {
  try {
    // Normalizar parámetros
    let type = kind;
    let options = {};
    let duration;

    // Soporte para formato especial: notify('persistent', msg, 'success', { ... })
    if (kind === 'persistent') {
      type = typeof a3 === 'string' ? a3 : 'info';
      options = (a4 && typeof a4 === 'object') ? a4 : {};
      // Forzar persistencia (no autodesaparece)
      duration = options.duration != null ? options.duration : 999999;
    } else {
      options = (a3 && typeof a3 === 'object') ? a3 : {};
    }

    // Sanitizar mensaje para prevenir XSS
    const safeMessage = escapeHtml(String(message));

    // Usar API global del sistema de notificaciones si está disponible
    if (typeof window.showNotification === 'function') {
      return window.showNotification(safeMessage, String(type), duration, options);
    }

    // Fallback a helpers individuales si existen
    const map = { success: 'showSuccess', error: 'showError', warning: 'showWarning', info: 'showInfo' };
    const fnName = map[String(type)] || null;
    if (fnName && typeof window[fnName] === 'function') {
      return window[fnName](safeMessage, options);
    }
  } catch (_) {}

    // Último recurso: log discreto en consola
  try { console[kind === 'error' ? 'error' : 'log']('[Aviso]', String(message)); } catch (_) {}
}

// Exponer atajos si no existen aún
if (!window.showSuccess) window.showSuccess = (message, options) => notify('success', message, options);
if (!window.showError) window.showError = (message, options) => notify('error', message, options);
if (!window.showWarning) window.showWarning = (message, options) => notify('warning', message, options);
if (!window.showInfo) window.showInfo = (message, options) => notify('info', message, options);

/**
 * Pide permiso al usuario para notificaciones y guarda la suscripción en la orden.
 * @param {string} orderId - El ID de la orden recién creada.
 */
async function askForNotificationPermission(savedOrder) {
  // Desactivado: no pedir permiso ni mostrar overlay post-envío.
  return;
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
      throw new Error('VAPID pública no disponible.');
    }

    // Validar formato de clave VAPID antes de convertir
    const raw = urlBase64ToUint8Array(vapidKey);
    if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
      console.error('Clave VAPID inválida: longitud', raw?.length, 'primer byte', raw?.[0]);
      throw new Error('Invalid raw ECDSA P-256 public key');
    }

    const applicationServerKey = raw;
    // applicationServerKey validada correctamente

    let subscription = null;
    let existing = null;
    try {
      existing = await registration.pushManager.getSubscription();
      if (existing) {
        subscription = existing;
        // Suscripción existente reutilizada
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
    
    // Guardado delegado al backend: la suscripción se vincula server-side.
    // Si se necesita enviar explícitamente, usar una función de Edge con validaciones.

    return subscription;
  } catch (error) {
    // Error en subscribeUserToPush (silenciado)
    throw error;
  }
}

// --- UI elegante para opt-in de notificaciones (tarjeta blanca con logo) ---
function showPushOptInCard(savedOrder) {
  // Evitar duplicados
  return; // Deshabilitado: no mostrar tarjeta de opt-in
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
  text = String(text).replace(/[`<>]/g, '');
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

function saveDraft() {
  try {
    const draft = {
      step: currentStep,
      client: {
        name: document.getElementById('clientName')?.value,
        phone: document.getElementById('clientPhone')?.value,
        email: document.getElementById('clientEmail')?.value,
      },
      service: selectedService,
      questions: serviceQuestions
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch(_) {}
}

function restoreDraftIfExists() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    // Lógica de restauración simplificada (opcional)
  } catch(_) {}
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  
  // Inicializar elementos del DOM
  steps = document.querySelectorAll('.step');
  nextBtn = document.getElementById('nextBtn');
  prevBtn = document.getElementById('prevBtn');
  progressBar = document.getElementById('progress-bar');
  helpText = document.getElementById('help-text');
  // Asegurar que los inputs de ruta estén disponibles desde el inicio
  pickupInput = document.getElementById('pickupAddress');
  deliveryInput = document.getElementById('deliveryAddress');
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
      
      if (selectedService?.id) {
        modalFilledByService[selectedService.id] = true; // Marcar completado por servicio
      }
      // Notificación opcional eliminada para evitar avisos intrusivos

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

      if(currentStep < steps.length) {
        currentStep++;
        showStep(currentStep);
        saveDraft(); // Guardado temporal
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
        notify('info', 'La solicitud ya fue enviada.', { title: 'Ya enviado' });
        return;
      }

      // Botón de envío y guardia de doble clic
      const submitBtn = serviceForm.querySelector('button[type="submit"], input[type="submit"]');
      if (isSubmittingOrder) {
        notify('info', 'Tu solicitud ya se está enviando...', { title: 'Procesando' });
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
          notify('error', 'No se pudo conectar con el servidor. Verifica tu conexión a internet.', { title: 'Error de Conexión' });
          return;
        }

        // Construir el objeto de la orden para Supabase
        const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
        const originCoords = getSafeCoords(MapState.origin);
        const destinationCoords = getSafeCoords(MapState.destination);

        // 1. Push Flow Centralizado
        const { permissionPromise, pushSubscription } = await PushFlow.resolve();

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
          service_questions: JSON.parse(JSON.stringify(serviceQuestions)),
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
          tracking_data: [{ status: 'created', date: new Date().toISOString() }]
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
          status: 'pending',
          estimated_price: null,
          tracking_data: orderData.tracking_data
        };

        

        let userId = null;
        if (supabaseConfig && supabaseConfig.client && supabaseConfig.client.auth && typeof supabaseConfig.client.auth.getSession === 'function') {
          const { data: sessionData } = await supabaseConfig.client.auth.getSession();
          userId = sessionData?.session?.user?.id || null;
        }
        baseOrder.client_id = userId || null;


        const origin_coords2 = orderData.origin_coords;
        const destination_coords2 = orderData.destination_coords;

        if (!orderData.service_id || !orderData.vehicle_id) {
          notify('error', 'Selecciona un servicio y un vehículo.', { title: 'Datos incompletos' });
          return;
        }
        if (!origin_coords2 || !destination_coords2) {
          notify('error', 'Debes seleccionar origen y destino en el mapa.', { title: 'Ruta incompleta' });
          return;
        }

        const variantA = Object.assign({}, baseOrder, {
          service_id: orderData.service_id,
          vehicle_id: orderData.vehicle_id,
          origin_coords: origin_coords2,
          destination_coords: destination_coords2,
          // ✅ AÑADIR LA SUSCRIPCIÓN AL PAYLOAD
          push_subscription: pushSubscription
        });

        

        let savedOrder;
        try {
          const result = await OrdersService.createOrderAndNotify(variantA);
          savedOrder = result?.order || null;
        } catch (err) {
          notify('error', 'No se pudo crear la solicitud. Intenta más tarde.', { title: 'Error al Guardar Solicitud' });
          return;
        }

        // Si llegamos aquí, savedOrder está presente (puede no traer ID si hubo fallback RLS)
        
        const displayCode = (savedOrder && (savedOrder.short_id || savedOrder.id)) ? (savedOrder.short_id || savedOrder.id) : null;
        
        // ✅ ACTUALIZACIÓN TARDÍA DE SUSCRIPCIÓN PUSH (RPC)
        
        // Caso B: El usuario aprobó el permiso TARDE (después del timeout de permiso)
        if (!pushSubscription && permissionPromise && savedOrder && savedOrder.id) {
            permissionPromise.then(async (latePerm) => {
                if (latePerm === 'granted') {
                    console.log('Permiso concedido tardíamente (Caso B). Intentando obtener suscripción...');
                    try {
                        const lateSub = await getPushSubscription();
                        if (lateSub) {
                            await supabaseConfig.client.rpc('update_push_subscription_by_order', {
                                p_order_id: savedOrder.id,
                                p_push_subscription: lateSub
                            });
                            console.log('Orden actualizada con suscripción push (late update B).');
                        }
                    } catch(e) { console.error('Error en late update B:', e); }
                }
            }).catch(e => console.debug('Late permission promise failed:', e));
        }

        if (!displayCode) {
          console.warn('Orden creada sin datos de retorno por RLS. Mostrando confirmación genérica.');
          notify('persistent',
            'Tu solicitud fue enviada. Te enviaremos el código de seguimiento por correo.',
            'success',
            { title: '¡Solicitud Enviada!' }
          );
        } else {
          const trackingUrl = `${window.location.origin}/seguimiento.html?codigo=${displayCode}`;
          // No actualizar tracking_url manualmente: el trigger del backend ya lo establece
          notify('persistent',
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

        // No solicitar notificaciones push automáticamente después del envío
        localStorage.removeItem(DRAFT_KEY);

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
          notify('error',
            `Error técnico: ${error.message || 'Error desconocido'}
            ${error.hint ? `\nSugerencia: ${error.hint}` : ''}
            ${error.code ? `\nCódigo: ${error.code}` : ''}`,
            { title: 'Error al Guardar (Debug)' }
          );
        } else {
          // Mensaje amigable en producción
          notify('error', 'Hubo un error al enviar tu solicitud. Por favor, inténtalo de nuevo.', 
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
  restoreDraftIfExists();
});
