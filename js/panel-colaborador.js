document.addEventListener('DOMContentLoaded', () => {
  // Elementos del DOM
  const grid = document.getElementById('ordersGrid');
  const overlay = document.getElementById('loadingOverlay');
  const showingEl = document.getElementById('collabShowing');
  const totalEl = document.getElementById('collabTotal');
  const modal = document.getElementById('orderModal');
  const closeModalBtn = document.getElementById('closeOrderModal');
  
  // Elementos del Modal de Detalles
  const modalOrderId = document.getElementById('modalOrderId');
  const modalService = document.getElementById('modalService');
  const modalStatus = document.getElementById('modalStatus');
  const modalClient = document.getElementById('modalClient');
  const modalVehicle = document.getElementById('modalVehicle');
  const modalPickup = document.getElementById('modalPickup');
  const modalDelivery = document.getElementById('modalDelivery');
  const modalQuestions = document.getElementById('modalQuestions');
  const markCompletedBtn = document.getElementById('markCompletedBtn'); // Opcional, si existe en HTML
  const markCancelledBtn = document.getElementById('markCancelledBtn'); // Opcional, si existe en HTML

  // Banner y Modal de Continuar
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

  // Vista de Trabajo Activo
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
  const backToListBtn = document.getElementById('backToListBtn');
  
  // Botones de Acción
  const btnGoPickup = document.getElementById('btnGoPickup');
  const btnLoading = document.getElementById('btnLoading');
  const btnGoDeliver = document.getElementById('btnGoDeliver');
  const btnComplete = document.getElementById('btnComplete');
  const btnCancel = document.getElementById('btnCancel');
  const btnVerOrigen = document.getElementById('btnVerOrigen');
  const btnVerDestino = document.getElementById('btnVerDestino');

  // Estado Local
  let orders = [];
  let currentOrder = null;
  let __iconsTimer = null;
  let __authSub = null;
  let activeMap = null;
  let activePickupMarker = null;
  let activeDeliveryMarker = null;

  // --- Utilidades ---

  // Prevenir XSS escapando HTML
  const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  function formatStatus(status) {
    const v = String(status || '').toLowerCase();
    if (v === 'pending' || v === 'pendiente') return 'Pendiente';
    if (v === 'accepted' || v === 'aceptada') return 'Aceptada';
    if (v === 'en_camino_recoger') return 'En camino a recoger';
    if (v === 'cargando') return 'Cargando';
    if (v === 'en_camino_entregar') return 'En camino a entregar';
    if (v === 'completed' || v === 'entregada' || v === 'completada') return 'Completada';
    if (v === 'cancelled' || v === 'cancelada') return 'Cancelada';
    if (v === 'in_progress' || v === 'en curso') return 'En progreso';
    return String(status || '').trim();
  }

  // --- Notificaciones Push (Automatización) ---
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function registerCollaboratorPush(userId) {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      
      // Intentar pedir permiso si está en 'default' (puede requerir interacción en algunos navegadores)
      if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch(_) {}
      }
      
      if (Notification.permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      
      if (!sub) {
        const vapidKey = await supabaseConfig.getVapidPublicKey();
        if (!vapidKey) return;
        
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        });
      }
      
      if (sub) {
        const raw = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
        const keys = raw?.keys || (sub.keys || {});
        const endpoint = String(sub.endpoint || '').trim().replace(/`+/g, '');
        // Validar si el colaborador está activo antes de intentar actualizar su fila
        let canUpdateCollaborator = false;
        try {
          const v = await supabaseConfig.validateActiveCollaborator?.(userId);
          canUpdateCollaborator = !!(v && v.isValid);
        } catch(_){}

        if (canUpdateCollaborator) {
          const { error: collabErr } = await supabaseConfig.client
            .from('collaborators')
            .update({ push_subscription: raw || sub })
            .eq('id', userId);
          if (!collabErr) return; // sincroniza a push_subscriptions por trigger
        }

        // Fallback robusto: guardar directamente en push_subscriptions
        try {
          await supabaseConfig.client
            .from('push_subscriptions')
            .upsert({
              user_id: userId,
              endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth }
            }, { onConflict: 'user_id,endpoint' });
        } catch(_){}
      }
    } catch (e) { console.warn('Error auto-registro push:', e); }
  }

  // --- Autenticación ---

  async function ensureAuthOrRedirect() {
    try {
      if (!window.supabaseConfig || !supabaseConfig.client) {
        throw new Error('Supabase client not initialized');
      }
      
      // Intentar obtener sesión actual
      const { data } = await supabaseConfig.client.auth.getSession();
      if (data?.session) return true;

      // Si no hay sesión, intentar refrescar brevemente
      await new Promise(r => setTimeout(r, 500));
      const retry = await supabaseConfig.client.auth.getSession();
      if (retry?.data?.session) return true;

      window.location.href = 'login-colaborador.html';
      return false;
    } catch (_) {
      window.location.href = 'login-colaborador.html';
      return false;
    }
  }

  async function getActiveCollaboratorInfo() {
    try {
      await supabaseConfig.ensureFreshSession?.();
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return null;
      const v = await supabaseConfig.validateActiveCollaborator?.(uid);
      if (v && !v.isValid) return null;
      const { data } = await supabaseConfig.client
        .from('collaborators')
        .select('id,name,matricula,status')
        .eq('id', uid)
        .maybeSingle();
      return data || { id: uid };
    } catch (_) { return null; }
  }

  // --- Gestión de Vistas ---

  function showView(name) {
    const showGrid = name === 'grid';
    const showActive = name === 'active';
    if (grid) grid.classList.toggle('hidden', !showGrid);
    if (activeView) activeView.classList.toggle('hidden', !showActive);
    
    // Si mostramos el mapa activo, asegurar que se renderice bien
    if (showActive && activeMap) {
      setTimeout(() => {
        try { activeMap.invalidateSize(); } catch(_) {}
      }, 300);
    }
  }

  // --- Modales ---

  async function openModal(order) {
    currentOrder = order;
    if (modalOrderId) modalOrderId.textContent = `#${order.id}`;
    if (modalService) modalService.innerHTML = `<strong>${escapeHtml(order?.service?.name || '')}</strong><br><small class="text-gray-600">${escapeHtml(order?.service?.description || '')}</small>`;
    if (modalStatus) modalStatus.textContent = formatStatus(order.status);
    if (modalClient) modalClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    if (modalVehicle) modalVehicle.textContent = order?.vehicle?.name || '';
    if (modalPickup) modalPickup.textContent = order.pickup || '';
    if (modalDelivery) modalDelivery.textContent = order.delivery || '';
    
    if (modalQuestions) {
      modalQuestions.innerHTML = '<span class="text-gray-400">Cargando...</span>';
      try {
        const full = await supabaseConfig.getOrderById(order.id);
        const q = full?.service_questions;
        if (Array.isArray(q) && q.length > 0) {
          modalQuestions.innerHTML = q.map(it => 
            `<div class="mb-1"><span class="font-semibold">${escapeHtml(it.label || it.question || '')}:</span> ${escapeHtml(it.answer || '')}</div>`
          ).join('');
        } else if (q && typeof q === 'object') {
          modalQuestions.innerHTML = Object.keys(q).map(k => 
            `<div class="mb-1"><span class="font-semibold">${escapeHtml(k)}:</span> ${escapeHtml(String(q[k]))}</div>`
          ).join('');
        } else {
          modalQuestions.textContent = 'No disponible';
        }
      } catch(_) {
        modalQuestions.textContent = 'No disponible';
      }
    }
    
    // Mostrar botón de aceptar solo si es pendiente y no está asignada
    if (modalAcceptBtn) {
        const isPending = (String(order.status || '').toLowerCase() === 'pending' || String(order.status || '').toLowerCase() === 'pendiente') && !order.assigned_to;
        if (isPending) {
            modalAcceptBtn.classList.remove('hidden');
        } else {
            modalAcceptBtn.classList.add('hidden');
        }
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeModal() {
    currentOrder = null;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function openContinueModal(order){
    if (continueOrderId) continueOrderId.textContent = `#${order.id}`;
    if (continueService) continueService.textContent = order?.service?.name || '';
    if (continueStatus) continueStatus.textContent = formatStatus(order.status);
    if (continueClient) continueClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    if (continueRoute) continueRoute.textContent = `${order.pickup || ''} → ${order.delivery || ''}`;
    continueModal.classList.remove('hidden');
    continueModal.classList.add('flex');
  }

  function closeContinue(){
    continueModal.classList.add('hidden');
    continueModal.classList.remove('flex');
  }

  // --- Mapas y Direcciones ---

  function openDirections(order){
    const oc = order.origin_coords || order.pickup_coords;
    const dc = order.destination_coords || order.delivery_coords;
    
    // Prioridad a coordenadas
    if (oc && dc && typeof oc.lat === 'number' && typeof oc.lng === 'number' && typeof dc.lat === 'number' && typeof dc.lng === 'number') {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${oc.lat},${oc.lng}&destination=${dc.lat},${dc.lng}`;
      window.open(url, '_blank');
      return;
    }
    // Fallback a direcciones de texto
    if ((order.pickup || '') && (order.delivery || '')) {
      const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(order.pickup)}&destination=${encodeURIComponent(order.delivery)}`;
      window.open(url, '_blank');
      return;
    }
    // Fallback a solo origen
    if (order.pickup) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.pickup)}`;
      window.open(url, '_blank');
    }
  }

  function openGoogleMaps(address){
    try {
      if (!address) return;
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      window.open(url, '_blank');
    } catch(_){}
  }

  function initActiveMap(order){
    try {
      if (!activeMapEl || typeof L === 'undefined') return;
      
      const defaultCenter = [18.4861, -69.9312]; // Santo Domingo
      if (!activeMap) {
        activeMap = L.map(activeMapEl).setView(defaultCenter, 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
          attribution: '&copy; OpenStreetMap' 
        }).addTo(activeMap);
      }
      
      // Limpiar marcadores anteriores
      if (activePickupMarker) { try { activeMap.removeLayer(activePickupMarker); } catch(_){} activePickupMarker = null; }
      if (activeDeliveryMarker) { try { activeMap.removeLayer(activeDeliveryMarker); } catch(_){} activeDeliveryMarker = null; }
      
      const oc = order.origin_coords || order.pickup_coords;
      const dc = order.destination_coords || order.delivery_coords;
      
      const bounds = [];

      if (oc && typeof oc.lat === 'number' && typeof oc.lng === 'number') {
        activePickupMarker = L.marker([oc.lat, oc.lng]).addTo(activeMap).bindPopup('Origen');
        bounds.push([oc.lat, oc.lng]);
      }
      
      if (dc && typeof dc.lat === 'number' && typeof dc.lng === 'number') {
        activeDeliveryMarker = L.marker([dc.lat, dc.lng]).addTo(activeMap).bindPopup('Destino');
        bounds.push([dc.lat, dc.lng]);
      }
      
      if (bounds.length > 0) {
        activeMap.fitBounds(bounds, { padding: [50, 50] });
      } else if (oc) {
        activeMap.setView([oc.lat, oc.lng], 14);
      }
      
      setTimeout(() => { try { activeMap.invalidateSize(); } catch(_){} }, 150);
    } catch(e){ console.error("Error init map", e); }
  }

  // --- Trabajo Activo ---

  function setActiveJobStorage(orderOrId){
    const id = typeof orderOrId === 'object' ? orderOrId?.id : orderOrId;
    try { localStorage.setItem('tlc_active_job_id', String(id)); } catch(_){}
  }

  function clearActiveJobStorage(){
    try { 
      localStorage.removeItem('tlc_active_job_id'); 
      localStorage.removeItem('tlc_active_job_state');
    } catch(_){}
  }

  async function openActiveJob(order) {
    if (!order || !order.id) {
      console.error('[ActiveJob] Orden inválida:', order);
      try { notifications?.error?.('La orden no está disponible'); } catch(_) {}
      return;
    }
    currentOrder = order;
    showView('active');
    
    if (activeId) activeId.textContent = `#${order.id}`;
    if (activeService) activeService.textContent = order?.service?.name || '';
    if (activeStatus) activeStatus.textContent = formatStatus(getUiStatus(order));
    if (activeClient) activeClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    if (activeVehicle) activeVehicle.textContent = order?.vehicle?.name || '';
    if (activePickup) activePickup.textContent = order.pickup || '';
    if (activeDelivery) activeDelivery.textContent = order.delivery || '';
    if (activeCollaborator) {
      const n = document.getElementById('sidebarCollabName');
      activeCollaborator.textContent = n?.textContent || '';
    }
    
    try {
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (activeCollaborator) activeCollaborator.textContent = user?.email || user?.id || '';
    } catch(_) { if (activeCollaborator) activeCollaborator.textContent = ''; }
    
    // Evidencia
    const photos = Array.isArray(order.evidence_photos) ? order.evidence_photos : [];
    if (activeEvidence) {
      activeEvidence.innerHTML = photos.map(p => {
        const u = typeof p === 'string' ? p : (p && (p.url || p.public_url) ? (p.url || p.public_url) : '');
        return u ? `<img src="${escapeHtml(u)}" alt="evidencia" class="w-full h-32 object-cover rounded-lg border cursor-pointer hover:opacity-90" onclick="window.open('${escapeHtml(u)}', '_blank')">` : '';
      }).join('');
    }
    if (evidencePreview) evidencePreview.innerHTML = '';
    
    setActiveJobStorage(order.id);
    updatePrimaryActionButtons(order);
    
    try { localStorage.setItem('tlc_active_job_state', getUiStatus(order)); } catch(_){ }
    
    if (btnVerOrigen) btnVerOrigen.onclick = () => openGoogleMaps(order.pickup);
    if (btnVerDestino) btnVerDestino.onclick = () => openGoogleMaps(order.delivery);
    
    initActiveMap(order);

    try {
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (uid) await registerCollaboratorPush(uid);
    } catch(_){}
  }

  function closeActiveJob() {
    currentOrder = null;
    showView('grid');
    clearActiveJobStorage();
    fetchOrdersForCollaborator(); // Recargar lista al salir
  }

  // --- Actualización de Estados ---

  // Helper para obtener estado UI desde orden DB
  function getUiStatus(order) {
    if (!order) return '';
    const s = String(order.status || '').toLowerCase();
    
    if (s === 'pending') return 'pendiente';
    if (s === 'accepted') return 'aceptada';
    if (s === 'completed') return 'entregada';
    if (s === 'cancelled') return 'cancelada';
    
    if (s === 'in_progress' || s === 'en curso') {
      if (Array.isArray(order.tracking_data) && order.tracking_data.length > 0) {
        const last = order.tracking_data[order.tracking_data.length - 1];
        const uiStatus = String(last.ui_status || 'en_camino_recoger').toLowerCase();
        // Return the specific UI status if it's one of the expected ones
        if (['en_camino_recoger', 'cargando', 'en_camino_entregar', 'entregada'].includes(uiStatus)) {
          return uiStatus;
        }
      }
      return 'en_camino_recoger'; 
    }
    return s;
  }

  function isFinalOrder(order) {
    const db = String(order?.status || '').toLowerCase();
    const ui = getUiStatus(order);
    return db === 'completed' || db === 'cancelled' || ['entregada', 'completada', 'cancelada'].includes(ui);
  }

  function updateProgressBar(status){
    const bar = document.getElementById('jobProgressBar');
    if (!bar) return;
    const map = { pendiente: 0, en_camino_recoger: 25, cargando: 50, en_camino_entregar: 75, entregada: 100 };
    // Normalizar status
    const s = String(status || '').toLowerCase();
    bar.style.width = (map[s] || 0) + '%';
  }

  function updatePrimaryActionButtons(order){
    const phase = getUiStatus(order);
    const hasEvidence = Array.isArray(order?.evidence_photos) && order.evidence_photos.length > 0;
    
    // Ocultar y deshabilitar todos primero
    [btnGoPickup, btnLoading, btnGoDeliver, btnComplete].forEach(btn => {
      if(btn) {
        btn.classList.add('hidden');
        btn.disabled = true;
      }
    });

    if (['entregada', 'completada', 'cancelada'].includes(phase)) {
      // Si la orden ya finalizó, no mostrar botones de acción
      updateProgressBar(phase);
      return;
    }

    if (phase === 'en_camino_recoger') { 
      if (btnLoading) { btnLoading.classList.remove('hidden'); btnLoading.disabled = false; } 
    }
    else if (phase === 'cargando') { 
      if (btnGoDeliver) { btnGoDeliver.classList.remove('hidden'); btnGoDeliver.disabled = false; }
      try {
        notifications?.info?.('Sube evidencia fotográfica antes de continuar');
        document.getElementById('evidenceInput')?.focus();
        document.getElementById('activeEvidence')?.scrollIntoView({ behavior: 'smooth' });
      } catch(_) {}
    }
    else if (phase === 'en_camino_entregar') { 
      if (btnComplete) { btnComplete.classList.remove('hidden'); btnComplete.disabled = !hasEvidence; }
      if (!hasEvidence) {
        try {
          notifications?.warning?.('Debes subir al menos una evidencia antes de completar');
          document.getElementById('evidenceInput')?.focus();
        } catch(_) {}
      }
    }
    else { 
      // Por defecto (ej. Aceptada), mostrar "En camino a recoger"
      if (btnGoPickup) { btnGoPickup.classList.remove('hidden'); btnGoPickup.disabled = false; } 
    }
    
    updateProgressBar(phase);
  }

  async function handleStatusUpdate(newStatus, successMsg, btn) {
    if (!currentOrder) return;
    try {
      if (window.__updatingOrder) return; 
      window.__updatingOrder = true;
      if(btn) btn.disabled = true;

      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');

      const res = await OrderManager.actualizarEstadoPedido(currentOrder.id, newStatus, { collaborator_id: user.id });
      if (!res?.success) throw new Error(res?.error || 'Error actualizando estado');

      notifications?.success?.(successMsg);
      
      // Actualizar status DB localmente (aproximado)
      if (['entregada', 'completada'].includes(newStatus)) currentOrder.status = 'completed';
      else if (['cancelada'].includes(newStatus)) currentOrder.status = 'cancelled';
      else if (['aceptada'].includes(newStatus)) currentOrder.status = 'accepted';
      else currentOrder.status = 'in_progress';
      
      // Simular tracking update
      if (!currentOrder.tracking_data) currentOrder.tracking_data = [];
      currentOrder.tracking_data.push({ ui_status: newStatus, date: new Date().toISOString() });

      if (newStatus === 'cargando') {
        try {
          notifications?.info?.('Sube evidencia fotográfica en la sección Evidencia');
          document.getElementById('evidenceInput')?.focus();
          document.getElementById('activeEvidence')?.scrollIntoView({ behavior: 'smooth' });
        } catch(_) {}
      }
      
      // Si es estado final, cerrar
      if (['entregada', 'cancelada'].includes(newStatus)) {
        clearActiveJobStorage();
        closeActiveJob();
        document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
        // Refrescar la lista para que la orden completada desaparezca
        fetchOrdersForCollaborator();
      } else {
        updatePrimaryActionButtons(currentOrder);
        try { localStorage.setItem('tlc_active_job_state', newStatus); } catch(_){}
      }

    } catch (e) {
      notifications?.error?.(e?.message || 'No se pudo actualizar');
    } finally {
      if(btn) btn.disabled = false;
      window.__updatingOrder = false;
    }
  }

  // Listeners de botones de estado
  if (btnGoPickup) btnGoPickup.addEventListener('click', async () => {
    if (!currentOrder?.id) return;
    btnGoPickup.disabled = true;
    try {
      const { order, error } = await supabaseConfig.startOrderWork(currentOrder.id);
      if (error) throw error;
      if (order) {
        currentOrder = order;
        setActiveJobStorage(order.id);
        try { localStorage.setItem('tlc_active_job_state', getUiStatus(order)); } catch(_){}
        updatePrimaryActionButtons(order);
        initActiveMap(order);
        notifications?.success?.('Trabajo iniciado');
      }
    } catch (e) {
      notifications?.error?.(e?.message || 'No se pudo iniciar el trabajo');
    } finally {
      btnGoPickup.disabled = false;
    }
  });
  if (btnLoading) btnLoading.addEventListener('click', () => handleStatusUpdate('cargando', 'Cargando', btnLoading));
  if (btnGoDeliver) btnGoDeliver.addEventListener('click', () => handleStatusUpdate('en_camino_entregar', 'En camino a entregar', btnGoDeliver));
  
  if (btnComplete) btnComplete.addEventListener('click', async () => {
    const photos = Array.isArray(currentOrder?.evidence_photos) ? currentOrder.evidence_photos : [];
    if (!photos.length) {
      try {
        notifications?.warning?.('Debes subir al menos una evidencia antes de completar');
        document.getElementById('evidenceInput')?.focus();
        document.getElementById('activeEvidence')?.scrollIntoView({ behavior: 'smooth' });
      } catch(_) {}
      return;
    }
    if (confirm('¿Seguro que deseas completar esta solicitud?')) {
      btnComplete.disabled = true;
      try {
        const { error } = await supabaseConfig.completeOrderWork(currentOrder.id);
        if (error) throw error;
        notifications?.success?.('Solicitud completada');
        clearActiveJobStorage();
        closeActiveJob();
        document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
        fetchOrdersForCollaborator();
      } catch (e) {
        notifications?.error?.(e?.message || 'No se pudo completar');
      } finally {
        btnComplete.disabled = false;
      }
    }
  });
  
  if (btnCancel) btnCancel.addEventListener('click', () => {
    if (confirm('¿Seguro que deseas cancelar esta solicitud?')) {
      handleStatusUpdate('cancelada', 'Solicitud cancelada', btnCancel);
    }
  });

  if (backToListBtn) backToListBtn.addEventListener('click', closeActiveJob);

  // --- Evidencia ---

  async function uploadEvidence(file){
    if (!currentOrder || !file) return;
    try {
      const bucket = supabaseConfig.getEvidenceBucket ? supabaseConfig.getEvidenceBucket() : 'order-evidence';
      // Sanitizar nombre de archivo
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `${currentOrder.id}/${Date.now()}-${safeName}`;
      
      const { error: upErr } = await supabaseConfig.client.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabaseConfig.client.storage.from(bucket).getPublicUrl(path);
      const url = pub?.publicUrl || '';
      
      const prev = Array.isArray(currentOrder.evidence_photos) ? currentOrder.evidence_photos : [];
      const next = [...prev, { bucket, path, url }];
      
      const { error: updErr } = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client.from('orders').update({ evidence_photos: next }).eq('id', currentOrder.id))
        || supabaseConfig.client.from('orders').update({ evidence_photos: next }).eq('id', currentOrder.id));
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

  // --- Carga de Datos ---

  async function fetchOrdersForCollaborator() {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    try {
      const ok = await ensureAuthOrRedirect();
      if (!ok) return;

      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("No user id");

      // Validar colaborador (opcional, depende de reglas de negocio)
      try {
        const v = await supabaseConfig.validateActiveCollaborator?.(uid);
        if (v && !v.isValid) {
          notifications?.error?.(v?.error === 'Collaborator is not active' ? 'Cuenta desactivada.' : 'No autorizado.');
          await supabaseConfig.client.auth.signOut();
          window.location.href = 'login-colaborador.html';
          return;
        }
      } catch (e) { console.error("Validacion error", e); }

      // PRIMERO: Verificar qué órdenes existen en general
      const respAll = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
        .from('orders')
        .select('id,status,assigned_to')
        .limit(10)) || supabaseConfig.client
        .from('orders')
        .select('id,status,assigned_to')
        .limit(10));
      const { data: allOrders, error: allError } = respAll;
      
      // Verificar si hay políticas RLS bloqueando
      if (allError) {
        console.error('Cannot access orders table:', allError);
        throw new Error(`No se puede acceder a la tabla orders: ${allError.message}`);
      }
      
      if (!allOrders || allOrders.length === 0) {
        orders = [];
        renderOrders();
        return;
      }
      
      // Importante: seleccionar campos necesarios 
      const resp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
        .from('orders')
        .select('id,short_id,name,phone,status,pickup,delivery,origin_coords,destination_coords,service_questions,estimated_price,service:services(name,description),vehicle:vehicles(name),assigned_to,tracking_data')
        .or(`assigned_to.eq.${uid},status.eq.pending`)
        .order('created_at', { ascending: false })) || supabaseConfig.client
        .from('orders')
        .select('id,short_id,name,phone,status,pickup,delivery,origin_coords,destination_coords,service_questions,estimated_price,service:services(name,description),vehicle:vehicles(name),assigned_to,tracking_data')
        .or(`assigned_to.eq.${uid},status.eq.pending`)
        .order('created_at', { ascending: false }));
      const { data, error } = resp;

      if (error) throw error;

      const rawOrders = data || [];
      
      // Filtrar órdenes asignadas al usuario o pendientes
      orders = rawOrders.filter(o => {
        const isAssignedToUser = o.assigned_to === uid;
        const isPending = o.assigned_to === null;
        return isAssignedToUser || isPending;
      });
      
      orders = orders.filter(o => !isFinalOrder(o));

      renderOrders();

    } catch (e) {
      console.error('Error in fetchOrdersForCollaborator:', e);
      notifications?.error?.('Error cargando solicitudes.');
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
    
    if (total === 0) {
      grid.innerHTML = '<div class="col-span-full bg-white rounded-xl border p-6 text-center text-gray-600">No hay solicitudes pendientes o asignadas por ahora.</div>';
      return;
    }

    grid.innerHTML = orders.map(o => {
      const idDisplay = o.id; // o.short_id si prefieres
      const service = escapeHtml(o?.service?.name || 'Servicio General');
      const status = String(o.status || '').trim();
      const s = status.toLowerCase();
      
      let badge = 'bg-gray-100 text-gray-700';
      if (s === 'pendiente') badge = 'bg-yellow-100 text-yellow-700';
      else if (s === 'aceptada') badge = 'bg-blue-100 text-blue-700';
      else if (s.includes('curso') || s.includes('camino')) badge = 'bg-indigo-100 text-indigo-700';
      else if (s === 'cancelada') badge = 'bg-red-100 text-red-700';
      else if (s === 'completada' || s === 'entregada') badge = 'bg-green-100 text-green-700';

      // Boton Aceptar solo si está pendiente y no tengo orden activa (o lógica de negocio)
      // Aquí permitimos aceptar si está pendiente.
      const canAccept = s === 'pendiente';
      
      return `
        <div class="group bg-white rounded-2xl shadow hover:shadow-lg border border-gray-200 overflow-hidden transition-shadow">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <span class="inline-flex items-center justify-center w-auto min-w-[36px] px-2 h-9 rounded-xl bg-blue-600 text-white font-bold text-sm">#${idDisplay}</span>
            <span class="px-2 py-1 rounded ${badge} text-xs font-medium uppercase tracking-wide">${escapeHtml(status)}</span>
          </div>
          <div class="p-4 space-y-3">
            <div class="flex items-start gap-2">
               <i data-lucide="package" class="w-4 h-4 text-gray-400 mt-0.5"></i>
               <p class="text-sm font-semibold text-gray-900">${service}</p>
            </div>
            <div class="flex items-start gap-2">
               <i data-lucide="map-pin" class="w-4 h-4 text-gray-400 mt-0.5"></i>
               <div class="text-xs text-gray-600">
                 <div class="font-medium text-gray-900">Origen:</div>
                 ${escapeHtml(o.pickup || 'Sin origen')}
               </div>
            </div>
            <div class="flex items-start gap-2">
               <i data-lucide="flag" class="w-4 h-4 text-gray-400 mt-0.5"></i>
               <div class="text-xs text-gray-600">
                 <div class="font-medium text-gray-900">Destino:</div>
                 ${escapeHtml(o.delivery || 'Sin destino')}
               </div>
            </div>

            <!-- TARIFA EDITABLE -->
            <div class="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
               <i data-lucide="dollar-sign" class="w-4 h-4 text-gray-400"></i>
               <div class="text-xs text-gray-600 flex-1">
                 <div class="font-medium text-gray-900">Tarifa:</div>
                 ${canAccept 
                  ? `<input type="number" step="0.01" min="0" class="price-input w-full mt-1 px-2 py-1 border rounded text-sm" value="${(o.estimated_price && parseFloat(o.estimated_price) > 0) ? o.estimated_price : ''}" placeholder="A convenir" data-id="${o.id}">`
                  : `<span class="text-sm font-semibold text-gray-800">${(o.estimated_price && parseFloat(o.estimated_price) > 0) ? '$'+o.estimated_price : 'A convenir'}</span>`
                }
               </div>
            </div>
            
          </div>
          <div class="px-4 py-3 border-t flex items-center justify-end gap-2 bg-gray-50">
            <button class="btn-open px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors" data-id="${o.id}">Detalles</button>
            ${canAccept ? `<button class="btn-accept px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm" data-id="${o.id}">Aceptar</button>` : ''}
            ${!canAccept && o.assigned_to ? `<button class="btn-continue px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm" data-id="${o.id}">Continuar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Re-inicializar iconos
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        if (__iconsTimer) clearTimeout(__iconsTimer);
        __iconsTimer = setTimeout(() => window.lucide.createIcons(), 50);
      }
    } catch (_) {}

    // Event Listeners
    grid.querySelectorAll('.btn-open').forEach(b => {
      b.addEventListener('click', () => {
        const o = orders.find(x => String(x.id) === b.dataset.id);
        if (o) openModal(o);
      });
    });

    grid.querySelectorAll('.btn-accept').forEach(b => {
      b.addEventListener('click', async () => {
        const o = orders.find(x => String(x.id) === b.dataset.id);
        if (!o) return;
        
        // Verificar si ya tengo una activa en local (opcional)
        // const activeId = localStorage.getItem('tlc_active_job_id');
        // if (activeId && activeId !== String(o.id)) { notifications?.info?.('Ya tienes un trabajo activo'); return; }

        try {
          b.disabled = true;
          b.textContent = '...';
          await supabaseConfig.ensureFreshSession?.();
          const { data: { session } } = await supabaseConfig.client.auth.getSession();
          const userId = session?.user?.id;
          if (!userId) throw new Error('Sesión inválida');
          const v = await supabaseConfig.validateActiveCollaborator?.(userId);
          if (v && !v.isValid) throw new Error('Sesión inválida');

          // Obtener precio editado si existe
          const inputPrice = grid.querySelector(`.price-input[data-id="${o.id}"]`);
          let finalPrice = null;
          if (inputPrice) {
            const val = parseFloat(inputPrice.value);
            if (!isNaN(val) && val >= 0) {
              finalPrice = val;
            }
          }

          const res = await OrderManager.acceptOrder(o.id, { 
            collaborator_id: userId,
            estimated_price: finalPrice
          });
          if (!res?.success) throw new Error(res?.error || 'Error al aceptar');

          notifications?.success?.('Orden aceptada');
          o.status = 'Aceptada';
          o.assigned_to = userId;
          if (finalPrice !== null) o.estimated_price = finalPrice;
          try { notifications?.info?.('Pulsa "En camino a recoger" para iniciar el trabajo'); } catch(_){}
        } catch (e) {
          notifications?.error?.(e.message || 'No se pudo aceptar la orden');
          b.disabled = false;
          b.textContent = 'Aceptar';
        }
      });
    });

    grid.querySelectorAll('.btn-continue').forEach(b => {
      b.addEventListener('click', () => {
        const o = orders.find(x => String(x.id) === b.dataset.id);
        if (o) openActiveJob(o);
      });
    });
  }

  // --- Inicialización ---

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

  // Aceptar desde Modal (sin iniciar trabajo)
  if (typeof modalAcceptBtn !== 'undefined' && modalAcceptBtn) {
    modalAcceptBtn.addEventListener('click', async () => {
      if (!currentOrder) return;
      try {
        modalAcceptBtn.disabled = true;
        await supabaseConfig.ensureFreshSession?.();
        const { data: { session } } = await supabaseConfig.client.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) throw new Error('Sesión inválida');
        const v = await supabaseConfig.validateActiveCollaborator?.(userId);
        if (v && !v.isValid) throw new Error('Cuenta no autorizada');

        // Aceptar por RPC (sin precio desde modal)
        const res = await OrderManager.acceptOrder(currentOrder.id, { collaborator_id: userId });
        if (!res?.success) throw new Error(res?.error || 'No se pudo aceptar');

        // Actualizar estado local y cerrar modal
        currentOrder.status = 'accepted';
        currentOrder.assigned_to = userId;
        closeModal();
        try { notifications?.info?.('Orden aceptada. Pulsa "En camino a recoger" para iniciar.'); } catch(_){}
      } catch (e) {
        notifications?.error?.(e?.message || 'No se pudo aceptar la orden');
      } finally {
        modalAcceptBtn.disabled = false;
      }
    });
  }

  const init = async () => {
    const ok = await ensureAuthOrRedirect();
    if (!ok) return;

    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch(_){}
      }
    } catch(_){}

    try {
      const info = await getActiveCollaboratorInfo();
      const nameEl = document.getElementById('sidebarCollabName');
      const matEl = document.getElementById('sidebarCollabMatricula');
      if (nameEl) nameEl.textContent = info?.name || 'Colaborador';
      if (matEl) matEl.textContent = info?.matricula ? `Matrícula: ${info.matricula}` : 'Matrícula: —';
    } catch(_) {}

    // Suscripción Realtime
    try {
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      
      if (uid) {
        // ✅ AUTOMATIZACIÓN: Registrar push al cargar
        registerCollaboratorPush(uid);

        const ch = supabaseConfig.client.channel('orders-collab-v2');
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
          const isNewPending = payload.eventType === 'INSERT' && String(payload.new.status || '').toLowerCase() === 'pending';
          const isMyOrder = payload.new?.assigned_to === uid || payload.old?.assigned_to === uid;
          const isUnassigned = payload.new?.assigned_to === null;
          
          if (isNewPending || isMyOrder || isUnassigned) {
             await fetchOrdersForCollaborator();
             // Si la orden activa cambió, actualizar vista activa
             if (currentOrder && payload.new && payload.new.id === currentOrder.id) {
               const s = String(payload.new.status || '').toLowerCase();
               if (s === 'cancelled' || s === 'completed') {
                 try { notifications?.warning?.(s === 'cancelled' ? 'Orden cancelada' : 'Orden completada'); } catch(_){}
                 clearActiveJobStorage();
                 closeActiveJob();
               } else {
                Object.assign(currentOrder, payload.new);
                if (activeView && !activeView.classList.contains('hidden')) {
                  openActiveJob(currentOrder);
                }
               }
             }
          }
        });
        try {
          ch.subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              // Fallback: polling cada 30s si Realtime falla
              if (!window.__ordersPolling) {
                window.__ordersPolling = setInterval(fetchOrdersForCollaborator, 30000);
              }
            }
          });
        } catch (_) {
          if (!window.__ordersPolling) {
            window.__ordersPolling = setInterval(fetchOrdersForCollaborator, 30000);
          }
        }
        
        window.addEventListener('beforeunload', () => { try { ch.unsubscribe(); } catch(_){} });
      }
    } catch(e) { console.error("Realtime error", e); }

    // Cargar trabajo activo real desde DB
    try {
      const active = await supabaseConfig.getActiveJobOrder();
      if (active) {
        openActiveJob(active);
        setActiveJobStorage(active.id);
      }
    } catch(_){}

    await fetchOrdersForCollaborator();

     // --- CONTINUIDAD DE SESIÓN ---
     if (!localStorage.getItem('tlc_active_job_id')) {
       try {
         const { data: { user } } = await supabaseConfig.client.auth.getSession();
         if (user?.id) {
           // ✅ CORRECCIÓN: Solo restaurar órdenes realmente activas
          const activeOrder = orders.find(o => o.assigned_to === user.id && !isFinalOrder(o));
           
           if (activeOrder) {
             console.log('[Continuidad] Orden activa encontrada en DB, restaurando sesión:', activeOrder.id);
             setActiveJobStorage(activeOrder.id);
             try { localStorage.setItem('tlc_active_job_state', getUiStatus(activeOrder)); } catch(_){}
           }
         }
       } catch (e) {
         console.error('[Continuidad] Error buscando orden activa:', e);
       }
     }

    // Recuperar sesión activa de localStorage si existe
    try {
      const storedId = localStorage.getItem('tlc_active_job_id');
      if (storedId) {
        // Buscar en las ordenes cargadas o fetch individual
        let o = orders.find(x => String(x.id) === storedId);
        if (!o) {
           const { data } = await supabaseConfig.client
             .from('orders')
             .select('*,service:services(name),vehicle:vehicles(name)')
             .eq('id', storedId)
             .single();
           if (data) o = data;
        }
        
        if (o) {
          if (isFinalOrder(o)) {
             clearActiveJobStorage();
             if (continueBanner) continueBanner.classList.add('hidden');
          } else {
             if (continueBanner) continueBanner.classList.remove('hidden');
          }
        }
      }
    } catch(_){}
  };

  init();

  // Listeners de Banner "Continuar"
  if (continueBtn) continueBtn.addEventListener('click', async () => {
    try {
      const storedId = localStorage.getItem('tlc_active_job_id');
      if (!storedId) return;
      
      // Buscar orden fresca
      const dresp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
             .from('orders')
             .select('*,service:services(name),vehicle:vehicles(name)')
             .eq('id', storedId)
             .single()) || supabaseConfig.client
             .from('orders')
             .select('*,service:services(name),vehicle:vehicles(name)')
             .eq('id', storedId)
             .single());
      const { data, error } = dresp;
             
      if (error || !data) {
        notifications?.error?.("La orden ya no está disponible");
        clearActiveJobStorage();
        continueBanner.classList.add('hidden');
        return;
      }

      if (isFinalOrder(data)) {
        notifications?.info?.("Esta orden ya fue finalizada");
        clearActiveJobStorage();
        continueBanner.classList.add('hidden');
        return;
      }
      
      openContinueModal(data);
    } catch(_){}
  });

  if (closeContinueModal) closeContinueModal.addEventListener('click', closeContinue);
  if (cancelContinueBtn) cancelContinueBtn.addEventListener('click', closeContinue);
  
  if (confirmContinueBtn) confirmContinueBtn.addEventListener('click', async () => {
    try {
      const storedId = localStorage.getItem('tlc_active_job_id');
      if (!storedId) return;
      
      const { data } = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
             .from('orders')
             .select('*,service:services(name),vehicle:vehicles(name)')
             .eq('id', storedId)
             .single()) || supabaseConfig.client
             .from('orders')
             .select('*,service:services(name),vehicle:vehicles(name)')
             .eq('id', storedId)
             .single());
             
      if (!data) return;
      
      closeContinue();
      openActiveJob(data);
      openDirections(data);
    } catch(_){}
  });

  const logoutBtnNav = document.getElementById('collabLogoutBtnNav');
  const collapseBtnNav = document.getElementById('collabCollapseBtnNav');
  if (logoutBtnNav) logoutBtnNav.addEventListener('click', async () => {
    try {
      await supabaseConfig.client.auth.signOut();
    } catch(_) {}
    try { localStorage.removeItem('userRole'); localStorage.removeItem('tlc_active_job_id'); localStorage.removeItem('tlc_active_job_state'); } catch(_){}
    window.location.href = 'login-colaborador.html';
  });
  if (collapseBtnNav) collapseBtnNav.addEventListener('click', () => {
    const footerToggle = document.getElementById('sidebar-toggle');
    if (footerToggle) { try { footerToggle.click(); } catch(_){} return; }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('md:translate-x-0');
  });

  // Ajuste: reforzar sesión antes de aceptar órdenes
  (function strengthenAcceptFlow(){
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.btn-accept').forEach(btn => {
        if (btn.__patched) return; btn.__patched = true;
        btn.addEventListener('click', async (ev) => {
          try { await supabaseConfig.ensureFreshSession?.(); } catch(_){ }
        }, { once: true, capture: true });
      });
    });
    observer.observe(document.getElementById('ordersGrid') || document.body, { childList: true, subtree: true });
  })();

});
