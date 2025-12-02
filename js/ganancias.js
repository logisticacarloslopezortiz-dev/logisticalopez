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
        .select('id, name, commission_percent, role');
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
      const uid = session.user?.id;
      const me = collaborators.find(c => String(c.id) === String(uid));
      return me && String(me.role).toLowerCase().includes('admin');
    } catch (_) { return false; }
  }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  function currency(value) {
    return `RD$ ${Number(value || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function monthStartOf(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function collabShare(order, pct) {
    return order.monto_cobrado * (pct / 100);
  }

  function computeFinance(now = new Date()) {
    const monthStart = monthStartOf(now);
    const monthOrders = allOrders.filter(o => o.completed_at >= monthStart);
    const fivePctMonth = monthOrders.reduce((s, o) => s + (o.monto_cobrado * 0.05), 0);

    const perCollab = new Map();
    collaborators.forEach(c => perCollab.set(String(c.id), { month: 0, total: 0, pct: collabPercentMap.get(String(c.id)) || 0 }));

    for (const o of allOrders) {
      const collabId = String(o.completed_by || o.assigned_to || '');
      if (!collabId) continue;
      const pct = collabPercentMap.get(collabId) || 0;
      const colShareVal = collabShare(o, pct);
      const entry = perCollab.get(collabId) || { month: 0, total: 0, pct };
      entry.total += colShareVal;
      if (o.completed_at >= monthStart) entry.month += colShareVal;
      perCollab.set(collabId, entry);
    }

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
    ui.collabFinanceTable.textContent = '';
    let monthCollabSum = 0;
    const frag = document.createDocumentFragment();
    collaborators.forEach(c => {
      const id = String(c.id);
      const stats = perCollab.get(id) || { month: 0, total: 0, pct: collabPercentMap.get(id) || 0 };
      monthCollabSum += stats.month;

      const tr = document.createElement('tr');
      tr.className = 'border-b hover:bg-gray-50';

      const tdName = document.createElement('td');
      tdName.className = 'table-cell';
      tdName.textContent = c.name || id;

      const tdPct = document.createElement('td');
      tdPct.className = 'table-cell';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.step = '0.5';
      input.value = String(stats.pct);
      input.setAttribute('data-collab-id', id);
      input.className = 'w-24 border rounded px-2 py-1';
      tdPct.appendChild(input);

      const tdMonth = document.createElement('td');
      tdMonth.className = 'table-cell';
      tdMonth.textContent = currency(stats.month);

      const tdTotal = document.createElement('td');
      tdTotal.className = 'table-cell';
      tdTotal.textContent = currency(stats.total);

      tr.appendChild(tdName);
      tr.appendChild(tdPct);
      tr.appendChild(tdMonth);
      tr.appendChild(tdTotal);
      frag.appendChild(tr);
    });
    ui.collabFinanceTable.appendChild(frag);

    ui.sumCollabMonth.textContent = currency(monthCollabSum);
    ui.sumCompanyMonth.textContent = currency(monthCompany);
    ui.sumFivePercent.textContent = currency(fivePctMonth);

    // Listado para detalle
    ui.detailCollabSelect.innerHTML = '';
    collaborators.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name || c.id;
      ui.detailCollabSelect.appendChild(opt);
    });
    const selId = ui.detailCollabSelect.value;
    renderCollabDetail(selId);

    // Handlers de edición de %
    const savePctDebounced = debounce(async (id, pct) => {
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
    }, 350);
    ui.collabFinanceTable.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-collab-id');
        const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
        e.target.value = pct;
        savePctDebounced(id, pct);
      });
    });
  }

  function renderCollabDetail(collabId) {
    ui.collabDetailTable.textContent = '';
    const pct = collabPercentMap.get(String(collabId)) || 0;
    const items = allOrders.filter(o => String(o.completed_by || o.assigned_to || '') === String(collabId));
    const fragDetail = document.createDocumentFragment();
    items.forEach(o => {
      const colShare = o.monto_cobrado * (pct / 100);
      const companyShare = Math.max(0, o.monto_cobrado - colShare);
      const fivePct = o.monto_cobrado * 0.05;
      const tr = document.createElement('tr');
      tr.className = 'border-b';

      const cells = [
        `#${o.id}`,
        o.service?.name || '',
        currency(o.monto_cobrado),
        `${pct}%`,
        currency(colShare),
        currency(companyShare),
        currency(fivePct),
        o.completed_at.toLocaleString('es-DO')
      ];
      cells.forEach(text => {
        const td = document.createElement('td');
        td.className = 'table-cell';
        td.textContent = text;
        tr.appendChild(td);
      });
      fragDetail.appendChild(tr);
    });
    ui.collabDetailTable.appendChild(fragDetail);
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
        doc.text(`${c.name || c.id}: ${pct}%`, 40, y);
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

    const formatCurrency = (value) => `RD$ ${Number(value||0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

    function monthsDiff(a, b) {
      return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
    }

    allOrders.forEach(order => {
      const d = new Date(order.completed_at);
      let key;

      if (period === 'day') {
        if (now.getTime() - d.getTime() > 30 * 24 * 60 * 60 * 1000) return;
        key = d.toLocaleDateString('es-DO', { year: '2-digit', month: '2-digit', day: '2-digit' });
      } else if (period === 'week') {
        if (now.getTime() - d.getTime() > 12 * 7 * 24 * 60 * 60 * 1000) return;
        const dow = d.getDay(); // 0=Dom
        const start = new Date(d);
        start.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); // Lunes como inicio
        start.setHours(0,0,0,0);
        key = `Semana del ${start.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}`;
      } else { // month
        if (monthsDiff(now, d) > 12) return;
        key = d.toLocaleDateString('es-DO', { year: 'numeric', month: 'long' });
      }

      dataMap.set(key, (dataMap.get(key) || 0) + order.monto_cobrado);
    });

    const sortedEntries = Array.from(dataMap.entries());
    return {
      labels: sortedEntries.map(([label]) => label),
      data: sortedEntries.map(([,value]) => value),
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
                return 'RD$ ' + Number(value||0).toLocaleString('es-DO');
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
                return ' Ganancias: RD$ ' + Number(context.raw || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
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

  let realtimeSetup = false;
  async function refreshUI() {
    await fetchCompletedOrders();
    updateStatCards();
    renderChart();
    await renderFinance(session);
  }

  async function initialize() {
    await Promise.all([fetchCompletedOrders(), fetchCollaborators()]);
    updateStatCards();
    renderChart();
    await renderFinance(session);

    ui.filterPeriod.addEventListener('change', renderChart);
    ui.exportExcel.addEventListener('click', exportToExcel);
    if (ui.exportFinancePdf) ui.exportFinancePdf.addEventListener('click', exportFinanceToPdf);
    if (ui.detailCollabSelect) ui.detailCollabSelect.addEventListener('change', (e) => renderCollabDetail(e.target.value));

    if (!realtimeSetup) {
      realtimeSetup = true;
      const ordersChannel = supabaseConfig.client
        .channel('public:orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
          console.log('Cambio en órdenes → refrescando métricas');
          await refreshUI();
        })
        .subscribe();

      const collabChannel = supabaseConfig.client
        .channel('public:collaborators')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collaborators' }, async () => {
          await fetchCollaborators();
          await renderFinance(session);
        })
        .subscribe();
      // Guardar referencias si luego se requiere cerrar
      window.__tlc_ordersChannel = ordersChannel;
      window.__tlc_collabChannel = collabChannel;
    }
  }

  initialize();
  });
