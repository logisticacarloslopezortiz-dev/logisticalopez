/// <reference path="../globals.d.ts" />
// Implementación de la función de notificaciones push para TLC
import { createClient } from '@supabase/supabase-js';
import { corsHeaders as _corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs
function logDebug(message: string, data?: unknown) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

async function logDb(
  supabase: any,
  fn_name: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload?: unknown
) {
  try {
    await supabase.from('function_logs' as any).insert({ fn_name, level, message, payload } as any);
  } catch (_) { void 0; }
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
async function sendPushNotification(subscription: WebPushSubscription, payload: unknown) {
  try {
    // Importar la biblioteca web-push de forma dinámica
    const { default: webpush } = await import('web-push');
    
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
    const errObj = error as { statusCode?: number; body?: unknown };
    const detail = {
      statusCode: typeof errObj?.statusCode === 'number' ? errObj.statusCode : null,
      body: typeof errObj?.body === 'string' ? errObj.body.slice(0, 200) : null
    };
    logDebug('Error al enviar notificación push', detail);
    throw error;
  }
}

type PushSubKeys = { p256dh: string; auth: string };
type PushSubRow = { endpoint?: string; keys?: PushSubKeys; p256dh?: string; auth?: string };
type OrderRow = { id: number; client_id: string | null; client_contact_id: string | null };

async function fetchUserSubscriptions(
  supabaseClient: any,
  userId: string
): Promise<Array<{ endpoint: string; keys: PushSubKeys }>> {
  const results: Array<{ endpoint: string; keys: PushSubKeys }> = [];
  const r1 = await supabaseClient
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId);
  if (!r1.error && Array.isArray(r1.data) && r1.data.length > 0) {
    for (const s of r1.data as unknown[]) {
      const row = s as PushSubRow;
      const k = row.keys;
      if (row.endpoint && k?.p256dh && k?.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } });
    }
    if (results.length > 0) return results;
  }
  const r2 = await supabaseClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (!r2.error && Array.isArray(r2.data) && r2.data.length > 0) {
    for (const s of r2.data as unknown[]) {
      const row = s as PushSubRow;
      if (row.endpoint && row.p256dh && row.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } });
    }
  }
  return results;
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
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500, req);
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
      icon = '/img/android-chrome-192x192.png',
      data = {}
    } = await req.json();
    
    if (!orderId && !to_user_id && !contact_id) {
      await logDb(supabase, 'send-push-notification', 'warning', 'Solicitud sin destinatarios', { body: await req.clone().json().catch(() => ({})) });
      return jsonResponse({ error: 'Faltan destinatarios: orderId, to_user_id o contact_id' }, 400, req);
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
      await logDb(supabase, 'send-push-notification', 'warning', 'Body faltante en notificación', { orderId, to_user_id, contact_id, newStatus });
      return jsonResponse({ error: 'Se requiere body o newStatus para la notificación' }, 400, req);
    }
    
    let pushSubscriptions: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];

    

    if (orderId) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, client_id, client_contact_id')
        .eq('id', orderId)
        .single();
      if (orderError || !order) {
        await logDb(supabase, 'send-push-notification', 'warning', 'Orden no encontrada', { orderId });
        return jsonResponse({ error: 'No se encontró la orden especificada' }, 404, req);
      }
      const ord = order as unknown as OrderRow;
      if (ord.client_contact_id) {
        const { data: subsByContact } = await supabase
          .from('push_subscriptions')
          .select('endpoint, keys')
          .eq('client_contact_id', ord.client_contact_id);
        if (subsByContact && subsByContact.length > 0) {
          pushSubscriptions = subsByContact as Array<{ endpoint: string; keys: PushSubKeys }>;
        }
      }
      if (pushSubscriptions.length === 0 && ord.client_id) {
        const subs = await fetchUserSubscriptions(supabase, ord.client_id);
        pushSubscriptions = subs;
      }
    } else if (to_user_id) {
      const subs = await fetchUserSubscriptions(supabase, String(to_user_id));
      pushSubscriptions = subs;
    } else if (contact_id) {
      const { data: subsByContact } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('client_contact_id', String(contact_id));
      if (subsByContact && subsByContact.length > 0) {
        pushSubscriptions = subsByContact as Array<{ endpoint: string; keys: PushSubKeys }>;
      }
    }

    if (pushSubscriptions.length === 0) {
      await logDb(supabase, 'send-push-notification', 'info', 'Sin suscripciones para destinatario', { orderId, to_user_id, contact_id });
      return jsonResponse({ success: false, message: 'No hay suscripciones push registradas' }, 200, req);
    }
    
    // Enviar notificación a todas las suscripciones del cliente
    const results: Array<{ success: boolean; endpoint: string; statusCode?: number | null; error?: string }> = [];
    for (const subscription of pushSubscriptions) {
      const cleanEndpoint = String(subscription.endpoint || '')
        .replace(/[`\s]+/g, '')
        .replace(/,+$/g, '')
        .trim();
      const cleanP256 = String(subscription.keys?.p256dh || '').trim();
      const cleanAuth = String(subscription.keys?.auth || '').trim();
      const pushSubscription = {
        endpoint: cleanEndpoint,
        keys: { p256dh: cleanP256, auth: cleanAuth }
      };
      const notificationPayload = {
        notification: {
          title: finalTitle,
          body: finalBody,
          icon,
          badge: '/img/favicon-32x32.png',
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
        const errObj = error as { statusCode?: number; body?: unknown; message?: string };
        const detail = {
          endpoint: pushSubscription.endpoint,
          statusCode: typeof errObj?.statusCode === 'number' ? errObj.statusCode : null,
          body: typeof errObj?.body === 'string' ? errObj.body.slice(0, 200) : null
        };
        logDebug('Error enviando a suscripción', detail);
        await logDb(supabase, 'send-push-notification', 'error', 'Fallo envío web-push', { detail, bodySent: notificationPayload });
        if (detail.statusCode === 404 || detail.statusCode === 410) {
          try {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', pushSubscription.endpoint);
          } catch (e) { const _ignored = e; }
        }
        results.push({ 
          success: false, 
          endpoint: pushSubscription.endpoint, 
          statusCode: detail.statusCode,
          error: typeof errObj?.message === 'string' ? errObj.message : String(error) 
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
    }, 200, req);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    try {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
        await logDb(supabase, 'send-push-notification', 'error', message, {});
      }
    } catch (_) { void 0; }
    return jsonResponse({ error: message }, 500, req);
  }
});
