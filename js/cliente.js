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

// ✅ 5. SAFE NOTIFY GLOBAL (OBLIGATORIO)
window.safeNotify = function(type, msg, opts = {}) {
  if (typeof notify === 'function') {
    notify(type, msg, opts);
  } else {
    // Fallback a la consola si el sistema de notificaciones no está listo
    const style = type === 'error' ? 'color: red; font-weight: bold;' : 'color: blue;';
    console.warn(`%c[${type.toUpperCase()}]`, style, msg);
  }
};

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
    const guideCard = document.getElementById('map-guide-card');
    const guideIcon = document.getElementById('map-guide-icon');
    const guideTitle = document.getElementById('map-guide-title');
    const guideText = document.getElementById('map-guide-text');

    if (MapState.mode === 'origin') {
      if (instr) instr.textContent = 'Primero, define tu punto de recogida.';
      if (guideCard) {
        guideCard.classList.remove('hidden', 'bg-red-50', 'border-red-200');
        guideCard.classList.add('bg-green-50', 'border-green-200', 'animate-bounce-subtle');
        if (guideIcon) guideIcon.innerHTML = '<i class="fa-solid fa-location-dot text-green-600 text-xl"></i>';
        if (guideTitle) guideTitle.textContent = 'Punto de Recogida';
        if (guideText) guideText.textContent = 'Toca el mapa o busca la dirección donde debemos recoger la carga.';
      }
    } else if (MapState.mode === 'destination') {
      if (instr) instr.textContent = 'Ahora, define tu punto de entrega.';
      if (guideCard) {
        guideCard.classList.remove('hidden', 'bg-green-50', 'border-green-200');
        guideCard.classList.add('bg-red-50', 'border-red-200', 'animate-pulse-subtle');
        if (guideIcon) guideIcon.innerHTML = '<i class="fa-solid fa-flag-checkered text-red-600 text-xl"></i>';
        if (guideTitle) guideTitle.textContent = 'Punto de Entrega';
        if (guideText) guideText.textContent = 'Excelente. Ahora marca el lugar exacto de destino.';
      }
    } else {
      // ✅ Limpiar animaciones de los inputs cuando el mapa está completo
      pickupInput?.classList.remove('animate-glow');
      deliveryInput?.classList.remove('animate-glow');

      if (instr) instr.textContent = 'Origen y destino definidos. Puedes continuar.';
      if (guideCard) guideCard.classList.add('hidden');
    }
    
    if (pickupInput) {
      pickupInput.disabled = false;
      // Facilitar pegado y limpieza
      if (!pickupInput.dataset.listenerAdded) {
        pickupInput.addEventListener('focus', () => pickupInput.select());
        pickupInput.dataset.listenerAdded = 'true';
      }
      // ✅ Animación de foco para guiar al usuario
      if (MapState.mode === 'origin') {
        pickupInput.classList.add('animate-glow');
      } else {
        pickupInput.classList.remove('animate-glow');
      }
    }
    if (deliveryInput) {
      deliveryInput.disabled = MapState.mode === 'origin';
      if (!deliveryInput.dataset.listenerAdded) {
        deliveryInput.addEventListener('focus', () => deliveryInput.select());
        deliveryInput.dataset.listenerAdded = 'true';
      }
      if (MapState.mode === 'destination') {
        deliveryInput.classList.add('animate-glow');
      }
    }
    
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
    if (distanceContainer) distanceContainer.classList.add('hidden'); 
  } catch(_) {}
}

// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar, helpText;
let mapContainer = null;

