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

// --- Envío por proveedores basados en token (FCM / Expo / WNS) ---
type TokenProvider = 'fcm' | 'expo' | 'wns';
type TokenSendInput = { token: string; provider?: TokenProvider; title: string; body: string; data?: Record<string, unknown> };
type TokenSendResult = { success: boolean; provider: TokenProvider; token: string; statusCode?: number; error?: string };

function sanitizeToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;
  if (t.toLowerCase() === 'undefined' || t.toLowerCase() === 'null') return null;
  return t;
}

function detectProvider(token: string, explicit?: TokenProvider): TokenProvider {
  if (explicit) return explicit;
  if (/^ExpoPushToken\[.+\]$/.test(token)) return 'expo';
  if (/^https?:\/\//i.test(token)) return 'wns';
  return 'fcm';
}

async function sendViaFCM(input: TokenSendInput): Promise<TokenSendResult> {
  const serverKey = Deno.env.get('FCM_SERVER_KEY') || Deno.env.get('FIREBASE_SERVER_KEY');
  if (!serverKey) return { success: false, provider: 'fcm', token: input.token, statusCode: 500, error: 'FCM_SERVER_KEY no configurado' };
  const payload = {
    to: input.token,
    notification: { title: input.title, body: input.body },
    data: { ...(input.data || {}) }
  };
  try {
    const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${serverKey}`
      },
      body: JSON.stringify(payload)
    });
    const ok = resp.ok;
    return { success: ok, provider: 'fcm', token: input.token, statusCode: resp.status, error: ok ? undefined : (await resp.text()).slice(0, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, provider: 'fcm', token: input.token, statusCode: 500, error: msg };
  }
}

async function sendViaExpo(input: TokenSendInput): Promise<TokenSendResult> {
  const body = {
    to: input.token,
    title: input.title,
    body: input.body,
    data: { ...(input.data || {}) }
  };
  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const ok = resp.ok;
    return { success: ok, provider: 'expo', token: input.token, statusCode: resp.status, error: ok ? undefined : (await resp.text()).slice(0, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, provider: 'expo', token: input.token, statusCode: 500, error: msg };
  }
}

async function getWnsAccessToken(): Promise<string | null> {
  const sid = Deno.env.get('WNS_SID');
  const secret = Deno.env.get('WNS_SECRET');
  if (!sid || !secret) return null;
  try {
    const resp = await fetch('https://login.live.com/accesstoken.srf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: sid,
        client_secret: secret,
        scope: 'notify.windows.com'
      }).toString()
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => ({} as any));
    return typeof json.access_token === 'string' ? json.access_token : null;
  } catch (_) { return null; }
}

async function sendViaWNS(input: TokenSendInput): Promise<TokenSendResult> {
  // En WNS el "token" suele ser la channel URI completa
  const accessToken = await getWnsAccessToken();
  if (!accessToken) return { success: false, provider: 'wns', token: input.token, statusCode: 500, error: 'WNS no configurado' };
  // Notificación tipo toast en XML
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<toast><visual><binding template="ToastGeneric"><text>${input.title}</text><text>${input.body}</text></binding></visual></toast>`;
  try {
    const resp = await fetch(input.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-WNS-Type': 'wns/toast',
        'Authorization': `Bearer ${accessToken}`
      },
      body: xml
    });
    const ok = resp.ok;
    return { success: ok, provider: 'wns', token: input.token, statusCode: resp.status, error: ok ? undefined : (await resp.text()).slice(0, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, provider: 'wns', token: input.token, statusCode: 500, error: msg };
  }
}

async function sendTokenNotification(input: TokenSendInput): Promise<TokenSendResult> {
  const token = sanitizeToken(input.token);
  if (!token) return { success: false, provider: detectProvider('', input.provider), token: String(input.token || ''), statusCode: 400, error: 'Token inválido' };
  const provider = detectProvider(token, input.provider);
  const payloadData = input.data || {};
  if (provider === 'fcm') return sendViaFCM({ ...input, token, provider, data: payloadData });
  if (provider === 'expo') return sendViaExpo({ ...input, token, provider, data: payloadData });
  return sendViaWNS({ ...input, token, provider, data: payloadData });
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
    const bodyJson = await req.json();
    const { 
      orderId, 
      to_user_id,
      contact_id,
      newStatus,
      title,
      body,
      icon = '/img/android-chrome-192x192.png',
      data = {},
      // Tokens directos (FCM/Expo/WNS)
      to,
      token,
      tokens,
      provider
    } = bodyJson;
    
    if (!orderId && !to_user_id && !contact_id && !to && !token && !Array.isArray(tokens)) {
      await logDb(supabase, 'send-push-notification', 'warning', 'Solicitud sin destinatarios', { body: await req.clone().json().catch(() => ({})) });
      return jsonResponse({ error: 'Faltan destinatarios: orderId, to_user_id, contact_id, token(s) o to' }, 400, req);
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
    const directTokens: string[] = [];

    // RUTA 1: Envío directo por tokens (FCM / Expo / WNS)
    if (to || token || Array.isArray(tokens)) {
      const arr = ([] as string[]).concat(
        typeof to === 'string' ? [to] : [],
        typeof token === 'string' ? [token] : [],
        Array.isArray(tokens) ? tokens.filter((t: unknown) => typeof t === 'string') : []
      );
      for (const t of arr) { const s = sanitizeToken(t); if (s) directTokens.push(s); }
    }

    // RUTA 2: Web Push tradicional (subscriptions) si no hay tokens directos
    if (directTokens.length === 0 && orderId) {
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
    } else if (directTokens.length === 0 && to_user_id) {
      const subs = await fetchUserSubscriptions(supabase, String(to_user_id));
      pushSubscriptions = subs;
    } else if (directTokens.length === 0 && contact_id) {
      const { data: subsByContact } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('client_contact_id', String(contact_id));
      if (subsByContact && subsByContact.length > 0) {
        pushSubscriptions = subsByContact as Array<{ endpoint: string; keys: PushSubKeys }>;
      }
    }

    // Si hay tokens directos, enviar por proveedor correspondiente
    if (directTokens.length > 0) {
      const results: TokenSendResult[] = [];
      for (const t of directTokens) {
        const r = await sendTokenNotification({ token: t, provider, title: finalTitle, body: finalBody, data: { orderId, ...(data || {}) } });
        results.push(r);
      }
      const successCount = results.filter(r => r.success).length;
      return jsonResponse({ success: successCount > 0, results }, 200, req);
    }

    // Si no hay suscripciones para web push
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
