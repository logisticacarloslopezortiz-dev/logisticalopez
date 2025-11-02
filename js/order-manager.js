// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const OrderManager = {
  /**
   * Centraliza la lógica para actualizar el estado de un pedido en Supabase.
   * También gestiona la actualización del historial de seguimiento y el envío de notificaciones.
   *
   * @param {string | number} orderId - El ID del pedido a actualizar.
   * @param {string} newStatus - El nuevo estado del pedido (ej. 'En proceso', 'Completado').
   * @param {Object} [additionalData={}] - Un objeto con datos adicionales para la actualización (ej. { monto_cobrado: 500 }).
   * @returns {Promise<{success: boolean, error: any}>} - Un objeto indicando si la operación fue exitosa.
   */
  async actualizarEstadoPedido(orderId, newStatus, additionalData = {}) {
    console.log(`[OrderManager] Iniciando actualización para orden #${orderId} a estado "${newStatus}"`);

    // 1. Construir el objeto de actualización para Supabase
    // No sobrescribir el estado global con estados intermedios del colaborador.
    // Solo aplicar 'status' si viene explícitamente en additionalData (p.ej. 'Completado' o 'Cancelado').
    const updatePayload = {
      ...additionalData
    };

    // 2. Añadir la nueva entrada al historial de seguimiento (tracking_data)
    // Primero, obtenemos el tracking_data actual para no sobreescribirlo.
    try {
      const { data: currentOrder, error: fetchError } = await supabaseConfig.client
        .from('orders')
        .select('tracking_data')
        .eq('id', orderId)
        .single();

      if (fetchError) {
        throw new Error(`Error al obtener el pedido: ${fetchError.message}`);
      }

      const newTrackingEntry = {
        status: newStatus,
        date: new Date().toISOString()
      };

      // Asegurarse de que tracking_data sea un array
      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      updatePayload.tracking_data = [...currentTracking, newTrackingEntry];


      // 3. Realizar la actualización en la base de datos
      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updateError) {
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
  },

  /**
   * Acepta una solicitud: asigna al colaborador, marca "En proceso",
   * y registra el primer estado del flujo del colaborador.
   *
   * @param {string|number} orderId
   * @param {string} collaboratorId
   * @returns {Promise<{success: boolean, error: any}>}
   */
  async acceptOrder(orderId, collaboratorId) {
    try {
      if (!supabaseConfig?.client) throw new Error('Cliente de Supabase no disponible');

      // Obtener pedido actual para validar y recuperar tracking
      const { data: currentOrder, error: fetchError } = await supabaseConfig.client
        .from('orders')
        .select('assigned_to, status, tracking_data')
        .eq('id', orderId)
        .single();

      if (fetchError) throw new Error(`Error al obtener pedido: ${fetchError.message}`);
      if (!currentOrder) throw new Error('Pedido no encontrado');

      // Validaciones
      if (currentOrder.status === 'Completado') {
        return { success: false, error: 'La solicitud ya fue completada.' };
      }
      if (currentOrder.status === 'Cancelado') {
        return { success: false, error: 'La solicitud ya está cancelada.' };
      }
      if (currentOrder.assigned_to && currentOrder.assigned_to !== collaboratorId) {
        return { success: false, error: 'La solicitud ya fue asignada a otro colaborador.' };
      }

      const currentTracking = Array.isArray(currentOrder.tracking_data) ? currentOrder.tracking_data : [];
      const newTrackingEntry = {
        status: 'en_camino_recoger',
        date: new Date().toISOString(),
        actor: 'collaborator',
        user_id: collaboratorId
      };

      const updatePayload = {
        assigned_to: collaboratorId,
        // Requisito: al aceptar debe cambiar el estado a "en_camino_recoger"
        status: 'en_camino_recoger',
        tracking_data: [...currentTracking, newTrackingEntry]
      };

      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updateError) throw new Error(`Error al actualizar: ${updateError.message}`);

      // Notificar
      try {
        await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: { orderId, newStatus: 'en_camino_recoger' }
        });
      } catch (invokeError) {
        console.warn('[OrderManager] Error al enviar notificación de aceptación:', invokeError);
      }

      return { success: true, error: null };
    } catch (err) {
      console.error('[OrderManager] acceptOrder error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Cancela un trabajo activo: marca la orden como "Cancelado",
   * opcionalmente libera la asignación y registra el evento en tracking.
   *
   * @param {string|number} orderId
   * @returns {Promise<{success: boolean, error: any}>}
   */
  async cancelActiveJob(orderId) {
    try {
      if (!supabaseConfig?.client) throw new Error('Cliente de Supabase no disponible');

      const { data: currentOrder, error: fetchError } = await supabaseConfig.client
        .from('orders')
        .select('tracking_data, status, assigned_to')
        .eq('id', orderId)
        .single();

      if (fetchError) throw new Error(`Error al obtener pedido: ${fetchError.message}`);

      if (currentOrder?.status === 'Completado') {
        return { success: false, error: 'No se puede cancelar una solicitud completada.' };
      }

      const currentTracking = Array.isArray(currentOrder?.tracking_data) ? currentOrder.tracking_data : [];
      const newTrackingEntry = {
        status: 'cancelado',
        date: new Date().toISOString(),
        actor: 'collaborator'
      };

      const updatePayload = {
        status: 'Cancelado',
        assigned_to: null,
        tracking_data: [...currentTracking, newTrackingEntry]
      };

      const { error: updateError } = await supabaseConfig.client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updateError) throw new Error(`Error al actualizar: ${updateError.message}`);

      // Notificar
      try {
        await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: { orderId, newStatus: 'cancelado' }
        });
      } catch (invokeError) {
        console.warn('[OrderManager] Error al enviar notificación de cancelación:', invokeError);
      }

      return { success: true, error: null };
    } catch (err) {
      console.error('[OrderManager] cancelActiveJob error:', err);
      return { success: false, error: err.message };
    }
  }
};
