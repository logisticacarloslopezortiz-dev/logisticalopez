/**
 * AUTH GUARD: Verificar autenticación y autorización
 * Paso 1: Verificar sesión activa en Supabase Auth
 * Paso 2: Validar que el usuario sea un colaborador activo en tabla collaborators
 * Paso 3: Si todo es válido, cargar panel. Si no, redirigir a login.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Verificar que Supabase esté disponible
  if (!window.supabaseConfig || !supabaseConfig.client) {
    console.error('Supabase Config no inicializado. Redirigiendo a login.');
    window.location.href = 'login-colaborador.html';
    return;
  }

  // Paso 1: Obtener sesión activa
  let session = null;
  try {
    // Intentar refrescar sesión si es necesario (helper en supabase-config)
    if (supabaseConfig.ensureFreshSession) {
      try { await supabaseConfig.ensureFreshSession(); } catch (e) { /* no-op */ }
    }
    const { data } = await supabaseConfig.client.auth.getSession();
    session = data?.session;
  } catch (e) {
    console.error('Error obteniendo sesión:', e);
  }

  if (!session) {
    console.warn('No hay sesión activa. Redirigiendo a login.');
    try { localStorage.removeItem('userRole'); localStorage.removeItem('collaboratorId'); localStorage.removeItem('tlc_active_job'); localStorage.removeItem('tlc_offline_updates'); } catch(_){}
    window.location.href = 'login-colaborador.html';
    return;
  }

  const userId = session.user?.id;
  console.log('Sesión activa. Usuario ID:', userId);

  // Paso 2: Validar que sea colaborador activo en la BD
  const validation = await supabaseConfig.validateActiveCollaborator(userId);
  
  if (!validation.isValid) {
    const errMsg = String(validation.error || '').toLowerCase();
    const isNetwork = errMsg.includes('failed to fetch') || errMsg.includes('network');
    if (!isNetwork) {
      const msg = validation.error === 'Collaborator is not active'
        ? 'Tu cuenta ha sido desactivada. Contacta al administrador.'
        : validation.error === 'Invalid role for this panel'
        ? 'No tienes permisos de colaborador. Acceso denegado.'
        : 'No estás registrado como colaborador. Acceso denegado.';
      alert(msg);
      try { await supabaseConfig.client.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem('userRole'); localStorage.removeItem('collaboratorId'); localStorage.removeItem('tlc_active_job'); localStorage.removeItem('tlc_offline_updates'); } catch(_){}
      window.location.href = 'login-colaborador.html';
      return;
    } else {
      console.warn('Modo offline: validación de colaborador falló por red. Continuando con UI limitada.');
    }
  }

  // Paso 3: Validación exitosa. Cargar panel
  console.log('✅ Validación de colaborador exitosa:', validation.collaborator.email);
  
  // Guardar en localStorage para referencia
  try {
    localStorage.setItem('userRole', 'colaborador');
    localStorage.setItem('collaboratorId', userId);
  } catch (_) {}

  // Cargar el panel y funcionalidades
  updateCollaboratorProfile(session);
  checkRoleWarning();
  await fetchAndRender();
  await restoreActiveJob();
  setupActions();
  setupActiveJob();
  setupRealtime();
  setupOfflineSync();
});

function collabDisplayName(email) {
  if (!email) return 'Usuario';
  const base = String(email).split('@')[0].replace(/[._-]+/g, ' ').trim();
  return base.length > 0 ? base[0].toUpperCase() + base.slice(1) : 'Usuario';
}

function updateCollaboratorProfile(session) {
  const user = session.user;
  const name = user.user_metadata && user.user_metadata.full_name ? user.user_metadata.full_name : collabDisplayName(user.email);
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const nameEl = document.getElementById('collabName');
  if (nameEl) nameEl.textContent = name;
  const emailEl = document.getElementById('collabEmail');
  if (emailEl) emailEl.textContent = user.email || '';
  const avatarEl = document.getElementById('collabAvatar');
  if (avatarEl) avatarEl.textContent = initials;
}

