// Inicializar iconos de Lucide
lucide.createIcons();

const businessForm = document.getElementById('businessForm');
const quotationForm = document.getElementById('quotationForm');
const logoPreview = document.getElementById('logoPreview');

// Cargar datos del negocio guardados
function loadBusinessData() {
  const data = JSON.parse(localStorage.getItem('businessData') || '{}');
  if(data.name) document.getElementById('businessName').value = data.name;
  if(data.address) document.getElementById('businessAddress').value = data.address;
  if(data.phone) document.getElementById('businessPhone').value = data.phone;
  if(data.email) document.getElementById('businessEmail').value = data.email;
  if(data.logo) { 
    document.getElementById('businessLogo').value = data.logo; 
    logoPreview.src = data.logo; 
  }
}

// Cargar configuración de cotización guardada
function loadQuotationConfig() {
  const config = JSON.parse(localStorage.getItem('quotationConfig') || '{}');
  
  // Tarifa base
  if(config.baseRate) document.getElementById('baseRate').value = config.baseRate;
  
  // Multiplicadores por vehículo
  if(config.vehicleRates) {
    if(config.vehicleRates.smallTruck) document.getElementById('smallTruckRate').value = config.vehicleRates.smallTruck;
    if(config.vehicleRates.pickup) document.getElementById('pickupRate').value = config.vehicleRates.pickup;
    if(config.vehicleRates.van) document.getElementById('vanRate').value = config.vehicleRates.van;
    if(config.vehicleRates.largeTruck) document.getElementById('largeTruckRate').value = config.vehicleRates.largeTruck;
  }
  
  // Multiplicadores por peso
  if(config.weightRates) {
    if(config.weightRates.light) document.getElementById('lightWeightRate').value = config.weightRates.light;
    if(config.weightRates.medium) document.getElementById('mediumWeightRate').value = config.weightRates.medium;
    if(config.weightRates.heavy) document.getElementById('heavyWeightRate').value = config.weightRates.heavy;
    if(config.weightRates.veryHeavy) document.getElementById('veryHeavyWeightRate').value = config.weightRates.veryHeavy;
  }
  
  // Tarifas adicionales
  if(config.additionalRates) {
    if(config.additionalRates.waiting) document.getElementById('waitingRate').value = config.additionalRates.waiting;
    if(config.additionalRates.urgent) document.getElementById('urgentRate').value = config.additionalRates.urgent;
  }
}

// Calcular cotización
function calculateQuotation(distance, vehicleType, weight, waitingHours = 0, isUrgent = false) {
  const config = JSON.parse(localStorage.getItem('quotationConfig') || '{}');
  let total = 0;
  
  // Tarifa base por distancia
  total = distance * (config.baseRate || 0);
  
  // Multiplicador por tipo de vehículo
  if(config.vehicleRates) {
    const vehicleRate = config.vehicleRates[vehicleType] || 1;
    total *= vehicleRate;
  }
  
  // Multiplicador por peso
  if(config.weightRates) {
    let weightRate = 1;
    if(weight <= 100) weightRate = config.weightRates.light || 1;
    else if(weight <= 500) weightRate = config.weightRates.medium || 1.3;
    else if(weight <= 1000) weightRate = config.weightRates.heavy || 1.6;
    else weightRate = config.weightRates.veryHeavy || 2;
    
    total *= weightRate;
  }
  
  // Tarifas adicionales
  if(config.additionalRates) {
    // Tiempo de espera
    if(waitingHours > 0) {
      total += waitingHours * (config.additionalRates.waiting || 0);
    }
    
    // Servicio urgente
    if(isUrgent) {
      total *= (config.additionalRates.urgent || 1);
    }
  }
  
  return Math.round(total * 100) / 100; // Redondear a 2 decimales
}

// Cargar datos al iniciar
window.onload = () => {
  loadBusinessData();
  loadQuotationConfig();
}

// Guardar datos del negocio
businessForm.addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    name: document.getElementById('businessName').value,
    address: document.getElementById('businessAddress').value,
    phone: document.getElementById('businessPhone').value,
    email: document.getElementById('businessEmail').value,
    logo: document.getElementById('businessLogo').value
  };
  localStorage.setItem('businessData', JSON.stringify(data));
  alert('Datos del negocio guardados correctamente.');
  logoPreview.src = data.logo;
});

// Guardar configuración de cotización
quotationForm.addEventListener('submit', e => {
  e.preventDefault();
  const config = {
    baseRate: parseFloat(document.getElementById('baseRate').value) || 0,
    vehicleRates: {
      smallTruck: parseFloat(document.getElementById('smallTruckRate').value) || 1,
      pickup: parseFloat(document.getElementById('pickupRate').value) || 1.2,
      van: parseFloat(document.getElementById('vanRate').value) || 1.3,
      largeTruck: parseFloat(document.getElementById('largeTruckRate').value) || 1.5
    },
    weightRates: {
      light: parseFloat(document.getElementById('lightWeightRate').value) || 1,
      medium: parseFloat(document.getElementById('mediumWeightRate').value) || 1.3,
      heavy: parseFloat(document.getElementById('heavyWeightRate').value) || 1.6,
      veryHeavy: parseFloat(document.getElementById('veryHeavyWeightRate').value) || 2
    },
    additionalRates: {
      waiting: parseFloat(document.getElementById('waitingRate').value) || 0,
      urgent: parseFloat(document.getElementById('urgentRate').value) || 1.5
    }
  };
  localStorage.setItem('quotationConfig', JSON.stringify(config));
  alert('Configuración de cotización guardada correctamente.');
});