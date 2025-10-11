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
  // Start button
  const startButton = document.getElementById('startButton');
  if (startButton) {
    startButton.addEventListener('click', startWizard);
  }
  
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
  const wizardScreen = document.getElementById('wizardScreen');
  
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  if (wizardScreen) wizardScreen.classList.remove('hidden');
  
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
  for (let i = 1; i <= 4; i++) {
    const progressStep = document.querySelector(`[data-step="${i}"]`);
    if (progressStep) {
      progressStep.classList.remove('active', 'completed');
      
      if (i < currentStep) {
        progressStep.classList.add('completed');
      } else if (i === currentStep) {
        progressStep.classList.add('active');
      }
    }
  }
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
  
  // Update UI
  const serviceCards = document.querySelectorAll('.service-card');
  serviceCards.forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.service === service) {
      card.classList.add('selected');
    }
  });
  
  // Clear error if any
  hideError();
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
function openServiceModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
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

// PWA Installation functions
async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    
    // Hide install buttons after installation attempt
    const installButtons = document.querySelectorAll('#installAppWelcome, .install-app-btn, #installAppFooter');
    installButtons.forEach(btn => {
      if (btn && outcome === 'accepted') btn.style.display = 'none';
    });
  } else {
    // Fallback for iOS or when prompt is not available
    const userAgent = navigator.userAgent.toLowerCase();
    let instructions = '';
    
    if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
      instructions = 'Para instalar en iOS:\n1. Toca el botón "Compartir" (⬆️)\n2. Selecciona "Agregar a pantalla de inicio"\n3. Confirma la instalación';
    } else if (userAgent.includes('android')) {
      instructions = 'Para instalar en Android:\n1. Abre el menú del navegador (⋮)\n2. Selecciona "Instalar app" o "Agregar a pantalla de inicio"\n3. Confirma la instalación';
    } else {
      instructions = 'Para instalar la app:\n\niOS: Toca "Compartir" → "Agregar a pantalla de inicio"\nAndroid: Menú del navegador → "Instalar app"';
    }
    
    alert(instructions);
  }
}

// PWA variables
let deferredPrompt;

// PWA Installation
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Show install buttons
  const installButtons = document.querySelectorAll('#installAppWelcome, .install-app-btn, #installAppFooter');
  installButtons.forEach(btn => {
    if (btn) btn.style.display = 'flex';
  });
});

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
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