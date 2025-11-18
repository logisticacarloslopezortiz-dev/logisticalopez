/// <reference path="../globals.d.ts" />
import { createClient } from '@supabase/supabase-js';
import { handleCors, jsonResponse } from '../cors-config.ts';

// Suscripción Web Push: endpoint y claves p256dh/auth
type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

// Fila de outbox a procesar
type OutboxRow = {
  id: number;
  order_id: number;
  new_status: string | null;
  target_role: 'administrador' | 'colaborador' | 'cliente' | null;
  target_user_id: string | null; // puede ser user_id o client_contact_id
  target_contact_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  processed_at: string | null;
};

// Tipado básico para construir consultas
type QueryBuilder<T> = {
  eq: (column: string, value: string | number) => QueryBuilder<T>;
  in: (column: string, values: string[]) => QueryBuilder<T>;
  is: (column: string, value: null) => QueryBuilder<T>;
  order: (column: string, options: { ascending: boolean }) => QueryBuilder<T>;
  limit: (n: number) => Promise<{ data?: T[]; error?: unknown }>;
  single: () => Promise<{ data?: T; error?: unknown }>;
  maybeSingle: () => Promise<{ data?: T; error?: unknown }>;
};

// Cliente Supabase minimalista para Deno Edge
type SupabaseClientLike = {
  from: (table: string) => {
    insert: (values: unknown) => Promise<{ data?: unknown; error?: unknown }>;
    select: (columns: string) => QueryBuilder<unknown>;
    update: (values: unknown) => { eq: (column: string, value: number) => Promise<{ data?: unknown; error?: unknown }> };
    delete?: () => { eq: (column: string, value: string) => Promise<{ data?: unknown; error?: unknown }> };
  };
};

// Utilidad: serializar errores
function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// Clasificación del evento para trazabilidad
function classifyEvent(row: OutboxRow): string {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const data = (p['data'] ?? {}) as Record<string, unknown>;
  const title = typeof p['title'] === 'string' ? (p['title'] as string).toLowerCase() : '';
  const body = typeof p['body'] === 'string' ? (p['body'] as string).toLowerCase() : '';
  if (row.new_status) return 'status_change';
  if ('estimated_price' in data) return 'price_update';
  if ('monto_cobrado' in data || 'amount' in data) return 'amount_update';
  if ('evidence' in data || 'evidence_photos' in data) return 'evidence_upload';
  if (title.includes('solicitud') || body.includes('solicitud')) return 'order_creation';
  if (body.includes('retraso') || body.includes('cancel') || body.includes('aviso')) return 'alert_update';
  return 'generic';
}

// Registro de eventos en tabla function_logs para auditoría
async function logDb(
  supabase: SupabaseClientLike,
  fn_name: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload?: unknown
) {
  try { await supabase.from('function_logs').insert({ fn_name, level, message, payload }); } catch (_) { void 0; }
}

// Envío Web Push usando claves VAPID del entorno
async function sendWebPush(endpoint: string, payload: unknown, keys: { p256dh: string; auth: string }) {
  const webpush = await import('web-push');
  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@tlc.com';
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('Faltan claves VAPID');
  webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const subscription = { endpoint, keys } as WebPushSubscription;
  // TTL debe ser no negativo
  return await webpush.default.sendNotification(subscription, JSON.stringify(payload), { TTL: 600 });
}

// Obtener suscripciones por usuario del sistema
async function fetchUserSubscriptions(supabase: SupabaseClientLike, userId: string): Promise<WebPushSubscription[]> {
  const results: WebPushSubscription[] = [];
  const r1 = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId);
  const rows1 = ((r1 as unknown as { data?: Array<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } | string }> }).data) || [];
  for (const row of rows1) {
    let k = row.keys as { p256dh?: string; auth?: string } | string | undefined;
    if (typeof k === 'string') {
      try { k = JSON.parse(k) as { p256dh?: string; auth?: string }; } catch { k = undefined; }
    }
    if (row.endpoint && k?.p256dh && k?.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: k.p256dh as string, auth: k.auth as string } });
  }
  if (results.length > 0) return results;
  const r2 = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  const rows2 = ((r2 as unknown as { data?: Array<{ endpoint?: string; p256dh?: string; auth?: string }> }).data) || [];
  for (const row of rows2) {
    if (row.endpoint && row.p256dh && row.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: row.p256dh as string, auth: row.auth as string } });
  }
  return results;
}

