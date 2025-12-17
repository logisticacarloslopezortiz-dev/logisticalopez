document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('ordersGrid');
  const overlay = document.getElementById('loadingOverlay');
  const showingEl = document.getElementById('collabShowing');
  const totalEl = document.getElementById('collabTotal');
  const modal = document.getElementById('orderModal');
  const closeModalBtn = document.getElementById('closeOrderModal');
  const modalOrderId = document.getElementById('modalOrderId');
  const modalService = document.getElementById('modalService');
  const modalStatus = document.getElementById('modalStatus');
  const modalClient = document.getElementById('modalClient');
  const modalVehicle = document.getElementById('modalVehicle');
  const modalPickup = document.getElementById('modalPickup');
  const modalDelivery = document.getElementById('modalDelivery');
  const modalQuestions = document.getElementById('modalQuestions');
  const markCompletedBtn = document.getElementById('markCompletedBtn');
  const markCancelledBtn = document.getElementById('markCancelledBtn');
  const continueBanner = document.getElementById('continueActiveBanner');
  const continueBtn = document.getElementById('continueActiveBtn');
  const continueModal = document.getElementById('continueActiveModal');
  const closeContinueModal = document.getElementById('closeContinueModal');
  const confirmContinueBtn = document.getElementById('confirmContinueBtn');
  const cancelContinueBtn = document.getElementById('cancelContinueBtn');
  const continueOrderId = document.getElementById('continueOrderId');
  const continueService = document.getElementById('continueService');
  const continueStatus = document.getElementById('continueStatus');
  const continueClient = document.getElementById('continueClient');
  const continueRoute = document.getElementById('continueRoute');

  let orders = [];
  let currentOrder = null;
  let __iconsTimer = null;
  let __authSub = null;

  async function ensureAuthOrRedirect() {
    try {
      if (!window.supabaseConfig || !supabaseConfig.client) {
        window.location.href = 'login-colaborador.html';
        return false;
      }
      try { await supabaseConfig.ensureFreshSession?.(); } catch(_) {}
      let tries = 0;
      let session = null;
      while (tries < 14) {
        const { data } = await supabaseConfig.client.auth.getSession();
        session = data?.session || null;
        if (session) break;
        await new Promise(r => setTimeout(r, 150));
        tries++;
      }
      if (!session) {
        window.location.href = 'login-colaborador.html';
        return false;
      }
      return true;
    } catch (_) {
      window.location.href = 'login-colaborador.html';
      return false;
    }
  }

  async function openModal(order) {
    currentOrder = order;
    modalOrderId.textContent = `#${order.id}`;
    modalService.textContent = order?.service?.name || '';
    modalStatus.textContent = String(order.status || '').trim();
    modalClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    modalVehicle.textContent = order?.vehicle?.name || '';
    modalPickup.textContent = order.pickup || '';
    modalDelivery.textContent = order.delivery || '';
    try {
      const full = await supabaseConfig.getOrderById(order.id);
      const q = full?.service_questions;
      if (modalQuestions) {
        if (Array.isArray(q) && q.length > 0) {
          modalQuestions.innerHTML = q.map(it => `<div class="mb-1"><span class="font-semibold">${it.label || it.question || ''}:</span> ${it.answer || ''}</div>`).join('');
        } else if (q && typeof q === 'object') {
          modalQuestions.innerHTML = Object.keys(q).map(k => `<div class="mb-1"><span class="font-semibold">${k}:</span> ${String(q[k])}</div>`).join('');
        } else {
          modalQuestions.textContent = 'No disponible';
        }
      }
    } catch(_) { if (modalQuestions) modalQuestions.textContent = 'No disponible'; }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeModal() {
    currentOrder = null;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function openContinueModal(order){
    continueOrderId.textContent = `#${order.id}`;
    continueService.textContent = order?.service?.name || '';
    continueStatus.textContent = String(order.status || '').trim();
    continueClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    continueRoute.textContent = `${order.pickup || ''} → ${order.delivery || ''}`;
    continueModal.classList.remove('hidden');
    continueModal.classList.add('flex');
  }

  function closeContinue(){
    continueModal.classList.add('hidden');
    continueModal.classList.remove('flex');
  }

  function openDirections(order){
    const oc = order.origin_coords || order.pickup_coords;
    const dc = order.destination_coords || order.delivery_coords;
    if (oc && dc && typeof oc.lat === 'number' && typeof oc.lng === 'number' && typeof dc.lat === 'number' && typeof dc.lng === 'number') {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${oc.lat},${oc.lng}&destination=${dc.lat},${dc.lng}`;
      window.open(url, '_blank');
      return;
    }
    if ((order.pickup || '') && (order.delivery || '')) {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(order.pickup)}&destination=${encodeURIComponent(order.delivery)}`;
      window.open(url, '_blank');
      return;
    }
    if (order.pickup) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.pickup)}`;
      window.open(url, '_blank');
    }
  }

  const activeView = document.getElementById('activeJobView');
  const activeId = document.getElementById('activeJobId');
  const activeService = document.getElementById('activeJobService');
  const activeStatus = document.getElementById('activeJobStatus');
  const activeClient = document.getElementById('activeJobClient');
  const activeVehicle = document.getElementById('activeJobVehicle');
  const activePickup = document.getElementById('activeJobPickup');
  const activeDelivery = document.getElementById('activeJobDelivery');
  const activeEvidence = document.getElementById('activeEvidence');
  const evidencePreview = document.getElementById('evidencePreview');
  const evidenceInput = document.getElementById('evidenceInput');
  const activeCollaborator = document.getElementById('activeCollaborator');
  const activeMapEl = document.getElementById('activeMap');
  let activeMap = null;
  let activePickupMarker = null;
  let activeDeliveryMarker = null;
  const backToListBtn = document.getElementById('backToListBtn');
  const btnGoPickup = document.getElementById('btnGoPickup');
  const btnLoading = document.getElementById('btnLoading');
  const btnGoDeliver = document.getElementById('btnGoDeliver');
  const btnComplete = document.getElementById('btnComplete');
  const btnCancel = document.getElementById('btnCancel');
  const btnVerOrigen = document.getElementById('btnVerOrigen');
  const btnVerDestino = document.getElementById('btnVerDestino');

  function showView(name){
    const showGrid = name === 'grid';
    const showActive = name === 'active';
    if (grid) grid.classList.toggle('hidden', !showGrid);
    if (activeView) activeView.classList.toggle('hidden', !showActive);
  }

  function setActiveJob(orderOrId){
    const id = typeof orderOrId === 'object' ? orderOrId?.id : orderOrId;
    try { localStorage.setItem('tlc_active_job_id', String(id)); } catch(_){}
  }

  function clearActiveJob(){
    try { localStorage.removeItem('tlc_active_job_id'); } catch(_){}
  }

  function openGoogleMaps(address){
    try {
      if (!address) return;
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      window.open(url, '_blank');
    } catch(_){}
  }

  async function openActiveJob(order) {
    currentOrder = order;
    const idDisplay = order.id;
    showView('active');
    if (activeId) activeId.textContent = `#${idDisplay}`;
    if (activeService) activeService.textContent = order?.service?.name || '';
    if (activeStatus) activeStatus.textContent = String(order.status || '').trim();
    if (activeClient) activeClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    if (activeVehicle) activeVehicle.textContent = order?.vehicle?.name || '';
    if (activePickup) activePickup.textContent = order.pickup || '';
    if (activeDelivery) activeDelivery.textContent = order.delivery || '';
    try {
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (activeCollaborator) activeCollaborator.textContent = user?.email || user?.id || '';
    } catch(_) { if (activeCollaborator) activeCollaborator.textContent = ''; }
    const photos = Array.isArray(order.evidence_photos) ? order.evidence_photos : [];
    if (activeEvidence) {
      activeEvidence.innerHTML = photos.map(p => {
        const u = typeof p === 'string' ? p : (p && (p.url || p.public_url) ? (p.url || p.public_url) : '');
        return u ? `<img src="${u}" alt="evidencia" class="w-full h-32 object-cover rounded-lg border">` : '';
      }).join('');
    }
    if (evidencePreview) evidencePreview.innerHTML = '';
    setActiveJob(order.id);
    updatePrimaryActionButtons(order);
    try { localStorage.setItem('tlc_active_job_state', order.last_collab_status || ''); } catch(_){ }
    if (btnVerOrigen) btnVerOrigen.onclick = () => openGoogleMaps(order.pickup);
    if (btnVerDestino) btnVerDestino.onclick = () => openGoogleMaps(order.delivery);
    initActiveMap(order);
    updateProgressBar(String(order.last_collab_status || '').toLowerCase());
  }

  function initActiveMap(order){
    try {
      if (!activeMapEl || typeof L === 'undefined') return;
      const defaultCenter = [18.4861, -69.9312];
      if (!activeMap) {
        activeMap = L.map(activeMapEl).setView(defaultCenter, 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(activeMap);
      }
      if (activePickupMarker) { try { activeMap.removeLayer(activePickupMarker); } catch(_){} activePickupMarker = null; }
      if (activeDeliveryMarker) { try { activeMap.removeLayer(activeDeliveryMarker); } catch(_){} activeDeliveryMarker = null; }
      const oc = order.origin_coords || order.pickup_coords;
      const dc = order.destination_coords || order.delivery_coords;
      if (oc && typeof oc.lat === 'number' && typeof oc.lng === 'number') {
        activePickupMarker = L.marker([oc.lat, oc.lng]).addTo(activeMap);
        activeMap.setView([oc.lat, oc.lng], 13);
      }
      if (dc && typeof dc.lat === 'number' && typeof dc.lng === 'number') {
        activeDeliveryMarker = L.marker([dc.lat, dc.lng]).addTo(activeMap);
        if (!oc) activeMap.setView([dc.lat, dc.lng], 13);
      }
      setTimeout(() => { try { activeMap.invalidateSize(); } catch(_){} }, 200);
    } catch(_){}
  }

  function closeActiveJob() {
    currentOrder = null;
    showView('grid');
    clearActiveJob();
  }

  if (backToListBtn) backToListBtn.addEventListener('click', closeActiveJob);
  if (btnGoPickup) btnGoPickup.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; window.__updatingOrder = true;
      btnGoPickup.disabled = true;
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');
      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, 'en_camino_recoger', { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error');
      notifications?.success?.('En camino a recoger');
      currentOrder.last_collab_status = 'en_camino_recoger';
      updatePrimaryActionButtons(currentOrder);
      try { localStorage.setItem('tlc_active_job_state', 'en_camino_recoger'); } catch(_){}
    } catch (_) { notifications?.error?.('No se pudo actualizar'); } finally { btnGoPickup.disabled = false; window.__updatingOrder = false; }
  });
  if (btnLoading) btnLoading.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; window.__updatingOrder = true;
      btnLoading.disabled = true;
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');
      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, 'cargando', { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error');
      notifications?.success?.('Cargando');
      currentOrder.last_collab_status = 'cargando';
      updatePrimaryActionButtons(currentOrder);
      try { localStorage.setItem('tlc_active_job_state', 'cargando'); } catch(_){}
    } catch (_) { notifications?.error?.('No se pudo actualizar'); } finally { btnLoading.disabled = false; window.__updatingOrder = false; }
  });
  if (btnGoDeliver) btnGoDeliver.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; window.__updatingOrder = true;
      btnGoDeliver.disabled = true;
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');
      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, 'en_camino_entregar', { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error');
      notifications?.success?.('En camino a entregar');
      currentOrder.last_collab_status = 'en_camino_entregar';
      updatePrimaryActionButtons(currentOrder);
      try { localStorage.setItem('tlc_active_job_state', 'en_camino_entregar'); } catch(_){}
    } catch (_) { notifications?.error?.('No se pudo actualizar'); } finally { btnGoDeliver.disabled = false; window.__updatingOrder = false; }
  });
  if (btnComplete) btnComplete.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; window.__updatingOrder = true;
      btnComplete.disabled = true;
      if (!confirm('¿Seguro que deseas completar esta solicitud?')) { btnComplete.disabled = false; return; }
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');
      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, 'entregada', { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error');
      notifications?.success?.('Solicitud completada');
      clearActiveJob();
      closeActiveJob();
      await fetchOrdersForCollaborator();
      document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { notifications?.error?.(e?.message || 'No se pudo completar'); } finally { btnComplete.disabled = false; window.__updatingOrder = false; }
  });
  if (btnCancel) btnCancel.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; window.__updatingOrder = true;
      btnCancel.disabled = true;
      if (!confirm('¿Seguro que deseas cancelar esta solicitud?')) { btnCancel.disabled = false; return; }
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');
      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, 'cancelada', { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error');
      notifications?.success?.('Solicitud cancelada');
      clearActiveJob();
      closeActiveJob();
      await fetchOrdersForCollaborator();
      document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { notifications?.error?.(e?.message || 'No se pudo cancelar'); } finally { btnCancel.disabled = false; window.__updatingOrder = false; }
  });

  function updatePrimaryActionButtons(order){
    const phase = String(order?.last_collab_status || '').toLowerCase();
    if (btnGoPickup) btnGoPickup.classList.add('hidden');
    if (btnLoading) btnLoading.classList.add('hidden');
    if (btnGoDeliver) btnGoDeliver.classList.add('hidden');
    if (btnComplete) btnComplete.classList.add('hidden');
    if (btnGoPickup) btnGoPickup.disabled = true;
    if (btnLoading) btnLoading.disabled = true;
    if (btnGoDeliver) btnGoDeliver.disabled = true;
    if (btnComplete) btnComplete.disabled = true;
    if (phase === 'en_camino_recoger') { if (btnLoading) { btnLoading.classList.remove('hidden'); btnLoading.disabled = false; } }
    else if (phase === 'cargando') { if (btnGoDeliver) { btnGoDeliver.classList.remove('hidden'); btnGoDeliver.disabled = false; } }
    else if (phase === 'en_camino_entregar') { if (btnComplete) { btnComplete.classList.remove('hidden'); btnComplete.disabled = false; } }
    else { if (btnGoPickup) { btnGoPickup.classList.remove('hidden'); btnGoPickup.disabled = false; } }
    updateProgressBar(phase);
  }

  function updateProgressBar(status){
    const bar = document.getElementById('jobProgressBar');
    if (!bar) return;
    const map = { pendiente: 0, en_camino_recoger: 25, cargando: 50, en_camino_entregar: 75, entregada: 100 };
    bar.style.width = (map[status] || 0) + '%';
  }

  async function uploadEvidence(file){
    if (!currentOrder || !file) return;
    try {
      await supabaseConfig.ensureFreshSession?.();
      const bucket = supabaseConfig.getEvidenceBucket ? supabaseConfig.getEvidenceBucket() : 'order-evidence';
      const path = `${currentOrder.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabaseConfig.client.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const pub = supabaseConfig.client.storage.from(bucket).getPublicUrl(path);
      const url = pub?.data?.publicUrl || '';
      const prev = Array.isArray(currentOrder.evidence_photos) ? currentOrder.evidence_photos : [];
      const next = [...prev, { bucket, path, url }];
      const { error: updErr } = await supabaseConfig.client.from('orders').update({ evidence_photos: next }).eq('id', currentOrder.id);
      if (updErr) throw updErr;
      currentOrder.evidence_photos = next;
      if (evidencePreview) {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'w-full h-32 object-cover rounded-lg border';
        evidencePreview.prepend(img);
      }
      notifications?.success?.('Evidencia subida');
    } catch (_) {
      notifications?.error?.('No se pudo subir evidencia');
    }
  }

  if (evidenceInput) evidenceInput.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    files.forEach(f => uploadEvidence(f));
    e.target.value = '';
  });

  async function fetchOrdersForCollaborator() {
    try { await supabaseConfig.ensureFreshSession?.(); } catch (_) {}
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    try {
      const ok = await ensureAuthOrRedirect();
      if (!ok) { overlay.classList.add('hidden'); overlay.classList.remove('flex'); return; }
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) {
        overlay.classList.add('hidden'); overlay.classList.remove('flex'); window.location.href = 'login-colaborador.html';
        return;
      }
      try {
        const v = await supabaseConfig.validateActiveCollaborator(uid);
        if (!v?.isValid) {
          await supabaseConfig.client.auth.signOut();
          const msg = v?.error === 'Collaborator is not active'
            ? 'Tu cuenta ha sido desactivada. Contacta al administrador.'
            : v?.error === 'Invalid role for this panel'
              ? 'No tienes permisos de colaborador para este panel.'
              : 'No estás registrado como colaborador.';
          notifications?.error?.(msg);
          window.location.href = 'login-colaborador.html';
          return;
        }
      } catch (e) {
        console.error('Error validando colaborador:', e?.message || e);
      }
      let list = [];
      try {
        list = await supabaseConfig.getOrdersForCollaborator(uid);
      } catch (_) {
        const sel = 'id,short_id,name,phone,status,pickup,delivery,service:services(name),vehicle:vehicles(name),assigned_to';
        const [a, p] = await Promise.all([
          supabaseConfig.client.from('orders').select(sel).eq('assigned_to', uid),
          supabaseConfig.client.from('orders').select(sel).is('assigned_to', null)
        ]);
        const assigned = a?.data || [];
        const pending = p?.data || [];
        const EXCLUDE = new Set(['Completada','Cancelada','completada','cancelada']);
        list = [...assigned, ...pending].filter(o => !EXCLUDE.has(String(o.status || '').trim()));
      }
      orders = Array.isArray(list) ? list : [];
      renderOrders();
    } catch (e) {
      notifications?.error?.('No se pudieron cargar las solicitudes.');
    } finally {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
    }
  }

  function renderOrders() {
    const total = orders.length;
    if (totalEl) totalEl.textContent = String(total);
    if (showingEl) showingEl.textContent = String(total);
    if (!grid) return;
    if (orders.length === 0) {
      grid.innerHTML = '<div class="col-span-full bg-white rounded-xl border p-6 text-center text-gray-600">No hay solicitudes pendientes o asignadas por ahora.</div>';
      try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          if (__iconsTimer) clearTimeout(__iconsTimer);
          __iconsTimer = setTimeout(() => window.lucide.createIcons(), 100);
        }
      } catch (_) {}
      return;
    }
    grid.innerHTML = orders.map(o => {
      const idDisplay = o.id;
      const service = o?.service?.name || '';
      const status = String(o.status || '').trim();
      const s = status.toLowerCase();
      const badge = s === 'pendiente'
        ? 'bg-yellow-100 text-yellow-700'
        : s === 'aceptada'
          ? 'bg-blue-100 text-blue-700'
          : s === 'en curso'
            ? 'bg-indigo-100 text-indigo-700'
            : s === 'cancelada'
              ? 'bg-red-100 text-red-700'
              : 'bg-green-100 text-green-700';
      return `
        <div class="group bg-white rounded-2xl shadow hover:shadow-lg border border-gray-200 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white font-bold">#${idDisplay}</span>
            <span class="px-2 py-1 rounded ${badge} text-xs">${status}</span>
          </div>
          <div class="p-4 space-y-2">
            <p class="text-sm font-semibold text-gray-900">${service}</p>
            <p class="text-xs text-gray-600">${o.pickup || ''}</p>
            <p class="text-xs text-gray-600">${o.delivery || ''}</p>
          </div>
          <div class="px-4 py-3 border-t flex items-center justify-end gap-2">
            <button class="btn-open px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm" data-id="${o.id}">Detalles</button>
            ${s === 'pendiente' ? `<button class="btn-accept px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm ${currentOrder ? 'opacity-50 cursor-not-allowed' : ''}" ${currentOrder ? 'disabled' : ''} data-id="${o.id}">Aceptar</button>` : ''}
            
          </div>
        </div>
      `;
    }).join('');
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        if (__iconsTimer) clearTimeout(__iconsTimer);
        __iconsTimer = setTimeout(() => window.lucide.createIcons(), 100);
      }
    } catch (_) {}
    grid.querySelectorAll('.btn-open').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const o = orders.find(x => String(x.id) === id);
        if (o) openModal(o);
      });
    });
    grid.querySelectorAll('.btn-accept').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const o = orders.find(x => String(x.id) === id);
        if (!o) return;
        if (currentOrder) { notifications?.info?.('Ya tienes un trabajo activo'); return; }
        try {
          b.disabled = true;
          const { data: { user } } = await supabaseConfig.client.auth.getUser();
          if (!user?.id) throw new Error('Sesión inválida');
          const res = await OrderManager.acceptOrder(o.id, { collaborator_id: user.id });
          if (!res?.success) throw new Error(res?.error || 'Error');
          notifications?.success?.('Orden aceptada');
          if (typeof openActiveJob === 'function') {
            openActiveJob({ ...o, status: 'aceptada', assigned_to: user.id });
            try { localStorage.setItem('tlc_active_job_id', String(o.id)); } catch(_){}
          } else {
            await fetchOrdersForCollaborator();
          }
        } catch (_) {
          notifications?.error?.('No se pudo aceptar la orden');
        } finally {
          b.disabled = false;
        }
      });
    });
    
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

  const init = async () => {
    const ok = await ensureAuthOrRedirect();
    if (!ok) return;
    try {
      const { data } = supabaseConfig.client.auth.onAuthStateChange(async (event) => {
        if (['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
          await fetchOrdersForCollaborator();
        }
        if (event === 'SIGNED_OUT') {
          orders = [];
          if (grid) grid.innerHTML = '';
          window.location.href = 'login-colaborador.html';
        }
      });
      __authSub = data?.subscription;
      window.addEventListener('beforeunload', () => { try { __authSub?.unsubscribe?.(); } catch(_){} });
      try {
        const ch = supabaseConfig.client.channel('orders-collab');
        ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
          try {
            const { data: { session } } = await supabaseConfig.client.auth.getSession();
            const uid = session?.user?.id || null;
            if (uid && payload?.new?.assigned_to === uid) {
              await fetchOrdersForCollaborator();
            }
          } catch(_) {}
        }).subscribe();
        window.addEventListener('beforeunload', () => { try { ch.unsubscribe?.(); } catch(_){} });
      } catch(_) {}
    } catch (_) {}
    await fetchOrdersForCollaborator();
    try {
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id || null;
      const assigned = orders.filter(o => o.assigned_to === uid && !['Completada','Cancelada','completada','cancelada'].includes(String(o.status||'').trim()));
      if (assigned.length > 0 && typeof openActiveJob === 'function') {
        openActiveJob(assigned[0]);
      } else {
        try {
          const storedId = localStorage.getItem('tlc_active_job_id');
          if (storedId) {
            const o = await supabaseConfig.getOrderById(Number(storedId));
            const storedState = localStorage.getItem('tlc_active_job_state');
            if (storedState && o) { o.last_collab_status = storedState; }
            if (continueBanner) continueBanner.classList.remove('hidden');
            if (o && typeof openActiveJob === 'function') openActiveJob(o);
          }
        } catch(_){ if (continueBanner) continueBanner.classList.remove('hidden'); }
      }
    } catch(_) {}
  };
  init();
  if (continueBtn) continueBtn.addEventListener('dblclick', async () => {
    try {
      const storedId = localStorage.getItem('tlc_active_job_id');
      if (!storedId) return;
      const o = await supabaseConfig.getOrderById(Number(storedId));
      if (!o) return;
      openContinueModal(o);
    } catch(_){}
  });
  if (closeContinueModal) closeContinueModal.addEventListener('click', closeContinue);
  if (cancelContinueBtn) cancelContinueBtn.addEventListener('click', closeContinue);
  if (confirmContinueBtn) confirmContinueBtn.addEventListener('click', async () => {
    try {
      const storedId = localStorage.getItem('tlc_active_job_id');
      if (!storedId) return;
      const o = await supabaseConfig.getOrderById(Number(storedId));
      if (!o) return;
      closeContinue();
      openActiveJob(o);
      openDirections(o);
    } catch(_){}
  });
});
