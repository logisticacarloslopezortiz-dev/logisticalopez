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
    
    // Buscar la orden y su suscripción push
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, push_subscription')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      logDebug('Error al buscar la orden', orderError);
      return jsonResponse({ error: 'No se encontró la orden especificada' }, 404);
    }
    
    if (!order.push_subscription) {
      return jsonResponse({ 
        success: false, 
        message: 'No hay suscripción push registrada para esta orden' 
      }, 200);
    }
    
    // Preparar la notificación
    const pushSubscription = order.push_subscription;
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
    
    // Enviar la notificación
    await sendPushNotification(pushSubscription, notificationPayload);
    
    // Registrar la notificación en la base de datos
    await supabase.from('notifications').insert({
      order_id: orderId,
      title,
      body,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });
    
    return jsonResponse({ 
      success: true, 
      message: 'Notificación enviada correctamente' 
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    return jsonResponse({ error: message }, 500);
  }
});