function checkRoleWarning() {
  try {
    const role = localStorage.getItem('userRole');
    const el = document.getElementById('roleWarning');
    if (!el) return;
    
    // Mostrar advertencia solo si el rol NO es 'colaborador'
    // (esto debería ser raro porque el Auth Guard ya validó esto)
    if (role !== 'colaborador') {
      console.warn('⚠️ Inconsistencia: userRole en localStorage no es "colaborador"');
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  } catch (_) {}
}

async function fetchAndRender() {
  let all = [];
  try {
    all = await supabaseConfig.getOrders();
    if (!Array.isArray(all)) all = [];
  } catch (_) {
    try { all = JSON.parse(localStorage.getItem('cached_orders') || '[]'); } catch (_) { all = []; }
  }
  try { localStorage.setItem('cached_orders', JSON.stringify(all)); } catch (_){ }
  let collabId = null;
  try {
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    collabId = session?.user?.id || null;
  } catch (_) {
    try { collabId = localStorage.getItem('collaboratorId') || null; } catch (_){ collabId = null; }
  }
  const pending = (all || []).filter(o => String(o.status || '').toLowerCase() === 'pendiente' && !o.assigned_to);
  const mine = (all || []).filter(o => o.assigned_to === collabId && !['completada','cancelada'].includes(String(o.status || '').toLowerCase()));
  const completedMine = (all || []).filter(o => o.assigned_to === collabId && String(o.status || '').toLowerCase() === 'completada');
  const assignedCountEl = document.getElementById('assignedCount');
  if (assignedCountEl) assignedCountEl.textContent = String(mine.length);
  const pendingCountEl = document.getElementById('pendingCount');
  if (pendingCountEl) pendingCountEl.textContent = String(pending.length);
  const completedCountEl = document.getElementById('completedCount');
  if (completedCountEl) completedCountEl.textContent = String(completedMine.length);
  renderPendingCards(pending);
  renderAssignedCards(mine);
  if (!getPersistedActiveJob() && mine.length > 0) {
    const active = mine.find(o => String(o.status || '').toLowerCase() === 'en curso') || mine[0];
    if (active && active.id) showActiveJobView(active.id);
  }
  if (window.lucide) lucide.createIcons();
}

function renderPendingCards(orders) {
  const container = document.getElementById('pendingOrdersContainer');
  if (!container) return;
  if (!orders || orders.length === 0) {
    container.innerHTML = '<div class="p-6 bg-white rounded-lg border text-center text-gray-500">No hay solicitudes pendientes.</div>';
    return;
  }
  container.innerHTML = orders.map(o => {
    const statusLabel = String(o.status || '').toUpperCase();
    return `
      <div class="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div class="p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">${statusLabel}</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm hover:bg-gray-200" data-action="view" data-id="${o.id}">Ver</button>
            <button class="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700" data-action="accept" data-id="${o.id}">Aceptar</button>
          </div>
        </div>
        <div class="px-4 pb-4 text-sm text-gray-700">
          <h3 class="font-semibold text-gray-900 mb-1">${o.name || 'Cliente'}</h3>
          <p class="text-gray-600 mb-2">${o.phone || ''}</p>
          <div class="mb-2">
            <p class="text-sm font-medium text-gray-800">${(o.service && o.service.name) ? o.service.name : (o.service || '—')}</p>
            ${o.vehicle ? `<p class="text-xs text-gray-500">${(o.vehicle && o.vehicle.name) ? o.vehicle.name : o.vehicle}</p>` : ''}
          </div>
          <div class="text-xs text-gray-600 mb-2">
            <span class="font-medium">Ruta:</span>
            <span class="block truncate" title="${o.pickup || ''} → ${o.delivery || ''}">
              ${o.pickup || ''} → ${o.delivery || ''}
            </span>
          </div>
          <div class="text-xs text-gray-600">
            <span class="font-medium">Fecha:</span> ${o.date || ''} • ${o.time || ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAssignedCards(orders) {
  const container = document.getElementById('assignedOrdersContainer');
  if (!container) return;
  if (!orders || orders.length === 0) {
    container.innerHTML = '<div class="p-6 bg-white rounded-lg border text-center text-gray-500">No tienes trabajos activos.</div>';
    return;
  }
  container.innerHTML = orders.map(o => {
    const st = String(o.status || '').toLowerCase();
    const badge = st === 'en curso' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700';
    const label = st === 'en curso' ? 'EN CURSO' : (st === 'aceptada' ? 'ACEPTADA' : 'ASIGNADA');
    return `
      <div class="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div class="p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 text-xs font-semibold rounded-full ${badge}">${label}</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm hover:bg-gray-200" data-action="view" data-id="${o.id}">Ver</button>
            <button class="px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm hover:bg-gray-200" data-action="start" data-id="${o.id}">Iniciar</button>
            <button class="px-3 py-1 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700" data-action="complete" data-id="${o.id}">Completar</button>
          </div>
        </div>
        <div class="px-4 pb-4 text-sm text-gray-700">
          <h3 class="font-semibold text-gray-900 mb-1">${o.name || 'Cliente'}</h3>
          <p class="text-gray-600 mb-2">${o.phone || ''}</p>
          <div class="mb-2">
            <p class="text-sm font-medium text-gray-800">${(o.service && o.service.name) ? o.service.name : (o.service || '—')}</p>
            ${o.vehicle ? `<p class="text-xs text-gray-500">${(o.vehicle && o.vehicle.name) ? o.vehicle.name : o.vehicle}</p>` : ''}
          </div>
          <div class="text-xs text-gray-600 mb-2">
            <span class="font-medium">Ruta:</span>
            <span class="block truncate" title="${o.pickup || ''} → ${o.delivery || ''}">
              ${o.pickup || ''} → ${o.delivery || ''}
            </span>
          </div>
          <div class="text-xs text-gray-600">
            <span class="font-medium">Fecha:</span> ${o.date || ''} • ${o.time || ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function setupActions() {
  const pendingContainer = document.getElementById('pendingOrdersContainer');
  const assignedContainer = document.getElementById('assignedOrdersContainer');
  // Delegate click events for pending container: View + Accept
  if (pendingContainer) {
    pendingContainer.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('[data-action="view"]');
      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        openOrderModal(id);
        return;
      }
      const btn = e.target.closest('[data-action="accept"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      openAcceptModal(id);
    });
  }

  // Delegate click events for assigned container: View + Start + Complete
  if (assignedContainer) {
    assignedContainer.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('[data-action="view"]');
      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        openOrderModal(id);
        return;
      }
      const startBtn = e.target.closest('[data-action="start"]');
      const completeBtn = e.target.closest('[data-action="complete"]');
      if (!startBtn && !completeBtn) return;
      const id = (startBtn || completeBtn).getAttribute('data-id');
      if (startBtn) {
        const updates = { status: 'En curso', accepted_at: new Date().toISOString() };
        try { await supabaseConfig.updateOrder(id, updates); await updateLastStatus(id, 'En curso'); showInfo('Has iniciado el servicio.'); await notifyStatusChange(id, 'En curso'); } catch (e) { showWarning('Sin conexión. Guardado para sincronizar.'); queueOfflineUpdate(id, updates); }
        persistActiveJob(id, 'En curso');
      }
      if (completeBtn) {
        const canFinish = await canFinalizeOrder(id);
        if (!canFinish) { showWarning('Debes subir al menos 1 foto antes de finalizar.'); return; }
        const updates = { status: 'Completada', completed_at: new Date().toISOString() };
        try { await supabaseConfig.updateOrder(id, updates); await updateLastStatus(id, 'Completada'); showSuccess('Servicio completado.'); await notifyStatusChange(id, 'Completada'); updateNotifyIndicator('Completada'); } catch (e) { showWarning('Sin conexión. Guardado para sincronizar.'); queueOfflineUpdate(id, updates); }
        // clear persisted active job when completed
        try { localStorage.removeItem('tlc_active_job'); } catch (_) {}
        await fetchAndRender();
        const activeSection = document.getElementById('activeJobSection');
        const pendingSec = document.getElementById('pendingOrdersContainer');
        const assignedWrapper = document.getElementById('assignedOrdersWrapper');
        if (activeSection) activeSection.classList.add('hidden');
        if (pendingSec && pendingSec.parentElement) pendingSec.parentElement.classList.remove('hidden');
        if (assignedWrapper) assignedWrapper.classList.remove('hidden');
      }
      await fetchAndRender();
    });
  }

  // Modal controls
  const modalClose = document.getElementById('orderModalClose');
  const modalAssign = document.getElementById('orderModalAssign');
  const modalStart = document.getElementById('orderModalStart');
  if (modalClose) modalClose.addEventListener('click', closeOrderModal);
  if (modalAssign) modalAssign.addEventListener('click', async (e) => {
    const id = modalAssign.getAttribute('data-id');
    if (!id) return;
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    const collabId = session?.user?.id || null;
    const updates = { assigned_to: collabId, status: 'Aceptada', assigned_at: new Date().toISOString() };
    try { await supabaseConfig.updateOrder(id, updates); await updateLastStatus(id, 'Aceptada'); showSuccess('Trabajo asignado a ti.'); await notifyStatusChange(id, 'Aceptada'); } catch (err) { showWarning('No se pudo asignar. Guardado para sincronizar.'); queueOfflineUpdate(id, updates); }
    persistActiveJob(id, 'Aceptada');
    closeOrderModal();
    await fetchAndRender();
    showActiveJobView(id);
  });
  if (modalStart) modalStart.addEventListener('click', async (e) => {
    const id = modalStart.getAttribute('data-id');
    if (!id) return;
    const updates = { status: 'En curso', accepted_at: new Date().toISOString() };
    try { await supabaseConfig.updateOrder(id, updates); await updateLastStatus(id, 'En curso'); showInfo('Servicio iniciado.'); await notifyStatusChange(id, 'En curso'); } catch (err) { showWarning('No se pudo iniciar. Guardado para sincronizar.'); queueOfflineUpdate(id, updates); }
    persistActiveJob(id, 'En curso');
    closeOrderModal();
    await fetchAndRender();
    showActiveJobView(id);
  });

  // Logout button
  const logoutBtn = document.getElementById('logout-button');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await supabaseConfig.client.auth.signOut();
        localStorage.removeItem('userRole');
        localStorage.removeItem('collaboratorId');
        localStorage.removeItem('tlc_active_job');
        localStorage.removeItem('tlc_offline_updates');
        window.location.href = 'login-colaborador.html';
      } catch (e) {
        console.error('Logout error:', e);
        window.location.href = 'login-colaborador.html';
      }
    });
  }
}

