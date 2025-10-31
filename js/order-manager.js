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
    const updatePayload = {
      status: newStatus,
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
        await supabaseConfig.client.functions.invoke('send-push-notification', {
          body: {
            orderId: orderId,
            newStatus: newStatus
          }
        });
        console.log(`[OrderManager] Solicitud de notificación enviada para la orden #${orderId}.`);
      } catch (invokeError) {
        // No consideramos esto un error fatal, pero lo registramos.
        console.warn(`[OrderManager] Fallo al enviar notificación para la orden #${orderId}:`, invokeError.message);
      }

      return { success: true, error: null };

    } catch (error) {
      console.error(`[OrderManager] Fallo completo en la actualización de la orden #${orderId}:`, error);
      // Aquí podrías notificar al usuario con un sistema de notificaciones más robusto si lo tienes.
      return { success: false, error: error.message };
    }
  }
};
