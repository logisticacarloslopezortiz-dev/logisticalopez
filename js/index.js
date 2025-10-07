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
  initializeApp();
});

// Variables globales del wizard
let currentStep = 1;
const totalSteps = 4;
let formData = {
  clientData: {},
  serviceData: {},
  locationData: {},
  rncData: null
};

// Elementos del DOM
const welcomeScreen = document.getElementById('welcomeScreen');
const wizardApp = document.getElementById('wizardApp');
const startButton = document.getElementById('startButton');
const backToWelcome = document.getElementById('backToWelcome');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const progressBar = document.getElementById('progressBar');
const progressSteps = document.querySelectorAll('.progress-step');
const wizardSteps = document.querySelectorAll('.wizard-step');
const orderSummary = document.getElementById('orderSummary');

// Modales
const rncModal = document.getElementById('rncModal');
const confirmModal = document.getElementById('confirmModal');
const openRNCModal = document.getElementById('openRNCModal');
const closeRNC = document.getElementById('closeRNC');
const cancelRNC = document.getElementById('cancelRNC');
const saveRNC = document.getElementById('saveRNC');
const closeConfirm = document.getElementById('closeConfirm');

// Funciones utilitarias
function genId() {
  const orders = loadOrders();
  const lastId = orders.length > 0 ? orders[0].id : 'TLC00';
  const lastNumber = parseInt(lastId.replace('TLC', '')) || 0;
  const nextNumber = lastNumber + 1;
  return 'TLC' + nextNumber.toString().padStart(2, '0');
}

function loadOrders() { 
  return JSON.parse(localStorage.getItem('tlc_orders') || '[]'); 
}

function saveOrders(arr) {
  localStorage.setItem('tlc_orders', JSON.stringify(arr));
}

function getServiceIcon(service) {
  const icons = {
    'Mudanza': 'home',
    'Transporte Comercial': 'package',
    'Carga Pesada': 'weight',
    'Fletes': 'truck',
    'Botes Aduanero': 'anchor',
    'Grúas': 'crane',
    'Paquetería': 'package-2'
  };
  return icons[service] || 'truck';
}

// Inicializar la aplicación
function initializeApp() {
  // Event listeners para navegación principal
  startButton.addEventListener('click', showWizard);
  backToWelcome.addEventListener('click', showWelcome);
  prevButton.addEventListener('click', previousStep);
  nextButton.addEventListener('click', nextStep);

  // Event listeners para modales
  openRNCModal.addEventListener('click', () => showModal(rncModal));
  closeRNC.addEventListener('click', () => hideModal(rncModal));
  cancelRNC.addEventListener('click', () => hideModal(rncModal));
  saveRNC.addEventListener('click', saveRNCData);
  closeConfirm.addEventListener('click', () => {
    hideModal(confirmModal);
    showWelcome();
  });

  // Event listeners para selección de servicios
  initializeServiceSelection();
  initializeVehicleSelection();

  // Configurar fecha mínima (hoy)
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('serviceDate').min = today;
}

// Navegación del wizard
function showWelcome() {
  welcomeScreen.classList.remove('hidden');
  wizardApp.classList.add('hidden');
  resetWizard();
}

function showWizard() {
  welcomeScreen.classList.add('hidden');
  wizardApp.classList.remove('hidden');
  currentStep = 1;
  updateWizardDisplay();
}

function nextStep() {
  if (validateCurrentStep()) {
    saveCurrentStepData();
    if (currentStep < totalSteps) {
      currentStep++;
      updateWizardDisplay();
    } else {
      submitForm();
    }
  }
}

function previousStep() {
  if (currentStep > 1) {
    currentStep--;
    updateWizardDisplay();
  }
}

function updateWizardDisplay() {
  // Actualizar barra de progreso
  const progressPercentage = (currentStep / totalSteps) * 100;
  progressBar.style.width = `${progressPercentage}%`;

  // Actualizar pasos visuales
  progressSteps.forEach((step, index) => {
    const stepNumber = index + 1;
    step.classList.remove('active', 'completed');
    
    if (stepNumber < currentStep) {
      step.classList.add('completed');
    } else if (stepNumber === currentStep) {
      step.classList.add('active');
    }
  });

  // Mostrar/ocultar pasos
  wizardSteps.forEach((step, index) => {
    if (index + 1 === currentStep) {
      step.classList.remove('hidden');
      step.classList.add('animate-slide-in');
    } else {
      step.classList.add('hidden');
      step.classList.remove('animate-slide-in');
    }
  });

  // Actualizar botones de navegación
  prevButton.classList.toggle('hidden', currentStep === 1);
  
  if (currentStep === totalSteps) {
    nextButton.innerHTML = `
      <i data-lucide="send" class="w-4 h-4 inline mr-2"></i>
      Enviar Solicitud
    `;
    generateOrderSummary();
  } else {
    nextButton.innerHTML = `
      Siguiente
      <i data-lucide="arrow-right" class="w-4 h-4 inline ml-2"></i>
    `;
  }

  // Reinicializar iconos de Lucide
  lucide.createIcons();
}

