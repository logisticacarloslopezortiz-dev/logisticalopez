// Inicializar iconos de Lucide
lucide.createIcons();

// Datos de ejemplo de ganancias
let gananciasData = {
  day: {
    'Lunes': 200,
    'Martes': 450,
    'Miércoles': 300,
    'Jueves': 500,
    'Viernes': 700,
    'Sábado': 650,
    'Domingo': 400
  },
  week: {
    'Semana 1': 2800,
    'Semana 2': 3200,
    'Semana 3': 2900,
    'Semana 4': 3500
  },
  month: {
    'Enero': 12000,
    'Febrero': 14500,
    'Marzo': 13200,
    'Abril': 15800,
    'Mayo': 16200,
    'Junio': 14900
  }
};

// Variables globales
let gananciaChart;
let currentPeriod = 'day';

// Función para cargar órdenes desde localStorage
function loadOrders() {
  return JSON.parse(localStorage.getItem('orders')) || [];
}

// Función para calcular ganancias reales desde las órdenes
function calculateRealEarnings() {
  const orders = loadOrders();
  const today = new Date();
  const realEarnings = {
    day: {},
    week: {},
    month: {}
  };

  // Inicializar días de la semana
  const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  daysOfWeek.forEach(day => realEarnings.day[day] = 0);

  // Inicializar últimas 4 semanas
  for (let i = 1; i <= 4; i++) {
    realEarnings.week[`Semana ${i}`] = 0;
  }

  // Inicializar últimos 6 meses
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  for (let i = 0; i < 6; i++) {
    const monthIndex = (today.getMonth() - i + 12) % 12;
    realEarnings.month[months[monthIndex]] = 0;
  }

  // Procesar órdenes completadas
  orders.filter(order => order.status === 'completado').forEach(order => {
    const orderDate = new Date(order.fecha);
    const dayName = daysOfWeek[orderDate.getDay()];
    const monthName = months[orderDate.getMonth()];
    const price = parseFloat(order.precio) || 0;

    // Ganancias por día
    if (realEarnings.day[dayName] !== undefined) {
      realEarnings.day[dayName] += price;
    }

    // Ganancias por mes
    if (realEarnings.month[monthName] !== undefined) {
      realEarnings.month[monthName] += price;
    }
  });

  return realEarnings;
}

// Función para actualizar el resumen de ganancias
function updateSummary() {
  const orders = loadOrders();
  const completedOrders = orders.filter(order => order.status === 'completado');
  
  const totalEarnings = completedOrders.reduce((sum, order) => sum + (parseFloat(order.precio) || 0), 0);
  const todayEarnings = completedOrders
    .filter(order => {
      const orderDate = new Date(order.fecha);
      const today = new Date();
      return orderDate.toDateString() === today.toDateString();
    })
    .reduce((sum, order) => sum + (parseFloat(order.precio) || 0), 0);

  const thisMonthEarnings = completedOrders
    .filter(order => {
      const orderDate = new Date(order.fecha);
      const today = new Date();
      return orderDate.getMonth() === today.getMonth() && orderDate.getFullYear() === today.getFullYear();
    })
    .reduce((sum, order) => sum + (parseFloat(order.precio) || 0), 0);

  const avgOrderValue = completedOrders.length > 0 ? totalEarnings / completedOrders.length : 0;

  // Actualizar elementos del DOM
  document.getElementById('totalEarnings').textContent = `$${totalEarnings.toFixed(2)}`;
  document.getElementById('todayEarnings').textContent = `$${todayEarnings.toFixed(2)}`;
  document.getElementById('monthEarnings').textContent = `$${thisMonthEarnings.toFixed(2)}`;
  document.getElementById('avgOrderValue').textContent = `$${avgOrderValue.toFixed(2)}`;
}

// Función para inicializar el gráfico
function initChart() {
  const ctx = document.getElementById('gananciaChart').getContext('2d');
  const realEarnings = calculateRealEarnings();
  const currentData = realEarnings[currentPeriod];

  gananciaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Object.keys(currentData),
      datasets: [{
        label: 'Ingresos en USD',
        data: Object.values(currentData),
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        borderColor: 'rgba(220, 38, 38, 1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'rgba(220, 38, 38, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            font: {
              size: 14,
              weight: 'bold'
            },
            color: '#374151'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(220, 38, 38, 1)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return `Ingresos: $${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: {
              size: 12,
              weight: 'bold'
            },
            color: '#6B7280'
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            font: {
              size: 12
            },
            color: '#6B7280',
            callback: function(value) {
              return '$' + value.toFixed(0);
            }
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });
}

// Función para actualizar el gráfico
function updateChart() {
  const realEarnings = calculateRealEarnings();
  const currentData = realEarnings[currentPeriod];
  
  gananciaChart.data.labels = Object.keys(currentData);
  gananciaChart.data.datasets[0].data = Object.values(currentData);
  gananciaChart.update('active');
}

// Función para exportar a Excel
function exportToExcel() {
  const realEarnings = calculateRealEarnings();
  const currentData = realEarnings[currentPeriod];
  const orders = loadOrders();
  
  // Crear hoja de ganancias por período
  const earningsData = Object.entries(currentData).map(([periodo, ingreso]) => ({
    Período: periodo,
    Ingreso: `$${ingreso.toFixed(2)}`
  }));
  
  // Crear hoja de órdenes completadas
  const completedOrders = orders
    .filter(order => order.status === 'completado')
    .map(order => ({
      ID: order.id,
      Fecha: order.fecha,
      Cliente: order.cliente,
      Servicio: order.servicio,
      Vehículo: order.vehiculo,
      Precio: `$${parseFloat(order.precio || 0).toFixed(2)}`,
      Estado: order.status
    }));
  
  // Crear libro de Excel
  const wb = XLSX.utils.book_new();
  
  // Agregar hoja de ganancias
  const wsEarnings = XLSX.utils.json_to_sheet(earningsData);
  XLSX.utils.book_append_sheet(wb, wsEarnings, `Ganancias_${currentPeriod}`);
  
  // Agregar hoja de órdenes
  const wsOrders = XLSX.utils.json_to_sheet(completedOrders);
  XLSX.utils.book_append_sheet(wb, wsOrders, 'Ordenes_Completadas');
  
  // Descargar archivo
  const fileName = `reporte_ganancias_${currentPeriod}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// Event listeners
document.getElementById('filterPeriod').addEventListener('change', (e) => {
  currentPeriod = e.target.value;
  updateChart();
  updateSummary();
});

document.getElementById('exportExcel').addEventListener('click', exportToExcel);

// Función de inicialización
function init() {
  updateSummary();
  initChart();
}

// Actualización automática cada 30 segundos
setInterval(() => {
  updateSummary();
  updateChart();
}, 30000);

// Inicializar cuando se carga la página
init();