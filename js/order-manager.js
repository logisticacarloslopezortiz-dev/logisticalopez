// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const UI_TO_DB_STATUS = Object.freeze({
  // UI español → DB enum Supabase
  pendiente:          'pending',
  aceptada:           'accepted',
  en_camino_recoger:  'in_progress',
  cargando:           'in_progress',
  en_camino_entregar: 'in_progress',
  completada:         'completed',
  entregada:          'completed',
  completed:          'completed',
  cancelada:          'cancelled',
  // Flow keys internos → DB enum Supabase
  pending:            'pending',
  accepted:           'accepted',
  in_progress:        'in_progress',
  loading:            'in_progress',
  delivering:         'in_progress',
  cancelled:          'cancelled'
});

const STATUS_LABELS = Object.freeze({
  pending:     'Pendiente',
  accepted:    'Aceptada',
  in_progress: 'En camino a recoger',
  loading:     'Cargando',
  delivering:  'En camino a entregar',
  completed:   'Completada',
  cancelled:   'Cancelada'
});

const PHASE_CONFIG = Object.freeze({
  pending:     { percent: 5,   color: 'bg-gray-400' },
  accepted:    { percent: 20,  color: 'bg-blue-600' },
  in_progress: { percent: 40,  color: 'bg-blue-500' },
  loading:     { percent: 60,  color: 'bg-yellow-500' },
  delivering:  { percent: 80,  color: 'bg-indigo-500' },
  completed:   { percent: 100, color: 'bg-green-500' },
  cancelled:   { percent: 100, color: 'bg-red-500' }
});

const ORDER_FLOW = Object.freeze({
  pending:              ['accepted'],
  accepted:             ['in_progress'],
  in_progress:          ['loading'],
  loading:              ['delivering'],
  delivering:           ['completed'],
  completed:            [],
  cancelled:            []
});

