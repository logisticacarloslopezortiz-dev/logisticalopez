/// <reference path="../globals.d.ts" />
// Implementación de la función de notificaciones push para TLC
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

// Tipo de suscripción esperado por web-push (evita conflicto con el DOM PushSubscription)
interface WebPushSubscription {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

// Función para enviar notificación push usando la API Web Push
async function sendPushNotification(subscription: WebPushSubscription, payload: any) {
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
      JSON.stringify(payload),
      { TTL: 2592000 }
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
      to_user_id,
      contact_id,
      newStatus,
      title,
      body, 
      icon = '/img/logo-tlc.png',
      data = {}
    } = await req.json();
    
    if (!orderId && !to_user_id && !contact_id) {
      return jsonResponse({ error: 'Faltan destinatarios: orderId, to_user_id o contact_id' }, 400);
    }
    let finalTitle = title;
    let finalBody = body;
    if (!finalBody && newStatus) {
      const statusLabel = String(newStatus);
      finalBody = `La orden ${orderId ? '#' + orderId : ''} cambió a "${statusLabel}"`;
    }
    if (!finalTitle) {
      finalTitle = orderId ? `Actualización de la orden #${orderId}` : 'Actualización de orden';
    }
    if (!finalBody) {
      return jsonResponse({ error: 'Se requiere body o newStatus para la notificación' }, 400);
    }
    
    let pushSubscriptions: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];

    async function fetchUserSubscriptions(userId: string) {
      const results: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];
      const r1 = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('user_id', userId);
      if (!r1.error && Array.isArray(r1.data) && r1.data.length > 0 && r1.data[0]?.keys) {
        for (const s of r1.data) {
          const k = (s as any).keys;
          if (k && k.p256dh && k.auth) results.push({ endpoint: (s as any).endpoint, keys: { p256dh: k.p256dh, auth: k.auth } });
        }
        return results;
      }
      const r2 = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId);
      if (!r2.error && Array.isArray(r2.data) && r2.data.length > 0) {
        for (const s of r2.data) {
          const p = (s as any).p256dh;
          const a = (s as any).auth;
          if (p && a) results.push({ endpoint: (s as any).endpoint, keys: { p256dh: p, auth: a } });
        }
      }
      return results;
    }

    if (orderId) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, client_id, push_subscription, client_contact_id')
        .eq('id', orderId)
        .single();
      if (orderError || !order) {
        return jsonResponse({ error: 'No se encontró la orden especificada' }, 404);
      }
      if (order.client_id) {
        const subs = await fetchUserSubscriptions(order.client_id);
        pushSubscriptions = subs;
      }
      if (pushSubscriptions.length === 0) {
        const sub = (order as any)?.push_subscription || null;
        if (sub && sub.endpoint && sub.keys && sub.keys.p256dh && sub.keys.auth) {
          pushSubscriptions = [{ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }];
        }
      }
      if (pushSubscriptions.length === 0) {
        const ccid = (order as any)?.client_contact_id || null;
        if (ccid) {
          const { data: contact } = await supabase
            .from('clients')
            .select('push_subscription')
            .eq('id', ccid)
            .maybeSingle();
          const csub = (contact as any)?.push_subscription || null;
          if (csub && csub.endpoint && csub.keys && csub.keys.p256dh && csub.keys.auth) {
            pushSubscriptions = [{ endpoint: csub.endpoint, keys: { p256dh: csub.keys.p256dh, auth: csub.keys.auth } }];
          }
        }
      }
    } else if (to_user_id) {
      const subs = await fetchUserSubscriptions(String(to_user_id));
      pushSubscriptions = subs;
    } else if (contact_id) {
      const { data: contact } = await supabase
        .from('clients')
        .select('id, push_subscription')
        .eq('id', contact_id)
        .maybeSingle();
      const sub = (contact as any)?.push_subscription || null;
      if (sub && sub.endpoint && sub.keys && sub.keys.p256dh && sub.keys.auth) {
        pushSubscriptions = [{ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }];
      }
    }

    if (pushSubscriptions.length === 0) {
      return jsonResponse({ success: false, message: 'No hay suscripciones push registradas' }, 200);
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
          title: finalTitle,
          body: finalBody,
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
        results.push({ 
          success: false, 
          endpoint: subscription.endpoint, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    const targetUserId = orderId ? (await supabase
      .from('orders')
      .select('client_id')
      .eq('id', orderId)
      .single()).data?.client_id : (to_user_id || null);
    if (targetUserId) {
      await supabase.from('notifications').insert({
        user_id: targetUserId,
        title: finalTitle,
        body: finalBody,
        data: { orderId, results },
        created_at: new Date().toISOString()
      });
    }
    
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
