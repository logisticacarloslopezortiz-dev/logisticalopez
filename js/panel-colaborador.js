document.addEventListener('DOMContentLoaded', () => {
  window.sendStatusEmail = async function(order, status) {
    try {
      if (!supabaseConfig?.client) return;
      const orderId = order?.id;
      const shortId = order?.short_id || null;
      const name = order?.name || null;
      let to = null;
      let clientId = order?.client_id || null;
      if (!clientId) {
        try {
          const { data: full } = await supabaseConfig.client
            .from('orders')
            .select('client_id,short_id,name')
            .eq('id', orderId)
            .single();
          clientId = full?.client_id || clientId || null;
        } catch (_) {}
      }
      if (clientId) {
        try {
          const { data: profile } = await supabaseConfig.client
            .from('profiles')
            .select('email,full_name')
            .eq('id', clientId)
            .maybeSingle();
          to = profile?.email || null;
        } catch (_) {}
      }
      if (!to && order?.email) to = order.email;
      if (!to) return;
      const payload = { to, orderId, shortId, status, name };
      let attempt = 0;
      const maxAttempts = 3;
      const trySend = async () => {
        attempt++;
        try {
          const { error } = await supabaseConfig.client.functions.invoke('send-order-email', { body: payload });
          if (error) throw error;
          notifications?.success?.('Correo enviado');
        } catch (e) {
          if (attempt < maxAttempts) {
            setTimeout(trySend, attempt * 600);
          } else {
            notifications?.warning?.('No se pudo enviar el correo');
          }
        }
      };
      trySend();
    } catch (_) {}
  };

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
  const modalAcceptBtn = document.getElementById('modalAcceptBtn');
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
  let __currentUserId = null;

  // Modal Confirmación Custom
  const confirmModal = document.getElementById('confirmationModal');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmYesBtn = document.getElementById('confirmYesBtn');
  const confirmNoBtn = document.getElementById('confirmNoBtn');
  let _confirmCallback = null;

  function showConfirm(msg, callback) {
    if (confirmMessage) confirmMessage.textContent = msg;
    _confirmCallback = callback;
    if (confirmModal) {
        confirmModal.classList.remove('hidden');
        confirmModal.classList.add('flex');
    } else {
        // Fallback si no existe el modal en HTML
        if (confirm(msg)) callback();
    }
  }

  function hideConfirm() {
    if (confirmModal) {
        confirmModal.classList.add('hidden');
        confirmModal.classList.remove('flex');
    }
    _confirmCallback = null;
  }

  if (confirmYesBtn) confirmYesBtn.onclick = () => {
    if (_confirmCallback) _confirmCallback();
    hideConfirm();
  };
  
  if (confirmNoBtn) confirmNoBtn.onclick = hideConfirm;

  // Estado Local
  let orders = [];
  let currentOrder = null;
  let __iconsTimer = null;
  let activeMap = null;
  let activePickupMarker = null;
  let activeDeliveryMarker = null;

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
    if (v === 'pending') return 'Pendiente';
    if (v === 'accepted') return 'Aceptada';
    if (v === 'completed') return 'Completada';
    if (v === 'cancelled') return 'Cancelada';
    if (v === 'en_camino_recoger') return 'En camino a recoger';
    if (v === 'cargando') return 'Cargando';
    if (v === 'en_camino_entregar') return 'En camino a entregar';
    return 'Actualizada';
  }

  // --- MÓDULOS DE GESTIÓN ---

  const UI = {
    showLoading() {
      if (grid) {
        grid.innerHTML = Array(3).fill(0).map(() => `
          <div class="bg-white rounded-2xl shadow p-4 space-y-3 animate-pulse">
            <div class="flex justify-between">
              <div class="h-6 bg-gray-200 rounded w-1/4"></div>
              <div class="h-6 bg-gray-200 rounded w-1/6"></div>
            </div>
            <div class="h-4 bg-gray-200 rounded w-3/4"></div>
            <div class="h-4 bg-gray-200 rounded w-1/2"></div>
            <div class="h-10 bg-gray-200 rounded w-full mt-4"></div>
          </div>
        `).join('');
      }
    },
    hideLoading() {
      if (overlay) overlay.classList.add('hidden');
    },
    disableButtons(disabled = true) {
      // Deshabilitar solo botones de acción principales para evitar bloqueo total
      const selectors = [
        '#btnGoPickup', '#btnLoading', '#btnGoDeliver', '#btnComplete', '#btnCancel',
        '#modalAcceptBtn', '#confirmContinueBtn'
      ];
      selectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.disabled = disabled;
      });
    }
  };

  // --- Utilidades ---

  // Geocoding inverso: convertir coordenadas a direcciones
  const addressCache = new Map();
  
  async function getAddressFromCoords(lat, lng) {
    if (!lat || !lng) return null;
    const key = `${lat},${lng}`;
    if (addressCache.has(key)) return addressCache.get(key);
    
    try {
      // Usar Nominatim (OpenStreetMap) - libre y sin API key
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lng=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'es' } }
      );
      if (!response.ok) return null;
      const data = await response.json();
      const address = data.address?.road || data.address?.village || data.address?.city || data.display_name || null;
      if (address) {
        addressCache.set(key, address);
        return address;
      }
    } catch (e) {
      console.warn('Error geocoding:', e);
    }
    return null;
  }

  // Obtener dirección de texto (si existe) o convertir desde coordenadas
  async function getDisplayAddress(textAddress, coordsObj) {
    // Si ya hay dirección de texto y no es solo coordenadas, usarla
    if (textAddress && textAddress.trim() && !/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(textAddress.trim())) {
      return textAddress;
    }
    
    // Si hay coordenadas, intentar convertir
    if (coordsObj && typeof coordsObj.lat === 'number' && typeof coordsObj.lng === 'number') {
      const address = await getAddressFromCoords(coordsObj.lat, coordsObj.lng);
      if (address) return address;
      // Fallback a mostrar coordenadas de forma legible
      return `${coordsObj.lat.toFixed(4)}, ${coordsObj.lng.toFixed(4)}`;
    }
    
    return textAddress || 'Sin dirección';
  }

  // --- Notificaciones Push (Automatización) ---
  async function registerCollaboratorPush(userId) {
    if (window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async function(OneSignal) {
        try {
          // Identificar al colaborador en OneSignal
          await OneSignal.login(userId);
          console.log(`[OneSignal] Colaborador identificado: ${userId}`);

          // Solicitar permiso si aún no lo tiene
          if (!OneSignal.User.PushSubscription.optedIn) {
             await OneSignal.Slidedown.promptPush();
          }

          // ✅ Guardar ID en Supabase para recibir notificaciones de asignación
          const saveId = async () => {
            const id = OneSignal.User.PushSubscription.id;
            if (id) {
              console.log('[OneSignal] Guardando ID en DB:', id);
              await supabaseConfig.updateOneSignalId(id);
            }
          };

          // Guardar ahora y si cambia
          await saveId();
          OneSignal.User.PushSubscription.addEventListener("change", saveId);

        } catch (e) {
          console.warn('[OneSignal] Error registrando colaborador:', e);
        }
      });
    }
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
      const uid = String(session?.user?.id || '').trim();
      if (!uid) return null;
      const v = await supabaseConfig.validateActiveCollaborator?.(uid);
      if (v && !v.isValid) return null;
      const resp = await supabaseConfig.withAuthRetry(() => supabaseConfig.client
        .from('collaborators')
        .select('id,name,matricula,status')
        .eq('id', uid)
        .maybeSingle());
      return resp?.data || { id: uid };
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
        const isPending = String(order.status || '').toLowerCase() === 'pending' && (!order.assigned_to || order.assigned_to === __currentUserId);
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
    const oc = order.origin_coords;
    const dc = order.destination_coords;
    
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
      
      const oc = order.origin_coords;
      const dc = order.destination_coords;
      
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
    
    updatePrimaryActionButtons(order);
    
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
    fetchOrdersForCollaborator(); // Recargar lista al salir
  }

  // --- Actualización de Estados ---

  // Helper para obtener estado UI desde orden DB
  function getUiStatus(order) {
    if (!order) return '';
    const s = String(order.status || '').toLowerCase();
    
    if (s === 'pending') return 'pending';
    if (s === 'accepted') return 'accepted';
    if (s === 'completed') return 'completed';
    if (s === 'cancelled') return 'cancelled';
    
    if (s === 'in_progress' || s === 'en curso') {
      if (Array.isArray(order.tracking_data) && order.tracking_data.length > 0) {
        const last = order.tracking_data[order.tracking_data.length - 1];
        const uiStatus = String(last.ui_status || 'en_camino_recoger').toLowerCase();
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
    return db === 'completed' || db === 'cancelled';
  }

  function updateProgressBar(status){
    const bar = document.getElementById('jobProgressBar');
    if (!bar) return;
    // Ajuste de porcentajes: entregada 90%, completed 100%
    const map = { 
      pending: 0, 
      accepted: 15, 
      en_camino_recoger: 25, 
      cargando: 50, 
      en_camino_entregar: 75, 
      entregada: 90, 
      completed: 100, 
      cancelled: 100
    };
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

    // Usar estado DB para determinar finalización
    const dbStatus = String(order?.status || '').toLowerCase();
    if (dbStatus === 'completed' || dbStatus === 'cancelled') {
      // Si la orden ya finalizó (DB), no mostrar botones de acción
      updateProgressBar(dbStatus === 'completed' ? 'completed' : 'cancelled');
      return;
    }

    if (phase === 'accepted') { 
      if (btnGoPickup) { btnGoPickup.classList.remove('hidden'); btnGoPickup.disabled = false; } 
    }
    else if (phase === 'en_camino_recoger') { 
      if (btnLoading) { btnLoading.classList.remove('hidden'); btnLoading.disabled = false; } 
    }
    else if (phase === 'cargando') { 
      if (btnGoDeliver) { btnGoDeliver.classList.remove('hidden'); btnGoDeliver.disabled = !hasEvidence; }
      if (!hasEvidence) {
        try {
          notifications?.info?.('Sube evidencia fotográfica antes de continuar');
          document.getElementById('evidenceInput')?.focus();
          document.getElementById('activeEvidence')?.scrollIntoView({ behavior: 'smooth' });
        } catch(_) {}
      }
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

    // Helper: actualiza tracking_data y (si aplica) status en DB
    async function persistTrackingStep(orderId, uiStatus, opts = {}) {
      const { setInProgress = true } = opts;
      // Obtener tracking actual desde DB para evitar sobrescribir
      const { data: fresh, error: getErr } = await (supabaseConfig.withAuthRetry?.(() =>
        supabaseConfig.client
          .from('orders')
          .select('tracking_data,status')
          .eq('id', orderId)
          .single()) || supabaseConfig.client
          .from('orders')
          .select('tracking_data,status')
          .eq('id', orderId)
          .single());
      if (getErr) throw getErr;

      const tracking = Array.isArray(fresh?.tracking_data) ? [...fresh.tracking_data] : [];
      const last = tracking[tracking.length - 1];
      if (last?.ui_status === uiStatus) return tracking;
      tracking.push({ ui_status: uiStatus, date: new Date().toISOString() });

      const patch = { tracking_data: tracking };
      if (setInProgress) patch.status = 'in_progress';

      const { error: updErr } = await (supabaseConfig.withAuthRetry?.(() =>
        supabaseConfig.client
          .from('orders')
          .update(patch)
          .eq('id', orderId)) || supabaseConfig.client
          .from('orders')
          .update(patch)
          .eq('id', orderId));
      if (updErr) throw updErr;

      return tracking;
    }

    try {
      if (window.__updatingOrder) return;
      window.__updatingOrder = true;
      UI.disableButtons(true);

      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');

      // Estados finales ya tienen flujos dedicados (complete/cancel). Aquí manejamos intermedios.
      if (['entregada', 'completada', 'cancelada'].includes(newStatus)) {
        throw new Error('Estado no soportado por este flujo');
      }

      // Persistir tracking y forzar in_progress
      const nextTracking = await persistTrackingStep(currentOrder.id, newStatus, { setInProgress: true });

      // Refrescar orden desde DB para tener estado consistente
      try {
        const { data: freshOrder } = await supabaseConfig.client
          .from('orders')
          .select('*,service:services(name,description),vehicle:vehicles(name)')
          .eq('id', currentOrder.id)
          .single();
        if (freshOrder) currentOrder = freshOrder;
      } catch (_) {}

      // Asegurar estado local coherente
      currentOrder.status = 'in_progress';
      currentOrder.tracking_data = nextTracking;

      

      notifications?.success?.(successMsg);
      try { window.sendStatusEmail?.(currentOrder, newStatus); } catch(_){}

      if (newStatus === 'cargando') {
        try {
          notifications?.info?.('Sube evidencia fotográfica en la sección Evidencia');
          document.getElementById('evidenceInput')?.focus();
          document.getElementById('activeEvidence')?.scrollIntoView({ behavior: 'smooth' });
        } catch (_) {}
      }

      updatePrimaryActionButtons(currentOrder);
    } catch (e) {
      notifications?.error?.(e?.message || 'No se pudo actualizar');
    } finally {
      UI.disableButtons(false);
      window.__updatingOrder = false;
    }
  }

  // Listeners de botones de estado
  if (btnGoPickup) btnGoPickup.addEventListener('click', () => handleStatusUpdate('en_camino_recoger', 'En camino a recoger', btnGoPickup));
  if (btnLoading) btnLoading.addEventListener('click', () => handleStatusUpdate('cargando', 'Cargando', btnLoading));
  if (btnGoDeliver) btnGoDeliver.addEventListener('click', () => {
    const phase = getUiStatus(currentOrder);
    if (phase !== 'cargando') {
      try { notifications?.warning?.('Debes pasar por "Cargando" antes de entregar'); } catch(_){}
      return;
    }
    handleStatusUpdate('en_camino_entregar', 'En camino a entregar', btnGoDeliver);
  });
  
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
    const phase = getUiStatus(currentOrder);
    if (phase !== 'en_camino_entregar') {
      try { notifications?.warning?.('Debes estar "En camino a entregar" para completar'); } catch(_){}
      return;
    }
    showConfirm('¿Seguro que deseas completar esta solicitud?', async () => {
      btnComplete.disabled = true;
      try {
        const { error } = await supabaseConfig.completeOrderWork(currentOrder.id);
        if (error) throw error;
        
        

        notifications?.success?.('Solicitud completada');
        try { window.sendStatusEmail?.(currentOrder, 'completed'); } catch(_){}
        closeActiveJob();
        document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
        fetchOrdersForCollaborator();
      } catch (e) {
        notifications?.error?.(e?.message || 'No se pudo completar');
      } finally {
        btnComplete.disabled = false;
      }
    });
  });
  
  if (btnCancel) btnCancel.addEventListener('click', async () => {
    if (!currentOrder?.id) return;
    showConfirm('¿Seguro que deseas cancelar esta solicitud?', async () => {
      btnCancel.disabled = true;
      try {
        const res = await OrderManager.cancelActiveJob(currentOrder.id);
        if (!res?.success) throw new Error(res?.error || 'No se pudo cancelar');
        notifications?.success?.('Solicitud cancelada');
        try { window.sendStatusEmail?.(currentOrder, 'cancelled'); } catch(_){}
        closeActiveJob();
        document.getElementById('main-content')?.scrollIntoView({ behavior: 'smooth' });
        fetchOrdersForCollaborator();
      } catch (e) {
        notifications?.error?.(e?.message || 'No se pudo cancelar');
      } finally {
        btnCancel.disabled = false;
      }
    });
  });

  if (backToListBtn) backToListBtn.addEventListener('click', closeActiveJob);

  // --- Evidencia ---

  async function uploadEvidence(file){
    if (!currentOrder || !file) return;
    const phase = getUiStatus(currentOrder);
    if (!['cargando', 'en_camino_entregar'].includes(phase)) {
      try { notifications?.warning?.('No puedes subir evidencia en este estado'); } catch(_) {}
      return;
    }
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

  async function fetchOrdersForCollaborator(isBackground = false) {
    if (!isBackground) {
      UI.showLoading();
    }

    try {
      const ok = await ensureAuthOrRedirect();
      if (!ok) return;

      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("No user id");
      __currentUserId = uid;

      try {
        const v = await supabaseConfig.validateActiveCollaborator?.(uid);
        if (v && !v.isValid) {
          notifications?.error?.(v?.error === 'Collaborator is not active' ? 'Cuenta desactivada.' : 'No autorizado.');
          await supabaseConfig.client.auth.signOut();
          window.location.href = 'login-colaborador.html';
          return;
        }
        // ✅ LÓGICA DE SOLICITUDES PENDIENTES:
        // La RLS policy de Supabase automáticamente:
        // 1. Si puede_ver_todas_las_ordenes = true (botón VERDE):
        //    - Ve TODAS las órdenes pendientes (assigned_to IS NULL)
        //    - ADEMÁS ve sus órdenes asignadas
        // 2. Si puede_ver_todas_las_ordenes = false (botón GRIS):
        //    - SOLO ve órdenes asignadas por el admin (assigned_to = su ID)
        const titleEl = document.getElementById('collabTitle');
        if (titleEl) {
            titleEl.textContent = 'Mis Solicitudes';
        }
      } catch (e) { console.error("Validacion error", e); }

      // ✅ REFACTOR: Llamada directa usando RLS
      // RLS filtra automáticamente basado en:
      // - puede_ver_todas_las_ordenes: true → ve pending + assigned
      // - puede_ver_todas_las_ordenes: false → SOLO assigned
      const base = supabaseConfig.client
        .from('orders')
        .select(`
          id,
          status,
          created_at,
          assigned_to,
          pickup,
          delivery,
          origin_coords,
          destination_coords,
          name,
          phone,
          service:services(name, description),
          vehicle:vehicles(name)
        `)
        .in('status', ['pending','accepted','in_progress']);
      
      let query = base;
      const vinfo = await supabaseConfig.validateActiveCollaborator?.(uid);
      const canViewAll = !!(vinfo && vinfo.collaborator && (vinfo.collaborator.can_take_orders || vinfo.collaborator.puede_ver_todas_las_ordenes));
      if (canViewAll) {
        query = query.or(`assigned_to.eq.${uid},status.eq.pending`);
      } else {
        query = query.eq('assigned_to', uid);
      }
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
          console.error('Error fetching visible orders:', error);
          throw error;
      }

      const rawOrders = data || [];
      
      // Normalizar visual: tratar órdenes asignadas al colaborador en estado "accepted" como "pendiente" visual
      // y priorizarlas al inicio.
      const me = uid;
      const normalized = rawOrders
        .filter(o => !isFinalOrder(o))
        .map(o => {
          const db = String(o.status || '').toLowerCase();
          const isMine = String(o.assigned_to || '') === String(me);
          const visualStatus = (db === 'accepted' && isMine) ? 'pending' : db;
          return { ...o, __visual_status: visualStatus };
        });
      
      const weight = (o) => {
        const s = String(o.__visual_status || '').toLowerCase();
        const isMine = String(o.assigned_to || '') === String(me);
        if (isMine && (s === 'pending' || s === 'accepted')) return 0; // mis asignadas primero (como pendientes)
        if (s === 'pending') return 1;
        if (s === 'in_progress' || s.includes('camino') || s === 'cargando') return 2;
        return 3;
      };
      orders = normalized.sort((a,b) => {
        const wa = weight(a), wb = weight(b);
        if (wa !== wb) return wa - wb;
        const ta = new Date(a.created_at || 0).getTime();
        const tb = new Date(b.created_at || 0).getTime();
        return tb - ta;
      });
      

      renderOrdersHTML();

    } catch (e) {
      console.error('Error in fetchOrdersForCollaborator:', e);
      notifications?.error?.('Error cargando solicitudes.');
    } finally {
      UI.hideLoading();
    }
    try {
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (uid) RealtimeManager.init(uid);
    } catch (_) {}
  }

  // --- GESTOR DE REALTIME MEJORADO ---
  const RealtimeManager = {
    channel: null,
    
    init(userId) {
      if (this.channel) {
        supabaseConfig.client.removeChannel(this.channel);
      }

      this.channel = supabaseConfig.client.channel('collab_dashboard_v3')
        // Escuchar mis órdenes asignadas
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `assigned_to=eq.${userId}` }, this.handleEvent.bind(this))
        // Escuchar nuevas órdenes pendientes (disponibles si puede_ver_todas_las_ordenes = true)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `status=eq.pending` }, this.handleEvent.bind(this))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Realtime conectado');
          } else if (status === 'CHANNEL_ERROR') {
            console.warn('⚠️ Error en Realtime, reintentando en 5s...');
            setTimeout(() => this.init(userId), 5000);
          }
        });
    },

    async handleEvent(payload) {
      console.log('[Realtime] Evento recibido:', payload.eventType);
      // Refrescar en segundo plano para mantener la UI actualizada
      await fetchOrdersForCollaborator(true);
    }
  };

