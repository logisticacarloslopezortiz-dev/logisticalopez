// Funciones de navegación del wizard
let currentStep = 1;
const totalSteps = 5;

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function() {
  console.log('Inicializando aplicación...');
  
  // Inicializar iconos
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
    console.log('Iconos inicializados correctamente');
  } else {
    console.warn('Lucide no está disponible');
  }
  
  // Inicializar componentes
  try {
    initializeNavigation();
    initializeRNCHandling();
    updateProgressBar();
    console.log('Aplicación inicializada correctamente');
  } catch (error) {
    console.error('Error durante la inicialización:', error);
    // Continuar con funcionalidad básica a pesar de errores
  }
});

// Inicializar navegación
function initializeNavigation() {
  console.log('Inicializando navegación...');
  
  // Elementos de navegación
  const prevButton = document.getElementById('prevButton');
  const nextButton = document.getElementById('nextButton');
  const backToWelcome = document.querySelector('header button#backToWelcome');
  const startButton = document.getElementById('startButton');
  
  // Pantallas principales
  const welcomeScreen = document.getElementById('welcomeScreen');
  const wizardApp = document.getElementById('wizardApp');
  
  // Configurar botón de inicio
  if (startButton) {
    startButton.addEventListener('click', function() {
      welcomeScreen.classList.add('hidden');
      wizardApp.classList.remove('hidden');
    });
  }
  
  // Configurar botón de regreso
  if (backToWelcome) {
    backToWelcome.addEventListener('click', function() {
      wizardApp.classList.add('hidden');
      welcomeScreen.classList.remove('hidden');
    });
  }
  
  // Configurar botones de navegación
  if (prevButton) {
    prevButton.addEventListener('click', previousStep);
  }
  
  if (nextButton) {
    nextButton.addEventListener('click', nextStep);
  }
  
  console.log('Navegación inicializada correctamente');
  return true;
}

// Función para ir al paso anterior
function previousStep() {
  if (currentStep > 1) {
    currentStep--;
    updateUI();
  }
}

// Función para ir al paso siguiente
function nextStep() {
  if (currentStep < totalSteps) {
    currentStep++;
    updateUI();
  }
}

// Alias para compatibilidad con código existente
function showPreviousStep() {
  previousStep();
}

function showNextStep() {
  nextStep();
}

// Actualizar interfaz según el paso actual
function updateUI() {
  // Ocultar todos los pasos
  document.querySelectorAll('.wizard-step').forEach(step => {
    step.classList.add('hidden');
  });
  
  // Mostrar paso actual
  const currentStepElement = document.getElementById(`step${currentStep}`);
  if (currentStepElement) {
    currentStepElement.classList.remove('hidden');
  } else {
    console.warn(`Elemento para el paso ${currentStep} no encontrado`);
  }
  
  // Actualizar botones
  const prevButton = document.getElementById('prevButton');
  if (prevButton) {
    if (currentStep > 1) {
      prevButton.classList.remove('hidden');
    } else {
      prevButton.classList.add('hidden');
    }
  }
  
  // Actualizar barra de progreso
  updateProgressBar();
}

// Actualizar barra de progreso
function updateProgressBar() {
  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
    progressBar.style.width = `${progressPercentage}%`;
  }
  
  // Actualizar indicadores de paso
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    const stepNumber = index + 1;
    
    if (stepNumber < currentStep) {
      step.classList.remove('active');
      step.classList.add('completed');
      step.classList.remove('bg-gray-200', 'text-gray-500');
      step.classList.add('bg-green-500', 'text-white');
    } else if (stepNumber === currentStep) {
      step.classList.add('active');
      step.classList.remove('completed');
      step.classList.remove('bg-gray-200', 'text-gray-500');
      step.classList.add('bg-blue-600', 'text-white');
    } else {
      step.classList.remove('active');
      step.classList.remove('completed');
      step.classList.remove('bg-green-500', 'bg-blue-600', 'text-white');
      step.classList.add('bg-gray-200', 'text-gray-500');
    }
  });
}

// Inicializar manejo de RNC
function initializeRNCHandling() {
  console.log('Inicializando manejo de RNC...');
  
  // Verificar si los elementos existen
  const rncYesRadio = document.getElementById('rncYesRadio');
  const rncInfo = document.getElementById('rncInfo');
  const rncForm = document.getElementById('rncForm');
  const editRNCInfo = document.getElementById('editRNCInfo');
  const saveRNCButton = document.getElementById('saveRNCButton');
  
  // Si no se encuentran los elementos, no bloquear la inicialización
  if (!rncYesRadio || !rncInfo) {
    console.warn('Elementos de UI para RNC no encontrados');
    return true;
  }
  
  // Configurar radio buttons
  document.querySelectorAll('input[name="needsRNC"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.value === 'yes' && rncInfo) {
        rncInfo.classList.remove('hidden');
      } else if (rncInfo) {
        rncInfo.classList.add('hidden');
      }
    });
  });
  
  // Configurar botón de editar
  if (editRNCInfo && rncForm) {
    editRNCInfo.addEventListener('click', function() {
      rncInfo.classList.add('hidden');
      rncForm.classList.remove('hidden');
    });
  }
  
  // Configurar botón de guardar
  if (saveRNCButton) {
    saveRNCButton.addEventListener('click', handleSaveRNCData);
  }
  
  console.log('Manejo de RNC inicializado correctamente');
  return true;
}

// Manejar guardado de datos RNC
function handleSaveRNCData() {
  const companyName = document.getElementById('companyName')?.value;
  const rncNumber = document.getElementById('rncNumber')?.value;
  
  if (!companyName || !rncNumber) {
    alert('Por favor complete todos los campos requeridos');
    return;
  }
  
  // Guardar datos
  const rncData = {
    companyName,
    rncNumber
  };
  
  // Almacenar en localStorage
  localStorage.setItem('rncData', JSON.stringify(rncData));
  
  // Actualizar UI
  const rncInfo = document.getElementById('rncInfo');
  const rncForm = document.getElementById('rncForm');
  
  if (rncInfo && rncForm) {
    rncForm.classList.add('hidden');
    rncInfo.classList.remove('hidden');
  }
}

// Alias para compatibilidad con código existente
function saveRNCData() {
  handleSaveRNCData();
}

// Función de utilidad para escapar HTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}