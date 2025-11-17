/// <reference path="../globals.d.ts" />
import { createClient } from '@supabase/supabase-js';
import { handleCors, jsonResponse } from '../cors-config.ts';

type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

type OutboxRow = {
  id: number;
  order_id: number;
  new_status: string | null;
  target_role: 'administrador' | 'colaborador' | 'cliente' | null;
  target_user_id: string | null; // puede ser user_id o client_contact_id
  payload: Record<string, unknown> | null;
  created_at: string;
  processed_at: string | null;
};

type QueryBuilder<T> = {
  eq: (column: string, value: string | number) => QueryBuilder<T>;
  in: (column: string, values: string[]) => QueryBuilder<T>;
  is: (column: string, value: null) => QueryBuilder<T>;
  order: (column: string, options: { ascending: boolean }) => QueryBuilder<T>;
  limit: (n: number) => Promise<{ data?: T[]; error?: unknown }>;
  single: () => Promise<{ data?: T; error?: unknown }>;
  maybeSingle: () => Promise<{ data?: T; error?: unknown }>;
};

type SupabaseClientLike = {
  from: (table: string) => {
    insert: (values: unknown) => Promise<{ data?: unknown; error?: unknown }>;
    select: (columns: string) => QueryBuilder<unknown>;
    update: (values: unknown) => { eq: (column: string, value: number) => Promise<{ data?: unknown; error?: unknown }> };
  };
};

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

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

async function logDb(
  supabase: SupabaseClientLike,
  fn_name: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload?: unknown
) {
  try { await supabase.from('function_logs').insert({ fn_name, level, message, payload }); } catch (_) { void 0; }
}

async function sendPush(subscription: WebPushSubscription, payload: unknown) {
  const webpush = await import('web-push');
  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@tlc.com';
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('Faltan claves VAPID');
  webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return await webpush.default.sendNotification(subscription, JSON.stringify(payload), { TTL: 600 });
}

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

function buildPayloadFromOutbox(row: OutboxRow): { title: string; body: string; icon: string; data: Record<string, unknown> } {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const title = String(p['title'] ?? (row.new_status ? `Actualización de orden` : 'Notificación'));
  const body = String(p['body'] ?? (row.new_status ? `La orden #${row.order_id} cambió a ${row.new_status}` : ''));
  const icon = String(p['icon'] ?? 'https://logisticalopezortiz.com/img/android-chrome-192x192.png');
  const data = { orderId: row.order_id, newStatus: row.new_status, ...((p['data'] ?? {}) as Record<string, unknown>) };
  return { title, body, icon, data };
}

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

  if (row.target_role === 'administrador' || row.target_role === 'colaborador') {
    const role = row.target_role;
    const { data: collabs, error } = await supabase
      .from('collaborators')
      .select('id, role')
      .eq('role', role);
    if (error) throw new Error(`No se pudieron obtener colaboradores para rol ${role}`);
    const list = Array.isArray(collabs) ? (collabs as Array<{ id?: string }>) : [];
    const ids = list.map((c) => String(c.id || '')).filter(Boolean);
    if (ids.length === 0) throw new Error(`Sin destinatarios para rol ${role}`);
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .in('user_id', ids);
    if (subsErr) throw new Error(`No se pudieron obtener suscripciones: ${errToString(subsErr)}`);
    subscriptions = Array.isArray(subs) ? (subs as unknown as WebPushSubscription[]) : [];
  } else {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const contactId = p['contactId'] ? String(p['contactId']) : null;
    const userId = p['userId'] ? String(p['userId']) : (row.target_user_id ? String(row.target_user_id) : null);
    if (contactId) {
      subscriptions = await fetchContactSubscriptions(supabase, contactId);
    } else if (userId) {
      subscriptions = await fetchUserSubscriptions(supabase, userId);
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
      await sendPush(sub, payload);
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

  const targetUserId = row.target_user_id ?? null;
  if (targetUserId) {
    try {
      await supabase.from('notifications').insert({
        user_id: targetUserId,
        title,
        body,
        data: { orderId: row.order_id, newStatus: row.new_status, results },
        created_at: new Date().toISOString(),
      });
    } catch (_) { void 0; }
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

    const { data: pending, error } = await supabase
      .from('notification_outbox')
      .select('*')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) {
      await logDb(supabase, 'process-outbox', 'error', 'Error consultando outbox', { error: errToString(error) });
      return jsonResponse({ success: false, error: 'Error consultando outbox' }, 200);
    }

    const rows = (pending ?? []) as OutboxRow[];
    for (const row of rows) {
      try {
        await processRow(supabase, row);
        await supabase
          .from('notification_outbox')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', row.id);
      } catch (err) {
        await logDb(supabase, 'process-outbox', 'error', 'Error procesando outbox row', { outboxId: row.id, error: errToString(err) });
      }
    }

    return jsonResponse({ success: true, processed: rows.length });
  } catch (error) {
    const msg = errToString(error);
    return jsonResponse({ success: false, error: msg }, 200);
  }
});