function setupActiveJob() {
  const persisted = getPersistedActiveJob();
  if (persisted) showActiveJobView(persisted);
  const evidenceInput = document.getElementById('evidenceInput');
  if (evidenceInput) {
    evidenceInput.addEventListener('change', () => {
      const gallery = document.getElementById('evidenceGallery');
      if (!gallery) return;
      gallery.innerHTML = '';
      const files = Array.from(evidenceInput.files || []);
      files.forEach(f => {
        const url = URL.createObjectURL(f);
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Evidencia';
        img.loading = 'lazy';
        img.className = 'w-full h-32 object-cover rounded-lg';
        gallery.appendChild(img);
      });
    });
  }
  const photoUpload = document.getElementById('photoUpload');
  if (photoUpload) {
    photoUpload.addEventListener('change', async () => {
      const id = getPersistedActiveJob();
      const files = Array.from(photoUpload.files || []);
      const gallery = document.getElementById('photoGallery');
      if (gallery) {
        gallery.innerHTML = '';
        files.forEach(f => {
          const url = URL.createObjectURL(f);
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'Evidencia';
          img.loading = 'lazy';
          img.className = 'w-full h-24 object-cover rounded-md';
          gallery.appendChild(img);
        });
      }
      if (id && files.length > 0) {
        await uploadEvidenceForOrder(id, files);
      }
    });
  }
  const cancelBtn = document.getElementById('cancelActiveJobBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      const id = getPersistedActiveJob();
      if (!id) return;
      try {
        if (window.OrderManager && typeof window.OrderManager.cancelActiveJob === 'function') {
          const res = await window.OrderManager.cancelActiveJob(id);
          if (!res?.success) throw new Error(res?.error || 'cancel_failed');
        } else {
          await supabaseConfig.updateOrder(id, { status: 'Cancelada' });
        }
        try { localStorage.removeItem('tlc_active_job'); } catch(_){ }
        showSuccess('Trabajo cancelado.');
        await fetchAndRender();
        const activeSection = document.getElementById('activeJobSection');
        const pendingSec = document.getElementById('pendingOrdersContainer');
        const assignedWrapper = document.getElementById('assignedOrdersWrapper');
        if (activeSection) activeSection.classList.add('hidden');
        if (pendingSec && pendingSec.parentElement) pendingSec.parentElement.classList.remove('hidden');
        if (assignedWrapper) assignedWrapper.classList.remove('hidden');
      } catch (e) {
        showError('No se pudo cancelar el trabajo.');
      }
    });
  }
  const activeSection = document.getElementById('activeJobSection');
  if (activeSection) {
    activeSection.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      const status = btn.getAttribute('data-status');
      const id = getPersistedActiveJob();
      if (!id) return;
      if (status === 'Completada') {
        const ok = await canFinalizeOrder(id);
        if (!ok) { showWarning('Debes subir al menos 1 foto antes de finalizar.'); return; }
        const updates = { status: 'Completada', completed_at: new Date().toISOString() };
        try { await supabaseConfig.updateOrder(id, updates); await notifyStatusChange(id, 'Completada'); showSuccess('Has finalizado el servicio.'); updateNotifyIndicator('Completada'); } catch (err) { showWarning('Sin conexión. Guardado para sincronizar.'); queueOfflineUpdate(id, updates); }
        const stEl = document.getElementById('activeJobStatus');
        if (stEl) stEl.textContent = 'Completada';
      } else {
        try {
          await updateLastStatus(id, status);
          await notifyStatusChange(id, status);
          showInfo(`Estado actualizado: ${status}`);
          updateNotifyIndicator(status);
        } catch (err) {
          queueOfflineUpdate(id, { last_collab_status: status });
          showWarning('Sin conexión. Guardado para sincronizar.');
        }
      }
    });
  }

  const uploadBtn = document.getElementById('uploadEvidenceBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const id = getPersistedActiveJob();
      if (!id) return;
      const input = document.getElementById('evidenceInput');
      const files = Array.from(input?.files || []);
      if (files.length === 0) { showInfo('Selecciona imágenes para subir.'); return; }
      await uploadEvidenceForOrder(id, files);
    });
  }
}