function renderOrdersHTML() {
    const total = orders.length;
    if (totalEl) totalEl.textContent = String(total);
    if (showingEl) showingEl.textContent = String(total);
    
    if (!grid) return;
    
    if (total === 0) {
      grid.innerHTML = '<div class="col-span-full bg-white rounded-xl border p-6 text-center text-gray-600">No hay solicitudes pendientes o asignadas por ahora.</div>';
      return;
    }

    function toSpanishStatus(s, o) {
      const x = String(s || '').trim().toLowerCase();
      const isMine = o && String(o.assigned_to || '') === String(__currentUserId || '');
      if (!x) return 'Pendiente';
      if (x === 'pending' || x === 'pendiente') return 'Pendiente';
      // Si está aceptada por admin pero asignada a mí, mostrar como Pendiente (para que yo la acepte)
      if (x === 'accepted' || x === 'aceptada') return isMine ? 'Pendiente' : 'Asignada';
      if (x === 'in_progress' || x === 'en curso') return 'En curso';
      if (x === 'en_camino_recoger') return 'En camino a recoger';
      if (x === 'cargando') return 'Cargando';
      if (x === 'en_camino_entregar') return 'En camino a entregar';
      if (x === 'completed' || x === 'completada' || x === 'entregada') return 'Completada';
      if (x === 'cancelled' || x === 'cancelada') return 'Cancelada';
      return s;
    }

    grid.innerHTML = orders.map(o => {
      const idDisplay = o.id; // o.short_id si prefieres
      const service = escapeHtml(o?.service?.name || 'Servicio General');
      const dbStatus = String(o.status || '').toLowerCase();
      const status = toSpanishStatus(dbStatus, o);
      const s = status.toLowerCase();
      
      let badge = 'bg-gray-100 text-gray-700';
      if (s === 'pending') {
        if (o.assigned_to === __currentUserId) {
            badge = 'bg-purple-100 text-purple-800 border border-purple-200'; // ✨ Diferenciador visual
            // Mostrar como Pendiente (para que el colaborador la acepte)
        } else {
            badge = 'bg-yellow-100 text-yellow-800 border border-yellow-200';
        }
      }
      else if (s === 'aceptada') badge = 'bg-blue-100 text-blue-700';
      else if (s.includes('curso') || s.includes('camino')) badge = 'bg-indigo-100 text-indigo-700';
      else if (s === 'cancelada') badge = 'bg-red-100 text-red-700';
      else if (s === 'completada' || s === 'entregada') badge = 'bg-green-100 text-green-700';

      // Boton Aceptar solo si está pendiente y no tengo orden activa (o lógica de negocio)
      // Aquí permitimos aceptar si está pendiente.
      const canAccept = (dbStatus === 'pending' && (!o.assigned_to || o.assigned_to === __currentUserId))
        || (dbStatus === 'accepted' && o.assigned_to === __currentUserId);
      
      const extraTag = (s === 'pending' && o.assigned_to === __currentUserId)
        ? `<span class="ml-2 px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px]">Asignada a ti</span>`
        : '';
      
      // Obtener direcciones (pueden ser de texto o coordenadas)
      const pickupDisplay = o.pickup && !/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(o.pickup) 
        ? o.pickup 
        : (o.origin_coords ? `${o.origin_coords.lat?.toFixed(4)}, ${o.origin_coords.lng?.toFixed(4)}` : o.pickup || 'Sin origen');
      
      const deliveryDisplay = o.delivery && !/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(o.delivery)
        ? o.delivery
        : (o.destination_coords ? `${o.destination_coords.lat?.toFixed(4)}, ${o.destination_coords.lng?.toFixed(4)}` : o.delivery || 'Sin destino');
      
      return `
        <div class="group bg-white rounded-2xl shadow hover:shadow-lg border border-gray-200 overflow-hidden transition-shadow">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <span class="inline-flex items-center justify-center w-auto min-w-[36px] px-2 h-9 rounded-xl bg-blue-600 text-white font-bold text-sm">#${idDisplay}</span>
            <span class="px-2 py-1 rounded ${badge} text-xs font-medium uppercase tracking-wide">${escapeHtml(status)}</span>
            ${extraTag}
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
                 ${escapeHtml(pickupDisplay)}
               </div>
            </div>
            <div class="flex items-start gap-2">
               <i data-lucide="flag" class="w-4 h-4 text-gray-400 mt-0.5"></i>
               <div class="text-xs text-gray-600">
                 <div class="font-medium text-gray-900">Destino:</div>
                 ${escapeHtml(deliveryDisplay)}
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
  }

  function bindOrderEvents() {
    if (!grid || grid.__delegated) return;
    grid.__delegated = true;
    grid.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const o = orders.find(x => String(x.id) === btn.dataset.id);
      if (!o) return;
      if (btn.classList.contains('btn-open')) { openModal(o); return; }
      if (btn.classList.contains('btn-accept')) {
        try {
          btn.disabled = true;
          btn.textContent = '...';
          await supabaseConfig.ensureFreshSession?.();
          const { data: { session } } = await supabaseConfig.client.auth.getSession();
          const userId = session?.user?.id;
          if (!userId) throw new Error('Sesión inválida');
          const v = await supabaseConfig.validateActiveCollaborator?.(userId);
          if (v && !v.isValid) throw new Error('Sesión inválida');

          // Bloquear aceptación local si ya existe un trabajo activo asignado
          const hasActive = orders.some(x => x.assigned_to === userId && !isFinalOrder(x));
          if (hasActive) {
            notifications?.error?.('Ya tienes una orden activa');
            btn.disabled = false;
            btn.textContent = 'Aceptar';
            return;
          }

          const res = await OrderManager.acceptOrder(o.id, { collaborator_id: userId });
          if (!res?.success) throw new Error(res?.error || 'Error al aceptar');

          notifications?.success?.('Orden aceptada');
          
          try { window.sendStatusEmail?.(o, 'accepted'); } catch(_){}

          try {
            const { data: updatedOrder } = await supabaseConfig.client
              .from('orders')
              .select('*,service:services(name,description),vehicle:vehicles(name)')
              .eq('id', o.id)
              .single();
            if (updatedOrder) Object.assign(o, updatedOrder);
          } catch (_) {}

          o.status = 'accepted';
          o.tracking_data = [];
          setTimeout(() => { try { openActiveJob(o); } catch(_){} }, 100);
          try { notifications?.info?.('Pulsa "En camino a recoger" para iniciar el trabajo'); } catch(_){}
        } catch (err) {
          notifications?.error?.(err?.message || 'No se pudo aceptar la orden');
          btn.disabled = false;
          btn.textContent = 'Aceptar';
        }
        return;
      }
      if (btn.classList.contains('btn-continue')) { openActiveJob(o); return; }
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
        currentOrder.tracking_data = []; // Iniciar vacío
        
        

        try { window.sendStatusEmail?.(currentOrder, 'accepted'); } catch(_){}
        closeModal();
        try { notifications?.info?.('Orden aceptada. Pulsa "En camino a recoger" para iniciar.'); } catch(_){}
        try {
          openActiveJob(currentOrder);
          updatePrimaryActionButtons(currentOrder);
          updateProgressBar(getUiStatus(currentOrder));
        } catch(_){}
      } catch (e) {
        notifications?.error?.(e?.message || 'No se pudo aceptar la orden');
      } finally {
        modalAcceptBtn.disabled = false;
      }
    });
  }

  async function startLocationTracking(uid) {
    if (!uid || !navigator.geolocation) return;
    
    const options = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 5000
    };

    navigator.geolocation.watchPosition(async (pos) => {
      try {
        await supabaseConfig.client
          .from('collaborator_locations')
          .upsert({
            collaborator_id: uid,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            updated_at: new Date()
          }, { onConflict: 'collaborator_id' });
      } catch (e) {
        console.error('Error updating location:', e);
      }
    }, (err) => {
      console.warn('Geolocation error:', err);
    }, options);
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
        
        // Iniciar tracking de ubicación
        startLocationTracking(uid);
        
        // Suscribirse a notificaciones personales
        if (window.notifications && window.notifications.subscribeToUserNotifications) {
           window.notifications.subscribeToUserNotifications(uid);
        }

        // Inicializar Realtime optimizado
        RealtimeManager.init(uid);
      }
    } catch(e) { console.error("Realtime error", e); }

    // Cargar trabajo activo real desde DB
    try {
      const active = await supabaseConfig.getActiveJobOrder();
      if (active) {
        openActiveJob(active);
      }
    } catch(_){}

    await fetchOrdersForCollaborator();
  };

  init();
  bindOrderEvents();

  // Listeners de Banner "Continuar"
  if (continueBtn) continueBtn.addEventListener('click', async () => {
    try {
      const active = await supabaseConfig.getActiveJobOrder();
      if (!active) {
        notifications?.error?.("No hay orden activa disponible");
        continueBanner.classList.add('hidden');
        return;
      }
      
      if (isFinalOrder(active)) {
        notifications?.info?.("Esta orden ya fue finalizada");
        continueBanner.classList.add('hidden');
        return;
      }
      
      openContinueModal(active);
    } catch(_){}
  });

  if (closeContinueModal) closeContinueModal.addEventListener('click', closeContinue);
  if (cancelContinueBtn) cancelContinueBtn.addEventListener('click', closeContinue);
  
  if (confirmContinueBtn) confirmContinueBtn.addEventListener('click', async () => {
    try {
      const data = await supabaseConfig.getActiveJobOrder();
             
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
    try { localStorage.removeItem('userRole'); } catch(_){}
    window.location.href = 'login-colaborador.html';
  });
  if (collapseBtnNav) collapseBtnNav.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarTexts = document.querySelectorAll('.sidebar-text');
    
    // Check current state
    const isCollapsed = sidebar.classList.contains('w-20');
    
    if (isCollapsed) {
        // Expand
        sidebar.classList.remove('w-20');
        sidebar.classList.add('w-64');
        if (mainContent) {
          mainContent.classList.remove('md:ml-20');
          mainContent.classList.add('md:ml-64');
        }
        sidebarTexts.forEach(el => el.classList.remove('hidden'));
    } else {
        // Collapse
        sidebar.classList.add('w-20');
        sidebar.classList.remove('w-64');
        if (mainContent) {
          mainContent.classList.add('md:ml-20');
          mainContent.classList.remove('md:ml-64');
        }
        sidebarTexts.forEach(el => el.classList.add('hidden'));
    }
    try { localStorage.setItem('sidebarCollapsed', !isCollapsed); } catch(_) {}
  });

  // Apply initial sidebar state
  try {
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('main-content');
        const sidebarTexts = document.querySelectorAll('.sidebar-text');
        
        if (sidebar && window.innerWidth >= 768) {
            sidebar.classList.add('w-20');
            sidebar.classList.remove('w-64');
            if (mainContent) {
                mainContent.classList.add('md:ml-20');
                mainContent.classList.remove('md:ml-64');
            }
            sidebarTexts.forEach(el => el.classList.add('hidden'));
        }
    }
  } catch(_) {}

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
