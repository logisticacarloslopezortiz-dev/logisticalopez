/**
 * js/ganancias.js — Módulo de Finanzas y Pagos
 * Gestiona el cálculo de comisiones, visualización de métricas y registro de pagos.
 */

'use strict';

// --- Utilidades Globales ---

/**
 * Formatea un número como moneda RD$.
 */
function currency(value) {
  return `RD$ ${Number(value || 0).toLocaleString('es-DO', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

/**
 * Retorna el nombre del mes dado su número (1-12).
 */
function getMonthName(m) {
  const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return names[m - 1] || '';
}

// --- Funciones Globales (Expuestas al window para botones dinámicos y HTML) ---

window.openPaymentModal = function(id, name, suggested) {
  const modal = document.getElementById('paymentModal');
  if (!modal) return;
  
  const idEl = document.getElementById('payCollabId');
  const nameEl = document.getElementById('payCollabName');
  const amountEl = document.getElementById('payAmount');
  const suggestedEl = document.getElementById('paySuggestedAmount');
  const monthEl = document.getElementById('payMonth');
  const yearEl = document.getElementById('payYear');

  if (idEl) idEl.value = id;
  if (nameEl) nameEl.value = name;
  if (amountEl) amountEl.value = Number(suggested || 0).toFixed(2);
  if (suggestedEl) suggestedEl.textContent = currency(suggested);
  
  const now = new Date();
  if (monthEl) monthEl.value = now.getMonth() + 1;
  if (yearEl) yearEl.value = now.getFullYear();
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => {
    const content = document.getElementById('paymentModalContent');
    if (content) {
      content.classList.remove('scale-95', 'opacity-0');
      content.classList.add('scale-100', 'opacity-100');
    }
  }, 10);
  if (window.lucide) lucide.createIcons();
};

window.closePaymentModal = function() {
  const modal = document.getElementById('paymentModal');
  if (!modal) return;
  const content = document.getElementById('paymentModalContent');
  if (content) {
    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');
  }
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 300);
};

window.generateReceiptPDF = function(p) {
  try {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      console.error('jsPDF no disponible');
      if (window.notifications) notifications.error('jsPDF no disponible para generar recibo');
      return;
    }
    const doc = new jsPDF();
    
    // Estilos
    doc.setFillColor(12, 55, 93); // Azul corporativo (#0C375D)
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text('RECIBO DE PAGO DE COMISIONES', 105, 25, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('LOGÍSTICA LÓPEZ ORTIZ', 20, 55);
    doc.setFont(undefined, 'normal');
    doc.text('Servicios de Transporte y Logística', 20, 62);
    
    doc.line(20, 70, 190, 70);
    
    // Datos del recibo
    let y = 85;
    const drawField = (label, value) => {
      doc.setFont(undefined, 'bold');
      doc.text(`${label}:`, 20, y);
      doc.setFont(undefined, 'normal');
      doc.text(String(value), 70, y);
      y += 10;
    };
    
    drawField('N° Recibo', `#PAY-${p.id}`);
    drawField('Fecha de Emisión', new Date(p.created_at).toLocaleString('es-DO'));
    drawField('Colaborador', p.profiles?.full_name || 'Desconocido');
    drawField('Período Correspondiente', `${getMonthName(p.payment_month)} ${p.payment_year}`);
    drawField('Método de Pago', p.payment_method);
    
    y += 5;
    doc.setFillColor(245, 245, 245);
    doc.rect(20, y, 170, 20, 'F');
    y += 13;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('MONTO PAGADO:', 25, y);
    doc.setTextColor(22, 101, 52); // Verde oscuro
    doc.text(currency(p.amount), 185, y, { align: 'right' });
    
    y += 20;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text('NOTAS:', 20, y);
    doc.setFont(undefined, 'normal');
    doc.text(p.notes || 'Sin notas adicionales', 20, y + 7, { maxWidth: 170 });
    
    y += 40;
    doc.line(40, y, 90, y);
    doc.line(120, y, 170, y);
    doc.text('Firma Administrador', 65, y + 5, { align: 'center' });
    doc.text('Firma Colaborador', 145, y + 5, { align: 'center' });
    
    doc.save(`recibo_${p.id}_${p.payment_month}_${p.payment_year}.pdf`);
  } catch (e) {
    console.error(e);
    if (window.notifications) notifications.error('Error al generar el recibo PDF');
  }
};