function showActiveJobView(orderId) {
  const activeSection = document.getElementById('activeJobSection');
  if (!activeSection) return;
  const pendingSec = document.getElementById('pendingOrdersContainer');
  const assignedWrapper = document.getElementById('assignedOrdersWrapper');
  if (pendingSec) pendingSec.parentElement.classList.add('hidden');
  if (assignedWrapper) assignedWrapper.classList.add('hidden');
  activeSection.classList.remove('hidden');
  try { activeSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(_) {}
  const actionsWrap = document.getElementById('activeJobActionButtons');
  if (actionsWrap) actionsWrap.innerHTML = '';
  renderActiveJob(orderId);
}

async function renderActiveJob(orderId, orderData) {
  const all = await supabaseConfig.getOrders();
  const order = orderData || (all || []).find(o => String(o.id) === String(orderId));
  if (!order) {
    console.error('Orden no encontrada:', orderId);
    return;
  }

  // Obtener info de sesión
  let collabName = '';
  try {
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    collabName = session?.user?.user_metadata?.full_name || collabDisplayName(session?.user?.email || '');
  } catch (_) {}

  // Actualizar datos del trabajo activo
  const infoEl = document.getElementById('activeJobInfo');
  if (infoEl) {
    const pickup = order?.pickup || 'Origen no especificado';
    const delivery = order?.delivery || 'Destino no especificado';
    const cliente = order?.name || 'Cliente';
    const serv = (order?.service && typeof order.service === 'object' && order.service.name) ? order.service.name : (order?.service || '—');
    const fecha = order?.date || '—';
    const hora = order?.time || '—';
    const vehicle = (order?.vehicle && typeof order.vehicle === 'object' && order.vehicle.name) ? order.vehicle.name : (order?.vehicle || 'No especificado');
    const notes = order?.notes || 'Sin notas adicionales';
    const shortId = order?.short_id || order?.id;

    // Actualizar elementos individuales
    const orderId_el = document.getElementById('activeJobOrderId');
    if (orderId_el) orderId_el.textContent = `#${shortId}`;

    const collab_el = document.getElementById('activeJobCollab');
    if (collab_el) collab_el.textContent = collabName || 'Colaborador';

    const client_el = document.getElementById('activeJobClient');
    if (client_el) client_el.textContent = cliente;

    const phone_el = document.getElementById('activeJobPhone');
    if (phone_el) phone_el.textContent = order?.phone || '—';

    const pickup_el = document.getElementById('activeJobPickup');
    if (pickup_el) pickup_el.textContent = pickup;

    const delivery_el = document.getElementById('activeJobDelivery');
    if (delivery_el) delivery_el.textContent = delivery;

    const service_el = document.getElementById('activeJobService');
    if (service_el) service_el.textContent = serv;

    const vehicle_el = document.getElementById('activeJobVehicle');
    if (vehicle_el) vehicle_el.textContent = vehicle;

    const notes_el = document.getElementById('activeJobNotes');
    if (notes_el) notes_el.textContent = notes;
  }

  // Referencias a elementos opcionales
  const routeEl = document.getElementById('activeJobRoute');
  const summaryEl = document.getElementById('activeJobSummary');

  // Actualizar estado
  const statusEl = document.getElementById('activeJobStatus');
  if (statusEl) statusEl.textContent = String(order?.status || 'Asignada').toUpperCase();
  // Ajustar estilo del badge según estado
  if (statusEl) {
    const st = String(order?.status || '').toLowerCase();
    statusEl.className = 'px-4 py-2 text-xs font-bold rounded-full shadow-lg';
    if (st.includes('recoger') || st.includes('camino')) {
      statusEl.style.background = 'var(--turquesa)'; statusEl.style.color = '#fff';
    } else if (st.includes('cargando')) {
      statusEl.style.background = 'linear-gradient(90deg,#f97316,#fb923c)'; statusEl.style.color = '#fff';
    } else if (st.includes('entregar') || st.includes('completada')) {
      statusEl.style.background = 'linear-gradient(90deg,#10b981,#34d399)'; statusEl.style.color = '#fff';
    } else if (st.includes('retraso') || st.includes('tapon')) {
      statusEl.style.background = 'linear-gradient(90deg,#f59e0b,#f97316)'; statusEl.style.color = '#fff';
    } else {
      statusEl.style.background = '#ffffff'; statusEl.style.color = 'var(--azul)';
    }
  }
  if (summaryEl) {
    const cliente = order?.name || 'Cliente';
    const serv = (order?.service && order.service.name) ? order.service.name : (order?.service || '—');
    const fecha = order?.date || '—';
    const hora = order?.time || '';
    let collabName = '';
    try {
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      collabName = session?.user?.user_metadata?.full_name || collabDisplayName(session?.user?.email || '');
    } catch (_) {}
    summaryEl.innerHTML = `<div><strong>Cliente:</strong> ${cliente}</div><div><strong>Servicio:</strong> ${serv}</div><div><strong>Fecha/Hora:</strong> ${fecha} ${hora}</div><div><strong>Colaborador:</strong> ${collabName || '—'}</div>`;
  }
  const openInMaps = document.getElementById('openInMaps');
  if (openInMaps) {
    const q = encodeURIComponent(`${order?.pickup || ''} to ${order?.delivery || ''}`);
    openInMaps.href = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(order?.pickup || '')}&destination=${encodeURIComponent(order?.delivery || '')}`;
  }
  const openOrigin = document.getElementById('openOrigin');
  if (openOrigin) {
    openOrigin.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order?.pickup || '')}`;
  }
  const openDestination = document.getElementById('openDestination');
  if (openDestination) {
    openDestination.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order?.delivery || '')}`;
  }
  const openTracking = document.getElementById('openTracking');
  if (openTracking) {
    const tu = order?.tracking_url || null;
    openTracking.href = tu ? tu : `seguimiento.html?id=${encodeURIComponent(orderId)}`;
  }
  const routeBtn = document.getElementById('viewRouteBtn');
  const originBtn = document.getElementById('viewOriginBtn');
  const destBtn = document.getElementById('viewDestinationBtn');
  if (routeBtn) routeBtn.onclick = () => {
    const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(order?.pickup || '')}&destination=${encodeURIComponent(order?.delivery || '')}`;
    window.open(url, '_blank');
  };
  if (originBtn) originBtn.onclick = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order?.pickup || '')}`;
    window.open(url, '_blank');
  };
  if (destBtn) destBtn.onclick = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order?.delivery || '')}`;
    window.open(url, '_blank');
  };

  // Generar botones de acción dinámicamente
  generateActiveJobButtons(orderId, order);

  // Inicializar mapa
  initActiveMap(order);
}

