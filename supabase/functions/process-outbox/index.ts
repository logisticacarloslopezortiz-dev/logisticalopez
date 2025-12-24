import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.4.5'

// --- CORS Configuration (Inlined for reliability) ---
const allowedOrigins = new Set([
  'https://logisticalopezortiz.com',
  'https://www.logisticalopezortiz.com',
  'http://127.0.0.1:5502',
  'http://localhost:5502',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5507',
  'http://localhost:5507'
]);

function corsHeadersForOrigin(origin: string | null): Record<string, string> {
  const isAllowed = !!origin && allowedOrigins.has(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, Authorization, X-Client-Info, Apikey, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
  if (isAllowed) headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');
    // Log preflight CORS clearly
    try {
      console.log(`[process-outbox] CORS preflight OPTIONS from origin=${origin || 'unknown'} allowed=${origin ? allowedOrigins.has(origin) : false}`)
    } catch(_) {}
    return new Response('ok', { status: 200, headers: corsHeadersForOrigin(origin) });
  }
  return null;
}

function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  const origin = req?.headers?.get('origin') ?? null;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForOrigin(origin), 'Content-Type': 'application/json' }
  });
}
// ----------------------------------------------------

type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }

const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const absolutize = (u: string) => /^https?:\/\//i.test(String(u||'')) ? String(u) : SITE_BASE + (String(u||'').startsWith('/') ? '' : '/') + String(u||'')

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function sendWebPush(sub: WebPushSubscription, payload: unknown) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  webpush.setVapidDetails(subject, pub, priv)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await webpush.sendNotification(sub as any, JSON.stringify(payload), { TTL: 2592000 })
  } finally {
    clearTimeout(timeout)
  }
}

interface OutboxMessage {
  id: number
  target_user_id?: string | null
  target_contact_id?: string | null
  payload?: any
  attempts?: number
  created_at?: string
}

async function resolveSubscription(userId?: string | null, contactId?: string | null) {
  if (userId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('user_id', userId)
      .limit(1)
    if (data && data.length) return { endpoint: data[0].endpoint, keys: data[0].keys as SubscriptionKeys }
  }
  if (contactId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('client_contact_id', contactId)
      .limit(1)
    if (data && data.length) return { endpoint: data[0].endpoint, keys: data[0].keys as SubscriptionKeys }
  }
  return null
}

async function processPending(limit = 50) {
  // [CORRECCIÓN 4] Use RPC for safe claiming with locking
  const { data: messages, error } = await supabase.rpc('claim_outbox_messages', { batch_size: limit })

  if (error) throw new Error(`outbox_claim_error: ${error.message}`)
  if (!messages || !messages.length) return { processed: 0 }

  let processed = 0
  for (const msg of messages as OutboxMessage[]) {
    // attempts is already incremented by RPC
    const attempts = msg.attempts || 1
    
    try {
      const sub = await resolveSubscription(msg.target_user_id || null, msg.target_contact_id || null)
      if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        // Fatal: No subscription. Mark as processed (failed)
        await supabase.from('notification_outbox').update({ 
          last_error: 'missing_subscription', 
          processed_at: new Date().toISOString(),
          locked_until: null 
        }).eq('id', msg.id)
        continue
      }

      const n = msg.payload || {}
      const payload = {
        title: String(n.title || 'Notificación'),
        body: String(n.body || ''),
        icon: absolutize(n.icon || '/img/android-chrome-192x192.png'),
        badge: absolutize('/img/favicon-32x32.png'),
        data: { ...(typeof n.data === 'object' ? n.data : {}), url: absolutize((n?.data?.url) || '/') }
      }

      const cleanEndpoint = String(sub.endpoint || '').trim().replace(/`/g, '')
      const cleanKeys = { p256dh: String(sub.keys.p256dh || '').trim(), auth: String(sub.keys.auth || '').trim() }
      await sendWebPush({ endpoint: cleanEndpoint, keys: cleanKeys }, payload)

      // Success
      await supabase.from('notification_outbox').update({ 
        processed_at: new Date().toISOString(), 
        last_error: null,
        locked_until: null
      }).eq('id', msg.id)
      processed++

    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      const message = err instanceof Error ? (err.message || 'unknown_error') : String(err)
      
      if (statusCode === 404 || statusCode === 410) {
        // Fatal: Subscription expired
        await supabase.from('notification_outbox').update({ 
          last_error: `expired_subscription_${statusCode}`, 
          processed_at: new Date().toISOString(),
          locked_until: null
        }).eq('id', msg.id)
      } else {
        // Transient error
        if (attempts >= 5) {
           // Max retries reached
           await supabase.from('notification_outbox').update({ 
            last_error: `max_attempts_reached: ${message}`, 
            processed_at: new Date().toISOString(),
            locked_until: null
          }).eq('id', msg.id)
        } else {
           // Retry later (locked_until set by RPC)
           await supabase.from('notification_outbox').update({ 
            last_error: message
          }).eq('id', msg.id)
        }
      }
    }
  }
  return { processed }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  try {
    console.log(`[process-outbox] Incoming ${req.method} from origin=${origin || 'unknown'}`)
  } catch(_) {}
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }
  try {
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw))) : 50
    // Log claiming start
    try { console.log(`[process-outbox] Processing pending messages (limit=${limit})`) } catch(_) {}
    const result = await processPending(limit)
    try { console.log(`[process-outbox] Done processing: processed=${result.processed ?? 0}`) } catch(_) {}
    return jsonResponse({ success: true, ...result }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? (e.message || 'unknown_error') : String(e)
    try { console.error(`[process-outbox] Error while processing: ${msg}`) } catch(_) {}
    return jsonResponse({ error: msg }, 500, req)
  }
})
