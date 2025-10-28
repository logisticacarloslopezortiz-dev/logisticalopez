/// <reference path="../globals.d.ts" />
// Implementación de la función de notificaciones push para TLC
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

// Función para enviar notificación push usando la API Web Push
async function sendPushNotification(subscription: PushSubscription, payload: any) {
  try {
    // Importar la biblioteca web-push de forma dinámica
    const webpush = await import('https://esm.sh/web-push@3.6.1');
    
    // Configurar las credenciales VAPID
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    
    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error('Faltan las claves VAPID en la configuración');
    }
    
    webpush.setVapidDetails(
      'mailto:contacto@tlc.com',
      vapidPublicKey,
      vapidPrivateKey
    );
    
    // Enviar la notificación
    const result = await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );
    
    return result;
  } catch (error) {
    logDebug('Error al enviar notificación push', error);
    throw error;
  }
}

// Manejador principal de la función
Deno.serve(async (req: Request) => {
  // Manejar solicitudes OPTIONS (preflight CORS)
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  try {
    // Obtener variables de entorno
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      logDebug('Variables de entorno faltantes', { SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE });
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500);
    }
    
    // Crear cliente de Supabase con rol de servicio
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    
    // Extraer datos del cuerpo de la solicitud
    const { 
      orderId, 
      title = 'Actualización de TLC', 
      body, 
      icon = '/img/logo-tlc.png',
      data = {}
    } = await req.json();
    
    if (!orderId || !body) {
      return jsonResponse({ error: 'Se requiere orderId y body para la notificación' }, 400);
    }
    
    // Buscar la orden
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, client_id, name, phone')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      logDebug('Error al buscar la orden', orderError);
      return jsonResponse({ error: 'No se encontró la orden especificada' }, 404);
    }
    
    // Buscar suscripciones push para el cliente
    let pushSubscriptions = [];
    
    if (order.client_id) {
      // Cliente registrado - buscar en push_subscriptions
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('user_id', order.client_id);
      
      if (!subError && subscriptions) {
        pushSubscriptions = subscriptions;
      }
    }
    
    if (pushSubscriptions.length === 0) {
      return jsonResponse({ 
        success: false, 
        message: 'No hay suscripciones push registradas para este cliente' 
      }, 200);
    }
    
    // Enviar notificación a todas las suscripciones del cliente
    const results = [];
    for (const subscription of pushSubscriptions) {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: subscription.keys
      };
      const notificationPayload = {
        notification: {
          title,
          body,
          icon,
          vibrate: [100, 50, 100],
          data: {
            orderId,
            timestamp: new Date().toISOString(),
            ...data
          }
        }
      };
      
      try {
        // Enviar la notificación
        await sendPushNotification(pushSubscription, notificationPayload);
        results.push({ success: true, endpoint: subscription.endpoint });
      } catch (error) {
        logDebug('Error enviando a suscripción', { endpoint: subscription.endpoint, error });
        results.push({ success: false, endpoint: subscription.endpoint, error: error.message });
      }
    }
    
    // Registrar la notificación en la base de datos
    await supabase.from('notifications').insert({
      user_id: order.client_id,
      title,
      body,
      data: { orderId, results },
      created_at: new Date().toISOString()
    });
    
    const successCount = results.filter(r => r.success).length;
    
    return jsonResponse({ 
      success: successCount > 0, 
      message: `Notificación enviada a ${successCount} de ${results.length} suscripciones`,
      results
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    return jsonResponse({ error: message }, 500);
  }
});
