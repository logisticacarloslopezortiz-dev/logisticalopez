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
    financeSection: document.getElementById('financeSection'),
    sumCollabMonth: document.getElementById('sumCollabMonth'),
    sumCompanyMonth: document.getElementById('sumCompanyMonth'),
    sumFivePercent: document.getElementById('sumFivePercent'),
    collabFinanceTable: document.getElementById('collabFinanceTable'),
    detailCollabSelect: document.getElementById('detailCollabSelect'),
    collabDetailTable: document.getElementById('collabDetailTable'),
    exportFinancePdf: document.getElementById('exportFinancePdf'),
  };

  let chartInstance = null;
  let allOrders = [];
  let collaborators = [];
  let collabPercentMap = new Map();

  // 3. --- Funciones de Lógica de Negocio ---

  /**
   * Obtiene todas las órdenes completadas desde Supabase.
   */
  async function fetchCompletedOrders() {
    ui.loadingOverlay.classList.remove('hidden');
    try {
      const { data, error } = await supabaseConfig.client
        .from('orders')
        .select('id, completed_at, monto_cobrado, completed_by, assigned_to, service:services(name)')
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

  async function fetchCollaborators() {
    try {
      const { data, error } = await supabaseConfig.client
        .from('collaborators')
        .select('id, full_name, commission_percent, role');
      if (error) throw error;
      collaborators = Array.isArray(data) ? data : [];
      collabPercentMap = new Map();
      collaborators.forEach(c => {
        const pct = typeof c.commission_percent === 'number' ? c.commission_percent : (parseFloat(c.commission_percent) || 0);
        collabPercentMap.set(String(c.id), Math.max(0, Math.min(100, pct)));
      });
    } catch (e) {
      console.error('Error al obtener colaboradores:', e);
      collaborators = [];
      collabPercentMap = new Map();
    }
  }

  function isAdmin(session) {
    try {
      const roleLocal = localStorage.getItem('userRole');
      if (roleLocal && roleLocal.toLowerCase().includes('admin')) return true;
      const uid = session.user?.id;
      const me = collaborators.find(c => String(c.id) === String(uid));
      return me && String(me.role).toLowerCase().includes('admin');
    } catch (_) { return false; }
  }

  function currency(value) {
    return `$${Number(value || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function computeFinance(now = new Date()) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthOrders = allOrders.filter(o => o.completed_at >= monthStart);

    const fivePctMonth = monthOrders.reduce((s, o) => s + (o.monto_cobrado * 0.05), 0);

    const perCollab = new Map();
    collaborators.forEach(c => perCollab.set(String(c.id), { month: 0, total: 0, pct: collabPercentMap.get(String(c.id)) || 0 }));

    allOrders.forEach(o => {
      const collabId = String(o.completed_by || o.assigned_to || '');
      if (!collabId) return;
      const pct = collabPercentMap.get(collabId) || 0;
      const colShare = o.monto_cobrado * (pct / 100);
      const entry = perCollab.get(collabId) || { month: 0, total: 0, pct };
      entry.total += colShare;
      if (o.completed_at >= monthStart) entry.month += colShare;
      perCollab.set(collabId, entry);
    });

    const monthGross = monthOrders.reduce((s, o) => s + o.monto_cobrado, 0);
    const monthCollabSum = Array.from(perCollab.values()).reduce((s, v) => s + v.month, 0);
    const monthCompany = Math.max(0, monthGross - monthCollabSum);

    return { perCollab, monthCompany, fivePctMonth };
  }

  async function renderFinance(session) {
    const admin = isAdmin(session);
    if (!admin) {
      ui.financeSection.classList.add('hidden');
      return;
    }
    ui.financeSection.classList.remove('hidden');

    const { perCollab, monthCompany, fivePctMonth } = computeFinance();

    // Tabla porcentajes y totales
    ui.collabFinanceTable.innerHTML = '';
    let monthCollabSum = 0;
    const rows = collaborators.map(c => {
      const id = String(c.id);
      const stats = perCollab.get(id) || { month: 0, total: 0, pct: collabPercentMap.get(id) || 0 };
      monthCollabSum += stats.month;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="table-cell">${c.full_name || id}</td>
        <td class="table-cell">
          <input type="number" min="0" max="100" step="0.5" value="${stats.pct}" data-collab-id="${id}" class="w-24 border rounded px-2 py-1" />
        </td>
        <td class="table-cell">${currency(stats.month)}</td>
        <td class="table-cell">${currency(stats.total)}</td>
      `;
      ui.collabFinanceTable.appendChild(tr);
    });

    ui.sumCollabMonth.textContent = currency(monthCollabSum);
    ui.sumCompanyMonth.textContent = currency(monthCompany);
    ui.sumFivePercent.textContent = currency(fivePctMonth);

    // Listado para detalle
    ui.detailCollabSelect.innerHTML = '';
    collaborators.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.full_name || c.id;
      ui.detailCollabSelect.appendChild(opt);
    });
    const selId = ui.detailCollabSelect.value;
    renderCollabDetail(selId);

    // Handlers de edición de %
    ui.collabFinanceTable.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-collab-id');
        const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
        e.target.value = pct;
        try {
          const { error } = await supabaseConfig.client.from('collaborators').update({ commission_percent: pct }).eq('id', id);
          if (error) throw error;
          collabPercentMap.set(String(id), pct);
          await renderFinance(session);
          notifications.success('Comisión actualizada');
        } catch (err) {
          console.error('No se pudo actualizar la comisión:', err);
          notifications.error('Error al guardar el porcentaje');
        }
      });
    });
  }

  function renderCollabDetail(collabId) {
    ui.collabDetailTable.innerHTML = '';
    const pct = collabPercentMap.get(String(collabId)) || 0;
    const items = allOrders.filter(o => String(o.completed_by || o.assigned_to || '') === String(collabId));
    items.forEach(o => {
      const colShare = o.monto_cobrado * (pct / 100);
      const companyShare = Math.max(0, o.monto_cobrado - colShare);
      const fivePct = o.monto_cobrado * 0.05;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="table-cell">#${o.id}</td>
        <td class="table-cell">${o.service?.name || ''}</td>
        <td class="table-cell">${currency(o.monto_cobrado)}</td>
        <td class="table-cell">${pct}%</td>
        <td class="table-cell">${currency(colShare)}</td>
        <td class="table-cell">${currency(companyShare)}</td>
        <td class="table-cell">${currency(fivePct)}</td>
        <td class="table-cell">${o.completed_at.toLocaleString('es-ES')}</td>
      `;
      ui.collabDetailTable.appendChild(tr);
    });
  }

  function exportFinanceToPdf() {
    try {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) { notifications.error('jsPDF no disponible'); return; }
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      doc.setFontSize(12);
      doc.text('Finanzas y Pagos — Comisiones', 40, 40);
      doc.text(`Total Colaboradores (Mes): ${ui.sumCollabMonth.textContent}`, 40, 60);
      doc.text(`Total Empresa (Mes): ${ui.sumCompanyMonth.textContent}`, 40, 80);
      doc.text(`5% Mensual Acumulado: ${ui.sumFivePercent.textContent}`, 40, 100);
      let y = 130;
      doc.text('Porcentajes por Colaborador', 40, y);
      y += 20;
      collaborators.forEach(c => {
        const pct = collabPercentMap.get(String(c.id)) || 0;
        doc.text(`${c.full_name || c.id}: ${pct}%`, 40, y);
        y += 18;
        if (y > 760) { doc.addPage(); y = 40; }
      });
      doc.save(`finanzas_${new Date().toISOString().slice(0,10)}.pdf`);
      notifications.success('PDF generado');
    } catch (e) {
      console.error(e);
      notifications.error('No se pudo generar el PDF');
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
    await Promise.all([fetchCompletedOrders(), fetchCollaborators()]);
    updateStatCards();
    renderChart();
    await renderFinance(session);

    ui.filterPeriod.addEventListener('change', renderChart);
    ui.exportExcel.addEventListener('click', exportToExcel);
    if (ui.exportFinancePdf) ui.exportFinancePdf.addEventListener('click', exportFinanceToPdf);
    if (ui.detailCollabSelect) ui.detailCollabSelect.addEventListener('change', (e) => renderCollabDetail(e.target.value));

    // Suscripción a cambios en tiempo real
    supabaseConfig.client
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        console.log('Cambio detectado en órdenes, actualizando datos de ganancias...');
        initialize();
      })
      .subscribe();

    // Suscripción a cambios en colaboradores (para porcentajes)
    supabaseConfig.client
      .channel('public:collaborators')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'collaborators' }, async (payload) => {
        await fetchCollaborators();
        await renderFinance(session);
      })
      .subscribe();
  }

  initialize();
});