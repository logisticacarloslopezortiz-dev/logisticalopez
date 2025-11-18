/// <reference path="../globals.d.ts" />
import { createClient } from '@supabase/supabase-js';
import { handleCors, jsonResponse } from '../cors-config.ts';
import { setTimeout as delay } from "node:timers/promises";

type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

type QueryChain = {
  eq: (column: string, value: string | number) => QueryChain;
  is: (column: string, value: null) => QueryChain;
  order: (column: string, options: { ascending: boolean }) => QueryChain;
  limit: (n: number) => Promise<{ data?: unknown; error?: unknown }> | QueryChain;
  or: (spec: string) => QueryChain;
};

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => QueryChain;
    insert: (values: unknown) => Promise<{ data?: unknown; error?: unknown }>;
    update: (values: unknown) => { eq: (column: string, value: string | number) => Promise<{ data?: unknown; error?: unknown }> };
  };
};
type OutboxRow = { id: number; order_id: number; new_status: string | null; target_role: 'administrador' | 'colaborador' | 'cliente' | null; target_user_id: string | null; target_contact_id: string | null; payload: Record<string, unknown> | null; created_at: string; processed_at: string | null };

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

async function logDb(supabase: SupabaseClientLike, fn_name: string, level: 'info' | 'warning' | 'error', message: string, payload?: unknown) {
  try { await supabase.from('function_logs').insert({ fn_name, level, message, payload }); } catch (_) { void 0; }
}

async function sendWebPush(endpoint: string, payload: unknown, keys: { p256dh: string; auth: string }, attempts = 3): Promise<void> {
  const webpush = await import('web-push');
  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@tlc.com';
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('Faltan claves VAPID');
  webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  for (let i = 0; i < attempts; i++) {
    try {
      await webpush.default.sendNotification({ endpoint, keys }, JSON.stringify(payload), { TTL: 600 });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await delay(500); // espera 500ms antes de reintentar
    }
  }
}

function buildPayloadFromOutbox(row: OutboxRow) {
  const p = row.payload ?? {};
  const title = String(p['title'] ?? (row.new_status ? `Actualización de orden` : 'Notificación'));
  const body = String(p['body'] ?? (row.new_status ? `La orden #${row.order_id} cambió a ${row.new_status}` : ''));
  const icon = String(p['icon'] ?? 'https://logisticalopezortiz.com/img/android-chrome-192x192.png');
  const data = { orderId: row.order_id, newStatus: row.new_status, ...((p['data'] ?? {}) as Record<string, unknown>) };
  return { title, body, icon, data };
}

