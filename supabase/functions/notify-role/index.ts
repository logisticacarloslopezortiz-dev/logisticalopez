/// <reference path="../globals.d.ts" />
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders as _corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// -------------------------------
// Tipos
// -------------------------------
type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type NotifyRoleRequest = {
  role: 'administrador' | 'colaborador' | 'cliente' | 'admin' | 'worker';
  orderId: number | string;
  title?: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  targetIds?: string[];
};

// -------------------------------
// Logs
// -------------------------------
function logDebug(msg: string, data?: unknown) {
  console.log(`[notify-role] ${msg}`, data ? JSON.stringify(data) : '');
}

async function logDb(supabase: SupabaseClient, fn: string, level: 'info' | 'warning' | 'error', msg: string, payload?: unknown) {
  try {
    await supabase.from('function_logs').insert({
      fn_name: fn,
      level,
      message: msg,
      payload
    });
  } catch {}
}

function errorToString(err: unknown) {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// -------------------------------
// Enviar PUSH
// -------------------------------
async function sendPush(sub: WebPushSubscription, payload: unknown) {
  const webpush = await import('jsr:@negrel/webpush');

  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_JWK = Deno.env.get('VAPID_JWK');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@tlc.com';

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('Faltan claves VAPID en el servidor');
  }

  let vapidKeys: any;
  try {
    vapidKeys = VAPID_JWK ? webpush.importVapidKeys(JSON.parse(VAPID_JWK)) : { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
  } catch (_) {
    vapidKeys = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
  }

  const appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys });
  const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  return await appServer.push(subscription as any, JSON.stringify(payload), { ttl: 2592000 });
}

// ===============================================================
//   SERVIDOR PRINCIPAL
// ===============================================================
Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  // --------------------------------------------
  // Supabase
  // --------------------------------------------
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return jsonResponse({ success: false, error: 'Error de configuración del servidor' }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  try {
    const body = (await req.json()) as NotifyRoleRequest;

    const {
      role,
      orderId,
      title = 'Actualización de TLC',
      body: messageBody,
      icon = '/img/android-chrome-192x192.png',
      data = {},
      targetIds = []
    } = body;

    if (!role || !orderId || !messageBody) {
      await logDb(supabase, 'notify-role', 'warning', 'Campos requeridos faltantes', { role, orderId });
      return jsonResponse({ success: false, error: 'role, orderId y body son requeridos' }, 400);
    }

    const normalizedRole =
      role === 'admin' ? 'administrador' :
      role === 'worker' ? 'colaborador' :
      role;

    // ===================================================================
    //  CASO 1: CLIENTE
    // ===================================================================
    if (normalizedRole === 'cliente') {
      const { data: order, error } = await supabase
        .from('orders')
        .select('client_id, client_contact_id')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        await logDb(supabase, 'notify-role', 'error', 'Error obteniendo orden para cliente', { orderId, error });
        return jsonResponse({ success: false, error: 'No se pudo obtener información del cliente' }, 500);
      }

      let subscriptions: WebPushSubscription[] = [];

      // Preferencia: user_id
      if (order?.client_id) {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, keys')
          .eq('user_id', order.client_id);

        if (subs) subscriptions = subs as WebPushSubscription[];
      }

      // fallback: client_contact_id
      if (subscriptions.length === 0 && order?.client_contact_id) {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, keys')
          .eq('client_contact_id', order.client_contact_id);

        if (subs) subscriptions = subs as WebPushSubscription[];
      }

      if (subscriptions.length === 0) {
        return jsonResponse({ success: false, message: 'Cliente sin suscripciones' }, 200);
      }

      const payload = {
        notification: {
          title,
          body: messageBody,
          icon,
          vibrate: [100, 50, 100],
          data: { orderId, role: normalizedRole, ...data }
        }
      };

      const results = [];
      for (const sub of subscriptions) {
        try {
          await sendPush(sub, payload);
          results.push({ success: true, endpoint: sub.endpoint });
        } catch (err) {
          const code = (err as any)?.statusCode;
          if (code === 404 || code === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          results.push({ success: false, endpoint: sub.endpoint, error: errorToString(err) });
        }
      }

      await supabase.from('notifications').insert({
        user_id: order?.client_id ?? null,
        title,
        body: messageBody,
        data: { orderId, role: normalizedRole },
        created_at: new Date().toISOString()
      });

      return jsonResponse({ success: results.some(r => r.success), results }, 200);
    }

    // ===================================================================
    //  CASO 2: ADMIN / COLABORADOR
    // ===================================================================
    const { data: collabs, error: collabErr } = await supabase
      .from('collaborators')
      .select('id, role')
      .eq('role', normalizedRole);

    if (collabErr) {
      await logDb(supabase, 'notify-role', 'error', 'Error consultando colaboradores', { normalizedRole });
      return jsonResponse({ success: false, error: 'No se pudieron obtener colaboradores' }, 500);
    }

    let ids = (collabs ?? []).map(c => String(c.id));

    if (targetIds.length > 0) {
      ids = ids.filter(id => targetIds.includes(id));
    }

    if (ids.length === 0) {
      return jsonResponse({ success: false, message: 'No hay destinatarios' }, 200);
    }

    const { data: subsRows } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .in('user_id', ids);

    const subscriptions = (subsRows ?? []) as WebPushSubscription[];
    if (subscriptions.length === 0) {
      return jsonResponse({ success: false, message: 'No hay suscripciones para el rol' }, 200);
    }

    const payload = {
      notification: {
        title,
        body: messageBody,
        icon,
        vibrate: [100, 50, 100],
        data: { orderId, role: normalizedRole, ...data }
      }
    };

    const results = [];
    for (const sub of subscriptions) {
      try {
        await sendPush(sub, payload);
        results.push({ success: true, endpoint: sub.endpoint });
      } catch (err) {
        const code = (err as any)?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        results.push({ success: false, endpoint: sub.endpoint, error: errorToString(err) });
      }
    }

    return jsonResponse(
      {
        success: results.some(r => r.success),
        sent: results.filter(r => r.success).length,
        total: results.length,
        results
      },
      200
    );

  } catch (error) {
    const msg = errorToString(error);
    await logDb(supabase, 'notify-role', 'error', msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