const OrderManager = {
  // ✅ Máquina de estados centralizada
  ORDER_FLOW,
  UI_TO_DB_STATUS,
  STATUS_LABELS,
  PHASE_CONFIG,

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

  // Normalización bidireccional UI ↔ DB para la máquina de estados
  _normalizeToFlowKey(status) {
    const s = String(status || '').toLowerCase().trim();
    const map = {
      // UI español
      pendiente:          'pending',
      aceptada:           'accepted',
      en_camino_recoger:  'in_progress',
      cargando:           'loading',
      en_camino_entregar: 'delivering',
      completada:         'completed',
      entregada:          'completed',
      cancelada:          'cancelled',
      // DB inglés directo
      pending:            'pending',
      accepted:           'accepted',
      in_progress:        'in_progress',
      loading:            'loading',
      delivering:         'delivering',
      completed:          'completed',
      cancelled:          'cancelled'
    };
    return map[s] ?? s;
  },

  canTransition(from, to) {
    const fromKey = this._normalizeToFlowKey(from);
    const toKey   = this._normalizeToFlowKey(to);
    if (toKey === 'cancelled') return true;
    // Permitir mantenerse en la misma fase lógica de in_progress (loading, delivering)
    // ya que en la DB todos mapean a 'in_progress' pero en UI son fases distintas
    const IN_PROGRESS_FAMILY = new Set(['in_progress', 'loading', 'delivering']);
    if (IN_PROGRESS_FAMILY.has(fromKey) && IN_PROGRESS_FAMILY.has(toKey)) return true;
    return ORDER_FLOW[fromKey]?.includes(toKey) ?? false;
  },

  // ✅ Helper para buscar orden por múltiples criterios
  async _findOrderByCandidates(orderId) {
    const normalizedId = this._normalizeOrderId(orderId);
    const isNumeric = Number.isFinite(normalizedId);
    
    let orConditions = [];
    if (isNumeric) {
      orConditions.push(`id.eq.${normalizedId}`);
      orConditions.push(`short_id.eq.${String(normalizedId)}`);
    } else if (typeof orderId === 'string') {
      const maybeNum = Number(orderId);
      if (Number.isFinite(maybeNum)) orConditions.push(`id.eq.${maybeNum}`);
      orConditions.push(`short_id.eq.${orderId}`);
    }

    if (orConditions.length === 0) return null;

    const { data, error } = await supabaseConfig.client
      .from('orders')
      // CORREGIDO: Eliminadas `client_email` y `last_ui_status` que no existen en el esquema.
      .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_id, client_contact_id, onesignal_id, onesignal_player_id, assigned_to')
      .or(orConditions.join(','))
      .limit(1)
      .maybeSingle();

    return error ? null : data;
  },

  // ✅ Notificaciones OneSignal
  async notifyOneSignal({ player_ids, title, message, url, data = {} }) {
    if (!player_ids || player_ids.length === 0) return;
    try {
      await supabaseConfig.client.functions.invoke('send-onesignal-notification', {
        body: { player_ids, title, message, url, data }
      });
    } catch (e) {
      console.warn('[OrderManager] OneSignal skip:', e.message);
    }
  },

  // ✅ Centraliza la ejecución de process-outbox (evita bloqueo por CORS)
  async runProcessOutbox() {
    try {
      // Usar invoke con modo 'no-cors' no es posible con supabase-js, 
      // pero podemos atrapar el error y que no rompa el flujo.
      await supabaseConfig.client.functions.invoke('process-outbox').catch(() => {
        // Ignorar error de CORS, el outbox se procesará por cron o por otros clientes
      });
    } catch (_) {}
  },

  // ✅ ENTERPRISE: Helper centralizado para liberar al colaborador
  async _releaseCollaboratorActiveJob(orderId) {
    try {
      // Intentar primero la función RPC segura si existe
      if (supabaseConfig.completeOrderWork) {
        await supabaseConfig.completeOrderWork(orderId);
      }
      // Fallback: eliminación directa para asegurar limpieza
      await supabaseConfig.client.from('collaborator_active_jobs').delete().eq('order_id', orderId);
    } catch (e) { console.warn('[OrderManager] Warning releasing active job:', e); }
  },

  // ✅ Centraliza la actualización de estado
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    try {
      await supabaseConfig.ensureFreshSession();
      const ns = String(newStatus || '').toLowerCase();
      const normalizedId = this._normalizeOrderId(orderId);

      if (!normalizedId) throw new Error('ID de orden inválido');

      const currentOrder = await this._findOrderByCandidates(orderId);
      if (!currentOrder) throw new Error('No se encontró la orden');

      // Normalizar ns a flow key (acepta español, inglés viejo y nuevo)
      const flowKey  = this._normalizeToFlowKey(ns);
      const dbStatus = UI_TO_DB_STATUS[ns] ?? UI_TO_DB_STATUS[flowKey] ?? flowKey;

      // Validar que el flowKey sea una key conocida del ORDER_FLOW
      if (!Object.prototype.hasOwnProperty.call(ORDER_FLOW, flowKey)) {
        throw new Error(`Estado inválido: ${ns}`);
      }

      const currentPhase = this._getUiPhaseFromOrder(currentOrder);

      // Evitar race condition: dos colaboradores aceptando la misma orden
      // (accepted ya tiene su propia ruta atómica vía acceptOrder + RPC)
      if (flowKey === 'accepted') {
        return this.acceptOrder(orderId, additionalData);
      }

      // Validar que el colaborador sea el dueño de la orden
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (
        currentOrder.assigned_to &&
        currentOrder.assigned_to !== user?.id
      ) {
        throw new Error('No tienes permiso para modificar esta orden');
      }

      // Validar transición
      if (currentPhase === flowKey) {
        console.log('[OrderManager] Ya está en estado:', flowKey);
        return { success: true, data: currentOrder };
      }
      if (!this.canTransition(currentPhase, flowKey)) {
        throw new Error(`Transición no permitida: ${currentPhase} -> ${flowKey}`);
      }

      // Validar evidencia para completar la orden
      if (dbStatus === 'completed' && (!currentOrder.evidence_photos || currentOrder.evidence_photos.length === 0)) {
        throw new Error('Se requiere evidencia fotográfica para completar la orden');
      }

      const trackingEntry = {
        ui_status: flowKey,
        db_status: dbStatus,
        date: new Date().toISOString(),
        description: `Estado actualizado a ${flowKey}`
      };

      const history = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      const tracking_data = [...history.slice(-25), trackingEntry];

      const updatePayload = {
        status: dbStatus,
        updated_at: new Date().toISOString(),
        tracking_data: tracking_data
      };

      if (dbStatus === 'completed') updatePayload.completed_at = updatePayload.updated_at;
      if (dbStatus === 'accepted')  updatePayload.assigned_at  = updatePayload.updated_at;
      // Aceptar tanto collaborator_id como assigned_to para compatibilidad
      const collabId = additionalData.collaborator_id || additionalData.assigned_to || null;
      if (collabId) {
        if (dbStatus === 'completed') updatePayload.completed_by = collabId;
        else updatePayload.assigned_to = collabId;
      }

      const { data: updatedData, error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', currentOrder.id)
        .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_id, client_contact_id, onesignal_id, onesignal_player_id, assigned_to')
        .single();

      if (updateError) throw updateError;

      if (dbStatus === 'completed') {
        await this._releaseCollaboratorActiveJob(currentOrder.id);
      }

      this.runProcessOutbox();
      if (updatedData && dbStatus !== 'pending' && dbStatus !== 'cancelled') {
        this._notifyClientStatusChange(updatedData, flowKey);
      }
      if (dbStatus === 'completed' || dbStatus === 'cancelled') {
        notifyClientForOrder(currentOrder.id, flowKey);
      }

      return { success: true, data: updatedData };
    } catch (error) {
      console.error('[OrderManager] Error:', error.message);
      return { success: false, error: error.message };
    }
  },

  // ✅ Centraliza la cancelación de un trabajo activo
  async cancelActiveJob(orderId) {
    try {
      const normalizedId = this._normalizeOrderId(orderId);
      if (!normalizedId) throw new Error('ID de orden inválido');

      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (!user?.id) throw new Error('Sesión inválida');

      const { data, error } = await supabaseConfig.client
        .from('orders')
        .update({ 
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', normalizedId)
        .select()
        .single();

      if (error) throw error;
      
      // ✅ ENTERPRISE: Limpieza automática al cancelar
      await this._releaseCollaboratorActiveJob(normalizedId);

      this.runProcessOutbox();
      return { success: true, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // ✅ Centraliza la aceptación de una orden (RPC atómica contra race conditions)
  async acceptOrder(orderId, additionalData = {}) {
    try {
      await supabaseConfig.ensureFreshSession();
      const normalizedId = this._normalizeOrderId(orderId);
      if (!normalizedId) throw new Error('ID de orden inválido');

      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      const collabId = additionalData.collaborator_id || additionalData.assigned_to || user?.id;
      if (!collabId) throw new Error('Sesión inválida');

      // Llamada atómica: la DB garantiza que solo 1 colaborador gana la orden
      // Aseguramos tipos: ID como entero y CollabId como string (UUID)
      const { data: rpcResult, error: rpcError } = await supabaseConfig.client
        .rpc('accept_order_atomic', {
          p_order_id: Math.floor(Number(normalizedId)),
          p_collaborator_id: String(collabId)
        });

      if (rpcError) {
        // Error específico de PostgREST si no encuentra la función
        if (rpcError.code === 'PGRST202' || String(rpcError.message).includes('Could not find the function')) {
          console.error('[OrderManager] RPC accept_order_atomic no encontrada. Por favor ejecuta el SQL de schema.sql.');
          throw new Error('Error de configuración en el servidor (RPC faltante). Contacta soporte.');
        }
        throw rpcError;
      }

      if (!rpcResult?.success) throw new Error(rpcResult?.error || 'Error al aceptar la orden');

      // Insertar en active_jobs y registrar tracking
      const currentOrder = await this._findOrderByCandidates(orderId);
      if (currentOrder) {
        const history = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
        const trackingEntry = {
          ui_status: 'accepted',
          db_status: 'accepted',
          date: new Date().toISOString(),
          description: 'Orden aceptada por colaborador'
        };
        await supabaseConfig.client
          .from('orders')
          .update({ tracking_data: [...history.slice(-25), trackingEntry] })
          .eq('id', normalizedId);

        try {
          await supabaseConfig.client
            .from('collaborator_active_jobs')
            .upsert({ collaborator_id: collabId, order_id: normalizedId, started_at: new Date().toISOString() });
        } catch (_) {}
      }

      this.runProcessOutbox();
      const updatedOrder = await this._findOrderByCandidates(orderId);
      if (updatedOrder) this._notifyClientStatusChange(updatedOrder, 'accepted');

      return { success: true, data: updatedOrder };
    } catch (error) {
      console.error('[OrderManager] acceptOrder error:', error.message);
      return { success: false, error: error.message };
    }
  },

  // ✅ NUEVO: Función faltante para actualizar precio y método de pago
  async setOrderAmount(orderId, amount, method) {
    try {
      await supabaseConfig.ensureFreshSession();
      const normalizedId = this._normalizeOrderId(orderId);
      if (!normalizedId) throw new Error('ID de orden inválido');

      let cleanAmount = amount;
      if (typeof amount === 'string') {
        cleanAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
      }

      const { data, error } = await supabaseConfig.client
        .from('orders')
        .update({ monto_cobrado: cleanAmount, metodo_pago: method })
        .eq('id', normalizedId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (e) {
      console.error('[OrderManager] setOrderAmount error:', e);
      throw e;
    }
  },

  // ✅ Helper para obtener configuración visual de fase
  getPhaseConfig(order) {
    const phase = this._getUiPhaseFromOrder(order);
    const config = PHASE_CONFIG[phase] || PHASE_CONFIG.pending;
    return {
      phase,
      label: STATUS_LABELS[phase] || phase,
      ...config
    };
  },

  // ✅ Helper para obtener estado visual real (Versión segura contra regresiones)
  _getUiPhaseFromOrder(order) {
    if (!order) return 'pending';
    const dbStatus = String(order.status || '').toLowerCase();
    if (dbStatus === 'completed') return 'completed';
    if (dbStatus === 'cancelled') return 'cancelled';

    // Prioridad: último tracking_data con ui_status válido
    const tracking = Array.isArray(order.tracking_data) ? order.tracking_data : [];
    for (let i = tracking.length - 1; i >= 0; i--) {
      const raw = tracking[i]?.ui_status;
      if (raw) {
        const normalized = this._normalizeToFlowKey(String(raw).toLowerCase());
        if (normalized && normalized !== 'pending') return normalized;
      }
    }

    // Fallback desde dbStatus — siempre normalizado al ORDER_FLOW
    return this._normalizeToFlowKey(dbStatus) || 'pending';
  },

  // ✅ Sistema de notificaciones integrado (Resuelve error de panel-colaborador.js)
  _toast(message, type = 'info') {
    // Intentar usar el sistema global si existe
    if (typeof window !== 'undefined' && window.notifications && typeof window.notifications.show === 'function') {
      window.notifications.show(message, type);
    } else {
      console.log(`[OrderManager Toast] ${type.toUpperCase()}: ${message}`);
      // Fallback visual mínimo
      if (typeof document !== 'undefined') {
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 p-4 rounded-xl text-white z-[9999] shadow-2xl transition-all duration-300 transform translate-y-0 opacity-100 ${
          type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;
        toast.style.minWidth = '200px';
        toast.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="font-bold">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <span>${message}</span>
          </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(20px)';
          setTimeout(() => toast.remove(), 300);
        }, 3500);
      }
    }
  },

  // Notificaciones al cliente
  async _notifyClientStatusChange(order, uiStatus) {
    try {
      const clientOnesignalId = order.onesignal_id || order.onesignal_player_id;
      if (!clientOnesignalId) return;

      const messages = {
        aceptada: '✅ Tu solicitud ha sido aceptada.',
        en_camino_recoger: '📍 El transportista va en camino.',
        cargando: '📦 Tu carga está siendo procesada.',
        en_camino_entregar: '🚚 ¡Tu pedido ya va en ruta!',
        entregada: '✅ ¡Servicio completado!'
      };

      this.notifyOneSignal({
        player_ids: [clientOnesignalId],
        title: 'Actualización de Pedido',
        message: messages[uiStatus] || `Nuevo estado: ${uiStatus}`,
        url: `${window.location.origin}/seguimiento.html?codigo=${order.short_id || order.id}`
      });
    } catch (_) {}
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
