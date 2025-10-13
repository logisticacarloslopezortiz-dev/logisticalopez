// Variables globales
let currentStep = 1;
let selectedService = null; // Ahora será un objeto {id, name}
let serviceQuestions = {};

// Elementos del DOM
let steps, nextBtn, prevBtn, progressBar;

const serviceContainer = document.querySelector('.step[data-step="2"] .grid');
const vehicleContainer = document.querySelector('.step[data-step="3"] .grid');
// Función para mostrar paso específico
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
    const nombre = document.querySelector('input[placeholder="Nombre completo"]').value;
    const telefono = document.querySelector('input[placeholder="Teléfono"]').value;
    const email = document.querySelector('input[placeholder="Correo"]').value;
    
    if (!nombre || !telefono || !email) {
      alert('Por favor complete todos los campos personales');
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
        serviceCard.className = 'service-card p-4 border rounded-lg text-center cursor-pointer hover:border-azulClaro hover:bg-blue-50 transition';
        serviceCard.dataset.serviceName = service.name; // Usar el nombre para el modal
        serviceCard.dataset.serviceId = service.id;

        // Normalizar nombre para buscar imagen
        const imageName = service.name.toLowerCase().replace(/ /g, '-') + '.png';

        serviceCard.innerHTML = `
            <img src="img-servicio/${imageName}" alt="${service.name}" class="mx-auto w-16 h-16 object-contain mb-2" onerror="this.src='img/1vertical.png'">
            <span class="font-medium">${service.name}</span>
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
        vehicleCard.className = 'vehicle-card p-2 border rounded-lg text-center cursor-pointer hover:border-azulClaro hover:bg-blue-50 transition';
        
        const imageName = vehicle.name.toLowerCase().replace(/ /g, '-').replace('ú', 'u') + '.jpg';

        vehicleCard.innerHTML = `
            <img src="img-vehiculo/${imageName}" alt="${vehicle.name}" class="mx-auto w-16 h-16 object-contain mb-2" onerror="this.src='img/1vertical.png'">
            <h4 class="font-medium">${vehicle.name}</h4>
            ${vehicle.description ? `<span class="text-sm text-gray-600">${vehicle.description}</span>` : ''}
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
        id: generateOrderId(),
        name: nombre,
        phone: telefono,
        email: email,
        rnc: rnc,
        empresa: empresa,
        service: selectedService.name,
        serviceQuestions: serviceQuestions,
        vehicle: vehiculo,
        pickup: origen,
        delivery: destino,
        date: fecha,
        time: hora,
        status: 'Pendiente',
        timestamp: new Date().toISOString(),
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

  // --- Funciones para añadir listeners a las tarjetas ---
  // Estas funciones deben estar definidas antes de ser llamadas por loadServices/loadVehicles

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

  // Cargar servicios y vehículos dinámicamente
  loadServices();
  loadVehicles();

  // Mostrar primer paso
  if (steps && steps.length > 0) {
    showStep(currentStep);
  }
});
