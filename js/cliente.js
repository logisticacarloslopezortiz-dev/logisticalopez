// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};

// Variables para el mapa
let map;
let marker;
let geocoder;
let activeMapInputId = null;


// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar;

// Función para mostrar paso específico

function addVehicleCardListeners() {
  document.querySelectorAll('.vehicle-card').forEach(card => {
    card.addEventListener('click', function() {
      document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('border-azulClaro', 'bg-blue-50'));
      this.classList.add('border-azulClaro', 'bg-blue-50');
    });
  });
}

function addServiceCardListeners() {
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', function() {
      document.querySelectorAll('.service-card').forEach(c => c.classList.remove('border-azulClaro', 'bg-blue-50'));
      this.classList.add('border-azulClaro', 'bg-blue-50');
      selectedService = { name: this.dataset.serviceName };

      const modalName = selectedService.name.toLowerCase().replace(/ /g, '-');
      const modal = document.getElementById(`modal-${modalName}`);
      if (modal) {
        modal.classList.remove('hidden');
      }
    });
  });
}
function showStep(step) {
  steps.forEach(s => s.classList.add('hidden'));
  document.querySelector(`.step[data-step="${step}"]`).classList.remove('hidden');
  prevBtn.classList.toggle('hidden', step === 1);
  nextBtn.classList.toggle('hidden', step === steps.length);
  progressBar.style.width = ((step-1)/(steps.length-1))*100 + '%';
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
    
    const isNombreValid = /^[a-zA-Z\s]+$/.test(nombreInput.value);
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
      if (!isNombreValid) errorMessage += '- Nombre: solo puede contener letras.\n';
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
  
  if (currentStep === 3) {
    const selectedVehicle = document.querySelector('.vehicle-card.border-azulClaro');
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

// --- Funciones del Mapa de Google ---
async function initMap(Map, AdvancedMarkerElement) {
    const santoDomingo = { lat: 18.4861, lng: -69.9312 };
    map = new Map(document.getElementById("map"), {
        center: santoDomingo,
        zoom: 12,
        mapId: 'TLC_MAP_ID' // ID de mapa requerido para Advanced Markers
    });
    geocoder = new google.maps.Geocoder();
    marker = new AdvancedMarkerElement({
        map: map,
        position: santoDomingo,
        gmpDraggable: true,
    });

    map.addListener('click', (e) => {
        marker.position = e.latLng;
    });
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  
  // Inicializar elementos del DOM
  steps = document.querySelectorAll('.step');
  nextBtn = document.getElementById('nextBtn');
  prevBtn = document.getElementById('prevBtn');
  progressBar = document.getElementById('progress-bar');
  
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
    const isValid = /^[a-zA-Z\s]*$/.test(e.target.value);
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

  // --- Lógica del Modal del Mapa ---
  const mapModal = document.getElementById('mapModal');
  const closeMapModalBtn = document.getElementById('closeMapModal');
  const confirmLocationBtn = document.getElementById('confirmLocationBtn');

  document.querySelectorAll('.open-map-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      activeMapInputId = this.dataset.target;
      mapModal.classList.remove('hidden');
      mapModal.classList.add('flex');
      // Forzar al mapa a redibujarse correctamente
      google.maps.event.trigger(map, 'resize');
    });
  });

  closeMapModalBtn.addEventListener('click', () => {
    mapModal.classList.add('hidden');
    mapModal.classList.remove('flex');
  });

  confirmLocationBtn.addEventListener('click', () => {
    const location = marker.position;
    geocoder.geocode({ location: location }, (results, status) => {
      if (status === 'OK' && results[0]) {
        document.getElementById(activeMapInputId).value = results[0].formatted_address;
      }
    });
    mapModal.classList.add('hidden');
    mapModal.classList.remove('flex');
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
      
      // Cerrar modal y continuar al siguiente paso
      this.closest('.fixed').classList.add('hidden');
      if (currentStep < steps.length) {
        currentStep++;
        showStep(currentStep);
      }
    });
  });

  // Botón siguiente
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!validateCurrentStep()) return;
      
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
      const selectedVehicleCard = document.querySelector('.vehicle-card.border-azulClaro');
      const orderData = {
        id: generateOrderId(),
        // Datos del cliente (Paso 1)
        name: document.querySelector('input[placeholder="Nombre completo"]').value,
        phone: document.querySelector('input[placeholder="Teléfono"]').value,
        email: document.querySelector('input[placeholder="Correo"]').value,
        rnc: document.querySelector('input[name="rnc"]')?.value || null,
        empresa: document.querySelector('input[name="empresa"]')?.value || null,
        // Detalles del servicio (Pasos 2 y 3)
        service: selectedService.name,
        vehicle: selectedVehicleCard ? selectedVehicleCard.querySelector('h4').textContent : null,
        service_questions: serviceQuestions,
        // Detalles de la ruta (Paso 4)
        pickup: document.getElementById('pickupAddress').value,
        delivery: document.getElementById('deliveryAddress').value,
        // Fecha y Hora (Paso 5)
        "date": document.querySelector('input[type="date"]').value,
        "time": document.querySelector('input[type="time"]').value,
        // Estado y precio inicial
        status: 'Pendiente',
        estimated_price: 'Por confirmar'
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

        // Mostrar confirmación
        alert(`¡Solicitud enviada exitosamente! Su número de orden es: ${orderData.id}`);
        
        // Redirigir
        window.location.href = 'index.html';

      } catch (error) {
        console.error('Error al guardar la solicitud:', error);
        alert(`Hubo un error al enviar tu solicitud. Por favor, inténtalo de nuevo.\n\nError: ${error.message}`);
      }
    });
  }

  addServiceCardListeners();
  addVehicleCardListeners();

  // Mostrar primer paso
  if (steps && steps.length > 0) {
    showStep(currentStep);
  }
});