// Validación de pasos
function validateCurrentStep() {
  switch (currentStep) {
    case 1:
      return validateStep1();
    case 2:
      return validateStep2();
    case 3:
      return validateStep3();
    case 4:
      return true; // El paso 4 es solo resumen
    default:
      return false;
  }
}

function validateStep1() {
  const name = document.getElementById('clientName').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  
  if (!name) {
    showError('Por favor ingresa tu nombre completo');
    return false;
  }
  
  if (!phone) {
    showError('Por favor ingresa tu número de teléfono');
    return false;
  }
  
  return true;
}

function validateStep2() {
  const selectedService = document.querySelector('.service-card.selected');
  const selectedVehicle = document.querySelector('input[name="vehicleType"]:checked');
  
  if (!selectedService) {
    showError('Por favor selecciona un tipo de servicio');
    return false;
  }
  
  if (!selectedVehicle) {
    showError('Por favor selecciona un tipo de vehículo');
    return false;
  }
  
  return true;
}

function validateStep3() {
  const pickupAddress = document.getElementById('pickupAddress').value.trim();
  const deliveryAddress = document.getElementById('deliveryAddress').value.trim();
  const serviceDate = document.getElementById('serviceDate').value;
  const serviceTime = document.getElementById('serviceTime').value;
  
  if (!pickupAddress) {
    showError('Por favor ingresa la dirección de recogida');
    return false;
  }
  
  if (!deliveryAddress) {
    showError('Por favor ingresa la dirección de entrega');
    return false;
  }
  
  if (!serviceDate) {
    showError('Por favor selecciona una fecha');
    return false;
  }
  
  if (!serviceTime) {
    showError('Por favor selecciona una hora');
    return false;
  }
  
  return true;
}

// Guardar datos de cada paso
function saveCurrentStepData() {
  switch (currentStep) {
    case 1:
      saveStep1Data();
      break;
    case 2:
      saveStep2Data();
      break;
    case 3:
      saveStep3Data();
      break;
  }
}

function saveStep1Data() {
  formData.clientData = {
    name: document.getElementById('clientName').value.trim(),
    phone: document.getElementById('clientPhone').value.trim(),
    email: document.getElementById('clientEmail').value.trim(),
    needsRNC: document.querySelector('input[name="needsRNC"]:checked').value
  };
}

function saveStep2Data() {
  const selectedService = document.querySelector('.service-card.selected');
  const selectedVehicle = document.querySelector('input[name="vehicleType"]:checked');
  
  formData.serviceData = {
    serviceType: selectedService.dataset.service,
    vehicleType: selectedVehicle.value,
    description: document.getElementById('serviceDescription').value.trim()
  };
}

function saveStep3Data() {
  formData.locationData = {
    pickupAddress: document.getElementById('pickupAddress').value.trim(),
    deliveryAddress: document.getElementById('deliveryAddress').value.trim(),
    date: document.getElementById('serviceDate').value,
    time: document.getElementById('serviceTime').value
  };
}

// Selección de servicios
function initializeServiceSelection() {
  const serviceCards = document.querySelectorAll('.service-card');
  
  serviceCards.forEach(card => {
    card.addEventListener('click', () => {
      // Remover selección anterior
      serviceCards.forEach(c => c.classList.remove('selected'));
      // Seleccionar actual
      card.classList.add('selected');
    });
  });
}

// Selección de vehículos
function initializeVehicleSelection() {
  const vehicleOptions = document.querySelectorAll('.vehicle-option');
  
  vehicleOptions.forEach(option => {
    option.addEventListener('click', () => {
      // Remover selección anterior
      vehicleOptions.forEach(v => {
        v.classList.remove('selected');
        v.style.borderColor = '';
        v.style.background = '';
      });
      
      // Seleccionar actual
      option.classList.add('selected');
      option.style.borderColor = '#2563eb';
      option.style.background = 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)';
      
      // Marcar el radio button
      const radio = option.querySelector('input[type="radio"]');
      radio.checked = true;
    });
  });
}

