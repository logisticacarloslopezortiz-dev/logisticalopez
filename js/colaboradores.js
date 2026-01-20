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

    // Helper para mensajes
    function showMsg(el, msg, type = 'info') {
      if (!el) return;
      el.textContent = msg;
      el.className = type === 'error' ? 'text-red-600' : 'text-green-600';
      setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
    }

    // Generar avatar (Node)
    function generateAvatarNode(name) {
      if (!name) return document.createTextNode('');
      const initials = name.trim().split(' ').map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('');
      const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 'bg-yellow-500', 'bg-indigo-500', 'bg-pink-500', 'bg-teal-500'];
      const colorIndex = name.length % colors.length;
      const bgColor = colors[colorIndex];
      
      const div = document.createElement('div');
      div.className = `w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-semibold text-sm`;
      div.textContent = initials;
      return div;
    }

    // Cargar y mostrar colaboradores con reintentos automáticos
    async function loadCollaborators(retryCount = 0) {
      if (!tableBody) return;
      
      const maxRetries = 3;
      const retryDelay = 1000 * (retryCount + 1); // 1s, 2s, 3s
      
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">Cargando colaboradores${retryCount > 0 ? ` (intento ${retryCount + 1}/${maxRetries + 1})` : ''}...</td></tr>`;

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
              <td colspan="6" class="text-center py-4">
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

    // Renderizar la tabla (DOM Nodes)
    function renderTable(collaborators) {
      if (!tableBody) return;
      tableBody.innerHTML = '';

      if (collaborators.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No se encontraron colaboradores.</td></tr>';
        return;
      }

      collaborators.forEach(colab => {
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50';
        
        // Name & Avatar
        const tdName = document.createElement('td');
        tdName.className = 'px-6 py-4 font-medium text-gray-900';
        const divFlex = document.createElement('div');
        divFlex.className = 'flex items-center gap-3';
        divFlex.appendChild(generateAvatarNode(colab.name));
        const divText = document.createElement('div');
        const divName = document.createElement('div');
        divName.className = 'font-medium';
        divName.textContent = colab.name;
        const divRole = document.createElement('div');
        divRole.className = 'text-sm text-gray-500';
        divRole.textContent = colab.role || 'Colaborador';
        divText.append(divName, divRole);
        divFlex.appendChild(divText);
        tdName.appendChild(divFlex);
        
        // Matricula
        const tdMat = document.createElement('td');
        tdMat.className = 'px-6 py-4';
        tdMat.textContent = colab.matricula || 'N/A';
        
        // Email
        const tdEmail = document.createElement('td');
        tdEmail.className = 'px-6 py-4';
        tdEmail.textContent = colab.email;
        
        // Status
        const tdStatus = document.createElement('td');
        tdStatus.className = 'px-6 py-4';
        const spanStatus = document.createElement('span');
        spanStatus.className = `px-2 py-1 text-xs font-semibold rounded-full ${colab.status === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
        spanStatus.textContent = colab.status;
        tdStatus.appendChild(spanStatus);
        
        // Commission
        const tdComm = document.createElement('td');
        tdComm.className = 'px-6 py-4';
        const inputComm = document.createElement('input');
        inputComm.type = 'number';
        inputComm.min = '0';
        inputComm.max = '100';
        inputComm.step = '0.5';
        inputComm.value = typeof colab.commission_percent === 'number' ? colab.commission_percent : (parseFloat(colab.commission_percent) || 0);
        inputComm.className = 'w-24 border rounded px-2 py-1';
        inputComm.dataset.collabId = colab.id;
        inputComm.addEventListener('change', async (e) => {
          const id = e.target.dataset.collabId;
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
            if (window.showSuccess) window.showSuccess('Comisión actualizada');
          } catch (err) {
            console.error('Error al guardar porcentaje de comisión:', err);
            if (window.showError) window.showError('No se pudo guardar el porcentaje.');
          }
        });
        tdComm.appendChild(inputComm);
        
        // Actions
        const tdActions = document.createElement('td');
        tdActions.className = 'px-6 py-4 flex items-center gap-2';
        
        const createBtn = (icon, action, title, colorClass) => {
            const btn = document.createElement('button');
            btn.className = colorClass;
            btn.title = title;
            btn.dataset.action = action;
            btn.dataset.id = colab.id;
            btn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
            return btn;
        };
        
        tdActions.append(
            createBtn('bar-chart-3', 'metrics', 'Ver rendimiento', 'text-blue-500 hover:text-blue-700'),
            createBtn('edit', 'edit', 'Editar', 'text-blue-600 hover:text-blue-800'),
            createBtn('trash-2', 'delete', 'Eliminar', 'text-red-600 hover:text-red-800'),
            createBtn('map', 'location', 'Ver ubicación', 'text-teal-500 hover:text-teal-700')
        );
        
        tr.append(tdName, tdMat, tdEmail, tdStatus, tdComm, tdActions);
        tableBody.appendChild(tr);
      });

      if (window.lucide) lucide.createIcons();
    }

    // Event delegation for actions
    if (tableBody) {
      tableBody.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          
          if (action === 'metrics') window.viewMetrics(id);
          if (action === 'edit') window.editCollaborator(id);
          if (action === 'delete') window.deleteCollaborator(id);
          if (action === 'location') window.viewLocation(id);
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
      if (totalColaboradoresEl) totalColaboradoresEl.textContent = allCollaborators.length;
      if (colaboradoresActivosEl) colaboradoresActivosEl.textContent = allCollaborators.filter(c => c.status === 'activo').length;
    }

    // Crear nuevo colaborador
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMsg(msgDiv, 'Creando colaborador...', 'info');

        try {
            // Obtener sesión para usar token seguro
            const { data: { session } } = await supabaseConfig.client.auth.getSession();
            const token = session?.access_token;
            if (!token) throw new Error('No hay sesión activa');

            const response = await fetch(`${supabaseConfig.client.supabaseUrl}/functions/v1/process-collaborator-requests`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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

            showMsg(msgDiv, '¡Colaborador creado con éxito!', 'success');
            form.reset();
            await loadCollaborators();

        } catch (error) {
            console.error('Error al crear colaborador:', error);
            showMsg(msgDiv, `Error: ${error.message}`, 'error');
        }
      });
    }

    // --- FUNCIONES DE ACCIÓN (EDITAR/ELIMINAR) ---

    window.editCollaborator = (id) => {
      const colab = allCollaborators.find(c => c.id === id);
      if (!colab) {
        if (window.showError) window.showError('No se encontró el colaborador');
        return;
      }
      editId.value = colab.id || '';
      editName.value = colab.name || '';
      editEmail.value = colab.email || '';
      editPhone.value = colab.phone || '';
      editMatricula.value = colab.matricula || '';
      editPassword.value = '';
      if (editMsg) { editMsg.textContent = ''; editMsg.className = ''; }
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
        showMsg(editMsg, 'Nueva contraseña generada. Guarda para aplicar los cambios.', 'warning');
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
        showMsg(editMsg, 'Guardando cambios...', 'info');

        try {
          // Invocar Edge Function segura para actualizar colaborador
          const { data, error } = await supabaseConfig.client.functions.invoke('update-collaborator', {
            body: payload
          });
          if (error) throw error;
          if (data && data.error) throw new Error(data.error);

          showMsg(editMsg, 'Cambios guardados correctamente', 'success');
          // Refrescar lista y cerrar
          await loadCollaborators();
          setTimeout(() => {
            closeEditModal();
            if (editMsg) editMsg.textContent = '';
          }, 800);
        } catch (err) {
          console.error('Error al actualizar colaborador:', err);
          const msg = (err && err.message) ? err.message : 'Error al guardar cambios';
          showMsg(editMsg, msg, 'error');
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

        // Limpiar handlers anteriores para evitar memory leaks
        if (rangeEl) rangeEl.onchange = null;
        if (toggleChartsEl) toggleChartsEl.onchange = null;
        if (exportCsvEl) exportCsvEl.onclick = null;

        nameEl.textContent = collab.name || String(id);
        emailEl.textContent = collab.email || '';
        avatarEl.innerHTML = '';
        avatarEl.appendChild(generateAvatarNode(colab.name || 'C'));

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

          if (window.showSuccess) window.showSuccess('Colaborador eliminado con éxito.');
          await loadCollaborators();

      } catch (error) {
          console.error('Error al eliminar colaborador:', error);
          if (window.showError) window.showError(`Error: ${error.message}`);
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
      initGlobalCollaboratorsMap();
    }

    document.addEventListener('admin-session-ready', (e) => {
      if (!e.detail?.isAdmin) return;
      initCollaboratorsAdminPage();
    }, { once: true });

    let __globalMap = null;
    let __globalMarkers = new Map();
    async function initGlobalCollaboratorsMap() {
      const el = document.getElementById('collaboratorsMap');
      if (!el || typeof L === 'undefined') return;
      if (!__globalMap) {
        __globalMap = L.map(el).setView([18.4861, -69.9312], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(__globalMap);
      }
      await refreshGlobalCollaboratorsPositions();
      try {
        if (window.__locationsRealtimeChannel) supabaseConfig.client.removeChannel(window.__locationsRealtimeChannel);
        window.__locationsRealtimeChannel = supabaseConfig.client
          .channel('public:collaborator_locations')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'collaborator_locations' }, payload => {
            if (payload.new) updateMarker(payload.new);
          })
          .subscribe();
      } catch (_) {}
    }

    function extractLatestLatLng(tracking) {
      if (!Array.isArray(tracking) || !tracking.length) return null;
      for (let i = tracking.length - 1; i >= 0; i--) {
        const t = tracking[i];
        const lat = Number(t?.lat);
        const lng = Number(t?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
      return null;
    }

    function updateMarker(location) {
      if (!location || !location.lat || !location.lng) return;
      const id = location.collaborator_id;
      const latlng = [location.lat, location.lng];
      
      // Find collaborator info for popup
      const col = allCollaborators.find(c => String(c.id) === String(id));
      
      // Filtrar colaboradores inactivos o no encontrados
      if (!col || col.status !== 'activo') {
         // Si existe marker, eliminarlo
         if (__globalMarkers.has(id)) {
           __globalMap.removeLayer(__globalMarkers.get(id));
           __globalMarkers.delete(id);
         }
         return;
      }

      const name = col ? col.name : 'Colaborador';
      
      if (__globalMarkers.has(id)) {
        __globalMarkers.get(id).setLatLng(latlng).setPopupContent(name);
      } else {
        const marker = L.marker(latlng, {
          icon: L.divIcon({
            className: 'pulse-marker',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          })
        }).addTo(__globalMap).bindPopup(name);
        __globalMarkers.set(id, marker);
      }
    }

    async function refreshGlobalCollaboratorsPositions() {
      try {
        const { data: locations } = await supabaseConfig.client
          .from('collaborator_locations')
          .select('collaborator_id, lat, lng, updated_at');
        
        const arr = Array.isArray(locations) ? locations : [];
        const activeIds = new Set(arr.map(l => String(l.collaborator_id)));
        
        // Eliminar markers obsoletos
        for (const id of __globalMarkers.keys()) {
          if (!activeIds.has(String(id))) {
            const m = __globalMarkers.get(id);
            if(m) __globalMap.removeLayer(m);
            __globalMarkers.delete(id);
          }
        }

        for (const loc of arr) {
          updateMarker(loc);
        }
      } catch (_) {}
    }

    let __collabDetailMap = null;
    let __collabDetailMarker = null;
    let __detailChannel = null;

    window.viewLocation = async function(collabId) {
      const modal = document.getElementById('collaboratorMapModal');
      const closeBtn = document.getElementById('closeCollabMapModal');
      const title = document.getElementById('collabMapTitle');
      const mapEl = document.getElementById('collaboratorMapDetail');

      const c = allCollaborators.find(x => String(x.id) === String(collabId));
      if (title) title.textContent = c ? `Ubicación de ${c.name}` : 'Ubicación del colaborador';

      modal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');

      // 🧹 LIMPIAR MAPA ANTERIOR SI EXISTE
      if (__collabDetailMap) {
        __collabDetailMap.remove();
        __collabDetailMap = null;
        __collabDetailMarker = null;
      }
      if (__detailChannel) {
        supabaseConfig.client.removeChannel(__detailChannel);
        __detailChannel = null;
      }

      // 🗺️ CREAR MAPA LIMPIO
      __collabDetailMap = L.map(mapEl).setView([18.4861, -69.9312], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(__collabDetailMap);

      // 📍 UBICACIÓN EN TIEMPO REAL (SNAPSHOT INICIAL)
      const { data: loc } = await supabaseConfig.client
        .from('collaborator_locations')
        .select('lat, lng')
        .eq('collaborator_id', collabId)
        .maybeSingle();

      if (loc?.lat && loc?.lng) {
        __collabDetailMarker = L.marker([loc.lat, loc.lng]).addTo(__collabDetailMap);
        __collabDetailMap.setView([loc.lat, loc.lng], 15);
      }

      // 📡 SUSCRIPCIÓN REALTIME (MEJORA PRO)
      __detailChannel = supabaseConfig.client
        .channel(`collab_detail:${collabId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'collaborator_locations', 
          filter: `collaborator_id=eq.${collabId}` 
        }, payload => {
          if (payload.new && payload.new.lat && payload.new.lng) {
            const { lat, lng } = payload.new;
            if (__collabDetailMarker) {
              __collabDetailMarker.setLatLng([lat, lng]);
            } else {
              __collabDetailMarker = L.marker([lat, lng]).addTo(__collabDetailMap);
            }
            // Opcional: Centrar mapa si se desea seguimiento automático
            // __collabDetailMap.panTo([lat, lng]);
          }
        })
        .subscribe();

      // 🧠 Forzar recálculo de tamaño
      setTimeout(() => {
        try { __collabDetailMap.invalidateSize(); } catch (_) {}
      }, 250);

      // ❌ CERRAR MODAL CORRECTAMENTE
      if (closeBtn) {
        closeBtn.onclick = () => {
          modal.classList.add('hidden');
          document.body.classList.remove('overflow-hidden');

          if (__collabDetailMap) {
            __collabDetailMap.remove();
            __collabDetailMap = null;
            __collabDetailMarker = null;
          }
          if (__detailChannel) {
            supabaseConfig.client.removeChannel(__detailChannel);
            __detailChannel = null;
          }
        };
      }
    };
  }); // End DOMContentLoaded

})(); // End IIFE
