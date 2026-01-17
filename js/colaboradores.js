// js/colaboradores.js

(() => {
  'use strict';
  let __initialized = false;

  document.addEventListener('DOMContentLoaded', () => {
  // --- ELEMENTOS DEL DOM ---
  const tableBody = document.getElementById('colaboradoresTableBody');
  const form = document.getElementById('colaboradorForm');
  const nameInput = document.getElementById('colaboradorName');
  const matriculaInput = document.getElementById('colaboradorMatricula');
  const emailInput = document.getElementById('colaboradorEmail');
  const passwordInput = document.getElementById('colaboradorPassword');
  const msgDiv = document.getElementById('colabMsg');
  // Elementos del modal de edición
  const editModal = document.getElementById('editCollaboratorModal');
  const editForm = document.getElementById('editCollaboratorForm');
  const editMsg = document.getElementById('editCollabMsg');
  const editId = document.getElementById('editCollabId');
  const editName = document.getElementById('editCollabName');
  const editEmail = document.getElementById('editCollabEmail');
  const editPhone = document.getElementById('editCollabPhone');
  const editMatricula = document.getElementById('editCollabMatricula');
  const editPassword = document.getElementById('editCollabPassword');
  const closeEditBtn = document.getElementById('closeEditCollabModal');
  const cancelEditBtn = document.getElementById('cancelEditCollab');
  const resetPasswordBtn = document.getElementById('resetPasswordCollab');
  
  const totalColaboradoresEl = document.getElementById('totalColaboradores');
  const colaboradoresActivosEl = document.getElementById('colaboradoresActivos');

  let allCollaborators = [];
  const collabPageState = { data: [], currentPage: 1, pageSize: 15, totalPages: 1 };

  // --- LÓGICA PRINCIPAL ---

  // Cargar y mostrar colaboradores con reintentos automáticos
  async function loadCollaborators(retryCount = 0) {
    if (!tableBody) return;
    
    const maxRetries = 3;
    const retryDelay = 1000 * (retryCount + 1); // 1s, 2s, 3s
    
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Cargando colaboradores${retryCount > 0 ? ` (intento ${retryCount + 1}/${maxRetries + 1})` : ''}...</td></tr>`;

    try {
      try { await supabaseConfig.ensureFreshSession?.(); } catch(_) {}
      const resp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
        .from('collaborators')
        .select('*')
        .order('created_at', { ascending: false })) || supabaseConfig.client
        .from('collaborators')
        .select('*')
        .order('created_at', { ascending: false }));
      const { data, error } = resp;

      if (error) {
        throw error;
      }

      allCollaborators = data || [];
      filterAndRender();
      updateSummary();
      console.log(`[Colaboradores] Cargados ${allCollaborators.length} colaboradores exitosamente`);
      
    } catch (error) {
      console.error(`Error al cargar colaboradores (intento ${retryCount + 1}):`, error);
      
      if (retryCount < maxRetries) {
        console.log(`[Colaboradores] Reintentando en ${retryDelay}ms...`);
        setTimeout(() => loadCollaborators(retryCount + 1), retryDelay);
      } else {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" class="text-center py-4">
              <div class="text-red-500 mb-2">No se pudieron cargar los colaboradores</div>
              <button onclick="loadCollaborators()" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Reintentar
              </button>
            </td>
          </tr>
        `;
      }
    }
  }

  // Función para generar avatar con iniciales
  function generateAvatar(name) {
    if (!name) return '';
    
    // Obtener las iniciales (máximo 2 caracteres)
    const initials = name.trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
    
    // Generar color basado en el nombre para consistencia
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 
      'bg-yellow-500', 'bg-indigo-500', 'bg-pink-500', 'bg-teal-500'
    ];
    const colorIndex = name.length % colors.length;
    const bgColor = colors[colorIndex];
    
    return `
      <div class="w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-semibold text-sm">
        ${initials}
      </div>
    `;
  }

  // Renderizar la tabla
  function renderTable(collaborators) {
    if (collaborators.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No se encontraron colaboradores.</td></tr>';
      return;
    }

    tableBody.innerHTML = collaborators.map(colab => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-6 py-4 font-medium text-gray-900">
          <div class="flex items-center gap-3">
            ${generateAvatar(colab.name)}
            <div>
              <div class="font-medium">${colab.name}</div>
              <div class="text-sm text-gray-500">${colab.role || 'Colaborador'}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">${colab.matricula || 'N/A'}</td>
        <td class="px-6 py-4">${colab.email}</td>
        <td class="px-6 py-4">
          <span class="px-2 py-1 text-xs font-semibold rounded-full ${colab.status === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${colab.status}
          </span>
        </td>
        <td class="px-6 py-4">
          <input type="number" min="0" max="100" step="0.5" value="${typeof colab.commission_percent === 'number' ? colab.commission_percent : (parseFloat(colab.commission_percent) || 0)}" data-collab-id="${colab.id}" class="w-24 border rounded px-2 py-1" />
        </td>
        <td class="px-6 py-4 flex items-center gap-2">
          <button onclick="viewMetrics('${colab.id}')" title="Ver rendimiento" class="text-azulClaro hover:text-azulOscuro"><i data-lucide="bar-chart-3" class="w-4 h-4"></i></button>
          <button onclick="editCollaborator('${colab.id}')" class="text-blue-600 hover:text-blue-800"><i data-lucide="edit" class="w-4 h-4"></i></button>
          <button onclick="deleteCollaborator('${colab.id}')" class="text-red-600 hover:text-red-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td>
      </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();

    tableBody.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-collab-id');
        const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
        e.target.value = pct;
        try {
          const { error } = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
            .from('collaborators')
            .update({ commission_percent: pct })
            .eq('id', id)) || supabaseConfig.client
            .from('collaborators')
            .update({ commission_percent: pct })
            .eq('id', id));
          if (error) throw error;
        } catch (err) {
          console.error('Error al guardar porcentaje de comisión:', err);
          alert('No se pudo guardar el porcentaje.');
        }
      });
    });
  }

  // Filtrar y renderizar
  function filterAndRender() {
    collabPageState.data = allCollaborators.slice();
    collabPageState.totalPages = Math.max(1, Math.ceil(collabPageState.data.length / collabPageState.pageSize));
    collabPageState.currentPage = Math.min(collabPageState.currentPage, collabPageState.totalPages);
    renderTablePage();
    renderPagination();
  }

  function renderTablePage() {
    const start = (collabPageState.currentPage - 1) * collabPageState.pageSize;
    const end = start + collabPageState.pageSize;
    const slice = collabPageState.data.slice(start, end);
    renderTable(slice);
    const showing = document.getElementById('collabShowingRange');
    const total = document.getElementById('collabTotalCount');
    if (showing) showing.textContent = `${Math.min(start+1, Math.max(0, collabPageState.data.length))}–${Math.min(end, collabPageState.data.length)}`;
    if (total) total.textContent = String(collabPageState.data.length);
  }

  function renderPagination() {
    const pagesEl = document.getElementById('collabPages');
    const prev = document.getElementById('collabPrev');
    const next = document.getElementById('collabNext');
    const first = document.getElementById('collabFirst');
    const last = document.getElementById('collabLast');
    if (!pagesEl || !prev || !next || !first || !last) return;
    const total = collabPageState.totalPages;
    const current = collabPageState.currentPage;
    prev.disabled = current <= 1;
    first.disabled = current <= 1;
    next.disabled = current >= total;
    last.disabled = current >= total;
    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize/2));
    let end = Math.min(total, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    pagesEl.innerHTML = '';
    for (let p = start; p <= end; p++) {
      const btn = document.createElement('button');
      btn.textContent = String(p);
      btn.className = `px-3 py-2 rounded text-sm ${p===current? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`;
      btn.addEventListener('click', () => { collabPageState.currentPage = p; renderTablePage(); renderPagination(); });
      pagesEl.appendChild(btn);
    }
    prev.onclick = () => { if (collabPageState.currentPage>1) { collabPageState.currentPage--; renderTablePage(); renderPagination(); } };
    next.onclick = () => { if (collabPageState.currentPage<total) { collabPageState.currentPage++; renderTablePage(); renderPagination(); } };
    first.onclick = () => { collabPageState.currentPage = 1; renderTablePage(); renderPagination(); };
    last.onclick = () => { collabPageState.currentPage = total; renderTablePage(); renderPagination(); };
  }

  // Actualizar tarjetas de resumen
  function updateSummary() {
    totalColaboradoresEl.textContent = allCollaborators.length;
    colaboradoresActivosEl.textContent = allCollaborators.filter(c => c.status === 'activo').length;
  }

  // Crear nuevo colaborador
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgDiv.textContent = 'Creando colaborador...';

    // Lógica para crear el usuario en Supabase Auth y luego en la tabla 'collaborators'
    // (Esta parte es compleja y requiere una Edge Function para mayor seguridad)
    // Por ahora, simularemos la creación directa (requiere RLS permisivo)

    try {
        // Usar la Edge Function para crear colaboradores de forma segura
        // Esto evita exponer la service_role key en el frontend
        const response = await fetch(`${supabaseConfig.client.supabaseUrl}/functions/v1/process-collaborator-requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseConfig.client.supabaseKey}`
            },
            body: JSON.stringify({
                action: 'create_collaborator',
                collaboratorData: {
                    email: emailInput.value,
                    password: passwordInput.value,
                    name: nameInput.value,
                    matricula: matriculaInput.value || null
                }
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Error desconocido al crear colaborador');
        }

        msgDiv.textContent = '¡Colaborador creado con éxito!';
        msgDiv.classList.add('text-green-600');
        form.reset();
        await loadCollaborators();

    } catch (error) {
        console.error('Error al crear colaborador:', error);
        msgDiv.textContent = `Error: ${error.message}`;
        msgDiv.classList.add('text-red-600');
    } finally {
        setTimeout(() => {
            msgDiv.textContent = '';
            msgDiv.classList.remove('text-green-600', 'text-red-600');
        }, 5000);
    }
  });

  // --- FUNCIONES DE ACCIÓN (EDITAR/ELIMINAR) ---

  window.editCollaborator = (id) => {
    const colab = allCollaborators.find(c => c.id === id);
    if (!colab) {
      alert('No se encontró el colaborador');
      return;
    }
    editId.value = colab.id || '';
    editName.value = colab.name || '';
    editEmail.value = colab.email || '';
    editPhone.value = colab.phone || '';
    editMatricula.value = colab.matricula || '';
    editPassword.value = '';
    editMsg.textContent = '';
    editMsg.classList.remove('text-green-600','text-red-600');
    editModal.classList.remove('hidden');
    // Bloquear scroll del body y enfocar el primer campo
    document.body.classList.add('overflow-hidden');
    setTimeout(() => { try { editName.focus(); } catch(_){} }, 50);
    // Trap de foco básico dentro del modal
    const focusable = editModal.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    function trap(e){
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstEl){
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl){
        e.preventDefault(); firstEl.focus();
      }
    }
    editModal.addEventListener('keydown', trap);
    // Guardar para remover al cerrar
    editModal._trapHandler = trap;
    if (window.lucide) lucide.createIcons();
  };

  function closeEditModal(){
    editModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (editModal._trapHandler) {
      editModal.removeEventListener('keydown', editModal._trapHandler);
      editModal._trapHandler = null;
    }
  }
  if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

  // Restablecer/generar contraseña segura
  function generateSecurePassword(len = 12){
    try {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}';
      const buf = new Uint32Array(len);
      crypto.getRandomValues(buf);
      return Array.from(buf).map(v => chars[v % chars.length]).join('');
    } catch {
      return Math.random().toString(36).slice(-len);
    }
  }
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', () => {
      const newPass = generateSecurePassword(12);
      editPassword.type = 'text';
      editPassword.value = newPass;
      editMsg.textContent = 'Nueva contraseña generada. Guarda para aplicar los cambios.';
      editMsg.classList.remove('text-red-600');
      editMsg.classList.add('text-yellow-600');
      setTimeout(() => { editPassword.type = 'password'; }, 2500);
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user_id = editId.value;
      const payload = {
        user_id,
        name: editName.value.trim(),
        email: editEmail.value.trim(),
        phone: editPhone.value.trim() || undefined,
        matricula: editMatricula.value.trim() || undefined,
        password: editPassword.value.trim() || undefined,
      };
      // Limpiar mensajes
      editMsg.textContent = 'Guardando cambios...';
      editMsg.classList.remove('text-green-600','text-red-600');

      try {
        // Invocar Edge Function segura para actualizar colaborador
        const { data, error } = await supabaseConfig.client.functions.invoke('update-collaborator', {
          body: payload
        });
        if (error) throw error;
        if (data && data.error) throw new Error(data.error);

        editMsg.textContent = 'Cambios guardados correctamente';
        editMsg.classList.add('text-green-600');
        // Refrescar lista y cerrar
        await loadCollaborators();
        setTimeout(() => {
          closeEditModal();
          editMsg.textContent = '';
          editMsg.classList.remove('text-green-600');
        }, 800);
      } catch (err) {
        console.error('Error al actualizar colaborador:', err);
        const msg = (err && err.message) ? err.message : 'Error al guardar cambios';
        editMsg.textContent = msg;
        editMsg.classList.add('text-red-600');
      }
    });
  }

  // Carga lazy de Chart.js bajo demanda
  async function ensureChartJsLoaded(){
    if (window.Chart) return true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('No se pudo cargar Chart.js'));
      document.head.appendChild(script);
    });
  }
  // Exponer por si se necesita al abrir métricas
  window.ensureChartJsLoaded = ensureChartJsLoaded;

  // Abrir y poblar modal de métricas
  window.viewMetrics = async (id) => {
    try {
      await ensureChartJsLoaded();
      const modal = document.getElementById('metricsModal');
      const overlay = modal?.querySelector('.absolute.inset-0');
      const nameEl = document.getElementById('modalCollabName');
      const emailEl = document.getElementById('modalCollabEmail');
      const avatarEl = document.getElementById('modalCollabAvatar');
      const completedEl = document.getElementById('modalCompletedCount');
      const activeEl = document.getElementById('modalActiveCount');
      const successEl = document.getElementById('modalSuccessRate');
      const avgTimeEl = document.getElementById('modalAvgTime');
      const timeStatsEl = document.getElementById('modalTimeStats');
      const vehicleStatsEl = document.getElementById('modalVehicleStats');
      const rangeEl = document.getElementById('modalRange');
      const chartsSection = document.getElementById('modalChartsSection');
      const toggleChartsEl = document.getElementById('modalToggleCharts');
      const exportCsvEl = document.getElementById('modalExportCsv');
      const collab = allCollaborators.find(c => String(c.id) === String(id));
      if (!collab) return;

      nameEl.textContent = collab.name || String(id);
      emailEl.textContent = collab.email || '';
      avatarEl.innerHTML = generateAvatar(collab.name || 'C');

      const { data: orders } = await supabaseConfig.client
        .from('orders')
        .select('id, status, created_at, completed_at, rating, customer_comment, service:services(name), vehicle:vehicles(name)')
        .eq('assigned_to', id)
        .order('created_at', { ascending: false });
      const arr = Array.isArray(orders) ? orders : [];
      const now = Date.now();
      const selectedRange = (rangeEl && rangeEl.value) ? rangeEl.value : '30';
      function withinRange(dStr) {
        if (selectedRange === 'all') return true;
        const days = Number(selectedRange) || 30;
        if (!dStr) return false;
        const t = new Date(dStr).getTime();
        if (!Number.isFinite(t)) return false;
        return (now - t) <= days * 24 * 3600 * 1000;
      }
      const filtered = arr.filter(o => withinRange(o.completed_at || o.created_at));
      const completed = filtered.filter(o => ['completada', 'completed', 'entregado', 'entregada'].includes(String(o.status).toLowerCase()));
      const active = filtered.filter(o => !['completada', 'completed', 'entregado', 'entregada', 'cancelada', 'cancelled'].includes(String(o.status).toLowerCase()));
      completedEl.textContent = String(completed.length);
      activeEl.textContent = String(active.length);
      const successRate = filtered.length > 0 ? Math.round((completed.length / filtered.length) * 100) : 0;
      successEl.textContent = `${successRate}%`;

      // Renderizar lista de calificaciones
      const ratingsListEl = document.getElementById('modalRatingsList');
      if (ratingsListEl) {
        ratingsListEl.innerHTML = '';
        const ratedOrders = completed.filter(o => {
          const r = o.rating || {};
          const stars = Number(r.stars || r.service || 0);
          const comment = o.customer_comment || r.comment;
          return stars > 0 || !!comment;
        });

        if (ratedOrders.length === 0) {
          ratingsListEl.innerHTML = '<p class="text-gray-500 text-center py-4 text-sm">No hay calificaciones registradas.</p>';
        } else {
          ratedOrders.forEach(o => {
            const r = o.rating || {};
            const stars = Number(r.stars || r.service || 0);
            const comment = o.customer_comment || r.comment || 'Sin comentario';
            const serviceName = o.service?.name || 'Servicio';
            const dateStr = new Date(o.completed_at || o.created_at).toLocaleDateString('es-ES');

            // Generar estrellas
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
              if (i <= stars) {
                starsHtml += '<i class="fas fa-star text-yellow-400 text-xs"></i>';
              } else {
                starsHtml += '<i class="far fa-star text-gray-300 text-xs"></i>';
              }
            }

            const item = document.createElement('div');
            item.className = 'bg-gray-50 p-3 rounded-lg border border-gray-100';
            item.innerHTML = `
              <div class="flex justify-between items-start mb-1">
                <div>
                  <p class="font-semibold text-gray-800 text-sm">${serviceName}</p>
                  <p class="text-xs text-gray-500">Orden #${o.id} • ${dateStr}</p>
                </div>
                <div class="flex space-x-0.5">
                  ${starsHtml}
                </div>
              </div>
              <p class="text-gray-600 text-sm mt-2 italic">"${comment}"</p>
            `;
            ratingsListEl.appendChild(item);
          });
        }
      }

      // Tiempo promedio: diferencia created_at → completed_at en horas
      const avgMs = completed
        .map(o => (new Date(o.completed_at).getTime() - new Date(o.created_at).getTime()))
        .filter(n => Number.isFinite(n) && n > 0)
        .reduce((a,b) => a + b, 0) / Math.max(1, completed.length);
      const avgHours = Math.round((avgMs / 3600000) * 10) / 10;
      avgTimeEl.textContent = `${avgHours}h`;

      // Horario simple: conteo por día de la semana para órdenes completadas
      const counts = [0,0,0,0,0,0,0];
      completed.forEach(o => { 
        const dStr = o.completed_at || o.created_at;
        if (!dStr) return;
        const d = new Date(dStr); 
        if (isNaN(d.getTime())) return;
        const idx = (d.getDay() || 7) - 1; 
        counts[idx] += 1; 
      });
      timeStatsEl.innerHTML = counts.map((c,i) => `<div class="flex items-center justify-between"><span class="text-gray-600">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][i]}</span><span class="font-semibold">${c}</span></div>`).join('');

      // Estadísticas de vehículos
      const vehCount = new Map();
      filtered.forEach(o => { const key = o.vehicle?.name || '—'; vehCount.set(key, (vehCount.get(key)||0)+1); });
      vehicleStatsEl.innerHTML = Array.from(vehCount.entries()).map(([k,v]) => `<div class="flex items-center justify-between"><span class="text-gray-600">${k}</span><span class="font-semibold">${v}</span></div>`).join('');

      // Gráfico semanal
      const ctxW = document.getElementById('modalWeeklyChart');
      if (window.__weeklyChart) { window.__weeklyChart.destroy(); }
      window.__weeklyChart = new Chart(ctxW, {
        type: 'bar',
        data: { labels: ['L','M','X','J','V','S','D'], datasets: [{ label: 'Completadas', data: counts, backgroundColor: 'rgba(37,99,235,0.5)' }] },
        options: { responsive: true, maintainAspectRatio: false }
      });

      // Gráfico de servicios
      const svcCount = new Map();
      filtered.forEach(o => { const key = o.service?.name || '—'; svcCount.set(key, (svcCount.get(key)||0)+1); });
      const labels = Array.from(svcCount.keys());
      const dataVals = Array.from(svcCount.values());
      const ctxS = document.getElementById('modalServicesChart');
      if (window.__servicesChart) { window.__servicesChart.destroy(); }
      window.__servicesChart = new Chart(ctxS, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: dataVals }] },
        options: { responsive: true, maintainAspectRatio: false }
      });

      // Abrir modal
      modal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      const closeBtn = document.getElementById('closeMetricsModal');
      if (closeBtn) closeBtn.onclick = () => { modal.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); };
      if (overlay) overlay.addEventListener('click', () => { modal.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }, { once: true });
      if (rangeEl) rangeEl.onchange = () => window.viewMetrics(String(id));
      if (toggleChartsEl && chartsSection) {
        chartsSection.classList.toggle('hidden', !toggleChartsEl.checked);
        toggleChartsEl.onchange = () => chartsSection.classList.toggle('hidden', !toggleChartsEl.checked);
      }
      if (exportCsvEl) {
        exportCsvEl.onclick = () => {
          const rows = filtered.map(o => ({
            id: o.id,
            status: o.status,
            created_at: o.created_at,
            completed_at: o.completed_at || '',
            rating_stars: Number((o.rating || {}).stars || (o.rating || {}).service || 0),
            comment: o.customer_comment || (o.rating || {}).comment || '',
            service: o.service?.name || '',
            vehicle: o.vehicle?.name || ''
          }));
          const header = ['id','status','created_at','completed_at','rating_stars','comment','service','vehicle'];
          const csv = [header.join(','), ...rows.map(r => header.map(h => {
            const val = String(r[h] ?? '');
            const safe = `"${val.replace(/"/g,'""')}"`;
            return safe;
          }).join(','))].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `rendimiento_${collab.name || id}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        };
      }
    } catch (e) { console.error('Error al abrir métricas:', e); }
  };

  window.deleteCollaborator = async (id) => {
    if (!confirm('¿Estás seguro de que quieres eliminar a este colaborador? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
        // Para eliminar un colaborador, es más seguro hacerlo desde una Edge Function
        // que use la service_role key para eliminar tanto de `auth.users` como de `public.collaborators`.

        // Simulación de la llamada a una función de borde:
        const { error } = await supabaseConfig.client.functions.invoke('delete-user', {
            body: { userId: id }
        });

        if (error) throw error;

        alert('Colaborador eliminado con éxito.');
        await loadCollaborators();

    } catch (error) {
        console.error('Error al eliminar colaborador:', error);
        alert(`Error: ${error.message}`);
    }
  };

  // Exportaciones y wiring de UI básico
  window.loadCollaborators = loadCollaborators;

  function initCollaboratorsAdminPage(){
    if (__initialized) return;
    __initialized = true;
    loadCollaborators();
    const openMetricsBtn = document.getElementById('openMetricsFromSidebar');
    if (openMetricsBtn) openMetricsBtn.addEventListener('click', () => {
      const first = allCollaborators[0];
      if (first) viewMetrics(String(first.id));
    });
    try {
      if (window.__collabRealtimeChannel) supabaseConfig.client.removeChannel(window.__collabRealtimeChannel);
      window.__collabRealtimeChannel = supabaseConfig.client
        .channel('public:collaborators')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collaborators' }, async () => {
          await loadCollaborators();
        })
        .subscribe();
    } catch (e) { console.warn('Realtime no disponible en colaboradores:', e); }
  }

  document.addEventListener('admin-session-ready', (e) => {
    if (!e.detail?.isAdmin) return;
    initCollaboratorsAdminPage();
  }, { once: true });
});

})();