// Generar resumen de la orden
function generateOrderSummary() {
  const summary = document.getElementById('orderSummary');
  
  const summaryHTML = `
    <div class="space-y-4">
      <div class="border-b pb-4">
        <h3 class="font-semibold text-gray-800 mb-2">Datos del Cliente</h3>
        <p class="text-sm text-gray-600">Nombre: ${formData.clientData.name}</p>
        <p class="text-sm text-gray-600">Teléfono: ${formData.clientData.phone}</p>
        ${formData.clientData.email ? `<p class="text-sm text-gray-600">Email: ${formData.clientData.email}</p>` : ''}
        ${formData.rncData ? `<p class="text-sm text-gray-600">RNC: ${formData.rncData.rnc} - ${formData.rncData.company}</p>` : ''}
      </div>
      
      <div class="border-b pb-4">
        <h3 class="font-semibold text-gray-800 mb-2">Servicio Solicitado</h3>
        <p class="text-sm text-gray-600">Tipo: ${formData.serviceData.serviceType}</p>
        <p class="text-sm text-gray-600">Vehículo: ${formData.serviceData.vehicleType}</p>
        ${formData.serviceData.description ? `<p class="text-sm text-gray-600">Descripción: ${formData.serviceData.description}</p>` : ''}
      </div>
      
      <div class="border-b pb-4">
        <h3 class="font-semibold text-gray-800 mb-2">Ubicación y Horario</h3>
        <p class="text-sm text-gray-600">Recogida: ${formData.locationData.pickupAddress}</p>
        <p class="text-sm text-gray-600">Entrega: ${formData.locationData.deliveryAddress}</p>
        <p class="text-sm text-gray-600">Fecha: ${formatDate(formData.locationData.date)}</p>
        <p class="text-sm text-gray-600">Hora: ${formatTime(formData.locationData.time)}</p>
      </div>
    </div>
  `;
  
  summary.innerHTML = summaryHTML;
}

// Enviar formulario
function submitForm() {
  const order = {
    id: genId(),
    ...formData.clientData,
    service: formData.serviceData.serviceType,
    vehicle: formData.serviceData.vehicleType,
    description: formData.serviceData.description,
    pickup: formData.locationData.pickupAddress,
    delivery: formData.locationData.deliveryAddress,
    date: formData.locationData.date,
    time: formData.locationData.time,
    rncData: formData.rncData,
    status: 'Pendiente',
    createdAt: new Date().toISOString()
  };

  const orders = loadOrders();
  orders.unshift(order);
  saveOrders(orders);

  // Mostrar modal de confirmación
  showModal(confirmModal);
  
  // Enviar notificación por WhatsApp (simulado)
  sendWhatsAppNotification(order);
}

// Funciones de modal
function showModal(modal) {
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function hideModal(modal) {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// Funciones RNC
function saveRNCData() {
  const rnc = document.getElementById('rncNumber').value.trim();
  const company = document.getElementById('companyName').value.trim();
  
  if (!rnc || !company) {
    showError('Por favor completa todos los campos del RNC');
    return;
  }
  
  formData.rncData = { rnc, company };
  hideModal(rncModal);
  showSuccess('Información RNC guardada correctamente');
}

// Funciones de utilidad
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-DO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatTime(timeString) {
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function showError(message) {
  // Crear toast de error
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <i data-lucide="alert-circle" class="w-4 h-4"></i>
      <span>${message}</span>
    </div>
  `;
  
  document.body.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

function showSuccess(message) {
  // Crear toast de éxito
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <i data-lucide="check-circle" class="w-4 h-4"></i>
      <span>${message}</span>
    </div>
  `;
  
  document.body.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function resetWizard() {
  currentStep = 1;
  formData = {
    clientData: {},
    serviceData: {},
    locationData: {},
    rncData: null
  };
  
  // Limpiar formularios
  document.getElementById('clientName').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientEmail').value = '';
  document.getElementById('serviceDescription').value = '';
  document.getElementById('pickupAddress').value = '';
  document.getElementById('deliveryAddress').value = '';
  document.getElementById('serviceDate').value = '';
  document.getElementById('serviceTime').value = '';
  
  // Limpiar selecciones
  document.querySelectorAll('.service-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  document.querySelectorAll('.vehicle-option').forEach(option => {
    option.classList.remove('selected');
    option.style.borderColor = '';
    option.style.background = '';
    const radio = option.querySelector('input[type="radio"]');
    radio.checked = false;
  });
  
  // Reset RNC
  document.querySelector('input[name="needsRNC"][value="no"]').checked = true;
  document.getElementById('rncNumber').value = '';
  document.getElementById('companyName').value = '';
}

function sendWhatsAppNotification(order) {
  // Simular envío de WhatsApp
  console.log('Enviando notificación WhatsApp para orden:', order.id);
  
  // En una implementación real, aquí se haría la llamada a la API de WhatsApp
  const message = `¡Nueva solicitud recibida!
  
Orden: ${order.id}
Cliente: ${order.name}
Teléfono: ${order.phone}
Servicio: ${order.service}
Vehículo: ${order.vehicle}
Fecha: ${formatDate(order.date)} a las ${formatTime(order.time)}
Recogida: ${order.pickup}
Entrega: ${order.delivery}`;

  console.log('Mensaje WhatsApp:', message);
}

// Manejo de eventos PWA
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Función para instalar PWA
function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('Usuario aceptó instalar la PWA');
      }
      deferredPrompt = null;
    });
  }
}