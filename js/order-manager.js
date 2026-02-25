// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const UI_TO_DB_STATUS = {
  pendiente: 'pending',
  aceptada: 'accepted',
  en_camino_recoger: 'in_progress',
  cargando: 'in_progress',
  en_camino_entregar: 'in_progress',
  entregada: 'completed',
  completada: 'completed',
  cancelada: 'cancelled'
};

const STATE_FLOW = {
  pendiente: ['aceptada'],
  aceptada: ['en_camino_recoger'],
  en_camino_recoger: ['cargando'],
  cargando: ['en_camino_entregar'],
  en_camino_entregar: ['entregada']
};

// ✅ Helper para crear tracking entries sin duplicación
const _makeTrackingEntry = (uiStatus, dbStatus) => ({
  ui_status: uiStatus,
  db_status: dbStatus,
  date: new Date().toISOString(),
  description: {
    'en_camino_recoger': 'Orden aceptada, en camino a recoger',
    'cargando': 'Carga en proceso',
    'en_camino_entregar': 'En ruta hacia entrega',
    'entregada': 'Pedido entregado'
  }[uiStatus] || 'Actualización de estado'
});

const OrderManager = {
  // Helper para normalizar IDs de orden (una sola llamada por función)
  _normalizeOrderId(orderId) {
    try {
      if (typeof orderId === 'number' && Number.isFinite(orderId)) return orderId;
      if (typeof orderId === 'string') {
        const n = Number(orderId);
        return Number.isFinite(n) ? n : null;
      }
      if (orderId && typeof orderId === 'object') {
        if (Number.isFinite(orderId.supabase_seq_id)) return orderId.supabase_seq_id;
        if (Number.isFinite(orderId.id)) return orderId.id;
        return null;
      }
      return null;
    } catch {
      return null;
    }
  },

  // ✅ Helper para validar transición de estado
  _isTransitionAllowed(currentPhase, nextPhase, isCancel = false, isDelivery = false) {
    if (isCancel) return true; // Cancelación siempre permitida
    if (isDelivery) return true; // Entrega tiene validaciones adicionales por separado
    const allowed = STATE_FLOW[currentPhase] || [];
    return allowed.includes(nextPhase);
  },

  // ✅ Helper para buscar orden por múltiples criterios (reemplaza búsquedas secuenciales)
  async _findOrderByCandidates(orderId) {
    const normalizedId = this._normalizeOrderId(orderId);
    const isNumeric = Number.isFinite(normalizedId);
    
    // Construir condiciones OR para una sola query
    let orConditions = [];
    if (isNumeric) {
      orConditions.push(`id.eq.${normalizedId}`);
      orConditions.push(`short_id.eq.${String(normalizedId)}`);
    } else if (typeof orderId === 'string') {
      const maybeNum = Number(orderId);
      if (Number.isFinite(maybeNum)) {
        orConditions.push(`id.eq.${maybeNum}`);
      }
      orConditions.push(`short_id.eq.${orderId}`);
    } else if (orderId && typeof orderId === 'object') {
      if (Number.isFinite(orderId.id)) orConditions.push(`id.eq.${orderId.id}`);
      if (typeof orderId.short_id === 'string') orConditions.push(`short_id.eq.${orderId.short_id}`);
    }

    if (orConditions.length === 0) return null;

    // ✅ Una sola query con OR en lugar de múltiples SELECT secuenciales
    const { data, error } = await supabaseConfig.client
      .from('orders')
      .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_email')
      .or(orConditions.join(','))
      .maybeSingle();

    if (error) return null;
    return data || null;
  },

  // ✅ Helper para enviar notificaciones OneSignal
  async notifyOneSignal({ player_ids, title, message, url, data = {} }) {
    if (!player_ids || player_ids.length === 0) return;
    try {
      console.log(`[OneSignal] Enviando notificación a ${player_ids.length} destinatarios...`);
      const { data: res, error } = await supabaseConfig.client.functions.invoke('send-onesignal-notification', {
        body: { player_ids, title, message, url, data }
      });
      if (error) console.error('[OneSignal] Error:', error);
      return res;
    } catch (e) {
      console.error('[OneSignal] Fallo crítico:', e);
    }
  },

  // Toast simple para notificaciones visuales
  _toast(message, type = 'info') {
    try {
      const colors = {
        info: { bg: '#2563eb', text: '#ffffff' },
        success: { bg: '#16a34a', text: '#ffffff' },
        warning: { bg: '#f59e0b', text: '#111827' },
        error: { bg: '#dc2626', text: '#ffffff' }
      };
      const { bg, text } = colors[type] || colors.info;
      const containerId = 'tlc-toast-container';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.style.cssText = `background:${bg};color:${text};padding:10px 14px;border-radius:8px;box-shadow:0 8px 16px rgba(0,0,0,0.15);font-size:14px;font-weight:600;max-width:340px;word-break:break-word;transition:opacity 300ms ease;`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    } catch (_) {
      try { alert(message); } catch (_) {}
    }
  },
  // Acepta una orden desde el panel del colaborador
  async acceptOrder(orderId, additionalData = {}) {
    const normalizedId = this._normalizeOrderId(orderId);

    if (!Number.isFinite(normalizedId)) {
      this._toast('ID inválido. Aplicando fallback…', 'warning');
      return await this.actualizarEstadoPedido(orderId, 'aceptada', additionalData);
    }

    // Prevalidar que el colaborador no tenga otra orden activa
    try {
      const collabId = additionalData?.collaborator_id || null;
      if (collabId) {
        const { data: conflicts } = await supabaseConfig.client
          .from('orders')
          .select('id,status')
          .eq('assigned_to', collabId)
          .in('status', ['accepted', 'in_progress'])
          .limit(1);
        if (Array.isArray(conflicts) && conflicts.length > 0) {
          this._toast('Ya tienes una orden activa', 'error');
          return { success: false, data: null, error: 'Ya tienes una orden activa' };
        }
      }
    } catch (_) {}

    const hasPrice = typeof additionalData?.estimated_price === 'number' && !isNaN(additionalData.estimated_price);
    const rpcPayload = { p_order_id: normalizedId, p_price: hasPrice ? additionalData.estimated_price : null };

    try {
      const { data, error } = await supabaseConfig.client.rpc('accept_order_with_price', rpcPayload);

      if (error) {
        const msg = String(error?.message || '');
        if (/ya tienes una orden activa/i.test(msg) || String(error?.code || '') === 'P0001') {
          this._toast('Ya tienes una orden activa', 'error');
          return { success: false, data: null, error: msg };
        }
        this._toast(`Error: ${error.message || 'falló'}`, 'warning');
        return { success: false, data: null, error: error.message || 'RPC falló' };
      }

      this._toast('Orden aceptada correctamente', 'success');
      return { success: true, data, error: null };
    } catch (error) {
      this._toast(`Error: ${error.message || 'falló'}`, 'warning');
      return { success: false, data: null, error: error.message || 'Excepción' };
    }
  },

  // Guarda el monto cobrado y método de pago
  async setOrderAmount(orderId, amount, method) {
    try {
      if (!supabaseConfig?.client) throw new Error('Supabase client no configurado');
      await supabaseConfig.ensureFreshSession?.();
      
      const { data: ord } = await supabaseConfig.client
        .from('orders')
        .select('status')
        .eq('id', Number(orderId))
        .maybeSingle();
      
      if (['Cancelada','Completada'].includes(String(ord?.status || '').trim())) {
        throw new Error('No se puede modificar el monto en este estado');
      }

      const rpcPayload = {
        order_id: Number(orderId),
        amount: Number(amount),
        method: method
      };

      const { data, error } = await supabaseConfig.client.rpc('set_order_amount_admin', rpcPayload);
      if (!error && data) return data;

      // ✅ Fallback directo sin logs
      const { data: upd, error: updErr } = await supabaseConfig.client
        .from('orders')
        .update({ monto_cobrado: Number(amount), metodo_pago: method })
        .eq('id', Number(orderId))
        .select('*')
        .maybeSingle();
      
      if (updErr) throw updErr;
      return upd;
    } catch (err) {
      this._toast('No se pudo guardar el monto.');
      throw err;
    }
  },

  // Cancela un trabajo activo
  async cancelActiveJob(orderId) {
    return await this.actualizarEstadoPedido(orderId, 'cancelada');
  },

  // Centraliza la lógica para actualizar el estado de un pedido
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    await supabaseConfig.ensureFreshSession();

    // ✅ Normalizar estado UNA SOLA VEZ
    const ns = String(newStatus || '').toLowerCase();
    const normalizedId = this._normalizeOrderId(orderId);
    const isNumeric = Number.isFinite(normalizedId);

    if (!isNumeric && typeof orderId !== 'string') {
      const errorMsg = `ID de orden inválido: ${JSON.stringify(orderId)}`;
      return { success: false, error: new Error(errorMsg) };
    }

    // Sanitizar additionalData
    const allowedFields = ['status', 'assigned_to', 'assigned_at', 'completed_at', 'completed_by', 'tracking_data'];
    const sanitizedData = {};
    Object.keys(additionalData).forEach(key => {
      if (allowedFields.includes(key)) sanitizedData[key] = additionalData[key];
    });

    if (additionalData.collaborator_id) {
      if (ns === 'entregada') {
        sanitizedData.completed_by = additionalData.collaborator_id;
      } else {
        sanitizedData.assigned_to = additionalData.collaborator_id;
      }
    }

    // Intentar RPC primero
    try {
      const dbStatus = UI_TO_DB_STATUS[ns] || newStatus;
      const trackingEntry = _makeTrackingEntry(ns, dbStatus);
      
      // ✅ Obtener ID de colaborador válido (UUID)
      let collabId = null;
      if (additionalData?.collaborator_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(additionalData.collaborator_id)) {
        collabId = additionalData.collaborator_id;
      } else if (additionalData?.assigned_to && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(additionalData.assigned_to)) {
        collabId = additionalData.assigned_to;
      }

      const rpcPayload = {
        p_order_id: normalizedId,
        p_new_status: ns,
        p_collaborator_id: collabId,
        p_tracking_entry: trackingEntry
      };

      const { data: rpcData, error: rpcError } = await supabaseConfig.client.rpc('update_order_status', rpcPayload);
      if (!rpcError) {
        try { await supabaseConfig.runProcessOutbox?.(); } catch (err) {
          console.warn('[OrderManager] Error invocando process-outbox:', err);
        }
        try { await notifyClientForOrder(normalizedId, ns); } catch (_) {}
        return { success: true, data: rpcData, error: null };
      }

      // Intentar RPC alternativo para aceptación
      if (ns === 'aceptada' || ns === 'accepted') {
        try {
          const { data: accData, error: accErr } = await supabaseConfig.client.rpc('accept_order_with_price', {
            p_order_id: normalizedId,
            p_price: null
          });
          if (!accErr) {
            try { await supabaseConfig.runProcessOutbox?.(); } catch (_) {}
            try { await notifyClientForOrder(normalizedId, ns); } catch (_) {}
            return { success: true, data: accData, error: null };
          }
        } catch (_) {}
      }
      // Continuar con flujo directo
    } catch (rpcEx) {
      // Continuar con flujo directo
    }

    // ✅ FLUJO DIRECTO UNIFICADO (SELECT + UPDATE)
    try {
      const currentOrder = await this._findOrderByCandidates(orderId);
      if (!currentOrder) {
        throw new Error(`No se encontró la orden con ID "${orderId}". Verifica permisos.`);
      }

      // ✅ Validar transición usando helper
      const currentDbStatus = String(currentOrder.status || '').toLowerCase();
      let currentPhase = currentDbStatus;

      // Mapear status DB a fase UI
      if (currentDbStatus === 'pending') currentPhase = 'pendiente';
      else if (currentDbStatus === 'accepted') currentPhase = 'aceptada';
      else if (currentDbStatus === 'completed') currentPhase = 'entregada';
      else if (currentDbStatus === 'cancelled') currentPhase = 'cancelada';
      else if (currentDbStatus === 'in_progress' || currentDbStatus === 'en curso') {
        if (Array.isArray(currentOrder.tracking_data) && currentOrder.tracking_data.length > 0) {
          const lastTrack = currentOrder.tracking_data[currentOrder.tracking_data.length - 1];
          currentPhase = String(lastTrack?.ui_status || 'cargando').toLowerCase();
        } else {
          currentPhase = 'en_camino_recoger';
        }
      }

      // Validar transición
      const isCancel = ns === 'cancelada';
      const isDelivery = ns === 'entregada';
      if (!this._isTransitionAllowed(currentPhase, ns, isCancel, isDelivery)) {
        throw new Error(`Transición no permitida desde "${currentPhase}" a "${ns}".`);
      }

      // Validaciones específicas para entrega
      if (isDelivery) {
        const hasRoute = currentPhase === 'en_camino_entregar' || 
          (Array.isArray(currentOrder.tracking_data) && 
           currentOrder.tracking_data.some(e => String(e?.ui_status || '').toLowerCase() === 'en_camino_entregar'));
        if (!hasRoute) {
          throw new Error('No puedes completar sin pasar por "En camino a entregar"');
        }

        const evidenceArr = Array.isArray(currentOrder.evidence_photos) ? currentOrder.evidence_photos : [];
        if (evidenceArr.length === 0) {
          throw new Error('Debes subir al menos una evidencia para completar');
        }
      }

      // Construir payload de actualización
      const updatePayload = { ...sanitizedData };
      const dbStatus = UI_TO_DB_STATUS[ns] || newStatus;
      updatePayload.status = dbStatus;

      if (dbStatus === 'completed') updatePayload.completed_at = new Date().toISOString();
      if (dbStatus === 'accepted') updatePayload.assigned_at = new Date().toISOString();
      if (ns === 'pendiente') {
        updatePayload.assigned_to = null;
        updatePayload.assigned_at = null;
      }

      // Agregar tracking entry
      const trackingEntry = _makeTrackingEntry(ns, dbStatus);
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, trackingEntry];

      // Actualizar (usar id como filtro siempre) + restricciones para aceptación
      let q = supabaseConfig.client.from('orders')
        .update(updatePayload)
        .eq('id', currentOrder.id);

      if (ns === 'aceptada' || ns === 'accepted') {
        q = q.eq('status', 'pending').is('assigned_to', null);
      }

      const { data: updatedData, error: updateError } = await q
        .select('id, short_id, status, name, email, client_email, client_id, client_contact_id')
        .single();

      if (updateError) {
        throw new Error(`Error al actualizar: ${updateError.message}`);
      }

      // ✅ NOTIFICACIÓN AL CLIENTE POR CAMBIO DE ESTADO (OneSignal)
      if (updatedData && ns !== 'pendiente' && ns !== 'cancelada') {
        this._notifyClientStatusChange(updatedData, ns);
      }

      try { await supabaseConfig.runProcessOutbox?.(); } catch (err) {
        console.warn('[OrderManager] Error invocando process-outbox:', err);
      }
      try { await notifyClientForOrder(currentOrder.id, ns); } catch (_) {}
      return { success: true, data: updatedData, error: null };

    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // ✅ Helper privado para notificar al cliente sobre cambios de estado
  async _notifyClientStatusChange(order, uiStatus) {
    try {
      let clientOnesignalId = null;
      
      // 1. Buscar en profiles si hay client_id
      if (order.client_id) {
        const { data: p } = await supabaseConfig.client.from('profiles').select('onesignal_id').eq('id', order.client_id).single();
        clientOnesignalId = p?.onesignal_id;
      } 
      
      // 2. Si no, buscar en clients si hay client_contact_id
      if (!clientOnesignalId && order.client_contact_id) {
        const { data: c } = await supabaseConfig.client.from('clients').select('onesignal_id').eq('id', order.client_contact_id).single();
        clientOnesignalId = c?.onesignal_id;
      }

      if (clientOnesignalId) {
        const statusMap = {
          'en_camino_recoger': '📍 El transportista va en camino a recoger tu carga.',
          'cargando': '📦 Tu carga está siendo procesada/cargada.',
          'en_camino_entregar': '🚚 ¡Tu pedido ya va en ruta de entrega!',
          'entregada': '✅ ¡Servicio completado con éxito!',
          'completada': '✅ ¡Servicio completado con éxito!'
        };

        const message = statusMap[uiStatus] || `El estado de tu orden #${order.short_id || order.id} ha cambiado a: ${uiStatus.replace(/_/g, ' ')}`;
        
        this.notifyOneSignal({
          player_ids: [clientOnesignalId],
          title: 'Actualización de tu pedido',
          message: message,
          url: `${window.location.origin}/seguimiento.html?codigo=${order.short_id || order.id}`
        });
      }
    } catch (e) {
      console.warn('[OrderManager] Error notificando al cliente:', e);
    }
  }
};

async function notifyClientForOrder(orderId, newStatus) {
  try { await supabaseConfig.ensureFreshSession?.(); } catch (_) {}
  const normalizedId = OrderManager._normalizeOrderId(orderId);
  if (!Number.isFinite(normalizedId)) return;
  const key = String(newStatus || '').toLowerCase();
  const dbStatus = UI_TO_DB_STATUS[key] || newStatus;
  try {
    await supabaseConfig.client.functions.invoke('send-order-email', {
      body: { orderId: normalizedId, status: dbStatus }
    });
  } catch (_) {}
}

// Exportar a entorno global
try { if (typeof window !== 'undefined') window.OrderManager = OrderManager; } catch (_) {}
try { if (typeof globalThis !== 'undefined') globalThis.OrderManager = OrderManager; } catch (_) {}
try { if (typeof module === 'object' && module?.exports) module.exports = OrderManager; } catch (_) {}
