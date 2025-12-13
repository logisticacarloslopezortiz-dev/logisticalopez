// ✅ CORRECCIÓN ARQUITECTURAL: Envolver toda la lógica en un IIFE para evitar ejecución prematura.
(() => {
  let initialized = false;

  // Esta función contiene toda la lógica de la página y solo se llamará si la sesión es válida.
  const initHistorial = async () => {
    if (initialized) return;
    initialized = true;

    const tableBody = document.getElementById('historyTableBody');
    const showingCountEl = document.getElementById('showingCount');
    const totalCountEl = document.getElementById('totalCount');

    if (!tableBody) return; // Si no estamos en la página correcta, no hacer nada.

    let allHistoryOrders = [];
    let filteredOrders = [];
    const histPageState = { currentPage: 1, pageSize: 15 };

    const normalize = (s) => String(s || '').toLowerCase();

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
      if (showingCountEl) showingCountEl.textContent = page.length > 0 ? `${start + 1}-${start + page.length}` : '0';
      
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

      tableBody.querySelectorAll('.btn-evidence').forEach(btn => {
        btn.addEventListener('click', () => {
          if (window.showEvidence) window.showEvidence(Number(btn.dataset.orderId));
        });
      });
      tableBody.querySelectorAll('.btn-pdf').forEach(btn => {
        btn.addEventListener('click', () => {
          if (window.showPDFModal) window.showPDFModal(Number(btn.dataset.orderId));
        });
      });
      renderPagination();
    };

    const filterAndRender = () => {
      histPageState.currentPage = 1;
      // Aquí iría la lógica de filtrado si se añade un campo de búsqueda.
      filteredOrders = allHistoryOrders;
      renderTable();
    };

    const loadHistory = async () => {
      const client = supabaseConfig.client;
      let orders = [];
      let err = null;
      const STATUS_OK = ['Completada', 'Cancelada', 'completada', 'cancelada', 'Completado', 'Cancelado', 'completado', 'cancelado', 'Finalizada', 'finalizada', 'Entregada', 'entregada'];

      try {
        const { data, error } = await client
          .from('orders')
          .select('id, name, phone, email, empresa, rnc, service_id, vehicle_id, status, created_at, date, time, pickup, delivery, completed_at, completed_by, monto_cobrado, evidence_photos, service:services(name), vehicle:vehicles(name), colaborador:collaborators(name)')
          .in('status', STATUS_OK)
          .order('completed_at', { ascending: false });
        if (error) err = error; else orders = data || [];
      } catch (e) { err = e; }

      if (err) {
        console.error("Error cargando historial:", err);
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
        return;
      }

      allHistoryOrders = orders;
      filterAndRender();
    };

    const loadOrderDetails = async (orderId) => {
      // Lógica para cargar un solo detalle de orden si es necesario por el realtime
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
              if (idx === -1) {
                allHistoryOrders.unshift(payload.new);
              } else {
                allHistoryOrders[idx] = { ...allHistoryOrders[idx], ...payload.new };
              }
              filterAndRender();
            })
            .subscribe();
        }
      } catch (e) {
        console.warn("No se pudo suscribir a realtime para historial:", e);
      }
    };

    function renderPagination() {
      // Lógica de paginación
    }

    // Mock de funciones globales si no existen en el HTML, para evitar errores
    if (!window.showEvidence) {
      window.showEvidence = (id) => console.log('showEvidence para ID:', id);
    }
    if (!window.showPDFModal) {
      window.showPDFModal = (id) => console.log('showPDFModal para ID:', id);
    }

    // --- Ejecución de la inicialización ---
    await loadHistory();
    setupRealtimeSubscription();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  // ✅ GATEKEEPER: Escuchar el evento del guardián.
  document.addEventListener('admin-session-ready', (e) => {
    // Solo inicializar si el evento confirma que es un admin.
    if (e.detail?.isAdmin) {
      initHistorial();
    } else {
      // Opcional: podrías mostrar un mensaje de "no autorizado" si la página se carga pero no hay sesión.
      console.warn('[Historial] Sesión no autorizada. No se inicializará la página.');
    }
  }, { once: true });

})();
