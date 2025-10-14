// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};

// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar;

const serviceContainer = document.querySelector('.step[data-step="2"] .grid');
const vehicleContainer = document.querySelector('.step[data-step="3"] .grid');
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
      
      selectedService = {
          id: this.dataset.serviceId,
          name: this.dataset.serviceName
      };

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
  let orderCount = localStorage.getItem('tlc_orderCount') || 0;
  orderCount = parseInt(orderCount) + 1;
  localStorage.setItem('tlc_orderCount', orderCount);
  return `TLC-${orderCount.toString().padStart(2, '0')}`;
}

// Función para guardar orden
async function saveOrder(orderData) {
  try {
    // Intentar guardar en Supabase primero
    if (typeof supabaseConfig !== 'undefined' && !supabaseConfig.useLocalStorage) {
      const savedOrder = await supabaseConfig.saveOrder(orderData);
      return savedOrder;
    } else {
      // Fallback a localStorage
      let orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
      orders.push(orderData);
      localStorage.setItem('tlc_orders', JSON.stringify(orders));
      return orderData;
    }
  } catch (error) {
    console.error('Error saving order:', error);
    // Fallback a localStorage en caso de error
    let orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
    orders.push(orderData);
    localStorage.setItem('tlc_orders', JSON.stringify(orders));
    return orderData;
  }
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
    const origen = document.querySelector('input[placeholder="Dirección de origen"]').value;
    const destino = document.querySelector('input[placeholder="Dirección de destino"]').value;
    
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
  
  if (rncCheckbox && rncFields) {
    if (rncCheckbox.checked) {
      rncFields.classList.remove('hidden');
    } else {
      rncFields.classList.add('hidden');
      // Limpiar campos cuando se ocultan
      document.querySelector('input[name="rnc"]').value = '';
      document.querySelector('input[name="empresa"]').value = '';
    }
  }
}

// --- Carga dinámica de servicios y vehículos ---
async function loadServices() {
    const services = await supabaseConfig.getServices();
    serviceContainer.innerHTML = ''; // Limpiar contenido estático
    services.forEach(service => {
        const serviceCard = document.createElement('div');
        serviceCard.className = 'service-card flex flex-col items-center p-4 border rounded-lg text-center cursor-pointer hover:border-azulClaro hover:bg-blue-50 transition';
        serviceCard.dataset.serviceName = service.name; // Usar el nombre para el modal
        serviceCard.dataset.serviceId = service.id;
        serviceCard.innerHTML = `
            <img src="assets/${service.image_url}" alt="${service.name}" class="mx-auto w-24 h-24 object-contain mb-4" onerror="this.src='assets/icons/1vertical.png'">
            <div class="flex flex-col">
                <span class="font-medium">${service.name}</span>
                ${service.description ? `<span class="text-sm text-gray-500 mt-1">${service.description}</span>` : ''}
            </div>
        `;
        serviceContainer.appendChild(serviceCard);
    });
    addServiceCardListeners();
}

async function loadVehicles() {
    const vehicles = await supabaseConfig.getVehicles();
    vehicleContainer.innerHTML = ''; // Limpiar contenido estático
    vehicles.forEach(vehicle => {
        const vehicleCard = document.createElement('div');
        vehicleCard.className = 'vehicle-card flex flex-col items-center p-4 border rounded-lg text-center cursor-pointer hover:border-azulClaro hover:bg-blue-50 transition';

        vehicleCard.innerHTML = `
            <img src="assets/img-vehiculos/${vehicle.image_url}" alt="${vehicle.name}" class="mx-auto w-24 h-24 object-contain mb-4" onerror="this.src='assets/icons/1vertical.png'">
            <div class="flex flex-col">
                <h4 class="font-medium">${vehicle.name}</h4>
                ${vehicle.description ? `<span class="text-sm text-gray-600 mt-1">${vehicle.description}</span>` : ''}
            </div>
        `;
        vehicleContainer.appendChild(vehicleCard);
    });
    addVehicleCardListeners();
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
      
      // Obtener datos del formulario
      const nombre = document.querySelector('input[placeholder="Nombre completo"]').value;
      const telefono = document.querySelector('input[placeholder="Teléfono"]').value;
      const email = document.querySelector('input[placeholder="Correo"]').value;
      const rnc = document.querySelector('input[name="rnc"]')?.value || '';
      const empresa = document.querySelector('input[name="empresa"]')?.value || '';
      
      const selectedVehicleCard = document.querySelector('.vehicle-card.border-azulClaro');
      const vehiculo = selectedVehicleCard ? selectedVehicleCard.querySelector('h4').textContent : '';
      
      const origen = document.querySelector('input[placeholder="Dirección de origen"]').value;
      const destino = document.querySelector('input[placeholder="Dirección de destino"]').value;
      const fecha = document.querySelector('input[type="date"]').value;
      const hora = document.querySelector('input[type="time"]').value;
      
      // Crear objeto de orden
      const orderData = {
        id: generateOrderId(), // e.g., TLC-01
        clientName: nombre,
        clientPhone: telefono,
        clientEmail: email,
        rncData: rnc ? { rncNumber: rnc, companyName: empresa } : null,
        orderType: rnc ? 'COMPROBANTE FISCAL FIJO' : 'CONSUMIDOR FINAL',
        service: selectedService.name,
        serviceDetails: serviceQuestions,
        vehicle: vehiculo,
        pickupAddress: origen,
        deliveryAddress: destino,
        serviceDate: fecha,
        serviceTime: hora,
        status: 'Pendiente',
        createdAt: new Date().toISOString(),
        estimatedPrice: 'Por confirmar'
      };
      
      // Guardar orden
      saveOrder(orderData);
      
      // Mostrar confirmación
      alert(`¡Solicitud enviada exitosamente! Su número de orden es: ${orderData.id}`);
      
      // Redirigir
      window.location.href = 'index.html';
    });
  }

  // Cargar servicios y vehículos dinámicamente
  loadServices();
  loadVehicles();

  // Mostrar primer paso
  if (steps && steps.length > 0) {
    showStep(currentStep);
  }
});