// Generar botones de acción con colores vibrantes
function generateActiveJobButtons(orderId, order) {
  const container = document.getElementById('activeJobActionButtons');
  if (!container) return;

  const status = String(order?.status || '').toLowerCase();
  
  // Definir botones disponibles según el estado actual
  const buttons = [
    {
      id: 'btn-pickup',
      label: 'En camino a recoger',
      icon: 'arrow-right',
      class: 'btn-action btn-pickup',
      status: 'en camino a recoger',
      show: !['en camino a recoger', 'completada', 'cancelada'].includes(status)
    },
    {
      id: 'btn-loading',
      label: 'Cargando',
      icon: 'package',
      class: 'btn-action btn-loading',
      status: 'cargando',
      show: !['cargando', 'completada', 'cancelada'].includes(status)
    },
    {
      id: 'btn-deliver',
      label: 'En camino a entregar',
      icon: 'truck',
      class: 'btn-action btn-deliver',
      status: 'en camino a entregar',
      show: !['en camino a entregar', 'completada', 'cancelada'].includes(status)
    },
    {
      id: 'btn-retraso',
      label: 'Retraso por tapón',
      icon: 'alert-circle',
      class: 'btn-action btn-retraso',
      status: 'retraso por tapon',
      show: !['retraso por tapon', 'completada', 'cancelada'].includes(status)
    },
    {
      id: 'btn-finish',
      label: 'Finalizar',
      icon: 'check-circle',
      class: 'btn-action btn-finish',
      status: 'completada',
      show: !['completada', 'cancelada'].includes(status)
    }
  ];

  const gradient = {
    'en camino a recoger': { bg: 'linear-gradient(90deg,#1E405A,#2D5A7B)', color: '#ffffff' },
    'cargando': { bg: 'linear-gradient(90deg,#FBBF24,#FCD34D)', color: '#1F2937' },
    'en camino a entregar': { bg: 'linear-gradient(90deg,#7C3AED,#A78BFA)', color: '#ffffff' },
    'retraso por tapon': { bg: 'linear-gradient(90deg,#F97316,#FB923C)', color: '#ffffff' },
    'completada': { bg: 'linear-gradient(90deg,#10B981,#34D399)', color: '#ffffff' }
  };

  // Renderizar botones
  container.innerHTML = buttons
    .filter(b => b.show)
    .map(b => `
      <button data-status="${b.status}" class="${b.class} hover:shadow-lg transform hover:scale-105 active:scale-95 transition-all" title="${b.label}" style="padding: 0.6rem 1rem; border-radius: 0.75rem; display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 700; border: none; cursor: pointer; box-shadow: 0 6px 18px rgba(2,6,23,0.1); background:${gradient[b.status].bg}; color:${gradient[b.status].color};">
        <i data-lucide="${b.icon}" class="w-4 h-4"></i>
        <span>${b.label}</span>
      </button>
    `)
    .join('');

  // Actualizar iconos de Lucide
  if (window.lucide) lucide.createIcons();

  // Agregar listeners de click
  container.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newStatus = btn.getAttribute('data-status');
      console.log('Button clicked, updating status to:', newStatus);
      await updateOrderStatus(orderId, newStatus);
    });
  });
}

// Actualizar estado de la orden y UI
async function updateOrderStatus(orderId, newStatus) {
  try {
    // Crear etiqueta legible: "en camino a recoger" -> "En camino a recoger"
    const statusLabel = String(newStatus)
      .split(' ')
      .map((word, idx) => idx === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)
      .join(' ');
    
    console.log('Updating order status:', { orderId, newStatus, statusLabel });
    
    // Actualizar en BD
    const updates = { status: statusLabel, updated_at: new Date().toISOString() };
    await supabaseConfig.updateOrder(orderId, updates);
    await updateLastStatus(orderId, statusLabel);
    
    // Persistir y notificar
    persistActiveJob(orderId, statusLabel);
    showSuccess(`✓ Estado actualizado a: ${statusLabel}`);
    await notifyStatusChange(orderId, statusLabel);
    
    // Refrescar UI
    const updated = await supabaseConfig.getOrderById(orderId);
    if (statusLabel.toLowerCase() === 'completada') {
      try { localStorage.removeItem('tlc_active_job'); } catch(_){ }
      await fetchAndRender();
      const activeSection = document.getElementById('activeJobSection');
      const pendingSec = document.getElementById('pendingOrdersContainer');
      const assignedWrapper = document.getElementById('assignedOrdersWrapper');
      if (activeSection) activeSection.classList.add('hidden');
      if (pendingSec && pendingSec.parentElement) pendingSec.parentElement.classList.remove('hidden');
      if (assignedWrapper) assignedWrapper.classList.remove('hidden');
    } else {
      await renderActiveJob(orderId, updated);
      generateActiveJobButtons(orderId, updated);
    }
  } catch (e) {
    console.error('Error actualizando estado:', e);
    showError('❌ No se pudo actualizar el estado. Intenta más tarde.');
    queueOfflineUpdate(orderId, { status: newStatus });
  }
}

async function updateLastStatus(orderId, status) {
  const order = await supabaseConfig.getOrderById(orderId);
  const arr = Array.isArray(order?.tracking_data) ? order.tracking_data : [];
  const next = [...arr, { at: new Date().toISOString(), status }];
  await supabaseConfig.updateOrder(orderId, { last_collab_status: status, tracking_data: next });
}

function updateNotifyIndicator(status) {
  const el = document.getElementById('notifyIndicator');
  if (el) el.textContent = status;
}

async function canFinalizeOrder(orderId) {
  const input = document.getElementById('evidenceInput');
  const selected = Array.from(input?.files || []);
  if (selected.length > 0) return true;
  const order = await supabaseConfig.getOrderById(orderId);
  const existing = Array.isArray(order?.evidence_photos) ? order.evidence_photos : [];
  return existing.length > 0;
}