async function fetchSubscriptions(supabase: SupabaseClientLike, userId?: string, contactId?: string): Promise<WebPushSubscription[]> {
  const results: WebPushSubscription[] = [];
  const queries = [];

  if (userId) queries.push({ column: 'user_id', id: userId });
  if (contactId) queries.push({ column: 'client_contact_id', id: contactId });

  for (const q of queries) {
    const r = await (supabase as any).from('push_subscriptions').select('endpoint, keys, p256dh, auth').eq(q.column, q.id);
    const rows = r.data ?? [];
    for (const row of rows) {
      let keys: { p256dh?: string; auth?: string } | undefined;
      if (row.keys && typeof row.keys === 'string') {
        try { keys = JSON.parse(row.keys); } catch { keys = undefined; }
      } else if (row.keys && typeof row.keys === 'object') keys = row.keys;
      if (!keys?.p256dh) keys = { p256dh: row.p256dh, auth: row.auth };
      if (row.endpoint && keys?.p256dh && keys?.auth) results.push({ endpoint: row.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    }
    if (results.length > 0) break; // si encontramos algo, no seguimos con la otra query
  }

  return results;
}

async function processRow(supabase: SupabaseClientLike, row: OutboxRow): Promise<{ successCount: number; failCount: number }> {
  const { title, body, icon, data } = buildPayloadFromOutbox(row);
  let subscriptions: WebPushSubscription[] = [];
  await logDb(supabase, 'process-outbox', 'info', 'processing_start', { outboxId: row.id, orderId: row.order_id });

  try {
    if (row.target_role === 'administrador') {
      let adminIds: string[] = [];
      try {
        const { data: admins } = await (supabase as any).from('profiles').select('id, role').eq('role', 'administrador');
        adminIds = Array.isArray(admins) ? admins.map((a: any) => String(a.id)).filter(Boolean) : [];
      } catch (_) { /* perfiles sin role */ }
      if (adminIds.length === 0) {
        const { data: collabs } = await (supabase as any).from('collaborators').select('id').eq('role', 'administrador');
        adminIds = Array.isArray(collabs) ? collabs.map((c: any) => String(c.id)).filter(Boolean) : [];
      }
      if (adminIds.length > 0) {
        const r = await (supabase as any).from('push_subscriptions').select('endpoint, keys, p256dh, auth').in('user_id', adminIds);
        const rows = r.data ?? [];
        for (const rowS of rows) {
          let keys: { p256dh?: string; auth?: string } | undefined;
          if (rowS.keys && typeof rowS.keys === 'string') { try { keys = JSON.parse(rowS.keys); } catch { keys = undefined; } }
          else if (rowS.keys && typeof rowS.keys === 'object') keys = rowS.keys;
          if (!keys?.p256dh) keys = { p256dh: rowS.p256dh, auth: rowS.auth };
          if (rowS.endpoint && keys?.p256dh && keys?.auth) subscriptions.push({ endpoint: rowS.endpoint, keys: { p256dh: keys.p256dh!, auth: keys.auth! } });
        }
      }
    } else {
      const p = row.payload ?? {};
      const contactId = p['contactId'] ?? row.target_contact_id;
      const targetUserId = p['userId'] ?? row.target_user_id;
      subscriptions = await fetchSubscriptions(supabase, targetUserId as string, contactId as string);
    }
  } catch (err) {
    await logDb(supabase, 'process-outbox', 'error', 'fetch_subscriptions_fail', { outboxId: row.id, error: errToString(err) });
  }

  await logDb(supabase, 'process-outbox', 'info', 'subscriptions_fetched', { outboxId: row.id, count: subscriptions.length });

  if (subscriptions.length === 0) {
    await logDb(supabase, 'process-outbox', 'warning', 'no_subscriptions', { outboxId: row.id });
    return { successCount: 0, failCount: 0 };
  }

  const payload = { notification: { title, body, icon, vibrate: [100, 50, 100], data: { ...data } } };
  const results: Array<{ success: boolean; endpoint: string; error?: string }> = [];

  await Promise.all(subscriptions.map(async (sub) => {
    try { await sendWebPush(sub.endpoint, payload, sub.keys); results.push({ success: true, endpoint: sub.endpoint }); }
    catch (err) { results.push({ success: false, endpoint: sub.endpoint, error: errToString(err) }); }
  }));

  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;
  await logDb(supabase, 'process-outbox', 'info', 'processing_end', { outboxId: row.id, successCount, failCount });

  // Guardar notificación evitando duplicados por orderId, title y body
  try {
    const p = row.payload ?? {};
    const contactId = p['contactId'] ?? row.target_contact_id;
    const targetUserId = p['userId'] ?? row.target_user_id;
    const recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    if (targetUserId) {
      const { data: existing } = await (supabase as any).from('notifications').select('id').eq('user_id', targetUserId).eq('title', title).eq('body', body).filter('data->>orderId', 'eq', String(row.order_id)).gte('created_at', recentSince).limit(1);
      if (!existing || existing.length === 0) {
        await (supabase as any).from('notifications').insert({ user_id: targetUserId, title, body, data: { orderId: row.order_id, newStatus: row.new_status, results }, created_at: new Date().toISOString() });
      }
    } else if (contactId) {
      const { data: existingC } = await (supabase as any).from('notifications').select('id').eq('contact_id', contactId).eq('title', title).eq('body', body).filter('data->>orderId', 'eq', String(row.order_id)).gte('created_at', recentSince).limit(1);
      if (!existingC || existingC.length === 0) {
        await (supabase as any).from('notifications').insert({ contact_id: contactId, title, body, data: { orderId: row.order_id, newStatus: row.new_status, results }, created_at: new Date().toISOString() });
      }
    }
  } catch (err) {
    await logDb(supabase, 'process-outbox', 'warning', 'insert_notification_fail', { outboxId: row.id, error: errToString(err) });
  }

  return { successCount, failCount };
}

// Función principal Deno.serve
Deno.serve(async (req: Request) => {
  const cors = handleCors(req); if (cors) return cors;
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
    if (!SUPABASE_URL || !SUPABASE_KEY) return jsonResponse({ success: false, error: 'Faltan variables de entorno Supabase' }, 500);
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY) as unknown as SupabaseClientLike;

    await logDb(supabase, 'process-outbox', 'info', 'invoke_start', { scheduleSpec: '*/1 * * * * *' });

    const url = new URL(req.url);
    const path = url.pathname;
    let input: any = null; try { input = await req.json(); } catch (_) { void 0; }
    const onlyId = input?.id ?? input?.outboxId ?? null;

    let pending: OutboxRow[] = [];
    if (path.endsWith('/health') || url.searchParams.get('health') === '1') {
      const { data: logs } = await (supabase as any).from('function_logs').select('*').order('created_at', { ascending: false }).limit(10);
      return jsonResponse({ success: true, logs }, 200);
    }

    const query: any = (supabase as any).from('notification_outbox').select('*').order('created_at', { ascending: true }).limit(100);
    if (onlyId) query.eq('id', Number(onlyId));
    else if (input?.orderId) query.eq('order_id', Number(input.orderId)).is('processed_at', null);
    else query.or('processed_at.is.null,new_status.eq.Pendiente');

    const { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: errToString(error) }, 200);
    pending = data ?? [];

    // Procesamiento paralelo limitado a 5 filas a la vez
    const limit = 5;
    for (let i = 0; i < pending.length; i += limit) {
      const chunk = pending.slice(i, i + limit);
      const summaries = await Promise.all(chunk.map(async (row) => {
        try { return await processRow(supabase, row); }
        catch (err) { await logDb(supabase, 'process-outbox', 'error', 'processRow_fail', { outboxId: row.id, error: errToString(err) }); return null; }
      }));
      // actualizar processed_at y status de todas las filas del chunk
      await Promise.all(chunk.map(async (row) => {
        const processedAt = new Date().toISOString();
        try {
          const idx = chunk.indexOf(row);
          const sum = summaries[idx];
          const statusOp = sum && sum.successCount > 0 ? 'Procesado' : 'Error';
          await (supabase as any).from('notification_outbox').update({ processed_at: processedAt, status: statusOp }).eq('id', row.id);
        } catch (_) { void 0; }
      }));
    }

    await logDb(supabase, 'process-outbox', 'info', 'invoke_end', { processed: pending.length });
    return jsonResponse({ success: true, processed: pending.length });
  } catch (error) {
    return jsonResponse({ success: false, error: errToString(error) }, 200);
  }
});
