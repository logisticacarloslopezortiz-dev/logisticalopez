// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const UI_TO_DB_STATUS = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  en_camino_recoger: 'En curso',
  cargando: 'En curso',
  en_camino_entregar: 'En curso',
  entregada: 'Completada',
  cancelada: 'Cancelada'
};

const STATE_FLOW = {
  pendiente: ['aceptada'],
  aceptada: ['en_camino_recoger'],
  en_camino_recoger: ['cargando'],
  cargando: ['en_camino_entregar'],
  en_camino_entregar: ['entregada']
};

const OrderManager = {
  // Función helper para normalizar IDs de orden
  _normalizeOrderId(orderId) {
    try {
      // Si ya es un número finito, devolverlo
      if (typeof orderId === 'number' && Number.isFinite(orderId)) return orderId;
      
      // Si es string numérico, convertir
      if (typeof orderId === 'string') {
        const n = Number(orderId);
        return Number.isFinite(n) ? n : null;
      }
      
      // Si es objeto, buscar supabase_seq_id o id numérico
      if (orderId && typeof orderId === 'object') {
        // Priorizar supabase_seq_id si existe
        if (Number.isFinite(orderId.supabase_seq_id)) return orderId.supabase_seq_id;
        // Fallback a id si es numérico (no UUID)
        if (Number.isFinite(orderId.id)) return orderId.id;
        return null;
      }
      
      return null;
    } catch {
      return null;
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
        container.style.position = 'fixed';
        container.style.top = '16px';
        container.style.right = '16px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.style.background = bg;
      toast.style.color = text;
      toast.style.padding = '10px 14px';
      toast.style.borderRadius = '8px';
      toast.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
      toast.style.fontSize = '14px';
      toast.style.fontWeight = '600';
      toast.style.maxWidth = '340px';
      toast.style.wordBreak = 'break-word';
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms ease';
        setTimeout(() => toast.remove(), 320);
      }, 3000);
    } catch (_) {
      // fallback a alert si el DOM no está listo
      try { alert(message); } catch (_) {}
    }
  },
  /**
   * Acepta una orden desde el panel del colaborador usando RPC
   */
  async acceptOrder(orderId, additionalData = {}) {
    console.log('[OrderManager] Aceptando orden', orderId);

    const normalizedId = this._normalizeOrderId(orderId);
    console.log('[OrderManager] ID normalizado para RPC:', normalizedId);

    if (!Number.isFinite(normalizedId)) {
      console.warn('[OrderManager] ID inválido para RPC accept_order; aplicando fallback...');
      this._toast('ID inválido para RPC. Aplicando fallback…', 'warning');
      return await this.actualizarEstadoPedido(orderId, 'aceptada', additionalData);
    }

    const rpcPayload = { order_id: normalizedId };
    console.log('[OrderManager] RPC accept_order -> payload', rpcPayload);

    try {
      const { data, error } = await supabaseConfig.client.rpc('accept_order', rpcPayload);

      if (error) {
        console.error('[OrderManager] RPC error accept_order', {
          message: error.message, 
          details: error.details, 
          hint: error.hint, 
          code: error.code
        });
        this._toast(`RPC error: ${error.message || 'falló'}. Aplicando fallback…`, 'warning');
        return await this.actualizarEstadoPedido(orderId, 'aceptada', additionalData);
      }

      console.log('[OrderManager] RPC accept_order OK', data);
      this._toast('Orden aceptada por RPC correctamente', 'success');
      return { success: true, data, error: null };
    } catch (error) {
      console.error('[OrderManager] Exception en RPC accept_order:', error);
      this._toast(`Error inesperado: ${error.message || 'falló'}. Aplicando fallback…`, 'warning');
      return await this.actualizarEstadoPedido(orderId, 'aceptada', additionalData);
    }
  },

  /**
   * Guarda el monto cobrado y método de pago usando RPC segura.
   * Devuelve el registro de la orden actualizado o lanza error.
   */
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
        method: method,
        collaborator_id: null // Se añade explícitamente para resolver ambigüedad en la función RPC (int vs bigint)
      };
      console.debug('[OrderManager.setOrderAmount] RPC set_order_amount_admin payload:', rpcPayload);
      const { data, error } = await supabaseConfig.client.rpc('set_order_amount_admin', rpcPayload);
      if (!error && data) return data;
      console.warn('[OrderManager.setOrderAmount] RPC fallo, aplicando fallback UPDATE:', error?.message || error);
      const { data: upd, error: updErr } = await supabaseConfig.client
        .from('orders')
        .update({ monto_cobrado: Number(amount), metodo_pago: method })
        .eq('id', Number(orderId))
        .select('*')
        .maybeSingle();
      if (updErr) throw updErr;
      return upd;
    } catch (err) {
      console.error('[OrderManager.setOrderAmount] Error:', err);
      this._toast('No se pudo guardar el monto.');
      throw err;
    }
  },

   /**
    * Cancela un trabajo activo marcándolo como Cancelada
    */
   async cancelActiveJob(orderId) {
     console.log(`[OrderManager] Cancelando trabajo activo #${orderId}`);
     
     return await this.actualizarEstadoPedido(orderId, 'Cancelada');
   },

   /**
    * Centraliza la lógica para actualizar el estado de un pedido en Supabase.
    */
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    console.log(`[OrderManager] Iniciando actualización para orden #${orderId} a estado "${newStatus}"`);

    // ✅ CORRECCIÓN: Asegurar que la sesión esté fresca ANTES de cualquier operación.
    // Esto previene los errores 401 por token expirado.
    await supabaseConfig.ensureFreshSession();

    const normalizedId = this._normalizeOrderId(orderId);
    const isNumeric = Number.isFinite(normalizedId);
    const candidates = [];

    // Construir candidatos de filtro por orden de preferencia
    if (isNumeric) {
      // Primero el ID primario
      candidates.push({ col: 'id', val: normalizedId });
      // Luego secuencia de supabase si existe
      candidates.push({ col: 'supabase_seq_id', val: normalizedId });
      // Por último short_id como texto
      candidates.push({ col: 'short_id', val: String(normalizedId) });
    } else if (typeof orderId === 'string') {
      const maybeNum = Number(orderId);
      if (Number.isFinite(maybeNum)) {
        candidates.push({ col: 'id', val: maybeNum });
        candidates.push({ col: 'supabase_seq_id', val: maybeNum });
      }
      // Considerar short_id tal cual (texto)
      candidates.push({ col: 'short_id', val: orderId });
    } else if (orderId && typeof orderId === 'object') {
      if (Number.isFinite(orderId.id)) candidates.push({ col: 'id', val: orderId.id });
      if (Number.isFinite(orderId.supabase_seq_id)) candidates.push({ col: 'supabase_seq_id', val: orderId.supabase_seq_id });
      if (typeof orderId.short_id === 'string') candidates.push({ col: 'short_id', val: orderId.short_id });
    }

    console.log('[OrderManager] Candidatos de filtro:', candidates);

    // Sanitizar additionalData - solo incluir campos válidos de la tabla orders
    const allowedFields = [
      'status', 'assigned_to', 'assigned_at', 'completed_at',
      'completed_by', 'tracking_data'
    ];
    const sanitizedData = {};
    Object.keys(additionalData).forEach(key => {
      if (allowedFields.includes(key)) {
        sanitizedData[key] = additionalData[key];
      }
    });

    // Mapear collaborator_id a campos correctos según el estado
    if (additionalData.collaborator_id) {
      if (String(newStatus || '').toLowerCase() === 'entregada') {
        sanitizedData.completed_by = additionalData.collaborator_id;
      } else {
        sanitizedData.assigned_to = additionalData.collaborator_id;
      }
    }

    const updatePayload = { ...sanitizedData };

    // Lógica de negocio centralizada:
    // Mapear estados de acciones del colaborador
    const ns = String(newStatus || '').toLowerCase();
    if (UI_TO_DB_STATUS[ns]) {
      const db = UI_TO_DB_STATUS[ns];
      updatePayload.status = db;
      if (db === 'Completada') updatePayload.completed_at = new Date().toISOString();
      if (db === 'Aceptada') updatePayload.assigned_at = new Date().toISOString();
    } else if (['completada'].includes(ns)) {
      updatePayload.status = 'Completada';
      updatePayload.completed_at = new Date().toISOString();
    } else if (['aceptada'].includes(ns)) {
      updatePayload.status = 'Aceptada';
      updatePayload.assigned_at = new Date().toISOString();
    } else if (['en curso'].includes(ns)) {
      updatePayload.status = 'En curso';
    } else if (['cancelada','cancelado'].includes(ns)) {
      updatePayload.status = 'Cancelada';
    } else if (['pendiente'].includes(ns)) {
      updatePayload.status = 'Pendiente';
    }
    updatePayload.last_collab_status = ns;

    // Intentar primero vía RPC para evitar problemas de RLS en SELECT/UPDATE
    try {
      const normalizedId = this._normalizeOrderId(orderId);
      const dbStatus = UI_TO_DB_STATUS[ns] || newStatus;
      const rpcTrackingEntry = {
        ui_status: ns,
        db_status: dbStatus,
        date: new Date().toISOString(),
        description: ns === 'en_camino_recoger'
          ? 'Orden aceptada, en camino a recoger'
          : ns === 'cargando'
            ? 'Carga en proceso'
            : ns === 'en_camino_entregar'
              ? 'En ruta hacia entrega'
              : ns === 'entregada'
                ? 'Entrega completada'
                : 'Actualización de estado'
      };

      const rpcPayload = {
        order_id: normalizedId,
        new_status: newStatus,
        collaborator_id: additionalData?.collaborator_id || null,
        tracking_entry: rpcTrackingEntry,
        extra: updatePayload
      };

      console.log('[OrderManager] Intentando RPC update_order_status ->', rpcPayload);
      const { data: rpcData, error: rpcError } = await supabaseConfig.client.rpc('update_order_status', rpcPayload);

      if (!rpcError) {
        console.log('[OrderManager] RPC update_order_status OK', rpcData);
        try { await supabaseConfig.runProcessOutbox?.(); } catch (_) {}
        return { success: true, data: rpcData, error: null };
      }

      console.warn('[OrderManager] RPC update_order_status falló, aplicando flujo directo:', {
        message: rpcError?.message, details: rpcError?.details, hint: rpcError?.hint, code: rpcError?.code
      });
      // Si falla RPC, continuar con el flujo directo (SELECT + UPDATE)
    } catch (rpcEx) {
      console.warn('[OrderManager] Excepción en RPC update_order_status, aplicando flujo directo:', rpcEx?.message);
      // Continuar con el flujo directo
    }

    try {
      // Obtener datos actuales probando secuencialmente los candidatos
      let usedFilter = null;
      let currentOrder = null;

      for (const cand of candidates) {
        console.log('[OrderManager] Fetch intento con:', cand);
        const { data, error } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, last_collab_status')
          .eq(cand.col, cand.val)
          .maybeSingle();

        if (error) {
          console.warn('[OrderManager] No encontrado con filtro:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            filter: cand
          });
          continue;
        }

        if (data) {
          usedFilter = cand;
          currentOrder = data;
          console.log('[OrderManager] Orden encontrada con filtro:', cand, 'Datos:', data);
          break;
        }
      }

      // Si no se encontró con los candidatos principales, intentar búsqueda más amplia
      if (!currentOrder && candidates.length > 0) {
        const nId = this._normalizeOrderId(orderId);
        if (Number.isFinite(nId)) {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, last_collab_status')
          .eq('id', nId)
          .maybeSingle();
          if (data) { currentOrder = data; usedFilter = { col: 'id', val: data.id }; }
        }
        if (!currentOrder && typeof orderId === 'string') {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, status, last_collab_status')
          .eq('short_id', orderId)
          .maybeSingle();
          if (data) { currentOrder = data; usedFilter = { col: 'id', val: data.id }; }
        }
      }

      if (!currentOrder || !usedFilter) {
        console.error('[OrderManager] No se pudo encontrar la orden. Candidatos probados:', candidates);
        throw new Error(`No se encontró la orden con ID "${orderId}". Verifica que la orden existe y tienes permisos para accederla.`);
      }

      // Validar transición de estado (máquina de estados)
      const currentDbStatus = String(currentOrder.status || '').toLowerCase();
      const currentPhase = (typeof currentOrder.last_collab_status === 'string' && currentOrder.last_collab_status)
        ? String(currentOrder.last_collab_status).toLowerCase()
        : (currentDbStatus === 'pendiente' ? 'pendiente'
          : currentDbStatus === 'aceptada' ? 'en_camino_recoger'
          : currentDbStatus === 'en curso' ? (Array.isArray(currentOrder.tracking_data) && currentOrder.tracking_data.length > 0
              ? String(currentOrder.tracking_data[currentOrder.tracking_data.length - 1]?.ui_status || 'cargando').toLowerCase()
              : 'cargando')
          : currentDbStatus);
      const nextAllowed = STATE_FLOW[currentPhase] || [];
      if (ns !== 'cancelada' && ns !== 'entregada' && !nextAllowed.includes(ns)) {
        throw new Error(`Transición no permitida desde "${currentPhase}" a "${ns}"`);
      }

      if (ns === 'entregada') {
        const hasRoutePhase = currentPhase === 'en_camino_entregar' || (Array.isArray(currentOrder.tracking_data) && currentOrder.tracking_data.some(e => String(e?.ui_status || '').toLowerCase() === 'en_camino_entregar'));
        const evidenceArr = Array.isArray(currentOrder.evidence_photos) ? currentOrder.evidence_photos : [];
        if (!hasRoutePhase) {
          throw new Error('No puedes completar sin pasar por "En camino a entregar"');
        }
        if (evidenceArr.length === 0) {
          throw new Error('Debes subir al menos una evidencia para completar');
        }
      }

      const dbStatus2 = UI_TO_DB_STATUS[ns] || newStatus;
      const newTrackingEntry = { 
        ui_status: ns, 
        db_status: dbStatus2,
        date: new Date().toISOString(),
        description: ns === 'en_camino_recoger'
          ? 'Orden aceptada, en camino a recoger'
          : ns === 'cargando'
            ? 'Carga en proceso'
            : ns === 'en_camino_entregar'
              ? 'En ruta hacia entrega'
              : ns === 'entregada'
                ? 'Pedido entregado'
                : undefined
      };
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, newTrackingEntry];
      updatePayload.last_collab_status = ns;

      console.log('[OrderManager] Update payload:', updatePayload);

      // Realizar la actualización usando el filtro que devolvió datos
      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq(usedFilter.col, usedFilter.val);

      if (updateError) {
        console.error('[OrderManager] Error al actualizar orden:', {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code
        });
        throw new Error(`Error al actualizar en Supabase: ${updateError.message}`);
      }

      console.log(`[OrderManager] Orden #${orderId} actualizada exitosamente en la BD.`);
      try { await supabaseConfig.runProcessOutbox?.(); } catch (_) {}

      // 4. Enviar notificaciones push (cliente y roles)
      // Cliente: mantener notificación existente
      // Notificación directa obsoleta eliminada; se usa notify-role más abajo

      // Notificar a administradores del cambio de estado
      try {
        const rolePayload = {
          role: 'administrador',
          orderId: usedFilter?.val ?? orderId,
          title: 'Estado de orden actualizado',
          body: `La orden #${usedFilter?.val ?? orderId} cambió a "${newStatus}"`,
          data: { newStatus, url: `https://logisticalopezortiz.com/inicio.html?orderId=${usedFilter?.val ?? orderId}` }
        };
        const adminNotify = await supabaseConfig.client.functions.invoke('notify-role', { body: rolePayload });
        console.log('[OrderManager] Notificación rol admin:', adminNotify);
      } catch (e) {
        console.warn('[OrderManager] No se pudo notificar a administradores:', e?.message || e);
      }

      // Notificar al colaborador asignado cuando aplique
      try {
        const collaboratorId = additionalData?.collaborator_id || updatePayload?.assigned_to || null;
        if (collaboratorId) {
          const rolePayload = {
            role: 'colaborador',
            orderId: usedFilter?.val ?? orderId,
            title: 'Actualización de tu trabajo',
            body: `Tu orden asignada #${usedFilter?.val ?? orderId} cambió a "${newStatus}"`,
            data: { newStatus },
            targetIds: [String(collaboratorId)]
          };
          const collabNotify = await supabaseConfig.client.functions.invoke('notify-role', { body: rolePayload });
          console.log('[OrderManager] Notificación rol colaborador:', collabNotify);
        }
      } catch (e) {
        console.warn('[OrderManager] No se pudo notificar a colaborador:', e?.message || e);
      }

      return { success: true, error: null };

    } catch (error) {
      console.error(`[OrderManager] Fallo completo en la actualización de la orden #${orderId}:`, error);
      // Aquí podrías notificar al usuario con un sistema de notificaciones más robusto si lo tienes.
      return { success: false, error: error.message };
    }
  }
};

// Exportar a entorno global para consumo desde panel-colaborador
try { if (typeof window !== 'undefined') { window.OrderManager = OrderManager; } } catch (_) {}
try { if (typeof globalThis !== 'undefined') { globalThis.OrderManager = OrderManager; } } catch (_) {}
try { if (typeof module === 'object' && module && module.exports) { module.exports = OrderManager; } } catch (_) {}