const CollabOrderActions = {
  async acceptOrder(orderId) {
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    const collabId = session?.user?.id || null;
    try {
      if (window.OrderManager && typeof window.OrderManager.acceptOrder === 'function') {
        const result = await window.OrderManager.acceptOrder(orderId, { collaborator_id: collabId });
        try { persistActiveJob(orderId, 'Aceptada'); } catch(_){}
        try { await updateLastStatus(orderId, 'Aceptada'); await notifyStatusChange(orderId, 'Aceptada'); } catch(_){}
        showSuccess(result?.success ? 'Has aceptado el trabajo.' : 'Aceptación aplicada (fallback).');
      } else {
        const updates = { assigned_to: collabId, status: 'Aceptada', assigned_at: new Date().toISOString() };
        try { await supabaseConfig.updateOrder(orderId, updates); await updateLastStatus(orderId, 'Aceptada'); showSuccess('Has aceptado el trabajo.'); }
        catch (e) { queueOfflineUpdate(orderId, updates); showWarning('Sin conexión. Guardado para sincronizar.'); }
        try { persistActiveJob(orderId, 'Aceptada'); } catch(_){}
        try { await notifyStatusChange(orderId, 'Aceptada'); } catch(_){}
      }
    } catch (e) {
      const updates = { assigned_to: collabId, status: 'Aceptada', assigned_at: new Date().toISOString() };
      queueOfflineUpdate(orderId, updates);
      showWarning('Sin conexión. Guardado para sincronizar.');
      try { persistActiveJob(orderId, 'Aceptada'); } catch(_){}
    }
    await fetchAndRender();
    showActiveJobView(orderId);
  }
};

function openAcceptModal(orderId) {
  const modal = document.getElementById('acceptModal');
  const body = document.getElementById('acceptModalBody');
  const confirmBtn = document.getElementById('acceptConfirmBtn');
  const cancelBtn = document.getElementById('acceptCancelBtn');
  const closeBtn = document.getElementById('acceptModalClose');
  if (!modal || !body) return;
  supabaseConfig.getOrderById(orderId).then(order => {
    const cliente = order?.name || '—';
    const contacto = order?.phone || '—';
    const serv = (order?.service && order.service.name) ? order.service.name : (order?.service || '—');
    const ruta = `${order?.pickup || '—'} → ${order?.delivery || '—'}`;
    const fecha = order?.date || '—';
    const hora = order?.time || '';
    body.innerHTML = `<div class="space-y-2"><div><strong>Cliente:</strong> ${cliente}</div><div><strong>Contacto:</strong> ${contacto}</div><div><strong>Servicio:</strong> ${serv}</div><div><strong>Ruta:</strong> ${ruta}</div><div><strong>Fecha/Hora:</strong> ${fecha} ${hora}</div></div>`;
    modal.classList.remove('hidden');
  });
  function close() { modal.classList.add('hidden'); }
  if (closeBtn) closeBtn.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;
  if (confirmBtn) confirmBtn.onclick = async () => { await CollabOrderActions.acceptOrder(orderId); close(); };
}

function initActiveMap(order) {
  if (typeof L === 'undefined') return;
  const mapEl = document.getElementById('activeJobMap');
  if (!mapEl) return;
  try { mapEl.classList.remove('hidden'); } catch(_){ }
  const hint = document.getElementById('activeJobMapHint');
  if (hint) hint.textContent = 'Usa los botones para abrir la ruta en Google Maps.';
  const defaultCoords = { lat: 18.4861, lng: -69.9312 };
  const pickupCoords = order?.pickup_coords || order?.origin_coords || defaultCoords;
  const deliveryCoords = order?.delivery_coords || order?.destination_coords || null;
  let map = window.__activeJobMap;
  if (!map) {
    map = L.map('activeJobMap').setView([pickupCoords.lat, pickupCoords.lng], 13);
    window.__activeJobMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    window.__activeJobLayer = L.layerGroup().addTo(map);
  }
  const layer = window.__activeJobLayer || L.layerGroup().addTo(map);
  window.__activeJobLayer = layer;
  const originIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25,41], iconAnchor: [12,41] });
  const destIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25,41], iconAnchor: [12,41] });
  const bounds = [];
  layer.clearLayers();
  L.marker([pickupCoords.lat, pickupCoords.lng], { icon: originIcon }).addTo(layer).bindPopup(`<b>Origen</b><br>${order?.pickup || ''}`);
  bounds.push([pickupCoords.lat, pickupCoords.lng]);
  if (deliveryCoords && deliveryCoords.lat && deliveryCoords.lng) {
    L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: destIcon }).addTo(layer).bindPopup(`<b>Destino</b><br>${order?.delivery || ''}`);
    bounds.push([deliveryCoords.lat, deliveryCoords.lng]);
    L.polyline(bounds, { color: '#2563eb', weight: 5 }).addTo(layer);
  }
  if (bounds.length > 0) map.fitBounds(bounds, { padding: [30,30] });
  try { setTimeout(() => { try { map.invalidateSize(); } catch(_){ } }, 0); } catch(_){ }
}

// removed duplicate simple generateActiveJobButtons

function persistActiveJob(id, status){
  try {
    const obj = { orderId: String(id), status: status || null, updatedAt: new Date().toISOString() };
    localStorage.setItem('tlc_active_job', JSON.stringify(obj));
  } catch (_){ }
}

function getPersistedActiveJob(){
  try {
    const raw = localStorage.getItem('tlc_active_job');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.orderId ? String(obj.orderId) : null;
  } catch (_) { return null; }
}

function getPersistedActiveJobObject(){
  try { return JSON.parse(localStorage.getItem('tlc_active_job') || 'null'); } catch (_) { return null; }
}

async function restoreActiveJob(){
  const id = getPersistedActiveJob();
  if (id) showActiveJobView(id);
}

function setupRealtime() {
  try {
    setInterval(fetchAndRender, 20000);
  } catch (_) {}
}

function queueOfflineUpdate(orderId, updates) {
  try {
    const q = JSON.parse(localStorage.getItem('tlc_offline_updates') || '[]');
    q.push({ orderId, updates, timestamp: new Date().toISOString(), synced: false });
    localStorage.setItem('tlc_offline_updates', JSON.stringify(q));
  } catch (_) {}
}

