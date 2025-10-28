// Variables globales
let gananciaChart;
let currentPeriod = 'day';
let allCompletedOrders = []; // Almacenará las órdenes completadas de Supabase

/**
 * Parsea un string de precio (ej. "$1,500.00") a un número.
 * @param {string} priceString - El precio como texto.
 * @returns {number} - El precio como número.
 */
function parsePrice(priceString) {
    if (typeof priceString !== 'string') return 0;
    return parseFloat(priceString.replace(/[^0-9.-]+/g, "")) || 0;
}

/**
 * Carga las órdenes completadas desde Supabase y actualiza la UI.
 */
async function loadAndProcessOrders() {
    try {
        const { data, error } = await supabaseConfig.client
            .from('orders')
            .select('id, completed_at, estimated_price, service:services(name), vehicle:vehicles(name), completed:profiles!orders_completed_by_fkey(full_name)')
            .eq('status', 'Completado')
            .not('completed_at', 'is', null);

        if (error) throw error;

        allCompletedOrders = data || [];
        updateSummaryCards();
        updateChart();

    } catch (error) {
        console.error("Error al cargar las ganancias:", error);
        document.getElementById('totalEarnings').textContent = 'Error';
    }
}

/**
 * Actualiza las tarjetas de resumen con las ganancias.
 */
function updateSummaryCards() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalEarnings = 0;
    let todayEarnings = 0;
    let monthEarnings = 0;

    allCompletedOrders.forEach(order => {
        const price = parsePrice(order.estimated_price);
        totalEarnings += price;

        const completedDate = new Date(order.completed_at);
        if (order.completed_at.startsWith(todayStr)) {
            todayEarnings += price;
        }
        if (completedDate.getMonth() === currentMonth && completedDate.getFullYear() === currentYear) {
            monthEarnings += price;
        }
    });

    const avgOrderValue = allCompletedOrders.length > 0 ? totalEarnings / allCompletedOrders.length : 0;

    document.getElementById('totalEarnings').textContent = `$${totalEarnings.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
    document.getElementById('todayEarnings').textContent = `$${todayEarnings.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
    document.getElementById('monthEarnings').textContent = `$${monthEarnings.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
    document.getElementById('avgOrderValue').textContent = `$${avgOrderValue.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
}

/**
 * Agrupa las ganancias por el período seleccionado (día, semana, mes).
 * @returns {object} - Objeto con etiquetas (labels) y datos (data) para el gráfico.
 */
function getChartData() {
    const data = {};
    const now = new Date();

    allCompletedOrders.forEach(order => {
        const date = new Date(order.completed_at);
        const price = parsePrice(order.estimated_price);
        let key;

        if (currentPeriod === 'day') {
            key = date.toLocaleDateString('es-DO', { weekday: 'short' });
        } else if (currentPeriod === 'week') {
            const weekNumber = Math.ceil(date.getDate() / 7);
            key = `Semana ${weekNumber}`;
        } else { // month
            key = date.toLocaleDateString('es-DO', { month: 'long' });
        }

        if (!data[key]) {
            data[key] = 0;
        }
        data[key] += price;
    });

    // Ordenar las etiquetas para una mejor visualización
    const sortedLabels = Object.keys(data).sort((a, b) => {
        if (currentPeriod === 'day') {
            const days = ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.'];
            return days.indexOf(a) - days.indexOf(b);
        }
        // Para semana y mes, la clasificación alfabética/numérica suele ser suficiente.
        return a.localeCompare(b, undefined, { numeric: true });
    });

    const sortedData = sortedLabels.map(label => data[label]);

    return { labels: sortedLabels, data: sortedData };
}

/**
 * Inicializa o actualiza el gráfico de ganancias.
 */
function updateChart() {
  const chartData = getChartData();
  const ctx = document.getElementById('gananciaChart').getContext('2d');

  if (gananciaChart) {
    gananciaChart.data.labels = chartData.labels;
    gananciaChart.data.datasets[0].data = chartData.data;
    gananciaChart.update();
    return;
  }

  gananciaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: 'Ingresos',
        data: chartData.data,
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'rgba(34, 197, 94, 1)',
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
          labels: { // Corregido: 'labels' en plural
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
          borderColor: 'rgba(34, 197, 94, 1)',
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
              return '$' + value.toLocaleString('es-DO');
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

/**
 * Exporta los datos de ganancias y órdenes completadas a un archivo Excel.
 */
function exportToExcel() {
    if (allCompletedOrders.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }

    // Formatear datos para la hoja de Excel
    const dataToExport = allCompletedOrders.map(order => ({
        'ID Orden': order.id,
        'Fecha Completado': new Date(order.completed_at).toLocaleString('es-DO'),
        'Servicio': order.service?.name || 'N/A',
        'Vehículo': order.vehicle?.name || 'N/A',
        'Completado por': order.completed?.full_name || 'N/A',
        'Precio': parsePrice(order.estimated_price)
    }));

    // Crear la hoja de cálculo
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);

    // Formatear la columna de precio como moneda
    worksheet['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }];
    dataToExport.forEach((_, index) => {
        const cellRef = XLSX.utils.encode_cell({ r: index + 1, c: 5 }); // Columna F (Precio)
        if (worksheet[cellRef]) {
            worksheet[cellRef].z = '$#,##0.00';
        }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ganancias');

    // Descargar el archivo
    XLSX.writeFile(workbook, `Reporte_Ganancias_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Event listeners
document.getElementById('filterPeriod').addEventListener('change', (e) => {
  currentPeriod = e.target.value;
  updateChart();
});

document.getElementById('exportExcel').addEventListener('click', exportToExcel);

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    let loaded = false;
    function safeLoad() {
      if (loaded) return;
      loaded = true;
      loadAndProcessOrders();
    }
    // Esperar a la sesión admin lista
    window.addEventListener('admin-session-ready', () => {
      safeLoad();
    });
    // Fallback: si la sesión ya existe
    supabaseConfig.client.auth.getSession().then(({ data: { session } }) => {
      if (session && localStorage.getItem('userRole') === 'administrador') {
        safeLoad();
      }
    }).catch(() => {});
});