// Edge Function: send-push
// Single entry point to send Web Push immediately to a user or contact.
// Security: requires Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webPush from 'https://esm.sh/jsr/@negrel/webpush';

type SubscriptionKeys = { p256dh: string; auth: string };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@logisticalopezortiz.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function normalizeKeys(raw: unknown): SubscriptionKeys | null {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const p256dh = (obj as any)?.p256dh;
    const auth = (obj as any)?.auth;
    if (!isString(p256dh) || !isString(auth)) return null;
    return { p256dh, auth };
  } catch {
    return null;
  }
}

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: 'bad_request', message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sendWebPush(endpoint: string, keys: SubscriptionKeys, payload: Record<string, unknown>) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys not configured');
  }

  await webPush.sendNotification(
    { endpoint, keys },
    JSON.stringify(payload),
    {
      vapidDetails: {
        subject: VAPID_SUBJECT,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
      },
      TTL: 60 * 60 * 24 * 7,
    }
  );

  return { ok: true };
}

function requireServiceRole(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? '';
  if (!SUPABASE_SERVICE_ROLE_KEY) return false;
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  return auth === expected;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Strict: only SRK can invoke.
  if (!requireServiceRole(req)) return unauthorized();

  let json: any;
  try {
    json = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const user_id: string | null = json.user_id ?? null;
  const contact_id: string | null = json.contact_id ?? null;
  const title: string | null = json.title ?? null;
  const body: string | null = json.body ?? null;
  const data: Record<string, unknown> | null = json.data ?? null;

  if (!title || !body) {
    return badRequest('title and body are required');
  }
  if (!user_id && !contact_id) {
    return badRequest('Provide user_id or contact_id');
  }

  const orFilter = [] as string[];
  if (user_id) orFilter.push(`user_id.eq.${user_id}`);
  if (contact_id) orFilter.push(`client_contact_id.eq.${contact_id}`);

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .or(orFilter.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('DB error', error);
    return new Response(JSON.stringify({ error: 'db_error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!subs) {
    return new Response(JSON.stringify({ error: 'no_subscription' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const keys = normalizeKeys(subs.keys);
  const endpoint = String(subs.endpoint ?? '').trim().replace(/`/g, '');
  if (!keys || !endpoint) {
    return new Response(JSON.stringify({ error: 'invalid_subscription_keys' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = { title, body, data };
    const result = await sendWebPush(endpoint, keys, payload);
    if (result.ok) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'send_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Push error', e);
    const status = (e as any)?.statusCode ?? (e as any)?.status ?? null;
    const message = String((e as any)?.message ?? e ?? '');
    if (
      (status === 404 || status === 410) ||
      message.includes('404') ||
      message.includes('410')
    ) {
      try {
        if ((subs as any)?.id) {
          await supabase.from('push_subscriptions').delete().eq('id', (subs as any).id);
        } else {
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        }
      } catch (delErr) {
        console.error('Failed to delete dead subscription', delErr);
      }
      return new Response(JSON.stringify({ error: 'subscription_gone', deleted: true }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'push_error', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
