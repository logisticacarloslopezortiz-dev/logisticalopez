// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const UI_TO_DB_STATUS = Object.freeze({
  pendiente: 'pending',
  aceptada: 'accepted',
  en_camino_recoger: 'in_progress',
  cargando: 'in_progress',
  en_camino_entregar: 'in_progress',
  completed: 'completed', // ✅ Asegurar que el key estándar exista
  entregada: 'completed', // Alias para compatibilidad
  completada: 'completed',
  cancelada: 'cancelled'
});

const STATUS_LABELS = Object.freeze({
  pending: 'Pendiente',
  accepted: 'Aceptada',
  en_camino_recoger: 'En camino a recoger',
  cargando: 'Cargando',
  en_camino_entregar: 'En camino a entregar',
  completed: 'Completada',
  cancelled: 'Cancelada'
});

const PHASE_CONFIG = Object.freeze({
  pending: { percent: 5, color: 'bg-gray-400' },
  accepted: { percent: 20, color: 'bg-blue-600' },
  en_camino_recoger: { percent: 40, color: 'bg-blue-500' },
  cargando: { percent: 60, color: 'bg-yellow-500' },
  en_camino_entregar: { percent: 80, color: 'bg-indigo-500' },
  completed: { percent: 100, color: 'bg-green-500' },
  cancelled: { percent: 100, color: 'bg-red-500' }
});

const ORDER_FLOW = Object.freeze({
  pending: ['accepted'],
  accepted: ['en_camino_recoger'],
  en_camino_recoger: ['cargando'],
  cargando: ['en_camino_entregar'],
  en_camino_entregar: ['completed'],
  completed: [],
  cancelled: []
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

  // ✅ Validación profesional de transición (Usa UI states para evitar mezcla con DB)
  canTransition(from, to) {
    let fromStatus = String(from || 'pending').toLowerCase();
    let toStatus = String(to || '').toLowerCase();
    
    // Normalizar alias para validación contra ORDER_FLOW
    if (fromStatus === 'entregada' || fromStatus === 'completada') fromStatus = 'completed';
    if (toStatus === 'entregada' || toStatus === 'completada') toStatus = 'completed';
    if (toStatus === 'cancelada') toStatus = 'cancelled';
    
    if (toStatus === 'cancelled') return true;

    return ORDER_FLOW[fromStatus]?.includes(toStatus);
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

  // Toast simple
  _toast(message, type = 'info') {
    const colors = { success: '#16a34a', error: '#dc2626', warning: '#f59e0b', info: '#2563eb' };
    const bg = colors[type] || colors.info;
    const containerId = 'tlc-toast-container';
    let container = document.getElementById(containerId) || (() => {
      const c = document.createElement('div');
      c.id = containerId;
      c.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(c);
      return c;
    })();
    const t = document.createElement('div');
    t.style.cssText = `background:${bg};color:white;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:14px;font-weight:600;transition:all 0.3s ease;opacity:0;`;
    t.textContent = message;
    container.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 3500);
  },

  // ✅ Centraliza la actualización de estado
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    try {
      await supabaseConfig.ensureFreshSession();
      const ns = String(newStatus || '').toLowerCase();
      const dbStatus = UI_TO_DB_STATUS[ns] || ns;
      const normalizedId = this._normalizeOrderId(orderId);

      if (!normalizedId) throw new Error('ID de orden inválido');

      const currentOrder = await this._findOrderByCandidates(orderId);
      if (!currentOrder) throw new Error('No se encontró la orden');

      // Mejora 1: Validación contra la máquina de estados para evitar estados inválidos.
      const validUiStates = Object.keys(UI_TO_DB_STATUS);
      if (!validUiStates.includes(ns)) {
        throw new Error(`Estado inválido: ${ns}`);
      }

      const currentPhase = this._getUiPhaseFromOrder(currentOrder);
      
      // ✅ 2. Validar que el colaborador sea el dueño de la orden
      const { data: { user } } = await supabaseConfig.client.auth.getUser();
      if (
        currentOrder.assigned_to &&
        currentOrder.assigned_to !== user?.id &&
        ns !== 'accepted' // 'accepted' es una acción de asignación, no de modificación de progreso
      ) {
        throw new Error('No tienes permiso para modificar esta orden');
      }
      
      // Mejora 3: Evitar que dos usuarios acepten la misma orden (race condition).
      if (ns === 'accepted' && currentOrder.assigned_to) {
        throw new Error('Esta orden ya fue tomada por otro colaborador');
      }

      // ✅ 1. FIX: Validar transición usando el estado UI (ns), no el de DB (dbStatus)
      if (!this.canTransition(currentPhase, ns)) {
        throw new Error(`Transición no permitida: ${currentPhase} -> ${ns}`);
      }

      // Validar evidencia para completar la orden
      if (dbStatus === 'completed' && (!currentOrder.evidence_photos || currentOrder.evidence_photos.length === 0)) {
        throw new Error('Se requiere evidencia fotográfica para completar la orden');
      }

      const trackingEntry = {
        ui_status: ns,
        db_status: dbStatus,
        date: new Date().toISOString(),
        description: `Estado actualizado a ${ns}`
      };

      // ✅ 3. Aumentar el historial guardado para evitar perder datos en órdenes largas
      const history = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      const tracking_data = [...history.slice(-25), trackingEntry];

      const updatePayload = {
        status: dbStatus,
        updated_at: new Date().toISOString(),
        tracking_data: tracking_data
      };

      if (dbStatus === 'completed') updatePayload.completed_at = updatePayload.updated_at;
      if (dbStatus === 'accepted') updatePayload.assigned_at = updatePayload.updated_at;
      if (additionalData.collaborator_id) {
        if (dbStatus === 'completed') updatePayload.completed_by = additionalData.collaborator_id;
        else updatePayload.assigned_to = additionalData.collaborator_id;
      }

      const { data: updatedData, error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', currentOrder.id)
        // CORREGIDO: Eliminada `client_email` que no existe.
        .select('tracking_data, id, short_id, status, evidence_photos, name, email, client_id, client_contact_id, onesignal_id, onesignal_player_id, assigned_to')
        .single();

      if (updateError) throw updateError;

      // --- Acciones post-update (no bloqueantes) ---
      this.runProcessOutbox();
      // Notificación PUSH para todos los estados de progreso (incluido 'completado')
      if (updatedData && dbStatus !== 'pending' && dbStatus !== 'cancelled') {
        this._notifyClientStatusChange(updatedData, ns);
      }
      // ✅ 4. FIX: Enviar email solo en estados finales para no saturar al cliente
      if (dbStatus === 'completed' || dbStatus === 'cancelled') {
        notifyClientForOrder(currentOrder.id, ns);
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
      
      this.runProcessOutbox();
      return { success: true, data };
    } catch (e) {
      return { success: false, error: e.message };
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

    // Prioridad 1: tracking_data (historial)
    const tracking = Array.isArray(order.tracking_data) ? order.tracking_data : [];
    if (tracking.length > 0) {
      const last = tracking[tracking.length - 1];
      if (last?.ui_status) return String(last.ui_status).toLowerCase();
    }

    // Fallback: Inferir de dbStatus
    if (dbStatus === 'accepted') return 'accepted';    
    // Si está en progreso, fallback a 'en_camino_recoger'
    if (dbStatus === 'in_progress') return 'en_camino_recoger';

    return 'pending';
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
