// Servicio de órdenes: orquestación de creación y notificación en una sola llamada
;(function(){
  const OrdersService = {
    async createOrderAndNotify(orderPayload) {
      if (!window.supabaseConfig) throw new Error('Supabase no inicializado');
      await window.supabaseConfig.ensureSupabaseReady?.();
      const client = window.supabaseConfig.client;
      if (!client || !client.functions || typeof client.functions.invoke !== 'function') {
        throw new Error('Funciones de Supabase no disponibles');
      }

      console.log('Invocando Edge Function create-order-and-notify...');
      
      try {
        const { data, error } = await client.functions.invoke('create-order-and-notify', {
          body: { order_payload: orderPayload }
        });

        if (error) {
          console.error('Error en Edge Function:', error);
          throw error;
        }

        if (data && data.success) {
          console.log('Edge Function ejecutada con éxito:', data);
          return data;
        }
        
        throw new Error(data?.error || 'Error desconocido en la función');
      } catch (err) {
        console.warn('Fallo Edge Function, intentando fallback RPC directo...', err);
        
        // Fallback: Crear la orden vía RPC si la Edge Function falla (ej: problemas de red o despliegue)
        const { data: created, error: rpcErr } = await client.rpc('create_order_with_contact', { order_payload: orderPayload });
        if (rpcErr) throw rpcErr;
        
        const order = Array.isArray(created) ? created[0] : created;
        
        // Intentar procesar outbox para disparar notificaciones asíncronas si el RPC funcionó
        try { await window.supabaseConfig.runProcessOutbox?.(50); } catch (_) {}
        
        return { success: true, order, email_sent: false, push_sent: false, fallback: true };
      }
    }
  };
  try { window.OrdersService = OrdersService; } catch(_) {}
})(); 
