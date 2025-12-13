document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('historyTableBody');
  const showingCountEl = document.getElementById('showingCount');
  const totalCountEl = document.getElementById('totalCount');

  let allHistoryOrders = [];
  let filteredOrders = [];
  const histPageState = { currentPage: 1, pageSize: 15 };

  // Referencias a modales (asumiendo que existen en el HTML)
  const evidenceModal = document.getElementById('evidenceModal');
  const pdfModal = document.getElementById('pdfModal');
  const normalize = (s) => String(s || '').toLowerCase();

  const applyFilters = () => {
    let rows = allHistoryOrders.slice();
    if (histPageState.status !== 'all') {
      const wanted = normalize(histPageState.status);
      rows = rows.filter(r => normalize(r.status) === wanted);
    }
    if (histPageState.search) {
      const q = normalize(histPageState.search);
      rows = rows.filter(r => {
        const parts = [r.id, r.short_id, r.name, r.phone, r.email, r.pickup, r.delivery, r.empresa, r.rnc, r?.service?.name, r?.vehicle?.name].map(x => normalize(x));
        return parts.some(p => p.includes(q));
      });
    }
    return rows;
  };

  const renderTable = (pageNumber = histPageState.currentPage) => {
    histPageState.currentPage = pageNumber;
    const sorted = filteredOrders.slice().sort((a, b) => {
      const ta = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const tb = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return tb - ta;
    });
    const total = sorted.length;
    const start = (histPageState.currentPage - 1) * histPageState.pageSize;
    const page = sorted.slice(start, start + histPageState.pageSize);
    if (totalCountEl) totalCountEl.textContent = String(total);
    if (showingCountEl) showingCountEl.textContent = `${start + 1}-${start + page.length}`;
    if (tableBody) {
      tableBody.innerHTML = page.map(o => {
        const id = o.id;
        const service = o.service?.name || '';
        const fecha = o.completed_at ? new Date(o.completed_at).toLocaleString() : (o.created_at ? new Date(o.created_at).toLocaleString() : '');
        const colaborador = o.colaborador?.name || '';
        const precio = (o.monto_cobrado != null && o.monto_cobrado !== '') ? `RD$ ${Number(o.monto_cobrado).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
        const evidenceCount = Array.isArray(o.evidence_photos) ? o.evidence_photos.length : 0;
        return `
          <tr>
            <td class="table-cell">${id}</td>
            <td class="table-cell">${o.name || ''}</td>
            <td class="table-cell">${service}</td>
            <td class="table-cell">${fecha}</td>
            <td class="table-cell">${colaborador}</td>
            <td class="table-cell">${precio}</td>
            <td class="table-cell">
              <button class="btn-evidence" data-order-id="${o.id}">${evidenceCount > 0 ? `Ver (${evidenceCount})` : 'No hay'}</button>
            </td>
            <td class="table-cell">
              <button class="btn-pdf" data-order-id="${o.id}">PDF</button>
            </td>
          </tr>
        `;
      }).join('');
      // Bind row actions
      tableBody.querySelectorAll('.btn-evidence').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.orderId);
          const order = allHistoryOrders.find(o => Number(o.id) === id);
          if (order) window.showEvidence(id); // Asume que showEvidence es global
        });
      });
      tableBody.querySelectorAll('.btn-pdf').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.orderId);
          const order = allHistoryOrders.find(o => Number(o.id) === id);
          if (order) window.showPDFModal(id); // Asume que showPDFModal es global
        });
      });
    }
    renderPagination();
  };

  const filterAndRender = () => {
    histPageState.currentPage = 1;
    renderTable();
  };

  const loadHistory = async () => {
    try { await supabaseConfig.ensureFreshSession?.(); } catch {}
    const client = supabaseConfig.client;
    let orders = [];
    let err = null;
    const STATUS_OK = ['Completada', 'Cancelada', 'completada', 'cancelada', 'Completado', 'Cancelado', 'completado', 'cancelado', 'Finalizada', 'finalizada', 'Entregada', 'entregada'];

    try {
      // ✅ CORRECCIÓN: Usar siempre el cliente autenticado para evitar problemas con RLS.
      const { data, error } = await client
        .from('orders')
        .select('*, service:services(name), vehicle:vehicles(name), colaborador:collaborators(name)')
        .in('status', STATUS_OK)
        .order('completed_at', { ascending: false });

      if (error) err = error; else orders = data || [];
    } catch (e) { err = e; }

    if (err) {
      console.error("Error cargando historial:", err);
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
      return;
    }

    if (!orders || orders.length === 0) {
      allHistoryOrders = [];
      filteredOrders = [];
      filterAndRender();
      return;
    }
    allHistoryOrders = orders;
    filteredOrders = orders;
    filterAndRender();
  };

  const loadOrderDetails = async (orderId) => {
    try {
      let data = null;
      let error = null;
      try {
        const resp = await supabaseConfig.client
          .from('orders')
          .select('*, service:services(name)')
          .eq('id', orderId)
          .maybeSingle();
        data = resp.data;
        error = resp.error || null;
      } catch (e) { error = e; }
      if (error && (String(error.message || '').toLowerCase().includes('jwt expired') || (error.status === 401))) {
        try {
          const pub = supabaseConfig.getPublicClient?.() || supabaseConfig.client;
          const resp2 = await pub
            .from('orders')
            .select('*, service:services(name)')
            .eq('id', orderId)
            .maybeSingle();
          data = resp2.data;
          error = resp2.error || null;
        } catch {}
      }
      if (data) {
        try {
          if (data.completed_by) {
            const { data: coll } = await (supabaseConfig.getPublicClient?.() || supabaseConfig.client)
              .from('collaborators')
              .select('id,name,role')
              .eq('id', data.completed_by)
              .maybeSingle();
            if (coll) data.colaborador = { name: coll.name || null, role: coll.role || null };
          }
        } catch {}
        allHistoryOrders.unshift(data);
        filterAndRender();
      }
    } catch {}
  };

  const setupRealtimeSubscription = () => {
    const cli = supabaseConfig.client;
    try {
      if (cli && typeof cli.channel === 'function') {
        const channel = cli.channel('historial-updates');
        const STATUS_OK = ['Completada', 'Cancelada'];
        channel
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `status=in.(${STATUS_OK.join(',')})` }, (payload) => {
            if (!payload.new) return;
            const idx = allHistoryOrders.findIndex(o => o.id === payload.new.id);
            if (idx === -1) loadOrderDetails(payload.new.id);
            else { allHistoryOrders[idx] = { ...allHistoryOrders[idx], ...payload.new }; renderTable(); }
          })
          .subscribe();
        return;
      }
      if (!window.__histRefresh__) {
        window.__histRefresh__ = setInterval(() => { try { loadHistory(); } catch {} }, 60000);
      }
    } catch {}
  };

  let __histInitialized = false;
  const safeInit = async () => {
    if (__histInitialized) return;
    __histInitialized = true;
    await loadHistory();
    setupRealtimeSubscription();
  };

  // ✅ CORRECCIÓN: Esperar a que la sesión de admin esté lista.
  document.addEventListener('admin-session-ready', safeInit);

  function renderPagination() {
    // Lógica de paginación (si es necesaria)
  }

  // Mock de funciones globales si no existen en el HTML, para evitar errores
  if (!window.showEvidence) {
    window.showEvidence = (id) => console.log('showEvidence para ID:', id);
  }
  if (!window.showPDFModal) {
    window.showPDFModal = (id) => console.log('showPDFModal para ID:', id);
  }

  // Inicialización de iconos si Lucide está presente
  if (window.lucide) {
    window.lucide.createIcons();
  }
});