function setupOfflineSync() {
  // When back online, attempt to flush both simple updates and queued evidence
  window.addEventListener('online', async () => {
    try {
      // First: sync simple queued updates from localStorage
      try {
        const q = JSON.parse(localStorage.getItem('tlc_offline_updates') || '[]');
        if (Array.isArray(q) && q.length > 0) {
          for (const item of q) {
            try { await supabaseConfig.updateOrder(item.orderId, item.updates); } catch (err) { console.warn('Failed to sync offline update', err); }
          }
          localStorage.removeItem('tlc_offline_updates');
          showSuccess('Cambios sincronizados.');
        }
      } catch (err) { console.warn('Error syncing tlc_offline_updates', err); }

      // Then: process IndexedDB evidence queue
      try { await processOfflineEvidenceQueue(); } catch (err) { console.warn('Error processing offline evidence queue', err); }

      await fetchAndRender();
    } catch (e) { console.warn('online handler error', e); }
  });

  // Periodic retry while online (in case background processing fails)
  setInterval(() => {
    if (navigator.onLine) {
      try { processOfflineEvidenceQueue(); } catch(_){}
    }
  }, 30 * 1000); // every 30s
}

async function notifyStatusChange(orderId, status) {
  try {
    const orders = await supabaseConfig.getOrders();
    const order = (orders || []).find(o => String(o.id) === String(orderId));
    if (!order) return;
    const contactId = order.client_contact_id || null;
    const shortId = order.short_id || orderId;
  const payload = contactId ? {
    contactId,
    title: 'Estado del pedido actualizado',
    body: `Tu pedido #${shortId} ahora está en estado: ${status}`
  } : null;
  if (payload && supabaseConfig?.client?.functions?.invoke) {
    try {
      const { data, error } = await supabaseConfig.client.functions.invoke('send-push-notification', { body: payload });
      if (error) {
        try { await supabaseConfig.runProcessOutbox(); } catch(_) {}
      }
    } catch(_) {
      try { await supabaseConfig.runProcessOutbox(); } catch(_) {}
    }
  } else {
    try { await supabaseConfig.runProcessOutbox(); } catch(_) {}
  }
  } catch (_) {
    /* no-op */
  }
}

async function uploadEvidenceForOrder(orderId, files) {
  try {
    const progressBar = document.getElementById('evidenceProgressBar');
    const progressText = document.getElementById('evidenceProgressText');
    const total = files.length;
    let done = 0;
    const bucket = 'evidence';
    const uploaded = [];

    // Compress and upload sequentially to keep memory usage reasonable
    for (let i = 0; i < files.length; i++) {
      const original = files[i];
      if (!original) continue;
      if (original.size > 30 * 1024 * 1024) { // 30MB hard limit per file to allow larger device photos
        console.warn('File too large, skipping:', original.name);
        done += 1;
        continue;
      }

      // Try to compress before upload
      let toUpload = original;
      try {
        const compressed = await compressImage(original, 1200, 0.75);
        if (compressed && compressed.size > 0) {
          const ext = 'jpg';
          const filename = `${Date.now()}_${i}.${ext}`;
          toUpload = new File([compressed], filename, { type: 'image/jpeg' });
        }
      } catch (e) {
        console.warn('Compression failed, using original file:', e);
        toUpload = original;
      }

      const ts = Date.now();
      const ext = (toUpload.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `orders/${orderId}/${ts}_${i}.${ext}`;

      try {
        const { data, error } = await supabaseConfig.client.storage.from(bucket).upload(path, toUpload, { contentType: toUpload.type || 'image/jpeg', upsert: false });
        if (error) {
          console.error('Upload error:', error);
          // If upload fails (likely network), queue remaining files including current one
          const remaining = files.slice(i);
          await queueEvidenceForOrder(orderId, remaining);
          showWarning('Sin conexión. Las evidencias se guardaron localmente y se subirán cuando vuelva la red.');
          break;
        }
        const pub = supabaseConfig.client.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        uploaded.push({ path, url, uploaded_at: new Date().toISOString() });
      } catch (err) {
        console.warn('Upload exception, queueing for offline upload', err);
        const remaining = files.slice(i);
        await queueEvidenceForOrder(orderId, remaining);
        showWarning('Sin conexión. Las evidencias se guardaron localmente y se subirán cuando vuelva la red.');
        break;
      }

      done += 1;
      const pct = Math.round((done / total) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `${pct}%`;
    }

    // If we uploaded some files, attach them to the order record
    if (uploaded.length > 0) {
      try {
        const orders = await supabaseConfig.getOrders();
        const order = (orders || []).find(o => String(o.id) === String(orderId));
        const existing = Array.isArray(order?.evidence_photos) ? order.evidence_photos : [];
        const nextArr = [...existing, ...uploaded];
        await supabaseConfig.updateOrder(orderId, { evidence_photos: nextArr });
        showSuccess('Evidencias subidas correctamente.');
      } catch (e) {
        console.warn('Could not attach uploaded evidence to order immediately, will retry via offline queue', e);
        // If attaching metadata fails, queue uploaded items metadata for later processing
        // (We still keep the files uploaded in storage; here we could persist metadata to localStorage or leave as-is.)
      }
    }
  } catch (e) {
    console.error('Unexpected error uploading evidence:', e);
    // Fallback: queue everything
    try { await queueEvidenceForOrder(orderId, files); showWarning('Sin conexión. Las evidencias se guardaron localmente y se subirán cuando vuelva la red.'); } catch(_) { showError('No se pudieron subir las evidencias.'); }
  }
}

/* ----------------------------- */
/* IndexedDB: Offline evidence queue */
/* ----------------------------- */
const IDB_NAME = 'tlc_offline_db_v1';
const IDB_STORE = 'evidence';

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
    } catch (err) { reject(err); }
  });
}

async function addOfflineEvidenceEntry(entry) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const r = store.add(entry);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Add entry failed'));
    } catch (err) { reject(err); }
  });
}

async function getAllOfflineEvidenceEntries() {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error || new Error('getAll failed'));
    } catch (err) { reject(err); }
  });
}

async function deleteOfflineEvidenceEntry(id) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const r = store.delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error || new Error('delete failed'));
    } catch (err) { reject(err); }
  });
}

// Queue files (File[]) into IndexedDB for later upload. We store the raw File/Blob to preserve EXIF.
async function queueEvidenceForOrder(orderId, files) {
  try {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const entry = {
        orderId: String(orderId),
        fileName: f.name || (`evidence_${Date.now()}_${i}.jpg`),
        fileType: f.type || 'image/jpeg',
        blob: f,
        timestamp: new Date().toISOString(),
        attempts: 0
      };
      await addOfflineEvidenceEntry(entry);
    }
    return true;
  } catch (e) { console.error('queueEvidenceForOrder error', e); throw e; }
}

