// TLC - Transporte Logístico Carlos López
// Main application JavaScript

// Global variables
let currentStep = 1;
let selectedService = '';
let selectedVehicle = '';
let pickupLocation = '';
let deliveryLocation = '';
let orderData = {};
let map;
let pickupAutocomplete;
let deliveryAutocomplete;

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
  lucide.createIcons();
});

// Initialize the application
function initializeApp() {
  // Initialize Google Maps if available
  if (typeof google !== 'undefined' && google.maps) {
    initializeGoogleMaps();
  }
  
  // Set up event listeners
  setupEventListeners();
  
  // Show welcome screen initially
  showWelcomeScreen();
}

// Setup event listeners
function setupEventListeners() {
  // Start buttons
  const startButtons = document.querySelectorAll('#startButton, #headerStartButton');
  startButtons.forEach(button => {
    button.addEventListener('click', startWizard);
  });
  
  // Next/Previous buttons
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  
  if (nextBtn) nextBtn.addEventListener('click', nextStep);
  if (prevBtn) prevBtn.addEventListener('click', prevStep);
  
  // Service cards
  const serviceCards = document.querySelectorAll('.service-card');
  serviceCards.forEach(card => {
    card.addEventListener('click', () => selectService(card.dataset.service));
  });
  
  // Vehicle cards
  const vehicleCards = document.querySelectorAll('.vehicle-card');
  vehicleCards.forEach(card => {
    card.addEventListener('click', () => selectVehicle(card.dataset.vehicle));
  });
  
  // Form submission
  const orderForm = document.getElementById('orderForm');
  if (orderForm) {
    orderForm.addEventListener('submit', submitOrder);
  }

  // RNC radio buttons
  const rncRadios = document.querySelectorAll('input[name="needsRNC"]');
  rncRadios.forEach(radio => {
    radio.addEventListener('change', toggleRNCFields);
  });

  // Service modal buttons
  const serviceModal = document.getElementById('serviceModal');
  if (serviceModal) {
    const closeButton = document.getElementById('closeServiceModal');
    if (closeButton) {
      closeButton.addEventListener('click', () => closeServiceModal('serviceModal'));
    }
    const cancelButton = document.getElementById('cancelServiceModal');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => closeServiceModal('serviceModal'));
    }
    const saveButton = document.getElementById('saveServiceModal');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        saveServiceDetails(selectedService);
        closeServiceModal('serviceModal');
      });
    }
  }
}

function toggleRNCFields() {
  const rncFields = document.getElementById('rncFields');
  const rncYesRadio = document.querySelector('input[name="needsRNC"][value="yes"]');
  if (rncFields && rncYesRadio) {
    rncFields.classList.toggle('hidden', !rncYesRadio.checked);
  }
}

// Initialize Google Maps
function initializeGoogleMaps() {
  try {
    // Initialize autocomplete for pickup location
    const pickupInput = document.getElementById('pickup');
    if (pickupInput) {
      pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput);
      pickupAutocomplete.addListener('place_changed', () => {
        const place = pickupAutocomplete.getPlace();
        if (!place.geometry) return;
        pickupLocation = place.formatted_address;
      });
    }
    
    // Initialize autocomplete for delivery location
    const deliveryInput = document.getElementById('delivery');
    if (deliveryInput) {
      deliveryAutocomplete = new google.maps.places.Autocomplete(deliveryInput);
      deliveryAutocomplete.addListener('place_changed', () => {
        const place = deliveryAutocomplete.getPlace();
        if (!place.geometry) return;
        deliveryLocation = place.formatted_address;
      });
    }
  } catch (error) {
    console.warn('Google Maps initialization failed:', error);
  }
}

// Show welcome screen
function showWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  const wizardScreen = document.getElementById('wizardScreen');
  
  if (welcomeScreen) welcomeScreen.classList.remove('hidden');
  if (wizardScreen) wizardScreen.classList.add('hidden');
}

// Start the wizard
function startWizard() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  const wizardScreen = document.getElementById('wizardApp');
  
  if (welcomeScreen && wizardScreen) {
    welcomeScreen.classList.add('hidden');
    wizardScreen.classList.remove('hidden');
  }
  
  currentStep = 1;
  updateProgressSteps();
  showStep(1);
}

// Navigate to next step
function nextStep() {
  if (!validateCurrentStep()) return;
  
  if (currentStep < 4) {
    currentStep++;
    updateProgressSteps();
    showStep(currentStep);
  }
}

// Navigate to previous step
function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    updateProgressSteps();
    showStep(currentStep);
  }
}

