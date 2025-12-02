/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders as _corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type NotifyRoleRequest = {
  role: 'administrador' | 'colaborador' | 'cliente';
  orderId: number | string;
  title?: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  targetIds?: string[]; // opcional: limitar a usuarios específicos (UUIDs de auth)
};

function logDebug(message: string, data?: unknown) {
  console.log(`[notify-role] ${message}`, data ? JSON.stringify(data) : '');
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

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function sendPush(subscription: WebPushSubscription, payload: unknown) {
  const webpush = await import('https://esm.sh/web-push@3.6.1');
  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@tlc.com';

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('Faltan claves VAPID en el servidor');
  }

  webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return await webpush.default.sendNotification(subscription, JSON.stringify(payload));
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed' }, 200);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return jsonResponse({ success: false, error: 'Error de configuración del servidor' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = (await req.json()) as NotifyRoleRequest;
    const {
      role,
      orderId,
      title = 'Actualización de TLC',
      body: messageBody,
      icon = '/img/android-chrome-192x192.png',
      data = {},
      targetIds = [],
    } = body;

    if (!role || !orderId || !messageBody) {
      await logDb(supabase, 'notify-role', 'warning', 'Body o campos requeridos faltantes', { role, orderId });
      return jsonResponse({ success: false, error: 'role, orderId y body son requeridos' }, 200);
    }

    // Resolver destinatarios según rol
    const _recipientUserIds: string[] = [];

    if (role === 'cliente') {
      // Notificar al cliente de la orden (soporta user_id y client_contact_id)
      const { data: order, error } = await supabase
        .from('orders')
        .select('client_id, client_contact_id')
        .eq('id', orderId)
        .maybeSingle();
      if (error) {
        logDebug('Error obteniendo orden para cliente', { error: errorToString(error) });
        await logDb(supabase, 'notify-role', 'warning', 'Error obteniendo orden para cliente', { orderId, error: errorToString(error) });
      }

      // Intentar subscripciones por client_id y luego por client_contact_id
      let subscriptions: WebPushSubscription[] = [];
      if (order?.client_id) {
        const { data: subsByUser } = await supabase
          .from('push_subscriptions')
          .select('endpoint, keys')
          .eq('user_id', order.client_id);
        if (Array.isArray(subsByUser) && subsByUser.length > 0) {
          subscriptions = subsByUser as WebPushSubscription[];
        }
      }
      if (subscriptions.length === 0 && order?.client_contact_id) {
        const { data: subsByContact } = await supabase
          .from('push_subscriptions')
          .select('endpoint, keys')
          .eq('client_contact_id', order.client_contact_id);
        if (Array.isArray(subsByContact) && subsByContact.length > 0) {
          subscriptions = subsByContact as WebPushSubscription[];
        }
      }

      if (subscriptions.length === 0) {
        await logDb(supabase, 'notify-role', 'info', 'Cliente sin suscripciones', { orderId });
        return jsonResponse({ success: false, message: 'Cliente sin suscripciones' }, 200);
      }

      const payload = {
        notification: {
          title,
          body: messageBody,
          icon,
          vibrate: [100, 50, 100],
          data: { orderId, role, timestamp: new Date().toISOString(), ...data },
        },
      };

      const results: Array<{ success: boolean; endpoint: string; error?: string }> = [];
      for (const sub of subscriptions) {
        try {
          await sendPush(sub, payload);
          results.push({ success: true, endpoint: sub.endpoint });
        } catch (err) {
          results.push({ success: false, endpoint: sub.endpoint, error: errorToString(err) });
          await logDb(supabase, 'notify-role', 'error', 'Fallo envío web-push', { endpoint: sub.endpoint, bodySent: payload, error: errorToString(err) });
        }
      }

      await supabase.from('notifications').insert({
        user_id: order?.client_id ?? null,
        title,
        body: messageBody,
        data: { orderId, role, results },
        created_at: new Date().toISOString(),
      });

      return jsonResponse({ success: results.some(r => r.success), results }, 200);
    }

    // Roles: administrador / colaborador
    const { data: collabs, error: collabErr } = await supabase
      .from('collaborators')
      .select('id, role')
      .eq('role', role);
    if (collabErr) {
      logDebug('Error consultando colaboradores', { error: errorToString(collabErr) });
      await logDb(supabase, 'notify-role', 'error', 'Error consultando colaboradores', { role, error: errorToString(collabErr) });
      return jsonResponse({ success: false, error: 'No se pudieron obtener colaboradores' }, 200);
    }

    const collabRows = (collabs ?? []) as Array<{ id: string; role: string }>;
    let ids = collabRows.map((c: { id: string }) => String(c.id)).filter((id: string) => Boolean(id));
    if (Array.isArray(targetIds) && targetIds.length > 0) {
      const set = new Set(targetIds);
      ids = ids.filter((id: string) => set.has(id));
    }

    if (ids.length === 0) {
      await logDb(supabase, 'notify-role', 'info', 'No hay destinatarios para el rol solicitado', { role });
      return jsonResponse({ success: false, message: 'No hay destinatarios para el rol solicitado' }, 200);
    }

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, keys')
      .in('user_id', ids);
    if (subsErr) {
      logDebug('Error obteniendo suscripciones', { error: errorToString(subsErr) });
      await logDb(supabase, 'notify-role', 'error', 'Error obteniendo suscripciones', { role, error: errorToString(subsErr) });
      return jsonResponse({ success: false, error: 'No se pudieron obtener suscripciones' }, 200);
    }

    const subRows = (subs ?? []) as Array<{ user_id: string; endpoint: string; keys: { p256dh: string; auth: string } }>;
    const subscriptions = subRows.map((s) => ({ endpoint: s.endpoint, keys: s.keys })) as WebPushSubscription[];
    if (subscriptions.length === 0) {
      await logDb(supabase, 'notify-role', 'info', 'No hay suscripciones para el rol', { role, ids });
      return jsonResponse({ success: false, message: 'No hay suscripciones para el rol' }, 200);
    }

    const payload = {
      notification: {
        title,
        body: messageBody,
        icon,
        vibrate: [100, 50, 100],
        data: { orderId, role, timestamp: new Date().toISOString(), ...data },
      },
    };

    const results: Array<{ success: boolean; endpoint: string; error?: string }> = [];
    for (const sub of subscriptions) {
      try {
        await sendPush(sub, payload);
        results.push({ success: true, endpoint: sub.endpoint });
      } catch (err) {
        results.push({ success: false, endpoint: sub.endpoint, error: errorToString(err) });
        await logDb(supabase, 'notify-role', 'error', 'Fallo envío web-push', { endpoint: sub.endpoint, bodySent: payload, error: errorToString(err) });
      }
    }

    await supabase.from('notifications').insert({
      user_id: null,
      title,
      body: messageBody,
      data: { orderId, role, results },
      created_at: new Date().toISOString(),
    });

    const successCount = results.filter(r => r.success).length;
    return jsonResponse({ success: successCount > 0, sent: successCount, total: results.length, results }, 200);

  } catch (error) {
    const msg = errorToString(error);
    logDebug('Fallo en notify-role', { error: msg });
    try {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
        await logDb(supabase, 'notify-role', 'error', msg, {});
      }
    } catch (_) { void 0; }
    return jsonResponse({ success: false, error: msg }, 200);
  }
});
