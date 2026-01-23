// Servicio de notificaciones: helpers para email y push (uso opcional)
;(function(){
  const NotificationsService = {
    async sendStatusEmail({ to, orderId, shortId, status, name }) {
      if (!window.supabaseConfig) throw new Error('Supabase no inicializado');
      await window.supabaseConfig.ensureSupabaseReady?.();
      const client = window.supabaseConfig.client;
      const { data, error } = await client.functions.invoke('send-order-email', {
        body: { to, orderId, shortId, status, name }
      });
      if (error) throw error;
      return data;
    }
  };
  try { window.NotificationsService = NotificationsService; } catch(_) {}
})(); 