// Process queued evidence uploads sequentially
async function processOfflineEvidenceQueue() {
  try {
    const entries = await getAllOfflineEvidenceEntries();
    if (!entries || entries.length === 0) return;
    const bucket = 'evidence';
    for (const entry of entries) {
      try {
        // attempt compression before upload
        let blobToUpload = entry.blob;
        try {
          const compressed = await compressImage(blobToUpload, 1200, 0.75);
          if (compressed && compressed.size > 0) {
            blobToUpload = compressed;
          }
        } catch (_) { /* ignore compression errors */ }

        const ts = Date.now();
        const ext = (entry.fileName.split('.').pop() || 'jpg').toLowerCase();
        const path = `orders/${entry.orderId}/${ts}_${entry.id || Math.floor(Math.random()*10000)}.${ext}`;
        const fileForUpload = new File([blobToUpload], entry.fileName || `${ts}.${ext}`, { type: entry.fileType || 'image/jpeg' });
        const { data, error } = await supabaseConfig.client.storage.from(bucket).upload(path, fileForUpload, { contentType: fileForUpload.type || 'image/jpeg', upsert: false });
        if (error) {
          console.warn('Offline upload failed for entry', entry.id, error);
          // increment attempts and skip for now
          entry.attempts = (entry.attempts || 0) + 1;
          if (entry.attempts > 5) {
            // give up and remove
            await deleteOfflineEvidenceEntry(entry.id);
          }
          continue;
        }
        const pub = supabaseConfig.client.storage.from(bucket).getPublicUrl(path);
        const url = pub?.data?.publicUrl || null;
        // attach to order record
        try {
          const orders = await supabaseConfig.getOrders();
          const order = (orders || []).find(o => String(o.id) === String(entry.orderId));
          const existing = Array.isArray(order?.evidence_photos) ? order.evidence_photos : [];
          const nextArr = [...existing, { path, url, uploaded_at: new Date().toISOString() }];
          await supabaseConfig.updateOrder(entry.orderId, { evidence_photos: nextArr });
        } catch (err) {
          console.warn('Could not attach evidence metadata to order yet', err);
        }
        // remove from queue
        await deleteOfflineEvidenceEntry(entry.id);
        showInfo('Evidencia sincronizada.');
      } catch (err) {
        console.warn('Processing offline entry failed', entry.id, err);
        // continue with next
      }
    }
    // refresh UI
    await fetchAndRender();
  } catch (e) { console.error('processOfflineEvidenceQueue error', e); }
}

// Compress image client-side using canvas. Returns a Blob (image/jpeg).
async function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Compression returned empty blob'));
            resolve(blob);
          }, 'image/jpeg', quality);
        } catch (err) { reject(err); }
      };
      img.onerror = (err) => reject(err);
    } catch (err) { reject(err); }
  });
}

async function fetchAndRender() {
  const all = await supabaseConfig.getOrders();
  const { data: { session } } = await supabaseConfig.client.auth.getSession();
  const collabId = session?.user?.id || null;
  const pending = (all || []).filter(o => String(o.status || '').toLowerCase() === 'pendiente' && !o.assigned_to);
  const mine = (all || []).filter(o => o.assigned_to === collabId && !['completada','cancelada'].includes(String(o.status || '').toLowerCase()));
  const completedMine = (all || []).filter(o => o.assigned_to === collabId && String(o.status || '').toLowerCase() === 'completada');
  const assignedCountEl = document.getElementById('assignedCount');
  if (assignedCountEl) assignedCountEl.textContent = String(mine.length);
  const pendingCountEl = document.getElementById('pendingCount');
  if (pendingCountEl) pendingCountEl.textContent = String(pending.length);
  const completedCountEl = document.getElementById('completedCount');
  if (completedCountEl) completedCountEl.textContent = String(completedMine.length);
  renderPendingCards(pending);
  renderAssignedCards(mine);
  if (!getPersistedActiveJob() && mine.length > 0) {
    const active = mine.find(o => String(o.status || '').toLowerCase() === 'en curso') || mine[0];
    if (active && active.id) showActiveJobView(active.id);
  }
  if (window.lucide) lucide.createIcons();
}

/* Order modal helpers */
function openOrderModal(orderId) {
  try {
    const modal = document.getElementById('orderModal');
    const body = document.getElementById('orderModalBody');
    const title = document.getElementById('orderModalTitle');
    const assignBtn = document.getElementById('orderModalAssign');
    const startBtn = document.getElementById('orderModalStart');
    if (!modal || !body) return;
    // load order details
  supabaseConfig.getOrderById(orderId).then(order => {
      if (!order) {
        body.innerHTML = '<div class="text-sm text-gray-600">No se encontró la orden.</div>';
      } else {
        title.textContent = `Orden: ${order.short_id || order.id}`;
        body.innerHTML = `
          <div class="space-y-2">
            <div><strong>Cliente:</strong> ${order.name || '—'}</div>
            <div><strong>Contacto:</strong> ${order.phone || '—'}</div>
            <div><strong>Servicio:</strong> ${(order.service && order.service.name) ? order.service.name : (order.service || '—')}</div>
            <div><strong>Ruta:</strong> ${order.pickup || '—'} → ${order.delivery || '—'}</div>
            <div><strong>Fecha/Hora:</strong> ${order.date || '—'} ${order.time || ''}</div>
            <div><strong>Estado:</strong> ${order.status || '—'}</div>
            <div class="pt-2"><strong>Notas:</strong><div class="text-xs text-gray-600 mt-1">${order.notes || '—'}</div></div>
          </div>
        `;
      }
      if (assignBtn) assignBtn.setAttribute('data-id', orderId);
      if (startBtn) startBtn.setAttribute('data-id', orderId);
      modal.classList.remove('hidden');
      modal.classList.add('open');
      if (window.lucide) lucide.createIcons();
    }).catch(() => {
      body.innerHTML = '<div class="text-sm text-gray-600">Error al cargar la orden.</div>';
      modal.classList.remove('hidden');
      modal.classList.add('open');
    });
  } catch (_) {}
}

function closeOrderModal(){
  try {
    const modal = document.getElementById('orderModal');
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 250);
  } catch (_) {}
}