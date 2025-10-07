// Inicializar iconos de Lucide
lucide.createIcons();

// --- Datos iniciales ---
let servicesData = JSON.parse(localStorage.getItem('servicesData')) || {
  'Lavado completo': 15,
  'Lavado básico': 25,
  'Encerado': 8,
  'Aspirado': 12,
  'Detallado': 5
};

let vehiclesData = JSON.parse(localStorage.getItem('vehiclesData')) || {
  'Sedán': 20,
  'SUV': 15,
  'Camioneta': 12,
  'Hatchback': 18,
  'Motocicleta': 8
};

const serviceList = document.getElementById('serviceList');
const vehicleList = document.getElementById('vehicleList');

// --- Funciones utilitarias ---
function loadOrders() {
  return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
}

function saveData() {
  localStorage.setItem('servicesData', JSON.stringify(servicesData));
  localStorage.setItem('vehiclesData', JSON.stringify(vehiclesData));
}

// --- Actualizar estadísticas desde pedidos reales ---
function updateStatsFromOrders() {
  const orders = loadOrders();
  const serviceStats = {};
  const vehicleStats = {};
  
  orders.forEach(order => {
    serviceStats[order.service] = (serviceStats[order.service] || 0) + 1;
    vehicleStats[order.vehicle] = (vehicleStats[order.vehicle] || 0) + 1;
  });
  
  // Actualizar datos con estadísticas reales
  Object.keys(serviceStats).forEach(service => {
    servicesData[service] = serviceStats[service];
  });
  
  Object.keys(vehicleStats).forEach(vehicle => {
    vehiclesData[vehicle] = vehicleStats[vehicle];
  });
  
  saveData();
}

// --- Render ---
function renderServices() {
  serviceList.innerHTML = '';
  Object.keys(servicesData).forEach(service => {
    const li = document.createElement('li');
    li.className = "bg-gradient-to-r from-red-50 to-red-100 p-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 flex justify-between items-center border-l-4 border-red-500";
    li.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center text-white font-bold">
          ${servicesData[service]}
        </div>
        <span class="font-medium text-gray-800">${service}</span>
      </div>
      <div class="flex gap-2">
        <button class="editServiceBtn bg-yellow-500 text-white px-3 py-2 rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-1">
          <i data-lucide="edit" class="w-4 h-4"></i>
          <span class="hidden sm:inline">Editar</span>
        </button>
        <button class="deleteServiceBtn bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
          <span class="hidden sm:inline">Eliminar</span>
        </button>
      </div>
    `;
    
    li.querySelector('.editServiceBtn').onclick = () => {
      const newName = prompt('Editar servicio:', service);
      if(newName && newName.trim() && newName !== service) {
        servicesData[newName.trim()] = servicesData[service];
        delete servicesData[service];
        renderServices();
        updateCharts();
        saveData();
        lucide.createIcons();
      }
    };
    
    li.querySelector('.deleteServiceBtn').onclick = () => {
      if(confirm(`¿Estás seguro de eliminar el servicio "${service}"?`)) {
        delete servicesData[service];
        renderServices();
        updateCharts();
        saveData();
      }
    };
    
    serviceList.appendChild(li);
  });
  lucide.createIcons();
}

function renderVehicles() {
  vehicleList.innerHTML = '';
  Object.keys(vehiclesData).forEach(vehicle => {
    const li = document.createElement('li');
    li.className = "bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 flex justify-between items-center border-l-4 border-blue-500";
    li.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
          ${vehiclesData[vehicle]}
        </div>
        <span class="font-medium text-gray-800">${vehicle}</span>
      </div>
      <div class="flex gap-2">
        <button class="editVehicleBtn bg-yellow-500 text-white px-3 py-2 rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-1">
          <i data-lucide="edit" class="w-4 h-4"></i>
          <span class="hidden sm:inline">Editar</span>
        </button>
        <button class="deleteVehicleBtn bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
          <span class="hidden sm:inline">Eliminar</span>
        </button>
      </div>
    `;
    
    li.querySelector('.editVehicleBtn').onclick = () => {
      const newName = prompt('Editar vehículo:', vehicle);
      if(newName && newName.trim() && newName !== vehicle) {
        vehiclesData[newName.trim()] = vehiclesData[vehicle];
        delete vehiclesData[vehicle];
        renderVehicles();
        updateCharts();
        saveData();
        lucide.createIcons();
      }
    };
    
    li.querySelector('.deleteVehicleBtn').onclick = () => {
      if(confirm(`¿Estás seguro de eliminar el vehículo "${vehicle}"?`)) {
        delete vehiclesData[vehicle];
        renderVehicles();
        updateCharts();
        saveData();
      }
    };
    
    vehicleList.appendChild(li);
  });
  lucide.createIcons();
}

