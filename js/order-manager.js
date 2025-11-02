// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const OrderManager = {
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
  async acceptOrder(orderId) {
    console.log(`[OrderManager] Aceptando orden #${orderId}`);

    // Detectar formato del ID entrante
    const orderIdRaw = orderId;
    const orderIdNum = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
    const isNumeric = Number.isFinite(orderIdNum);
    const isUUID = typeof orderIdRaw === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdRaw);
    console.log('[OrderManager] ID detectado', { orderIdRaw, orderIdNum, isNumeric, isUUID });

    if (!isNumeric && !isUUID) {
      const msg = 'ID de orden inválido (no es número ni UUID)';
      console.error(`[OrderManager] ${msg}:`, orderIdRaw);
      return { success: false, error: msg };
    }

    try {
      // Llamar al RPC con el nombre de parámetro esperado por PostgREST
      // Nota: la mayoría de implementaciones usan 'order_id' como nombre de argumento
      // Llamada al RPC (asumiendo que espera el secuencial interno)
      console.log('[OrderManager] RPC accept_order -> payload', { order_id: orderIdNum });
      const { data, error } = await supabaseConfig.client
        .rpc('accept_order', { order_id: orderIdNum });

      if (error) throw error;

      console.log('[OrderManager] RPC accept_order -> respuesta', { data });
      console.log(`[OrderManager] Orden #${isNumeric ? orderIdNum : orderIdRaw} aceptada exitosamente`);
      this._toast('Orden aceptada (RPC)', 'success');
      return { success: true, data, error: null };
    } catch (error) {
      // Registro detallado del error de Supabase/PostgREST
      const details = {
        message: error?.message,
        code: error?.code,
        hint: error?.hint,
        details: error?.details
      };
      console.error(`[OrderManager] Error al aceptar orden #${isNumeric ? orderIdNum : orderIdRaw}:`, details, error);

      // Fallback: intentar actualización directa si el RPC no existe o falla por firma
      const messageText = String(error?.message || '').toLowerCase();
      const rpcMissing = messageText.includes('could not find') || messageText.includes('undefined function') || error?.code === 'PGRST204';
      if (rpcMissing) {
        this._toast('RPC no disponible, aplicando respaldo automático…', 'warning');
        try {
          // Intentar obtener el usuario actual para asignar
          const { data: userData } = await supabaseConfig.client.auth.getUser();
          const userId = userData?.user?.id || null;
          // Obtener tracking actual y agregar entrada inicial
          let fetchQuery = supabaseConfig.client
            .from('orders')
            .select('id, tracking_data');
          if (isNumeric) fetchQuery = fetchQuery.eq('supabase_seq_id', orderIdNum);
          else fetchQuery = fetchQuery.eq('id', orderIdRaw);
          console.log('[OrderManager] Fallback -> fetch filtro', { by: isNumeric ? 'supabase_seq_id' : 'id', value: isNumeric ? orderIdNum : orderIdRaw });
          const { data: currentOrder } = await fetchQuery.single();
          const currentTracking = Array.isArray(currentOrder?.tracking_data) ? currentOrder.tracking_data : [];
          const initialTrack = { status: 'en_camino_recoger', date: new Date().toISOString(), message: 'Orden aceptada, en camino a recoger' };

          const payload = {
            status: 'En proceso',
            last_collab_status: 'en_camino_recoger',
            accepted_at: new Date().toISOString(),
            tracking_data: [...currentTracking, initialTrack]
          };
          if (userId) {
            payload.accepted_by = userId;
            payload.assigned_to = userId;
          }
          console.log('[OrderManager] Fallback -> update payload', payload);
          let updateQuery = supabaseConfig.client.from('orders').update(payload);
          if (isNumeric) updateQuery = updateQuery.eq('supabase_seq_id', orderIdNum);
          else updateQuery = updateQuery.eq('id', orderIdRaw);
          console.log('[OrderManager] Fallback -> update filtro', { by: isNumeric ? 'supabase_seq_id' : 'id', value: isNumeric ? orderIdNum : orderIdRaw });
          const { error: updErr } = await updateQuery;
          if (updErr) throw updErr;

          console.log(`[OrderManager] Fallback aplicado: orden #${isNumeric ? orderIdNum : orderIdRaw} aceptada/actualizada`);
          this._toast('Orden aceptada mediante respaldo automático', 'success');
          return { success: true, data: null, error: null };
        } catch (fallbackError) {
          console.error(`[OrderManager] Fallback de aceptación falló para orden #${orderIdNum}:`, {
            message: fallbackError?.message,
            code: fallbackError?.code,
            details: fallbackError?.details
          });
          this._toast('No se pudo aplicar respaldo automático', 'error');
        }
      }

      return { success: false, error: error?.message || 'No se pudo aceptar la orden' };
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

    const updatePayload = { ...additionalData, last_collab_status: newStatus };

    // Lógica de negocio centralizada:
    // Si el colaborador marca "entregado", el estado general de la orden pasa a "Completado".
    if (newStatus === 'entregado') {
      updatePayload.status = 'Completado';
      updatePayload.completed_at = new Date().toISOString();
      if (additionalData.collaborator_id) {
        updatePayload.completed_by = additionalData.collaborator_id;
      }
    }
    // Si el colaborador inicia el trabajo, el estado general pasa a "En proceso".
    else if (['en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(newStatus)) {
      updatePayload.status = 'En proceso';
    }

    try {
      // Obtener tracking_data actual
      const { data: currentOrder, error: fetchError } = await supabaseConfig.client
        .from('orders')
        .select('tracking_data')
        .eq('id', orderId)
        .single();

      if (fetchError) throw new Error(`Error al obtener el pedido: ${fetchError.message}`);

      const newTrackingEntry = { status: newStatus, date: new Date().toISOString() };
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, newTrackingEntry];

      // Realizar la actualización
      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updateError) throw new Error(`Error al actualizar en Supabase: ${updateError.message}`);

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
