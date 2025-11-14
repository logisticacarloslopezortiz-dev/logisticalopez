document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // 1. --- Verificación de Sesión ---
  if (!window.supabaseConfig || !supabaseConfig.client) {
    console.error('Cliente de Supabase no inicializado.');
    window.location.href = 'login.html';
    return;
  }
  const { data: { session }, error: sessionError } = await supabaseConfig.client.auth.getSession();
  if (sessionError || !session) {
    console.warn('Sesión no encontrada, redirigiendo al login.');
    window.location.href = 'login.html';
    return;
  }

  // 2. --- Referencias a Elementos del DOM ---
  const ui = {
    totalEarnings: document.getElementById('totalEarnings'),
    todayEarnings: document.getElementById('todayEarnings'),
    monthEarnings: document.getElementById('monthEarnings'),
    avgOrderValue: document.getElementById('avgOrderValue'),
    filterPeriod: document.getElementById('filterPeriod'),
    exportExcel: document.getElementById('exportExcel'),
    chartCanvas: document.getElementById('gananciaChart'),
    loadingOverlay: document.getElementById('loadingOverlay'),
  };

  let chartInstance = null;
  let allOrders = [];

  // 3. --- Funciones de Lógica de Negocio ---

  /**
   * Obtiene todas las órdenes completadas desde Supabase.
   */
  async function fetchCompletedOrders() {
    ui.loadingOverlay.classList.remove('hidden');
    try {
      const { data, error } = await supabaseConfig.client
        .from('orders')
        .select('id, completed_at, monto_cobrado')
        .in('status', ['Completada', 'entregado']) // Considerar ambos estados
        .not('monto_cobrado', 'is', null)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      
      allOrders = data.map(order => ({
        ...order,
        monto_cobrado: parseFloat(order.monto_cobrado) || 0,
        completed_at: new Date(order.completed_at)
      })).filter(order => order.monto_cobrado > 0 && !isNaN(order.completed_at.getTime()));

    } catch (error) {
      console.error('Error al obtener las órdenes:', error);
      notifications.error('No se pudieron cargar los datos de ganancias.');
    } finally {
      ui.loadingOverlay.classList.add('hidden');
    }
  }

  /**
   * Calcula y muestra las métricas principales en las tarjetas.
   */
  function updateStatCards() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalEarnings = allOrders.reduce((sum, order) => sum + order.monto_cobrado, 0);
    const todayEarnings = allOrders
      .filter(order => order.completed_at >= todayStart)
      .reduce((sum, order) => sum + order.monto_cobrado, 0);
    const monthEarnings = allOrders
      .filter(order => order.completed_at >= monthStart)
      .reduce((sum, order) => sum + order.monto_cobrado, 0);
    const avgOrderValue = allOrders.length > 0 ? totalEarnings / allOrders.length : 0;

    const formatCurrency = (value) => `$${value.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    ui.totalEarnings.textContent = formatCurrency(totalEarnings);
    ui.todayEarnings.textContent = formatCurrency(todayEarnings);
    ui.monthEarnings.textContent = formatCurrency(monthEarnings);
    ui.avgOrderValue.textContent = formatCurrency(avgOrderValue);
  }

  /**
   * Procesa los datos para el gráfico según el período seleccionado.
   */
  function processChartData(period) {
    const dataMap = new Map();
    const now = new Date();

    allOrders.forEach(order => {
      let key;
      const date = order.completed_at;

      if (period === 'day') {
        // Últimos 30 días
        if (now - date > 30 * 24 * 60 * 60 * 1000) return;
        key = date.toLocaleDateString('es-ES', { year: '2-digit', month: '2-digit', day: '2-digit' });
      } else if (period === 'week') {
        // Últimas 12 semanas
        if (now - date > 12 * 7 * 24 * 60 * 60 * 1000) return;
        const startOfWeek = new Date(date.setDate(date.getDate() - date.getDay()));
        key = `Semana del ${startOfWeek.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`;
      } else { // month
        // Últimos 12 meses
        if (now.getFullYear() - date.getFullYear() > 1 && now.getMonth() > date.getMonth()) return;
        key = date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });
      }

      dataMap.set(key, (dataMap.get(key) || 0) + order.monto_cobrado);
    });

    const sortedEntries = Array.from(dataMap.entries()).reverse();
    return {
      labels: sortedEntries.map(entry => entry[0]),
      data: sortedEntries.map(entry => entry[1]),
    };
  }

  /**
   * Renderiza o actualiza el gráfico de ganancias.
   */
  function renderChart() {
    const period = ui.filterPeriod.value;
    const { labels, data } = processChartData(period);

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ui.chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Ganancias',
          data: data,
          borderColor: 'rgba(30, 138, 149, 1)', // --color-primario-turquesa
          backgroundColor: 'rgba(30, 138, 149, 0.1)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: 'rgba(30, 138, 149, 1)',
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value.toLocaleString('es-DO');
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` Ganancias: $${context.raw.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Exporta los datos actuales del gráfico a un archivo Excel.
   */
  function exportToExcel() {
    const period = ui.filterPeriod.value;
    const { labels, data } = processChartData(period);

    const worksheetData = [
      ['Período', 'Ganancias'],
      ...labels.map((label, index) => [label, data[index]])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ganancias');

    // Formatear columnas
    worksheet['!cols'] = [{ wch: 25 }, { wch: 15 }];
    
    XLSX.writeFile(workbook, `Reporte_Ganancias_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notifications.success('Reporte de Excel generado.');
  }

  // 4. --- Inicialización y Event Listeners ---

  async function initialize() {
    await fetchCompletedOrders();
    updateStatCards();
    renderChart();

    ui.filterPeriod.addEventListener('change', renderChart);
    ui.exportExcel.addEventListener('click', exportToExcel);

    // Suscripción a cambios en tiempo real
    supabaseConfig.client
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        console.log('Cambio detectado en órdenes, actualizando datos de ganancias...');
        // Recargar todo para mantener la simplicidad
        initialize();
      })
      .subscribe();
  }

  initialize();
});