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
  const filters = { search: '', status: '', collaboratorId: '', dateFrom: '', dateTo: '', service: '', vehicle: '' };
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
      
      if (total === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-gray-500">No se encontraron órdenes con esos criterios.</td></tr>`;
        renderPagination();
        return;
      }

      tableBody.innerHTML = page.map(o => {
        const id = o.id;
        const service = o.service?.name || '';
        const fecha = o.completed_at ? new Date(o.completed_at).toLocaleString() : (o.created_at ? new Date(o.created_at).toLocaleString() : '');
        const colaboradorAsignado = o.colaborador?.name || '';
        const completadoPor = o.completed_by_name || '';
        const colaborador = completadoPor && completadoPor !== colaboradorAsignado ? `${colaboradorAsignado} → ${completadoPor}` : colaboradorAsignado;
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
              <button class="btn-evidence" data-order-id="${o.id}" title="Ver evidencia" aria-label="Ver evidencia" role="button">${evidenceCount > 0 ? `Ver (${evidenceCount})` : 'No hay'}</button>
            </td>
            <td class="table-cell">
              <button class="btn-pdf" data-order-id="${o.id}" title="Descargar comprobante PDF" aria-label="Descargar comprobante PDF" role="button">PDF</button>
            </td>
            <td class="table-cell">
              <button class="btn-rate" data-order-id="${o.id}" title="Enviar enlace de calificación" aria-label="Enviar enlace de calificación" role="button">Calificar</button>
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
      tableBody.querySelectorAll('.btn-rate').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.orderId);
          const order = filteredOrders.find(o => o.id === id);
          if (!order) return;
          sendRatingLink(order);
        });
      });
      renderPagination();
    };

    const applyFilters = () => {
      const df = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
      const dt = filters.dateTo ? new Date(filters.dateTo).getTime() : null;
      const st = normalize(filters.status);
      const colId = String(filters.collaboratorId || '').trim();
      const svc = normalize(filters.service);
      const veh = normalize(filters.vehicle);
      const q = normalize(filters.search);
      filteredOrders = allHistoryOrders.filter(o => {
        const okStatus = !st || normalize(o.status) === st || normalize(o.status) === (st === 'completadas' ? 'completada' : st);
        const compAt = o.completed_at ? new Date(o.completed_at).getTime() : null;
        const okDate = (!df || (compAt && compAt >= df)) && (!dt || (compAt && compAt <= dt));
        const okCollab = !colId || String(o.assigned_to || o.completed_by || '') === colId;
        const okSvc = !svc || normalize(o.service?.name) === svc || normalize(o.service?.name).includes(svc);
        const okVeh = !veh || normalize(o.vehicle?.name) === veh || normalize(o.vehicle?.name).includes(veh);
        const hay = q
          ? (
            normalize(o.name).includes(q) ||
            String(o.id).includes(q) ||
            normalize(o.phone).includes(q) ||
            normalize(o.empresa).includes(q) ||
            normalize(o.service?.name).includes(q) ||
            normalize(o.vehicle?.name).includes(q) ||
            normalize(o.colaborador?.name).includes(q)
          )
          : true;
        return okStatus && okDate && okCollab && okSvc && okVeh && hay;
      });
    };

    const filterAndRender = () => {
      histPageState.currentPage = 1;
      applyFilters();
      try { window.filteredOrders = filteredOrders.slice(); } catch(_) {}
      renderTable();
    };

    const setLoading = (isLoading) => {
      const el = document.getElementById('historyLoading');
      if (el) el.classList.toggle('hidden', !isLoading);
      if (isLoading && tableBody) {
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-6">Cargando…</td></tr>`;
      }
    };

    const loadHistory = async () => {
      const client = supabaseConfig.client;
      let orders = [];
      let err = null;
      const STATUS_OK = ['completed', 'cancelled'];

      try {
        setLoading(true);
        const sp = new URLSearchParams(location.search);
        const page = Number(sp.get('page') || histPageState.currentPage);
        const size = Number(sp.get('size') || histPageState.pageSize);
        histPageState.currentPage = page > 0 ? page : 1;
        histPageState.pageSize = size > 0 ? size : 15;
        const start = (histPageState.currentPage - 1) * histPageState.pageSize;
        const end = start + histPageState.pageSize - 1;
        const sel = 'id,name,phone,email,empresa,rnc,service_id,vehicle_id,status,created_at,date,time,pickup,delivery,completed_at,completed_by,monto_cobrado,evidence_photos,assigned_to, service:services(name), vehicle:vehicles(name)';
        const resp = await (supabaseConfig.withAuthRetry?.(() => client
          .from('orders')
          .select(sel, { count: 'exact' })
          .in('status', STATUS_OK)
          .order('completed_at', { ascending: false })
          .range(start, end)) || client
          .from('orders')
          .select(sel, { count: 'exact' })
          .in('status', STATUS_OK)
          .order('completed_at', { ascending: false })
          .range(start, end));
        const { data, count, error } = resp;
        if (error) err = error; else { orders = data || []; histPageState.totalCount = count || orders.length; }
      } catch (e) { err = e; }

      if (err && /is not a function/i.test(String(err.message || ''))) {
        try {
          const { data } = await client
            .from('orders')
            .select('id,name,phone,email,empresa,rnc,service_id,vehicle_id,status,created_at,date,time,pickup,delivery,completed_at,completed_by,monto_cobrado,evidence_photos,assigned_to, service:services(name), vehicle:vehicles(name)');
          const filtered = (data || []).filter(o => STATUS_OK.includes(String(o.status || '').toLowerCase()));
          orders = filtered.sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime());
          err = null;
        } catch (e2) { err = e2; }
      }

      if (err && (String(err.message||'').toLowerCase().includes('jwt expired') || err.status === 401 || err.code === 'PGRST303')) {
        try {
          const pub = supabaseConfig.getPublicClient?.();
          if (pub) {
            const resp2 = await pub
              .from('orders')
              .select('id,name,phone,email,empresa,rnc,service_id,vehicle_id,status,created_at,date,time,pickup,delivery,completed_at,completed_by,monto_cobrado,evidence_photos,assigned_to, service:services(name), vehicle:vehicles(name)', { count: 'exact' })
              .in('status', STATUS_OK)
              .order('completed_at', { ascending: false })
              .range(0, histPageState.pageSize - 1);
            orders = resp2.data || [];
            histPageState.totalCount = resp2.count || orders.length;
            err = null;
          }
        } catch (_) {}
      }

      if (err) {
        console.error("Error cargando historial:", err);
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
        setLoading(false);
        return;
      }

      let collaborators = {};
      let collabCacheKey = 'tlc_collab_cache_v1';
      try {
        const ids = [...new Set((orders || []).flatMap(o => [o.assigned_to, o.completed_by]).filter(Boolean))];
        try {
          const cache = JSON.parse(localStorage.getItem(collabCacheKey) || '{}');
          Object.assign(collaborators, cache || {});
        } catch(_){ }
        if (ids.length > 0) {
          const { data } = await client.from('collaborators').select('id,name').in('id', ids);
          (data || []).forEach(c => { collaborators[c.id] = c.name; });
          try { localStorage.setItem(collabCacheKey, JSON.stringify(collaborators)); } catch(_){ }
        }
      } catch (_) {}

      allHistoryOrders = (orders || []).map(o => ({ 
        ...o, 
        colaborador: { name: collaborators[o.assigned_to] || '' },
        completed_by_name: collaborators[o.completed_by] || ''
      }));
      filterAndRender();
      try {
        const sp = new URLSearchParams(location.search);
        sp.set('page', String(histPageState.currentPage));
        sp.set('size', String(histPageState.pageSize));
        history.replaceState({}, '', `${location.pathname}?${sp.toString()}`);
      } catch (_) {}
      setLoading(false);
    };

    const loadOrderDetails = async (orderId) => {
      // Lógica para cargar un solo detalle de orden si es necesario por el realtime
    };

    const setupRealtimeSubscription = () => {
      const cli = supabaseConfig.client;
      try {
        if (cli && typeof cli.channel === 'function') {
          const channel = cli.channel('historial-updates');
          const STATUS_OK = ['completed', 'cancelled'];
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
      const total = histPageState.totalCount || filteredOrders.length;
      const pages = Math.max(1, Math.ceil(total / histPageState.pageSize));
      const container = document.getElementById('historyPagination');
      if (!container) return;
      container.innerHTML = '';
      const mk = (n, label) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = n === histPageState.currentPage;
        b.className = 'px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm m-1';
        b.addEventListener('click', () => {
          histPageState.currentPage = n;
          const sp = new URLSearchParams(location.search);
          sp.set('page', String(n));
          history.replaceState({}, '', `${location.pathname}?${sp.toString()}`);
          renderTable(n);
        });
        return b;
      };
      container.appendChild(mk(Math.max(1, histPageState.currentPage - 1), 'Anterior'));
      container.appendChild(mk(Math.min(pages, histPageState.currentPage + 1), 'Siguiente'));
    }

    // Mock de funciones globales si no existen en el HTML, para evitar errores
    if (!window.showEvidence) {
      window.showEvidence = (id) => console.log('showEvidence para ID:', id);
    }
    if (!window.showPDFModal) {
      window.showPDFModal = (id) => console.log('showPDFModal para ID:', id);
    }

    // --- Ejecución de la inicialización ---
    await ensureModals();
    await loadHistory();
    setupRealtimeSubscription();
    if (window.lucide) {
      window.lucide.createIcons();
    }

    const deb = (fn, ms = 300) => {
      let t = null;
      return (...args) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };

    const bindFilters = () => {
      const fSearch = document.getElementById('filterSearch');
      const fStatus = document.getElementById('filterStatus');
      const fCollab = document.getElementById('filterCollaborator');
      const fDF = document.getElementById('filterDateFrom');
      const fDT = document.getElementById('filterDateTo');
      const fSvc = document.getElementById('filterService');
      const fVeh = document.getElementById('filterVehicle');
      const updateUrl = () => {
        try {
          const sp = new URLSearchParams(location.search);
          Object.entries(filters).forEach(([k,v]) => { if (v) sp.set(k, String(v)); else sp.delete(k); });
          history.replaceState({}, '', `${location.pathname}?${sp.toString()}`);
        } catch(_){ }
      };
      const onChange = () => { updateUrl(); filterAndRender(); };
      if (fSearch) fSearch.addEventListener('input', deb(() => { filters.search = fSearch.value || ''; onChange(); }, 300));
      if (fStatus) fStatus.addEventListener('change', () => { filters.status = fStatus.value || ''; onChange(); });
      if (fCollab) fCollab.addEventListener('change', () => { filters.collaboratorId = fCollab.value || ''; onChange(); });
      if (fDF) fDF.addEventListener('change', () => { filters.dateFrom = fDF.value || ''; onChange(); });
      if (fDT) fDT.addEventListener('change', () => { filters.dateTo = fDT.value || ''; onChange(); });
      if (fSvc) fSvc.addEventListener('change', () => { filters.service = fSvc.value || ''; onChange(); });
      if (fVeh) fVeh.addEventListener('change', () => { filters.vehicle = fVeh.value || ''; onChange(); });

      try {
        const sp = new URLSearchParams(location.search);
        filters.search = sp.get('search') || '';
        filters.status = sp.get('status') || '';
        filters.collaboratorId = sp.get('collaboratorId') || '';
        filters.dateFrom = sp.get('dateFrom') || '';
        filters.dateTo = sp.get('dateTo') || '';
        filters.service = sp.get('service') || '';
        filters.vehicle = sp.get('vehicle') || '';
      } catch(_){ }
      filterAndRender();
    };

    bindFilters();
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

async function ensureModals(){
  let evidenceModal = document.getElementById('evidenceModal');
  if (!evidenceModal) {
    evidenceModal = document.createElement('div');
    evidenceModal.id = 'evidenceModal';
    evidenceModal.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center z-50';
    evidenceModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <p class="text-lg font-semibold">Evidencia</p>
          <button id="closeEvidenceModal" class="p-2 text-gray-500 hover:text-gray-700">Cerrar</button>
        </div>
        <div id="evidenceGallery" class="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"></div>
      </div>`;
    document.body.appendChild(evidenceModal);
  }
  let pdfModal = document.getElementById('pdfModal');
  if (!pdfModal) {
    pdfModal = document.createElement('div');
    pdfModal.id = 'pdfModal';
    pdfModal.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center z-50';
    pdfModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <p class="text-lg font-semibold">Comprobante PDF</p>
          <button id="closePdfModal" class="p-2 text-gray-500 hover:text-gray-700">Cerrar</button>
        </div>
        <div id="selectedOrderInfo" class="p-6 space-y-2"></div>
        <div class="px-6 py-4 border-t flex items-center justify-end gap-3">
          <button id="downloadPdfBtn" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Descargar</button>
          <button id="cancelPdfBtn" class="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(pdfModal);
  }
  const closeEvidenceModalBtn = document.getElementById('closeEvidenceModal');
  const evidenceGallery = document.getElementById('evidenceGallery');
  const closePdfModalBtn = document.getElementById('closePdfModal');
  const pdfOrderInfo = document.getElementById('selectedOrderInfo');
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  window.showEvidence = (orderId) => {
    const order = window.filteredOrders ? window.filteredOrders.find(o => o.id === orderId) : null;
    const list = order ? order.evidence_photos || [] : [];
    evidenceGallery.innerHTML = list.map(p => {
      const url = typeof p === 'string' ? p : (p?.url || p?.public_url || '');
      const clean = String(url || '').replace(/`/g, '').replace(/\+$/g, '').trim();
      return clean ? `<a href="${clean}" target="_blank" rel="noopener noreferrer"><img src="${clean}" class="w-full h-48 object-cover rounded-lg"/></a>` : '';
    }).join('');
    const modal = document.getElementById('evidenceModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  };
  const closeEvidenceModal = () => {
    const modal = document.getElementById('evidenceModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };
  closeEvidenceModalBtn.onclick = closeEvidenceModal;
  evidenceModal.onclick = (e) => { if (e.target === evidenceModal) closeEvidenceModal(); };

  window.showPDFModal = (orderId) => {
    const order = (window.filteredOrders || []).find(o => o.id === orderId);
    if (!order) return;
    const compBy = order.completed_by || order.assigned_to || '';
    const fecha = order.completed_at ? new Date(order.completed_at).toLocaleString('es-DO') : '';
    pdfOrderInfo.innerHTML = `
      <div class="space-y-2">
        <p><strong>Orden #:</strong> ${order.id}</p>
        <p><strong>Cliente:</strong> ${order.name || ''}</p>
        <p><strong>Servicio:</strong> ${order.service?.name || ''}</p>
        <p><strong>Estado:</strong> ${order.status}</p>
        <p><strong>Completado por:</strong> ${compBy}</p>
        <p><strong>Fecha:</strong> ${fecha}</p>
        <p><strong>Monto:</strong> ${order.monto_cobrado != null ? `RD$ ${Number(order.monto_cobrado).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : '-'}</p>
      </div>`;
    const modal = document.getElementById('pdfModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    downloadPdfBtn.onclick = async () => { await generatePDF(order); closePdfModal(); };
    document.getElementById('cancelPdfBtn').onclick = closePdfModal;
  };
  const closePdfModal = () => {
    const modal = document.getElementById('pdfModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };
  closePdfModalBtn.onclick = closePdfModal;
  pdfModal.onclick = (e) => { if (e.target === pdfModal) closePdfModal(); };
}

async function generatePDF(order) {
  try {
    if (!window.jspdf) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      document.head.appendChild(s);
      await new Promise(r => { s.onload = r; });
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    
    // Colores corporativos
    const brandDark = '#1e405a'; // rgb(30, 64, 90)
    const brandTurq = '#1e8a95'; // rgb(30, 138, 149)
    
    // Configuración inicial
    let y = 40;
    const margin = 40;
    const width = doc.internal.pageSize.getWidth();
    const contentWidth = width - (margin * 2);
    
    // Cargar logo (intentar cargar, si falla, seguir sin logo)
    try {
      const logoUrl = 'https://logisticalopezortiz.com/img/1horizontal%20(1).png';
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = logoUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        // Timeout para no bloquear
        setTimeout(() => reject(new Error('Timeout loading logo')), 3000);
      });
      // Calcular aspecto del logo
      const logoWidth = 120;
      const logoHeight = (img.height / img.width) * logoWidth;
      doc.addImage(img, 'PNG', margin, y, logoWidth, logoHeight);
      y += logoHeight + 20;
    } catch (e) {
      console.warn('No se pudo cargar el logo para el PDF:', e);
      // Fallback texto si no hay logo
      doc.setFontSize(18);
      doc.setTextColor(brandDark);
      doc.setFont('helvetica', 'bold');
      doc.text('Logística López Ortiz', margin, y);
      y += 25;
    }

    // Encabezado del documento
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.text('RNC: 1-32-86086-6', margin, y);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, width - margin - 100, y);
    y += 30;

    // Título de la Orden
    doc.setFillColor(brandTurq);
    doc.rect(margin, y, contentWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Comprobante de Orden #${order.id}`, margin + 10, y + 17);
    y += 40;

    // Función auxiliar para dibujar filas con mejor manejo de espacio
    const drawRow = (label, value) => {
      doc.setFontSize(10);
      doc.setTextColor(50);
      doc.setFont('helvetica', 'bold');
      doc.text(label, margin, y);
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      
      // Ajuste de texto largo con manejo de saltos de línea
      const strValue = String(value || 'N/A');
      // Dividir primero por saltos de línea explícitos si los hay
      const paragraphs = strValue.split('\n');
      let finalLines = [];
      paragraphs.forEach(p => {
        const lines = doc.splitTextToSize(p, contentWidth - 120);
        finalLines = finalLines.concat(lines);
      });

      doc.text(finalLines, margin + 120, y);
      
      // Calcular nueva altura basada en líneas
      const lineHeight = 12;
      const height = Math.max(lineHeight, finalLines.length * lineHeight);
      y += height + 10; // Espacio entre filas aumentado para mejor lectura
      
      // Verificar salto de página con margen inferior
      if (y > doc.internal.pageSize.getHeight() - 50) {
        doc.addPage();
        y = 40;
      }
    };

    drawRow('Cliente:', order.name);
    drawRow('Teléfono:', order.phone);
    drawRow('Servicio:', order.service?.name);
    drawRow('Vehículo:', order.vehicle?.name);
    drawRow('Origen:', order.pickup);
    drawRow('Destino:', order.delivery);
    drawRow('Estado:', order.status);
    
    const fechaCompletado = order.completed_at ? new Date(order.completed_at).toLocaleString('es-DO') : '';
    if (fechaCompletado) {
      drawRow('Completado:', fechaCompletado);
    }
    
    const completadoPor = order.completed_by_name || order.assigned_to || '';
    if (completadoPor) {
      drawRow('Atendido por:', completadoPor);
    }

    y += 10;
    
    // Total
    doc.setDrawColor(brandDark);
    doc.setLineWidth(1);
    doc.line(margin, y, width - margin, y);
    y += 25;
    
    doc.setFontSize(14);
    doc.setTextColor(brandDark);
    doc.setFont('helvetica', 'bold');
    const monto = order.monto_cobrado != null ? `RD$ ${Number(order.monto_cobrado).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : 'N/A';
    doc.text('MONTO TOTAL:', margin, y);
    doc.text(monto, width - margin - doc.getTextWidth(monto), y);

    // Pie de página
    const footerY = doc.internal.pageSize.getHeight() - 30;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setFont('helvetica', 'italic');
    doc.text('Gracias por preferir a Logística López Ortiz', margin, footerY);

    doc.save(`orden_${order.id}.pdf`);
  } catch (error) {
    console.error('Error generando PDF:', error);
    alert('Hubo un error al generar el PDF. Por favor intenta de nuevo.');
  }
}

async function sendRatingLink(order){
  const code = String(order.short_id || order.id || '').trim();
  const link = `https://logisticalopezortiz.com/calificar.html?pedido=${encodeURIComponent(code)}`;
  const phone = String(order.phone || '').replace(/\D/g, '');
  const hasPhone = phone.length >= 8;
  const email = order.client_email || order.email || '';
  if (hasPhone) {
    const msg = encodeURIComponent(`Hola ${order.name || ''}, por favor califica nuestro servicio: ${link}`);
    const wa = `https://wa.me/${phone}?text=${msg}`;
    window.open(wa, '_blank');
  } else if (email) {
    const subj = encodeURIComponent('Califica nuestro servicio');
    const body = encodeURIComponent(`Hola ${order.name || ''}, por favor califica nuestro servicio: ${link}`);
    window.location.href = `mailto:${email}?subject=${subj}&body=${body}`;
  } else {
    try { await navigator.clipboard.writeText(link); } catch(_) {}
    alert('Enlace de calificación copiado');
  }
  try {
    await supabaseConfig.client.from('orders').update({ rating_sent_at: new Date().toISOString() }).eq('id', order.id);
  } catch(_) {}
}

// Exportación CSV del historial filtrado
window.exportHistoryCSV = () => {
  try {
    const rows = (window.filteredOrders || []).map(o => ({
      id: o.id,
      cliente: o.name || '',
      servicio: o.service?.name || '',
      estado: o.status || '',
      colaborador: o.colaborador?.name || '',
      completado_por: o.completed_by_name || '',
      fecha: o.completed_at || o.created_at || '',
      monto: o.monto_cobrado != null ? Number(o.monto_cobrado) : ''
    }));
    const header = Object.keys(rows[0] || { id: '', cliente: '', servicio: '', estado: '', colaborador: '', completado_por: '', fecha: '', monto: '' });
    const csv = [header.join(','), ...rows.map(r => header.map(k => String(r[k]).replace(/[\n\r,]/g, ' ').trim()).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historial_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
  } catch(_) {}
};