// --- Agregar nuevos elementos ---
document.getElementById('addServiceBtn').addEventListener('click', () => {
  const name = document.getElementById('newService').value.trim();
  if(name && !servicesData[name]) {
    servicesData[name] = 0;
    document.getElementById('newService').value = '';
    renderServices();
    updateCharts();
    saveData();
  } else if(servicesData[name]) {
    alert('Este servicio ya existe');
  }
});

document.getElementById('addVehicleBtn').addEventListener('click', () => {
  const name = document.getElementById('newVehicle').value.trim();
  if(name && !vehiclesData[name]) {
    vehiclesData[name] = 0;
    document.getElementById('newVehicle').value = '';
    renderVehicles();
    updateCharts();
    saveData();
  } else if(vehiclesData[name]) {
    alert('Este vehículo ya existe');
  }
});

// Permitir agregar con Enter
document.getElementById('newService').addEventListener('keypress', (e) => {
  if(e.key === 'Enter') {
    document.getElementById('addServiceBtn').click();
  }
});

document.getElementById('newVehicle').addEventListener('keypress', (e) => {
  if(e.key === 'Enter') {
    document.getElementById('addVehicleBtn').click();
  }
});

// --- Charts ---
const serviceCtx = document.getElementById('serviceChart').getContext('2d');
const vehicleCtx = document.getElementById('vehicleChart').getContext('2d');

const serviceChart = new Chart(serviceCtx, {
  type: 'bar',
  data: {
    labels: Object.keys(servicesData),
    datasets: [{
      label: 'Pedidos',
      data: Object.values(servicesData),
      backgroundColor: 'rgba(220, 38, 38, 0.8)',
      borderColor: 'rgba(220, 38, 38, 1)',
      borderWidth: 2,
      borderRadius: 8,
      borderSkipped: false
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(220, 38, 38, 1)',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        },
        ticks: {
          color: '#374151'
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: '#374151',
          maxRotation: 45
        }
      }
    },
    animation: {
      duration: 1000,
      easing: 'easeInOutQuart'
    }
  }
});

const vehicleChart = new Chart(vehicleCtx, {
  type: 'doughnut',
  data: {
    labels: Object.keys(vehiclesData),
    datasets: [{
      data: Object.values(vehiclesData),
      backgroundColor: [
        '#dc2626', '#f59e0b', '#2563eb', '#10b981', 
        '#8b5cf6', '#f472b6', '#14b8a6', '#f97316'
      ],
      borderWidth: 3,
      borderColor: '#ffffff',
      hoverBorderWidth: 4
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true,
          color: '#374151'
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(220, 38, 38, 1)',
        borderWidth: 1
      }
    },
    animation: {
      duration: 1000,
      easing: 'easeInOutQuart'
    }
  }
});

function updateCharts() {
  serviceChart.data.labels = Object.keys(servicesData);
  serviceChart.data.datasets[0].data = Object.values(servicesData);
  serviceChart.update('active');

  vehicleChart.data.labels = Object.keys(vehiclesData);
  vehicleChart.data.datasets[0].data = Object.values(vehiclesData);
  vehicleChart.update('active');
}

// --- Actualizar resumen de estadísticas ---
function updateSummary() {
  const totalServices = Object.values(servicesData).reduce((sum, val) => sum + val, 0);
  const totalVehicles = Object.values(vehiclesData).reduce((sum, val) => sum + val, 0);
  const mostRequestedService = Object.keys(servicesData).reduce((a, b) => servicesData[a] > servicesData[b] ? a : b, '');
  const mostUsedVehicle = Object.keys(vehiclesData).reduce((a, b) => vehiclesData[a] > vehiclesData[b] ? a : b, '');
  
  document.getElementById('totalServices').textContent = totalServices;
  document.getElementById('totalVehicles').textContent = totalVehicles;
  document.getElementById('mostRequestedService').textContent = mostRequestedService || 'N/A';
  document.getElementById('mostUsedVehicle').textContent = mostUsedVehicle || 'N/A';
}

// --- Inicialización ---
function init() {
  updateStatsFromOrders();
  renderServices();
  renderVehicles();
  updateCharts();
  updateSummary();
}

// --- Actualización automática ---
setInterval(() => {
  updateStatsFromOrders();
  updateCharts();
  updateSummary();
}, 30000); // Actualizar cada 30 segundos

// Inicializar la aplicación
init();