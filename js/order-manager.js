// js/order-manager.js

/**
 * Módulo centralizado para gestionar las actualizaciones de estado de los pedidos.
 * Proporciona una única función para ser usada desde cualquier panel (dueño, colaborador, etc.)
 * para asegurar consistencia en las actualizaciones de la base de datos y en las notificaciones.
 */

const OrderManager = {
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
