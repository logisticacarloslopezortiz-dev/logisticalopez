// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

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
      return await this.actualizarEstadoPedido(orderId, 'en_camino_recoger', additionalData);
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
        return await this.actualizarEstadoPedido(orderId, 'en_camino_recoger', additionalData);
      }

      console.log('[OrderManager] RPC accept_order OK', data);
      this._toast('Orden aceptada por RPC correctamente', 'success');
      return { success: true, data, error: null };
    } catch (error) {
      console.error('[OrderManager] Exception en RPC accept_order:', error);
      this._toast(`Error inesperado: ${error.message || 'falló'}. Aplicando fallback…`, 'warning');
      return await this.actualizarEstadoPedido(orderId, 'en_camino_recoger', additionalData);
    }
  },

   /**
    * Cancela un trabajo activo marcándolo como Cancelado
    */
   async cancelActiveJob(orderId) {
     console.log(`[OrderManager] Cancelando trabajo activo #${orderId}`);
     
     try {
       const { error } = await supabaseConfig.client
         .from('orders')
         .update({ status: 'Cancelado' })
         .eq('id', orderId);
       
       if (error) throw error;
       
       console.log(`[OrderManager] Trabajo #${orderId} cancelado exitosamente`);
       return { success: true, error: null };
     } catch (error) {
       console.error(`[OrderManager] Error al cancelar trabajo #${orderId}:`, error);
       return { success: false, error: error.message };
     }
   },

   /**
    * Centraliza la lógica para actualizar el estado de un pedido en Supabase.
    */
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    console.log(`[OrderManager] Iniciando actualización para orden #${orderId} a estado "${newStatus}"`);

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
      if (newStatus === 'entregado') {
        sanitizedData.completed_by = additionalData.collaborator_id;
      } else {
        sanitizedData.assigned_to = additionalData.collaborator_id;
      }
    }

    const updatePayload = { ...sanitizedData };

    // Lógica de negocio centralizada:
    // Mapear estados de acciones del colaborador
    if (newStatus === 'entregado') {
      updatePayload.status = 'Completada';
      updatePayload.completed_at = new Date().toISOString();
    }
    else if (newStatus === 'en_camino_recoger') {
      updatePayload.status = 'Aceptada';
      updatePayload.assigned_at = new Date().toISOString();
    }
    else if (['cargando', 'en_camino_entregar'].includes(newStatus)) {
      updatePayload.status = 'En curso';
    }
    // Mapear estados cuando la UI del dueño usa valores finales
    else if (['Completada', 'completada'].includes(newStatus)) {
      updatePayload.status = 'Completada';
      updatePayload.completed_at = new Date().toISOString();
    }
    else if (['Aceptada', 'aceptada'].includes(newStatus)) {
      updatePayload.status = 'Aceptada';
      updatePayload.assigned_at = new Date().toISOString();
    }
    else if (['En curso', 'en curso'].includes(newStatus)) {
      updatePayload.status = 'En curso';
    }
    else if (['Cancelado', 'cancelado'].includes(newStatus)) {
      updatePayload.status = 'Cancelado';
    }
    else if (['Pendiente', 'pendiente'].includes(newStatus)) {
      updatePayload.status = 'Pendiente';
    }

    try {
      // Obtener tracking_data actual probando secuencialmente los candidatos
      let usedFilter = null;
      let currentOrder = null;

      for (const cand of candidates) {
        console.log('[OrderManager] Fetch intento con:', cand);
        const { data, error } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, supabase_seq_id')
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
        console.log('[OrderManager] Intentando búsqueda amplia para orderId:', orderId);
        const { data, error } = await supabaseConfig.client
          .from('orders')
          .select('tracking_data, id, short_id, supabase_seq_id')
          .or(`id.eq.${normalizedId},short_id.eq.${orderId},supabase_seq_id.eq.${normalizedId}`)
          .maybeSingle();

        if (data && !error) {
          currentOrder = data;
          usedFilter = { col: 'id', val: data.id }; // Usar el ID real encontrado
          console.log('[OrderManager] Orden encontrada con búsqueda amplia:', data);
        }
      }

      if (!currentOrder || !usedFilter) {
        console.error('[OrderManager] No se pudo encontrar la orden. Candidatos probados:', candidates);
        throw new Error(`No se encontró la orden con ID "${orderId}". Verifica que la orden existe y tienes permisos para accederla.`);
      }

      const newTrackingEntry = { 
        status: newStatus, 
        date: new Date().toISOString(),
        description: newStatus === 'en_camino_recoger'
          ? 'Orden aceptada, en camino a recoger'
          : newStatus === 'cargando'
            ? 'Carga en proceso'
            : newStatus === 'en_camino_entregar'
              ? 'En ruta hacia entrega'
              : newStatus === 'entregado'
                ? 'Pedido entregado'
                : undefined
      };
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, newTrackingEntry];

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

      // 4. Enviar notificación push (si aplica)
      // Esta lógica se puede expandir para notificar a diferentes roles.
      try {
        // Crear el cuerpo de la solicitud para diagnóstico detallado
        const notificationBody = {
          orderId: orderId,
          newStatus: newStatus
        };
        
        console.log(`[OrderManager] Enviando notificación push para orden #${orderId}:`, JSON.stringify(notificationBody));
        
        const response = await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: notificationBody
        });
        
        console.log(`[OrderManager] Respuesta de notificación para orden #${orderId}:`, response);
        console.log(`[OrderManager] Solicitud de notificación enviada exitosamente para la orden #${orderId}.`);
      } catch (invokeError) {
        // Log detallado del error para diagnóstico
        console.error(`[OrderManager] ERROR al enviar notificación para la orden #${orderId}:`, {
          mensaje: invokeError.message,
          código: invokeError.code || 'N/A',
          detalles: invokeError.details || 'N/A',
          respuesta: invokeError.response || 'N/A',
          cuerpo: {
            orderId: orderId,
            newStatus: newStatus
          }
        });
      }

      return { success: true, error: null };

    } catch (error) {
      console.error(`[OrderManager] Fallo completo en la actualización de la orden #${orderId}:`, error);
      // Aquí podrías notificar al usuario con un sistema de notificaciones más robusto si lo tienes.
      return { success: false, error: error.message };
    }
  }
};
