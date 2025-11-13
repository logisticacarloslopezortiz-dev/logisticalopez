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
          .select('id, completed_at, monto_cobrado, service:services(name), vehicle:vehicles(name), completed:profiles!orders_completed_by_fkey(full_name)')
          .eq('status', 'Completada')
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
        const price = order.monto_cobrado || 0;
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
    const buckets = new Map();

    allCompletedOrders.forEach(order => {
      const d = new Date(order.completed_at);
      const val = Number(order.monto_cobrado) || 0;
      let key;
      if (currentPeriod === 'day') {
        key = d.toISOString().slice(0,10); // YYYY-MM-DD
      } else if (currentPeriod === 'week') {
        const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = tmp.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day; // lunes como inicio de semana
        const monday = new Date(tmp);
        monday.setUTCDate(tmp.getUTCDate() + diff);
        key = monday.toISOString().slice(0,10);
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; // YYYY-MM
      }
      buckets.set(key, (buckets.get(key) || 0) + val);
    });

    // Ordenar claves cronológicamente
    const labels = Array.from(buckets.keys()).sort((a,b) => a.localeCompare(b));
    const data = labels.map(k => buckets.get(k));

    // Humanizar etiquetas
    const humanLabels = labels.map(k => {
      if (currentPeriod === 'day') {
        const d = new Date(k);
        return d.toLocaleDateString('es-DO', { day:'2-digit', month:'short' });
      } else if (currentPeriod === 'week') {
        const d = new Date(k);
        const end = new Date(d);
        end.setDate(d.getDate()+6);
        return `${d.toLocaleDateString('es-DO',{ day:'2-digit', month:'short' })} - ${end.toLocaleDateString('es-DO',{ day:'2-digit', month:'short' })}`;
      } else {
        const [y,m] = k.split('-');
        return `${new Date(Number(y), Number(m)-1, 1).toLocaleDateString('es-DO',{ month:'long' })} ${y}`;
      }
    });

    return { labels: humanLabels, data };
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
        backgroundColor: 'rgba(30, 138, 149, 0.1)', // Turquesa con opacidad
        borderColor: '#1E8A95', // Turquesa sólido
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#FBBF24', // Amarillo para los puntos
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointHoverBackgroundColor: '#FBBF24',
        pointHoverBorderColor: '#fff'
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
        'Precio': order.monto_cobrado || 0
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
      setupRealtime();
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

function setupRealtime() {
  const channel = supabaseConfig.client.channel('ganancias:orders');
  let t;
  const scheduleRefresh = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      loadAndProcessOrders();
    }, 300);
  };
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh).subscribe();
}