function showStep(step, direction = 'next') {
  if (!steps || steps.length === 0) return;
  
  const oldStep = currentStep;
  // Guardar el paso actual en una variable global si no existe
  currentStep = step;

  steps.forEach(s => {
    const stepNumber = parseInt(s.dataset.step, 10);
    // Limpiar estado previo
    s.classList.remove('step-active', 'step-inactive-left', 'step-inactive-right', 'hidden');

    if (stepNumber === step) {
      s.classList.add('step-active'); // Posición relativa (da altura al contenedor)
    } else {
      // Posición absoluta (fuera del flujo) y desplazado para animación
      if (stepNumber < step) s.classList.add('step-inactive-left');
      else s.classList.add('step-inactive-right');
    }
  });

  if (prevBtn) prevBtn.classList.toggle('hidden', step === 1);
  const isLastStep = step === steps.length;
  if (nextBtn) nextBtn.classList.toggle('hidden', isLastStep);
  // Ocultar también el div de navegación completo en paso 6 para no mostrar espacio vacío
  const navDiv = nextBtn?.parentElement;
  if (navDiv) navDiv.style.display = isLastStep ? 'none' : '';

  // Lógica para mostrar/ocultar el mapa a pantalla completa
  if (step === 4) { // Asumiendo que el paso 4 es el del mapa
    const formSection = document.getElementById('form-section');
    if (formSection) { formSection.classList.add('z-50'); }
  } else {
    const formSection = document.getElementById('form-section');
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
  if (step === 4) {
    try {
      if (!mapInitialized) {
        mapInitialized = true;
        initMap();
      } else if (map) {
        setTimeout(() => map.invalidateSize(), 150);
      }
    } catch (e) {
      console.error('Error mapa:', e);
    }
  }
  const dateEl = document.getElementById('orderDate');
  const timeEl = document.getElementById('orderTime');
  const isStep5 = step === 5;
  if (dateEl) { dateEl.required = isStep5; }
  if (timeEl) { timeEl.required = isStep5; }
  if (progressBar) { 
    const totalSteps = steps ? steps.length : 6;
    progressBar.style.width = ((step-1)/(totalSteps-1))*100 + '%'; 
  }
  updateHelpText(step);
  updateStepsNav(step);
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
  // ✅ FIX 1: Envolver toda la lógica en try...catch
  try {
    const serviceListContainer = document.getElementById('service-list');
    if (!serviceListContainer) return;

    const services = await supabaseConfig.getServices();

    if (!Array.isArray(services) || services.length === 0) {
      serviceListContainer.innerHTML = '<p class="text-gray-500 col-span-full">No hay servicios disponibles en este momento.</p>';
      if (!Array.isArray(services)) {
      throw new Error('Formato inválido en servicios');
      }
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
        } else {
          console.warn('⚠️ Modal no encontrado:', `modal-${normalizedName}`);
          if (selectedService?.id) {
            modalFilledByService[selectedService.id] = true; // 🔥 PERMITIR CONTINUAR
          }
        }
      });
    });
  } catch (err) {
    console.error('❌ loadServices error:', err);
    safeNotify('error', 'Error cargando servicios');
  }
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
  // ✅ FIX 2: Envolver toda la lógica en try...catch
  try {
    const vehicleListContainer = document.getElementById('vehicle-list');
    if (!vehicleListContainer) return;

    const vehicles = await supabaseConfig.getVehicles();

    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      vehicleListContainer.innerHTML = '<p class="text-gray-500 col-span-full">No hay vehículos disponibles.</p>';
      if (!Array.isArray(vehicles)) {
      throw new Error('Formato inválido en vehículos');
      }
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
  } catch (err) {
    console.error('❌ loadVehicles error:', err);
    // ✅ FIX 5: Usar safeNotify en lugar de notify?.
    safeNotify('error', 'Error cargando vehículos');
  }
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
    const phoneRegex = /^(\+1|1)?[-\s]?8[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{4}$/;
    const isTelefonoValid = phoneRegex.test(telefonoInput.value.replace(/[-\s]/g, ''));
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value);

    // Feedback visual con clases del design system
    [nombreInput, telefonoInput, emailInput].forEach(el => el.classList.remove('valid', 'invalid'));
    nombreInput.classList.add(isNombreValid ? 'valid' : 'invalid');
    telefonoInput.classList.add(isTelefonoValid ? 'valid' : 'invalid');
    emailInput.classList.add(isEmailValid ? 'valid' : 'invalid');

    if (!isNombreValid || !isTelefonoValid || !isEmailValid) {
      safeNotify('warning', 'Revisa los campos marcados en rojo.', { title: 'Datos incompletos' });
      return false;
    }
  }
  
  if (currentStep === 2 && (!selectedService || !selectedService.name)) {
    safeNotify('warning', 'Debes seleccionar un servicio para continuar.', { title: 'Paso Incompleto' });
    return false;
  }

  // Validar que el modal del servicio actual fue llenado
  if (currentStep === 2 && selectedService?.id) {
    const filled = !!modalFilledByService[selectedService.id];
    if (!filled) {
      safeNotify('warning', 'Completa y guarda la información adicional del servicio antes de continuar.', { title: 'Información Requerida' });
      return false;
    }
  }
  
  if (currentStep === 3) {
    const selectedVehicle = document.querySelector('.vehicle-item.selected');
    if (!selectedVehicle) {
      safeNotify('warning', 'Debes seleccionar un vehículo para continuar.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 4) {
    const pickupEl = document.getElementById('pickupAddress');
    const deliveryEl = document.getElementById('deliveryAddress');
    const origen = pickupEl && pickupEl.value ? String(pickupEl.value).trim() : '';
    const destino = deliveryEl && deliveryEl.value ? String(deliveryEl.value).trim() : '';

    if (!origen || !destino) {
      safeNotify('warning', 'Debes establecer una dirección de origen y una de destino en el mapa.', { title: 'Paso Incompleto' });
      return false;
    }
  }
  
  if (currentStep === 5) {
    const fechaEl = document.getElementById('orderDate');
    const horaEl = document.getElementById('orderTime');
    const fecha = fechaEl ? fechaEl.value : '';
    const hora = horaEl ? horaEl.value : '';
    
    if (!fecha || !hora) {
      safeNotify('warning', 'Debes seleccionar una fecha y hora para el servicio.', { title: 'Paso Incompleto' });
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

  const row = (label, val) => val ? `<div class="summary-row"><span class="label">${label}</span><span>${val}</span></div>` : '';

  let summaryHTML = `
    <div class="summary-card">
      <h5>👤 Datos del Cliente</h5>
      ${row('Nombre', escName)}
      ${row('Teléfono', escPhone)}
      ${row('Correo', escEmail)}
      ${escRnc ? row('RNC', escRnc) : ''}
      ${escEmpresa ? row('Empresa', escEmpresa) : ''}
    </div>
    <div class="summary-card">
      <h5>🚛 Servicio y Vehículo</h5>
      ${row('Servicio', escService)}
      ${row('Vehículo', escVehicle)}`;

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
    <div class="summary-card">
      <h5>📍 Ruta y Horario</h5>
      ${row('Origen', escPickup)}
      ${row('Destino', escDelivery)}
      ${distance !== '--' ? row('Distancia', escapeHtml(String(distance)) + ' km') : ''}
      ${row('Fecha', escDate)}
      ${row('Hora', escTime)}
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
                  () => safeNotify('error', 'No se pudo obtener tu ubicación')
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
      safeNotify('error', 'La ubicación seleccionada está fuera de la República Dominicana. Por favor, marca un punto dentro del territorio nacional.', { title: 'Ubicación no permitida' });
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
      // Notificar éxito al fijar origen
      safeNotify('success', 'Punto de recogida fijado correctamente.', { duration: 2000 });
    } else if (MapState.mode === 'destination') {
      setPoint('destination', latlng, label);
      MapState.mode = 'complete';
      // Notificar éxito al fijar destino
      safeNotify('success', 'Ruta completada. Ya puedes continuar al siguiente paso.', { duration: 3000 });
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
  const goToTracking = () => {
    setTimeout(() => {
      window.location.href = `seguimiento.html?codigo=${encodeURIComponent(text)}`;
    }, 800);
  };
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => {
        window.showSuccess?.('ID copiado — abriendo seguimiento...');
        goToTracking();
      }).catch(() => {
        goToTracking();
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
    document.execCommand('copy');
    document.body.removeChild(ta);
    window.showSuccess?.('ID copiado — abriendo seguimiento...');
    goToTracking();
  } catch {
    goToTracking();
  }
}
    window.showError?.('No se pudo copiar el ID');
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

// Actualiza los dots de navegación visual
function updateStepsNav(step) {
  const totalSteps = steps ? steps.length : 6;
  document.querySelectorAll('.step-dot[data-nav]').forEach(dot => {
    const n = parseInt(dot.dataset.nav, 10);
    dot.classList.remove('active', 'completed');
    if (n === step) dot.classList.add('active');
    else if (n < step) dot.classList.add('completed');
  });
  for (let i = 1; i < totalSteps; i++) {
    const conn = document.getElementById(`conn-${i}-${i+1}`);
    if (conn) conn.classList.toggle('done', i < step);
  }
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Cliente] Init...');

  try {
    steps = document.querySelectorAll('.step[data-step]');
    nextBtn = document.getElementById('nextBtn');
    prevBtn = document.getElementById('prevBtn');
    progressBar = document.getElementById('progress-bar');
    helpText = document.getElementById('help-text');
    pickupInput = document.getElementById('pickupAddress');
    deliveryInput = document.getElementById('deliveryAddress');

    if (!steps || steps.length === 0) {
      console.error('❌ No se encontraron los pasos del formulario.');
      return;
    }

    await Promise.all([loadServices(), loadVehicles()]);

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (validateCurrentStep()) {
          showStep(currentStep + 1, 'next');
          saveDraft();
        }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => showStep(currentStep - 1, 'prev'));
    }

    document.getElementById('hasRNC')?.addEventListener('change', toggleRNCField);

    // Feedback en tiempo real paso 1
    ['clientName','clientPhone','clientEmail'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', function() {
        this.classList.remove('valid','invalid');
      });
    });

    document.getElementById('orderDate')?.addEventListener('change', () => {
      document.getElementById('time-message')?.classList.remove('hidden');
    });

    // Submit handler
    const form = document.getElementById('serviceForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...'; }

        try {
          const selectedVehicleCard = document.querySelector('.vehicle-item.selected');
          const vehicleId = selectedVehicleCard?.dataset.vehicleId || null;
          const originCoords = getSafeCoords(MapState.origin);
          const destinationCoords = getSafeCoords(MapState.destination);

          const orderPayload = {
            name: document.getElementById('clientName')?.value?.trim(),
            phone: document.getElementById('clientPhone')?.value?.trim(),
            email: document.getElementById('clientEmail')?.value?.trim(),
            rnc: document.getElementById('clientRNC')?.value?.trim() || null,
            empresa: document.getElementById('clientCompany')?.value?.trim() || null,
            service_id: selectedService?.id || null,
            vehicle_id: vehicleId,
            pickup: document.getElementById('pickupAddress')?.value?.trim(),
            delivery: document.getElementById('deliveryAddress')?.value?.trim(),
            origin_coords: originCoords ? `${originCoords.lat},${originCoords.lng}` : null,
            destination_coords: destinationCoords ? `${destinationCoords.lat},${destinationCoords.lng}` : null,
            date: document.getElementById('orderDate')?.value,
            time: document.getElementById('orderTime')?.value,
            service_questions: Object.keys(serviceQuestions).length > 0 ? serviceQuestions : null,
            status: 'pending',
            client_id: getClientId()
          };

          // Usar OrdersService (Edge Function + fallback RPC) para evitar RLS con cliente anon
          const result = await window.OrdersService.createOrderAndNotify(orderPayload);
          if (!result?.success) throw new Error(result?.error || 'Error al crear la orden');

          try { localStorage.removeItem(DRAFT_KEY); } catch(_) {}

          const shortId = result?.order?.short_id || result?.order?.id || '---';
          const summaryContainer = document.getElementById('order-summary');
          if (summaryContainer) {
            summaryContainer.innerHTML = `
              <div class="success-screen">
                <div class="success-icon">
                  <i class="fa-solid fa-check text-white text-2xl"></i>
                </div>
                <h3 style="font-size:1.2rem;font-weight:700;color:#1E405A;margin-bottom:0.5rem">¡Solicitud enviada!</h3>
                <p style="color:#6b7280;font-size:0.9rem;margin-bottom:0.5rem">Guarda tu número de seguimiento:</p>
                <div class="order-id-box" onclick="copyToClipboard('${escapeHtml(String(shortId))}')">
                  <div class="id-label">Número de orden</div>
                  <div class="id-value">ORD-${escapeHtml(String(shortId))}</div>
                  <div style="font-size:0.7rem;opacity:0.7;margin-top:4px"><i class="fa-solid fa-copy"></i> Toca para copiar</div>
                </div>
                <p style="color:#6b7280;font-size:0.82rem">Nos contactaremos contigo pronto para confirmar.</p>
                <a href="index.html" style="display:inline-block;margin-top:1rem;padding:0.6rem 1.5rem;background:var(--color-secundario);color:#fff;border-radius:0.6rem;font-weight:600;font-size:0.9rem;text-decoration:none">
                  Volver al inicio
                </a>
              </div>`;
          }
          if (submitBtn) submitBtn.style.display = 'none';
          safeNotify('success', '¡Solicitud enviada correctamente!', { duration: 4000 });

        } catch (err) {
          console.error('❌ Error al enviar solicitud:', err);
          safeNotify('error', 'No se pudo enviar la solicitud. Intenta de nuevo.', { title: 'Error' });
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Solicitud'; }
        }
      });
    }

    // Modales: cerrar
    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('[id^="modal-"]')?.classList.add('hidden');
        document.documentElement.classList.remove('overflow-hidden');
        document.body.classList.remove('overflow-hidden');
      });
    });

    // Modales: submit genérico — solo forms dentro de modales (no el serviceForm principal)
    document.querySelectorAll('[id^="modal-"] [id^="form-"]').forEach(modalForm => {
      if (!(modalForm instanceof HTMLFormElement)) return;
      modalForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(modalForm);
        formData.forEach((val, key) => { serviceQuestions[key] = val; });
        if (selectedService?.id) modalFilledByService[selectedService.id] = true;
        const modal = modalForm.closest('[id^="modal-"]');
        if (modal) modal.classList.add('hidden');
        document.documentElement.classList.remove('overflow-hidden');
        document.body.classList.remove('overflow-hidden');
        safeNotify('success', 'Información guardada. Puedes continuar.', { duration: 2000 });
      });
    });

    // Modal mudanza: botones +/-
    document.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input[type="number"]');
        if (!input) return;
        const val = parseInt(input.value, 10) || 0;
        if (btn.textContent.trim() === '+') input.value = val + 1;
        else if (val > 0) input.value = val - 1;
      });
    });

    document.getElementById('tiene_fragiles')?.addEventListener('change', function() {
      document.getElementById('descripcion_fragiles_container')?.classList.toggle('hidden', this.value !== 'si');
    });

    document.getElementById('tipo_material_botes')?.addEventListener('change', function() {
      const otroInput = this.closest('div')?.querySelector('input[name="material_otro"]');
      if (otroInput) otroInput.classList.toggle('hidden', this.value !== 'otro');
    });

    showStep(1);
    console.log('✅ Cliente listo');

  } catch (err) {
    console.error('❌ Error en la inicialización del cliente:', err);
    safeNotify('error', 'Hubo un problema al cargar la página. Por favor, recarga.');
  }
});