// Obtener suscripciones por contacto/cliente no autenticado
async function fetchContactSubscriptions(supabase: SupabaseClientLike, contactId: string): Promise<WebPushSubscription[]> {
  const results: WebPushSubscription[] = [];
  const r1 = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('client_contact_id', contactId);
  const rows1 = ((r1 as unknown as { data?: Array<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } | string }> }).data) || [];
  for (const row of rows1) {
    let k = row.keys as { p256dh?: string; auth?: string } | string | undefined;
    if (typeof k === 'string') {
      try { k = JSON.parse(k) as { p256dh?: string; auth?: string }; } catch { k = undefined; }
    }
    if (row.endpoint && k?.p256dh && k?.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: k.p256dh as string, auth: k.auth as string } });
  }
  if (results.length > 0) return results;
  const r2 = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('client_contact_id', contactId);
  const rows2 = ((r2 as unknown as { data?: Array<{ endpoint?: string; p256dh?: string; auth?: string }> }).data) || [];
  for (const row of rows2) {
    if (row.endpoint && row.p256dh && row.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: row.p256dh as string, auth: row.auth as string } });
  }
  return results;
}

// Construye el payload de la notificación desde la fila del outbox
function buildPayloadFromOutbox(row: OutboxRow): { title: string; body: string; icon: string; data: Record<string, unknown> } {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const title = String(p['title'] ?? (row.new_status ? `Actualización de orden` : 'Notificación'));
  const body = String(p['body'] ?? (row.new_status ? `La orden #${row.order_id} cambió a ${row.new_status}` : ''));
  const icon = String(p['icon'] ?? 'https://logisticalopezortiz.com/img/android-chrome-192x192.png');
  const data = { orderId: row.order_id, newStatus: row.new_status, ...((p['data'] ?? {}) as Record<string, unknown>) };
  return { title, body, icon, data };
}