// Validate current step
function validateCurrentStep() {
  switch (currentStep) {
    case 1:
      if (!selectedService) {
        showError('Por favor selecciona un servicio');
        return false;
      }
      return true;
    case 2:
      if (!selectedVehicle) {
        showError('Por favor selecciona un vehículo');
        return false;
      }
      return true;
    case 3:
      const pickup = document.getElementById('pickup')?.value;
      const delivery = document.getElementById('delivery')?.value;
      if (!pickup || !delivery) {
        showError('Por favor completa las ubicaciones de recogida y entrega');
        return false;
      }
      return true;
    case 4:
      return validateOrderForm();
    default:
      return true;
  }
}

// Validate order form
function validateOrderForm() {
  const name = document.getElementById('name')?.value;
  const phone = document.getElementById('phone')?.value;
  const email = document.getElementById('email')?.value;
  const date = document.getElementById('date')?.value;
  const time = document.getElementById('time')?.value;
  
  if (!name || !phone || !email || !date || !time) {
    showError('Por favor completa todos los campos requeridos');
    return false;
  }
  
  if (!isValidEmail(email)) {
    showError('Por favor ingresa un email válido');
    return false;
  }
  
  return true;
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Show specific step
function showStep(step) {
  // Hide all steps
  for (let i = 1; i <= 4; i++) {
    const stepElement = document.getElementById(`step${i}`);
    if (stepElement) {
      stepElement.classList.add('hidden');
    }
  }
  
  // Show current step
  const currentStepElement = document.getElementById(`step${step}`);
  if (currentStepElement) {
    currentStepElement.classList.remove('hidden');
  }
  
  // Update navigation buttons
  updateNavigationButtons();
}

// Update progress steps
function updateProgressSteps() {
    const progressSteps = document.querySelectorAll('.progress-step');
    const progressBar = document.getElementById('progressBar');

    progressSteps.forEach((step, index) => {
        const stepNumber = index + 1;
        if (stepNumber < currentStep) {
            step.classList.add('completed');
            step.classList.remove('active');
        } else if (stepNumber === currentStep) {
            step.classList.add('active');
            step.classList.remove('completed');
        } else {
            step.classList.remove('active', 'completed');
        }
    });

    const totalSteps = progressSteps.length;
    const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
    progressBar.style.width = `${progressPercentage}%`;
}

// Update navigation buttons
function updateNavigationButtons() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  
  if (prevBtn) {
    prevBtn.style.display = currentStep === 1 ? 'none' : 'block';
  }
  
  if (nextBtn && submitBtn) {
    if (currentStep === 4) {
      nextBtn.style.display = 'none';
      submitBtn.style.display = 'block';
    } else {
      nextBtn.style.display = 'block';
      submitBtn.style.display = 'none';
    }
  }
}

// Select service
function selectService(service) {
    selectedService = service;

    const serviceCards = document.querySelectorAll('.service-card');
    serviceCards.forEach(card => {
        card.classList.remove('border-blue-500', 'bg-blue-50');
        if (card.dataset.service === service) {
            card.classList.add('border-blue-500', 'bg-blue-50');
        }
    });

    if (service === 'Mudanza' || service === 'Transporte Comercial' || service === 'Paquetería' || service === 'Botes Mineros' || service === 'Grúas') {
        openServiceModal(service);
    }
}

// Select vehicle
function selectVehicle(vehicle) {
  selectedVehicle = vehicle;
  
  // Update UI
  const vehicleCards = document.querySelectorAll('.vehicle-card');
  vehicleCards.forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.vehicle === vehicle) {
      card.classList.add('selected');
    }
  });
  
  // Clear error if any
  hideError();
}

// Submit order
function submitOrder(event) {
  event.preventDefault();
  
  if (!validateCurrentStep()) return;
  
  // Collect form data
  const formData = new FormData(event.target);
  orderData = {
    id: generateOrderId(),
    service: selectedService,
    vehicle: selectedVehicle,
    pickup: document.getElementById('pickup')?.value || pickupLocation,
    delivery: document.getElementById('delivery')?.value || deliveryLocation,
    name: formData.get('name'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    date: formData.get('date'),
    time: formData.get('time'),
    notes: formData.get('notes') || '',
    status: 'pending',
    timestamp: new Date().toISOString(),
    serviceDetails: getServiceSpecificDetails()
  };
  
  // Save order
  saveOrder(orderData);
  
  // Show success message
  showSuccessScreen();
}

// Generate order ID
function generateOrderId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `TLC-${timestamp}-${random}`;
}