document.addEventListener('DOMContentLoaded', async () => {
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
    paymentHistoryTable: document.getElementById('paymentHistoryTable'),
    paymentModal: document.getElementById('paymentModal'),
    paymentForm: document.getElementById('paymentForm')
  };

  let chartInstance = null;
  let allOrders = [];
  let collaborators = [];
  let collabPercentMap = new Map();
  let paymentHistory = [];

  /**
   * Obtiene todas las órdenes completadas desde Supabase.
   */
  async function fetchCompletedOrders() {
    ui.loadingOverlay.classList.remove('hidden');
    try {
      const raw = localStorage.getItem('tlc_earnings_orders_cache');
      if (raw) {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached)) {
          allOrders = cached.map(o => ({
            ...o,
            monto_cobrado: parseFloat(o.monto_cobrado) || 0,
            completed_at: new Date(o.completed_at)
          })).filter(order => order.monto_cobrado > 0 && !isNaN(order.completed_at.getTime()));
          ui.loadingOverlay.classList.add('hidden');
        }
      }
    } catch (_) {}
    try {
      const COMPLETED = ['completed'];
      let data = null; let error = null;
      try {
        const resp = await supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
          .from('orders')
          .select('id, status, completed_at, monto_cobrado, completed_by, assigned_to, service:services(name)')
          .in('status', COMPLETED)
          .not('monto_cobrado', 'is', null)
          .order('completed_at', { ascending: false })
        ) || await supabaseConfig.client
          .from('orders')
          .select('id, status, completed_at, monto_cobrado, completed_by, assigned_to, service:services(name)')
          .in('status', COMPLETED)
          .not('monto_cobrado', 'is', null)
          .order('completed_at', { ascending: false });
        data = resp.data; error = resp.error || null;
      } catch (e) { error = e; }

      // Fallback si el cliente no soporta Query Builder completo
      if (error && /is not a function/i.test(String(error.message||''))) {
        try {
          const { data: fallback } = await supabaseConfig.client
            .from('orders')
            .select('id, status, completed_at, monto_cobrado, completed_by, assigned_to, service:services(name)');
          data = (fallback || []).filter(o => COMPLETED.includes(String(o.status||'').toLowerCase()))
            .filter(o => o.monto_cobrado != null)
            .sort((a,b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());
          error = null;
        } catch (_) {}
      }

      if (error && (String(error.message||'').toLowerCase().includes('jwt expired') || error.status === 401 || error.code === 'PGRST303')) {
        try {
          const pub = supabaseConfig.getPublicClient?.() || supabaseConfig.client;
          const resp2 = await pub
            .from('orders')
            .select('id, status, completed_at, monto_cobrado, completed_by, assigned_to, service:services(name)')
            .in('status', COMPLETED)
            .not('monto_cobrado', 'is', null)
            .order('completed_at', { ascending: false });
          data = resp2.data; error = resp2.error || null;
        } catch (_) {}
      }

      if (error) throw error;
      
      allOrders = (data || []).map(order => ({
        ...order,
        monto_cobrado: parseFloat(order.monto_cobrado) || 0,
        completed_at: new Date(order.completed_at)
      })).filter(order => order.monto_cobrado > 0 && !isNaN(order.completed_at.getTime()));
      try {
        const toStore = (data || []).map(order => ({
          id: order.id,
          status: order.status,
          completed_at: order.completed_at,
          monto_cobrado: order.monto_cobrado,
          completed_by: order.completed_by,
          assigned_to: order.assigned_to,
          service: order.service
        }));
        localStorage.setItem('tlc_earnings_orders_cache', JSON.stringify(toStore));
      } catch (_) {}

    } catch (error) {
      console.error('Error al obtener las órdenes:', error);
      notifications.error('No se pudieron cargar los datos de ganancias.');
    } finally {
      ui.loadingOverlay.classList.add('hidden');
    }
  }

  async function fetchCollaborators() {
    try {
      const resp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
        .from('collaborators')
        .select('id, name, commission_percent, role, status')
      ) || supabaseConfig.client
        .from('collaborators')
        .select('id, name, commission_percent, role, status'));
      const { data, error } = resp;
      if (error) throw error;
      collaborators = Array.isArray(data) ? data : [];
      collabPercentMap = new Map();
      collaborators.forEach(c => {
        // Clamped a [0, 100] para prevenir valores inválidos desde el DB o UI
        const pct = Math.max(0, Math.min(100, Number(c.commission_percent) || 0));
        collabPercentMap.set(String(c.id), pct);
      });
      await fetchPaymentHistory();
    } catch (e) {
      console.error('Error al obtener colaboradores:', e);
      collaborators = [];
      collabPercentMap = new Map();
    }
  }

  async function fetchPaymentHistory() {
    try {
      const { data, error } = await supabaseConfig.client
        .from('collaborator_payments')
        .select('*, profiles!collaborator_id(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      paymentHistory = data || [];
      renderPaymentHistory();
    } catch (e) {
      console.error('Error al obtener historial de pagos:', e);
    }
  }

  function renderPaymentHistory() {
    if (!ui.paymentHistoryTable) return;
    if (paymentHistory.length === 0) {
      ui.paymentHistoryTable.innerHTML = '<tr><td colspan="6" class="px-4 py-4 text-center text-gray-400">No hay pagos registrados aún.</td></tr>';
      return;
    }

    ui.paymentHistoryTable.innerHTML = paymentHistory.map(p => `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">${new Date(p.created_at).toLocaleDateString('es-DO')}</td>
        <td class="px-4 py-3 font-medium">${p.profiles?.full_name || 'Desconocido'}</td>
        <td class="px-4 py-3">${getMonthName(p.payment_month)} ${p.payment_year}</td>
        <td class="px-4 py-3 font-bold text-green-700">${currency(p.amount)}</td>
        <td class="px-4 py-3 text-xs text-gray-600">${p.payment_method}</td>
        <td class="px-4 py-3">
          <button onclick="window.generateReceiptPDF(${JSON.stringify(p).replace(/"/g, '&quot;')})" class="text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <i data-lucide="file-text" class="w-4 h-4"></i> Recibo
          </button>
        </td>
      </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
  }

  function isAdmin(session) {
    try {
      const uid = session?.user?.id;
      const me = collaborators.find(c => String(c.id) === String(uid));
      return me && ['admin', 'administrador', 'superadmin'].includes(String(me.role).toLowerCase().trim());
    } catch (_) { return false; }
  }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
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
      tdTotal.className = 'table-cell font-bold';
      tdTotal.textContent = currency(stats.total);

      const tdActions = document.createElement('td');
      tdActions.className = 'table-cell';
      const payBtn = document.createElement('button');
      payBtn.className = 'bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition-colors flex items-center gap-1';
      payBtn.innerHTML = '<i data-lucide="hand-coins" class="w-3 h-3"></i> Pagar';
      payBtn.onclick = () => window.openPaymentModal(id, c.name || id, stats.month);
      tdActions.appendChild(payBtn);

      tr.appendChild(tdName);
      tr.appendChild(tdPct);
      tr.appendChild(tdMonth);
      tr.appendChild(tdTotal);
      tr.appendChild(tdActions);
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
        const { error } = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client.from('collaborators').update({ commission_percent: pct }).eq('id', id))
          || supabaseConfig.client.from('collaborators').update({ commission_percent: pct }).eq('id', id));
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
    // isSameDay: compara solo la parte de fecha, sin importar hora ni timezone
    const isSameDay = (d) => {
      if (!d || isNaN(d.getTime())) return false;
      return d.getFullYear() === now.getFullYear() &&
             d.getMonth()    === now.getMonth()    &&
             d.getDate()     === now.getDate();
    };
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalEarnings = allOrders.reduce((sum, o) => sum + o.monto_cobrado, 0);
    const todayEarnings = allOrders
      .filter(o => isSameDay(o.completed_at))
      .reduce((sum, o) => sum + o.monto_cobrado, 0);
    const monthEarnings = allOrders
      .filter(o => o.completed_at >= monthStart)
      .reduce((sum, o) => sum + o.monto_cobrado, 0);
    const avgOrderValue = totalEarnings > 0 && allOrders.length > 0
      ? totalEarnings / allOrders.length : 0;

    const fmt = (v) => `RD$ ${Number(v||0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    ui.totalEarnings.textContent = fmt(totalEarnings);
    ui.todayEarnings.textContent = fmt(todayEarnings);
    ui.monthEarnings.textContent = fmt(monthEarnings);
    ui.avgOrderValue.textContent = fmt(avgOrderValue);
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
    // Cargar desde caché para UI inmediata (si hay datos previos)
    try {
      const raw = localStorage.getItem('tlc_earnings_orders_cache');
      if (raw) {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached)) {
          allOrders = cached.map(o => ({
            ...o,
            monto_cobrado: parseFloat(o.monto_cobrado) || 0,
            completed_at: new Date(o.completed_at)
          })).filter(o => o.monto_cobrado > 0 && !isNaN(o.completed_at.getTime()));
          updateStatCards();
          renderChart();
        }
      }
    } catch (_) {}

    // Fetch fresh data
    await Promise.all([fetchCompletedOrders(), fetchCollaborators()]);
    updateStatCards();
    renderChart();
    await renderFinance(session);

    ui.filterPeriod.addEventListener('change', renderChart);
    ui.exportExcel.addEventListener('click', exportToExcel);
    if (ui.exportFinancePdf) ui.exportFinancePdf.addEventListener('click', exportFinanceToPdf);
    if (ui.detailCollabSelect) ui.detailCollabSelect.addEventListener('change', (e) => renderCollabDetail(e.target.value));

    // --- Manejo del Formulario de Pago ---
    if (ui.paymentForm) {
      ui.paymentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = ui.paymentForm.querySelector('button[type="submit"]');
        const originalBtnContent = submitBtn ? submitBtn.innerHTML : '';
        
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="w-4 h-4 animate-spin border-2 border-white border-t-transparent rounded-full"></i> Procesando...';
        }

        try {
          const collabId = document.getElementById('payCollabId').value;
          const amount = parseFloat(document.getElementById('payAmount').value);
          const method = document.getElementById('payMethod').value;
          const month = parseInt(document.getElementById('payMonth').value);
          const year = parseInt(document.getElementById('payYear').value);
          const notes = document.getElementById('payNotes').value;

          if (!collabId || isNaN(amount) || amount <= 0) {
            throw new Error('Datos de pago inválidos');
          }

          const { data, error } = await supabaseConfig.client
            .from('collaborator_payments')
            .insert([{
              collaborator_id: collabId,
              amount,
              payment_method: method,
              payment_month: month,
              payment_year: year,
              notes,
              processed_by: session.user.id
            }])
            .select('*, profiles:profiles!collaborator_id(full_name)')
            .single();

          if (error) throw error;

          notifications.success('Pago registrado correctamente');
          window.closePaymentModal();
          ui.paymentForm.reset();
          
          // Actualizar historial y finanzas localmente
          await fetchPaymentHistory();
          await renderFinance(session);
          
          // Generar recibo automáticamente
          if (data) {
            // Ajustar el objeto para que coincida con lo esperado por generateReceiptPDF
            // La respuesta de single() ya trae profiles si el join funcionó
            window.generateReceiptPDF(data);
          }

        } catch (err) {
          console.error('Error al registrar pago:', err);
          notifications.error(err.message || 'No se pudo registrar el pago');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnContent;
          }
        }
      });
    }

    if (!realtimeSetup) {
      realtimeSetup = true;
      const ordersChannel = supabaseConfig.client
        .channel('public:orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
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
      window.__tlc_ordersChannel = ordersChannel;
      window.__tlc_collabChannel = collabChannel;
    }
  }

  // ✅ CARGA CONDICIONAL: Esperar la "luz verde" del sidebar.
  document.addEventListener('admin-session-ready', initialize, { once: true });
  });
