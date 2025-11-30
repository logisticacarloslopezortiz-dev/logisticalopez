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
    // Elementos del nuevo reporte
    earningsReportForm: document.getElementById('earningsReportForm'),
    startDateInput: document.getElementById('startDate'),
    endDateInput: document.getElementById('endDate'),
    reportTableBody: document.getElementById('reportTableBody'),
    reportTableFooter: document.getElementById('reportTableFooter'),
    reportLoading: document.getElementById('reportLoading'),
  };

  let chartInstance = null;
  let allOrders = [];

  const formatCurrency = (value) => `$${(typeof value === 'number' ? value : 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 3. --- Funciones de Lógica de Negocio ---

  async function fetchCompletedOrders() {
    ui.loadingOverlay.classList.remove('hidden');
    try {
      const { data, error } = await supabaseConfig.client
        .from('orders')
        .select('id, completed_at, monto_cobrado')
        .eq('status', 'Completada')
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
    } finally {
      ui.loadingOverlay.classList.add('hidden');
    }
  }

  function updateStatCards() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalEarnings = allOrders.reduce((sum, order) => sum + order.monto_cobrado, 0);
    const todayEarnings = allOrders.filter(o => o.completed_at >= todayStart).reduce((sum, o) => sum + o.monto_cobrado, 0);
    const monthEarnings = allOrders.filter(o => o.completed_at >= monthStart).reduce((sum, o) => sum + o.monto_cobrado, 0);
    const avgOrderValue = allOrders.length > 0 ? totalEarnings / allOrders.length : 0;

    ui.totalEarnings.textContent = formatCurrency(totalEarnings);
    ui.todayEarnings.textContent = formatCurrency(todayEarnings);
    ui.monthEarnings.textContent = formatCurrency(monthEarnings);
    ui.avgOrderValue.textContent = formatCurrency(avgOrderValue);
  }

  function processChartData(period) {
    const dataMap = new Map();
    const now = new Date();
    allOrders.forEach(order => {
      let key;
      const date = order.completed_at;
      if (period === 'day') {
        if (now - date > 30 * 24 * 60 * 60 * 1000) return;
        key = date.toLocaleDateString('es-ES', { year: '2-digit', month: '2-digit', day: '2-digit' });
      } else if (period === 'week') {
        if (now - date > 12 * 7 * 24 * 60 * 60 * 1000) return;
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        key = `Semana del ${startOfWeek.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`;
      } else {
        if (now.getFullYear() - date.getFullYear() > 1 && now.getMonth() > date.getMonth()) return;
        key = date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });
      }
      dataMap.set(key, (dataMap.get(key) || 0) + order.monto_cobrado);
    });
    const sortedEntries = Array.from(dataMap.entries()).sort((a,b) => new Date(a[0]) - new Date(b[0]));
    return {
      labels: sortedEntries.map(entry => entry[0]),
      data: sortedEntries.map(entry => entry[1]),
    };
  }

  function renderChart() {
    const period = ui.filterPeriod.value;
    const { labels, data } = processChartData(period);
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ui.chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Ganancias', data: data, borderColor: 'rgba(30, 138, 149, 1)',
          backgroundColor: 'rgba(30, 138, 149, 0.1)', fill: true, tension: 0.3,
          pointBackgroundColor: 'rgba(30, 138, 149, 1)', pointRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: value => `$${value.toLocaleString('es-DO')}` } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Ganancias: ${formatCurrency(ctx.raw)}` } } }
      }
    });
  }

  function exportToExcel() {
    const period = ui.filterPeriod.value;
    const { labels, data } = processChartData(period);
    const worksheetData = [['Período', 'Ganancias'], ...labels.map((label, index) => [label, data[index]])];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ganancias');
    worksheet['!cols'] = [{ wch: 25 }, { wch: 15 }];
    XLSX.writeFile(workbook, `Reporte_Ganancias_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // --- NUEVAS FUNCIONES PARA REPORTE DE COLABORADORES ---

  /**
   * Maneja el envío del formulario de reporte de ganancias.
   */
  async function handleReportGeneration(event) {
    event.preventDefault();
    const startDate = ui.startDateInput.value;
    const endDate = ui.endDateInput.value;

    if (!startDate || !endDate) {
      alert('Por favor, seleccione una fecha de inicio y una fecha de fin.');
      return;
    }

    ui.reportTableBody.innerHTML = '';
    ui.reportTableFooter.innerHTML = '';
    ui.reportLoading.classList.remove('hidden');

    try {
      const { data: reportData, error } = await supabaseConfig.client.rpc('get_collaborator_earnings_report', {
        start_date: startDate,
        end_date: endDate
      });

      if (error) throw error;

      renderReportTable(reportData);

    } catch (error) {
      console.error('Error al generar el reporte de colaboradores:', error);
      ui.reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Error al cargar el reporte: ${error.message}</td></tr>`;
    } finally {
      ui.reportLoading.classList.add('hidden');
    }
  }

  /**
   * Renderiza la tabla con los datos del reporte de ganancias.
   */
  function renderReportTable(data) {
    if (!data || data.length === 0) {
      ui.reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-500">No se encontraron servicios completados en el período seleccionado.</td></tr>`;
      return;
    }

    ui.reportTableBody.innerHTML = data.map(row => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 font-medium text-gray-900">${row.collaborator_name}</td>
        <td class="px-6 py-4 text-center">${row.service_count}</td>
        <td class="px-6 py-4 text-right">${formatCurrency(row.total_collected)}</td>
        <td class="px-6 py-4 text-right text-green-600 font-semibold">${formatCurrency(row.collaborator_commission)}</td>
        <td class="px-6 py-4 text-right text-blue-600 font-semibold">${formatCurrency(row.partner_fee)}</td>
      </tr>
    `).join('');

    // Calcular y renderizar el pie de la tabla con los totales
    const totals = data.reduce((acc, row) => ({
        total_collected: acc.total_collected + parseFloat(row.total_collected || 0),
        collaborator_commission: acc.collaborator_commission + parseFloat(row.collaborator_commission || 0),
        partner_fee: acc.partner_fee + parseFloat(row.partner_fee || 0),
    }), { total_collected: 0, collaborator_commission: 0, partner_fee: 0 });

    ui.reportTableFooter.innerHTML = `
      <tr>
        <td class="px-6 py-4 text-lg" colspan="2">Totales</td>
        <td class="px-6 py-4 text-right text-lg">${formatCurrency(totals.total_collected)}</td>
        <td class="px-6 py-4 text-right text-lg text-green-700">${formatCurrency(totals.collaborator_commission)}</td>
        <td class="px-6 py-4 text-right text-lg text-blue-700">${formatCurrency(totals.partner_fee)}</td>
      </tr>
    `;
  }

  // 4. --- Inicialización y Event Listeners ---

  async function initialize() {
    await fetchCompletedOrders();
    updateStatCards();
    renderChart();

    ui.filterPeriod.addEventListener('change', renderChart);
    ui.exportExcel.addEventListener('click', exportToExcel);
    ui.earningsReportForm.addEventListener('submit', handleReportGeneration);

    // Suscripción a cambios en tiempo real
    supabaseConfig.client
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        console.log('Cambio detectado en órdenes, actualizando datos de ganancias...');
        initialize();
      })
      .subscribe();
  }

  initialize();
});