// Procesa una fila de notification_outbox: resuelve destinatarios, envía push y registra
async function processRow(supabase: SupabaseClientLike, row: OutboxRow) {
  const { title, body, icon, data } = buildPayloadFromOutbox(row);
  const startedAt = Date.now();
  const eventType = classifyEvent(row);
  await logDb(supabase, 'process-outbox', 'info', 'processing_start', {
    outboxId: row.id,
    orderId: row.order_id,
    eventType,
    targetRole: row.target_role,
    scheduleSpec: '*/1 * * * * *',
    latencyMs: typeof row.created_at === 'string' ? Math.max(0, Date.now() - Date.parse(row.created_at)) : null,
  });
  let subscriptions: WebPushSubscription[] = [];

  // Roles administradores: usar profiles con role='administrador' si existe; fallback a collaborators
  if (row.target_role === 'administrador') {
    let adminIds: string[] = [];
    try {
      const { data: admins, error: pErr } = await (supabase as any)
        .from('profiles')
        .select('id, role')
        .eq('role', 'administrador');
      if (!pErr && Array.isArray(admins)) adminIds = admins.map((a: any) => String(a.id)).filter(Boolean);
    } catch (_) { /* puede que profiles.role no exista */ }
    if (adminIds.length === 0) {
      const { data: collabs, error } = await (supabase as any)
        .from('collaborators')
        .select('id')
        .eq('role', 'administrador');
      if (error) throw new Error('No se pudieron obtener administradores');
      adminIds = Array.isArray(collabs) ? collabs.map((c: any) => String(c.id)).filter(Boolean) : [];
    }
    if (adminIds.length === 0) throw new Error('Sin destinatarios administradores');
    const { data: subs, error: subsErr } = await (supabase as any)
      .from('push_subscriptions')
      .select('endpoint, keys')
      .in('user_id', adminIds);
    if (subsErr) throw new Error(`No se pudieron obtener suscripciones: ${errToString(subsErr)}`);
    subscriptions = Array.isArray(subs) ? (subs as unknown as WebPushSubscription[]) : [];
  } else {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const contactId = p['contactId'] ? String(p['contactId']) : (row.target_contact_id ? String(row.target_contact_id) : null);
    const userId = p['userId'] ? String(p['userId']) : (row.target_user_id ? String(row.target_user_id) : null);
    if (contactId) {
      subscriptions = await fetchContactSubscriptions(supabase, contactId);
    } else if (userId) {
      subscriptions = await fetchUserSubscriptions(supabase, userId);
      if (subscriptions.length === 0) {
        const idMaybe = String(userId);
        const alt = await fetchContactSubscriptions(supabase, idMaybe);
        if (alt.length > 0) subscriptions = alt;
      }
    }
  }

  await logDb(supabase, 'process-outbox', 'info', 'subscriptions_fetched', {
    outboxId: row.id,
    count: subscriptions.length,
    eventType,
  });
  if (subscriptions.length === 0) {
    await logDb(supabase, 'process-outbox', 'warning', 'no_subscriptions', { outboxId: row.id, eventType });
    return;
  }

  const payload = {
    notification: {
      title,
      body,
      icon,
      vibrate: [100, 50, 100],
      data: { ...data, timestamp: new Date().toISOString() },
    },
  };

  const results: Array<{ success: boolean; endpoint: string; error?: string }> = [];
  for (const sub of subscriptions) {
    try {
      await sendWebPush(sub.endpoint, payload, sub.keys);
      results.push({ success: true, endpoint: sub.endpoint });
    } catch (err) {
      results.push({ success: false, endpoint: sub.endpoint, error: errToString(err) });
      await logDb(supabase, 'process-outbox', 'error', 'send_fail', { outboxId: row.id, endpoint: sub.endpoint, error: errToString(err), eventType });
    }
  }

  const durationMs = Date.now() - startedAt;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;
  await logDb(supabase, 'process-outbox', 'info', 'processing_end', {
    outboxId: row.id,
    orderId: row.order_id,
    eventType,
    durationMs,
    successCount,
    failCount,
    scheduleSpec: '*/1 * * * * *'
  });

  // Persistencia de notificación en la tabla notifications
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const contactId = p['contactId'] ? String(p['contactId']) : (row.target_contact_id ? String(row.target_contact_id) : null);
  const targetUserId = p['userId'] ? String(p['userId']) : (row.target_user_id ? String(row.target_user_id) : null);

  // Caso usuario del sistema
  if (targetUserId) {
    try {
      const { data: userExists } = await (supabase as any)
        .from('profiles')
        .select('id')
        .eq('id', targetUserId)
        .limit(1);
      const isValidUser = Array.isArray(userExists) && userExists.length > 0;
      if (!isValidUser) {
        await logDb(supabase, 'process-outbox', 'warning', 'skip_notifications_non_user', { targetUserId, outboxId: row.id });
      } else {
        const recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: existing } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', targetUserId)
          .eq('title', title)
          .eq('body', body)
          .filter('data->>orderId', 'eq', String(row.order_id))
          .gte('created_at', recentSince)
          .limit(1);
        const hasDup = Array.isArray(existing) && existing.length > 0;
        if (!hasDup) {
          await supabase.from('notifications').insert({
            user_id: targetUserId,
            title,
            body,
            data: { orderId: row.order_id, newStatus: row.new_status, results },
            created_at: new Date().toISOString(),
          });
        } else {
          await logDb(supabase, 'process-outbox', 'info', 'skip_duplicate_notification', { user_id: targetUserId, order_id: row.order_id, title });
        }
      }
    } catch (_) { /* evitar romper flujo */ }
  }

  // Caso contacto/cliente no autenticado: insertar usando contact_id
  if (!targetUserId && contactId) {
    try {
      const recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: existingC } = await (supabase as any)
        .from('notifications')
        .select('id')
        .eq('contact_id', contactId)
        .eq('title', title)
        .eq('body', body)
        .filter('data->>orderId', 'eq', String(row.order_id))
        .gte('created_at', recentSince)
        .limit(1);
      const hasDupC = Array.isArray(existingC) && existingC.length > 0;
      if (!hasDupC) {
        await supabase.from('notifications').insert({
          contact_id: contactId,
          title,
          body,
          data: { orderId: row.order_id, newStatus: row.new_status, results },
          created_at: new Date().toISOString(),
        });
      } else {
        await logDb(supabase, 'process-outbox', 'info', 'skip_duplicate_notification_contact', { contact_id: contactId, order_id: row.order_id, title });
      }
    } catch (e) {
      await logDb(supabase, 'process-outbox', 'warning', 'contact_notification_insert_fail', { error: errToString(e), contact_id: contactId, outboxId: row.id });
    }
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return jsonResponse({ success: false, error: 'Config del servidor incompleta' }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE) as unknown as SupabaseClientLike;

    let input: any = null;
    try { input = await req.json(); } catch (_) { input = null; }
    const onlyId = input?.id ?? input?.outboxId ?? null;

    let pending: OutboxRow[] | undefined;
    let error: unknown | undefined;
    if (onlyId) {
      const r = await (supabase as any)
        .from('notification_outbox')
        .select('*')
        .eq('id', Number(onlyId))
        .limit(1);
      pending = (r?.data ?? []) as OutboxRow[];
      error = r?.error;
    } else {
      const r = await supabase
        .from('notification_outbox')
        .select('*')
        .is('processed_at', null)
        .order('created_at', { ascending: true })
        .limit(100);
      pending = (r.data ?? []) as OutboxRow[];
      error = r.error;
    }
    if (error) {
      await logDb(supabase, 'process-outbox', 'error', 'Error consultando outbox', { error: errToString(error) });
      return jsonResponse({ success: false, error: 'Error consultando outbox' }, 200);
    }

    const rows = pending ?? [];
    for (const row of rows) {
      try {
        await processRow(supabase, row);
      } catch (err) {
        await logDb(supabase, 'process-outbox', 'error', 'Error procesando outbox row', { outboxId: row.id, error: errToString(err) });
      } finally {
        // Marcar processed_at incluso si hubo error, para evitar bloqueos
        try {
          await supabase
            .from('notification_outbox')
            .update({ processed_at: new Date().toISOString() })
            .eq('id', row.id);
        } catch (_) { /* evitar romper el bucle */ }
      }
    }

    return jsonResponse({ success: true, processed: rows.length });
  } catch (error) {
    const msg = errToString(error);
    return jsonResponse({ success: false, error: msg }, 200);
  }
});