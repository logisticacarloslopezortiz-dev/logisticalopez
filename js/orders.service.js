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
      // Estrategia: evitar CORS en ambientes locales -> usar RPC primero
      const { data: created, error: rpcErr } = await client.rpc('create_order_with_contact', { order_payload: orderPayload });
      if (rpcErr) throw rpcErr;
      const order = Array.isArray(created) ? created[0] : created;
      const to = order?.email || null;
      const orderId = order?.id || null;
      const shortId = order?.short_id || null;
      const name = order?.name || null;
      let email_sent = false;
      /* 
      // ❌ ELIMINADO: El frontend NO debe enviar emails ni notificaciones.
      // Esto lo maneja el backend (Trigger -> Outbox -> Edge Function).
      if (to && orderId) {
        try {
          const { error: mailErr } = await client.functions.invoke('send-order-email', { body: { to, orderId, shortId, status: 'pending', name } });
          if (!mailErr) email_sent = true;
        } catch (_) { email_sent = false; }
      }
      // Intento opcional de función unificada si está desplegada (no crítico)
      try {
        const { data, error } = await client.functions.invoke('create-order-and-notify', {
          body: { order_payload: orderPayload }
        });
        if (!error && data && data.success === true) {
          return data;
        }
      } catch (_) { } 
      */
      return { success: true, order, email_sent: false, push_sent: false, fallback: true };
    }
  };
  try { window.OrdersService = OrdersService; } catch(_) {}
})(); 