// Save order to localStorage
function saveOrder(order) {
  try {
    const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
    orders.push(order);
    localStorage.setItem('tlc_orders', JSON.stringify(orders));
    
    // Also try to save to Google Sheets if available
    if (typeof saveToGoogleSheets === 'function') {
      saveToGoogleSheets(order);
    }
    
    // Try to save to Supabase if available
    if (typeof supabaseConfig !== 'undefined') {
      supabaseConfig.saveOrder(order);
    }
  } catch (error) {
    console.error('Error saving order:', error);
  }
}

// Get service specific details
function getServiceSpecificDetails() {
  const serviceDetails = {};
  
  // Add service-specific form data based on selected service
  switch (selectedService) {
    case 'mudanza':
      serviceDetails.rooms = document.getElementById('rooms')?.value;
      serviceDetails.hasElevator = document.getElementById('hasElevator')?.checked;
      serviceDetails.packingService = document.getElementById('packingService')?.checked;
      break;
    case 'carga':
      serviceDetails.weight = document.getElementById('weight')?.value;
      serviceDetails.dimensions = document.getElementById('dimensions')?.value;
      serviceDetails.fragile = document.getElementById('fragile')?.checked;
      break;
    // Add more service types as needed
  }
  
  return serviceDetails;
}

// Show success screen
function showSuccessScreen() {
  const wizardScreen = document.getElementById('wizardScreen');
  const successScreen = document.getElementById('successScreen');
  
  if (wizardScreen) wizardScreen.classList.add('hidden');
  if (successScreen) {
    successScreen.classList.remove('hidden');
    
    // Update success screen with order details
    const orderIdElement = document.getElementById('orderId');
    if (orderIdElement) {
      orderIdElement.textContent = orderData.id;
    }
  }
}

// Show error message
function showError(message) {
  const errorElement = document.getElementById('errorMessage');
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
    
    // Hide after 5 seconds
    setTimeout(() => {
      hideError();
    }, 5000);
  }
}

// Hide error message
function hideError() {
  const errorElement = document.getElementById('errorMessage');
  if (errorElement) {
    errorElement.classList.add('hidden');
  }
}

// Reset wizard
function resetWizard() {
  currentStep = 1;
  selectedService = '';
  selectedVehicle = '';
  pickupLocation = '';
  deliveryLocation = '';
  orderData = {};
  
  // Clear form
  const orderForm = document.getElementById('orderForm');
  if (orderForm) {
    orderForm.reset();
  }
  
  // Clear selections
  document.querySelectorAll('.service-card, .vehicle-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  // Show welcome screen
  showWelcomeScreen();
}

// Service modal functions
function openServiceModal(serviceType) {
    const modal = document.getElementById('serviceModal');
    const title = document.getElementById('serviceModalTitle');
    const content = document.getElementById('serviceModalContent');

    if (modal && title && content) {
        title.textContent = `Detalles de ${serviceType}`;
        content.innerHTML = generateServiceModalContent(serviceType);
        modal.classList.remove('hidden');
    }
}

function generateServiceModalContent(serviceType) {
    let content = '';
    switch (serviceType) {
        case 'Carga Pesada':
            content = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de carga se va a transportar? (maquinaria, materiales de construcción, productos industriales, etc.)</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuál es el peso total aproximado de la carga?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuáles son las dimensiones aproximadas (largo, ancho y alto)?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Se necesita montacargas, grúa o brazo hidráulico para subir o bajar la carga?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿La carga requiere equipos especiales? (paletas, estibas, correas, cadenas, carretillas, etc.)</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿La empresa dispone de personal o montacargas en el punto de carga?</label><input type="text" class="form-input"></div>
                </div>
            `;
            break;
        case 'Paquetería':
            content = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de artículo desea enviar?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Es un solo paquete o varios bultos?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Los paquetes están debidamente empacados o sellados?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿El paquete debe ser transportado en vehículo cerrado o en moto?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Habrá alguien disponible para entregar y recibir el paquete en ambos puntos?</label><input type="text" class="form-input"></div>
                </div>
            `;
            break;
        case 'Fletes':
            content = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de carga desea transportar?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuál es el peso aproximado total?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuántas unidades o bultos son en total?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Requiere ayudantes para cargar o descargar la mercancía?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Se necesita montacargas, grúa, rampa o polea para subir o bajar la carga?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿La empresa dispone de personal o montacargas en el punto de carga?</label><input type="text" class="form-input"></div>
                </div>
            `;
            break;
        case 'Transporte Comercial':
            content = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de productos o mercancía desea transportar?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿La carga es propia de la empresa o de un cliente?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuántas unidades, cajas o paletas serán transportadas?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Cuál es el peso total aproximado?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Requiere ayudantes adicionales para carga y descarga?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿La empresa dispone de personal o montacargas en el punto de carga?</label><input type="text" class="form-input"></div>
                </div>
            `;
            break;
        case 'Mudanza':
            content = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de objetos necesita trasladar? (muebles, electrodomésticos, cajas, cama, estufa, lavadora, sillones, mesas, etc.)</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Hay objetos frágiles o de valor que necesiten un trato especial? Describa.</label><textarea class="form-input" rows="3"></textarea></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿En qué tipo de vivienda o local se encuentra actualmente? (casa, apartamento, oficina, etc.)</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿En qué piso se encuentra el punto de origen y el de destino?</label><input type="text" class="form-input"></div>
                    <div><label class="block text-sm font-medium text-gray-700">¿Hay ascensor o solo escaleras?</label><input type="text" class="form-input"></div>
                </div>
            `;
            break;
        case 'Grúas':
            content = `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">¿Qué tipo de servicio de grúa necesita?</label>
                        <select class="form-input" onchange="toggleGruaFields(this.value)">
                            <option value="">Seleccionar...</option>
                            <option value="vehiculo">Grúa de Vehículo</option>
                            <option value="carga">Grúa de Carga</option>
                        </select>
                    </div>
                    <div id="gruaVehiculoFields" class="hidden space-y-4">
                        <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de vehículo es? (carro, jeepeta, camioneta, camión, motor, etc.)</label><input type="text" class="form-input"></div>
                        <div><label class="block text-sm font-medium text-gray-700">¿Cuál es la marca, modelo y color del vehículo?</label><input type="text" class="form-input"></div>
                        <div><label class="block text-sm font-medium text-gray-700">¿El vehículo tiene tracción delantera, trasera o es 4x4?</label><input type="text" class="form-input"></div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">¿Qué tipo de servicio necesita?</label>
                            <select class="form-input">
                                <option value="">Seleccionar...</option>
                                <option value="averia">Remolque por avería</option>
                                <option value="accidente">Accidente de tránsito</option>
                                <option value="traslado">Traslado preventivo</option>
                                <option value="retiro_entrega">Retiro del taller o entrega a domicilio</option>
                            </select>
                        </div>
                    </div>
                    <div id="gruaCargaFields" class="hidden space-y-4">
                        <div><label class="block text-sm font-medium text-gray-700">¿Qué tipo de carga necesita mover o levantar? (contenedor, maquinaria, estructura metálica, generador, camión, etc.)</label><input type="text" class="form-input"></div>
                        <div><label class="block text-sm font-medium text-gray-700">¿Cuál es el peso aproximado de la carga?</label><input type="text" class="form-input"></div>
                        <div><label class="block text-sm font-medium text-gray-700">¿Cuenta con puntos de anclaje o enganche para izar la carga de forma segura?</label><input type="text" class="form-input"></div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">¿Qué tipo de maniobra se realizará?</label>
                            <select class="form-input">
                                <option value="">Seleccionar...</option>
                                <option value="izado">Izado vertical</option>
                                <option value="carga_transporte">Carga y transporte</option>
                                <option value="descarga_reubicacion">Descarga o reubicación en el mismo sitio</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;
            break;
        default:
            content = '<p>No hay detalles adicionales para este servicio.</p>';
            break;
    }
    return content;
}

function toggleGruaFields(value) {
    const vehiculoFields = document.getElementById('gruaVehiculoFields');
    const cargaFields = document.getElementById('gruaCargaFields');
    if (value === 'vehiculo') {
        vehiculoFields.classList.remove('hidden');
        cargaFields.classList.add('hidden');
    } else if (value === 'carga') {
        vehiculoFields.classList.add('hidden');
        cargaFields.classList.remove('hidden');
    } else {
        vehiculoFields.classList.add('hidden');
        cargaFields.classList.add('hidden');
    }
}

function closeServiceModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
  }
}

function saveServiceDetails(serviceType) {
  // Save service-specific details
  console.log('Saving details for service:', serviceType);
  
  // Close modal
  const modals = document.querySelectorAll('[id$="Modal"]');
  modals.forEach(modal => {
    modal.classList.add('hidden');
  });
}


// Export functions for global access
window.startWizard = startWizard;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.selectService = selectService;
window.selectVehicle = selectVehicle;
window.resetWizard = resetWizard;
window.openServiceModal = openServiceModal;
window.closeServiceModal = closeServiceModal;
window.saveServiceDetails = saveServiceDetails;
window.installApp = installApp;

// Supabase Configuration
if (typeof supabase !== 'undefined') {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
}