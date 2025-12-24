import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const webpushPromise = import('https://esm.sh/web-push@3.4.5')

// Helpers
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }

// ✅ Corrección crítica: eliminar espacios en SITE_BASE
const SITE_BASE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com').trim()

const absolutize = (u: string): string => {
  const url = String(u || '').trim()
  if (/^https?:\/\//i.test(url)) return url
  const base = SITE_BASE.endsWith('/') ? SITE_BASE.slice(0, -1) : SITE_BASE
  const path = url.startsWith('/') ? url : `/${url}`
  return base + path
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function sendWebPush(sub: WebPushSubscription, payload: unknown) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com'
  
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  
  const { default: webpush } = await webpushPromise
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
}

async function resolveSubscription(userId?: string | null, contactId?: string | null) {
  if (userId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('user_id', userId)
      .limit(1)
    if (data?.[0]) return { endpoint: data[0].endpoint, keys: data[0].keys as SubscriptionKeys }
  }
  if (contactId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('client_contact_id', contactId)
      .limit(1)
    if (data?.[0]) return { endpoint: data[0].endpoint, keys: data[0].keys as SubscriptionKeys }
  }
  return null
}

async function processPending(limit = 10) {
  const { data: messages, error } = await supabase.rpc('claim_outbox_messages', { batch_size: limit })
  if (error) throw new Error(`outbox_claim_error: ${error.message}`)
  if (!messages?.length) return { processed: 0 }

  let processed = 0
  for (const msg of messages as OutboxMessage[]) {
    const attempts = msg.attempts || 1
    try {
      const sub = await resolveSubscription(msg.target_user_id, msg.target_contact_id)
      
      if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
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
        data: {
          ...(typeof n.data === 'object' ? n.data : {}),
          url: absolutize((n.data?.url) || '/')
        }
      }

      const cleanEndpoint = String(sub.endpoint).trim().replace(/`/g, '')
      const cleanKeys = {
        p256dh: String(sub.keys.p256dh).trim(),
        auth: String(sub.keys.auth).trim()
      }

      await sendWebPush({ endpoint: cleanEndpoint, keys: cleanKeys }, payload)

      // Insertar en notifications (deduplicación por índice único existente)
      try {
        if (msg.target_user_id) {
          await supabase.from('notifications').insert({
            user_id: msg.target_user_id,
            title: payload.title,
            body: payload.body,
            data: { orderId: (msg as any).order_id, role: (msg as any).target_role }
          })
        } else if (msg.target_contact_id) {
          await supabase.from('notifications').insert({
            contact_id: msg.target_contact_id,
            title: payload.title,
            body: payload.body,
            data: { orderId: (msg as any).order_id, role: (msg as any).target_role }
          })
        }
      } catch (_) {
        // Silenciar errores de deduplicación o RLS
      }

      await supabase.from('notification_outbox').update({
        processed_at: new Date().toISOString(),
        last_error: null,
        locked_until: null
      }).eq('id', msg.id)
      processed++

    } catch (err) {
      const statusCode = (err as any)?.statusCode
      const msgErr = err instanceof Error ? err.message : String(err)

      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('notification_outbox').update({
          last_error: `expired_subscription_${statusCode}`,
          processed_at: new Date().toISOString(),
          locked_until: null
        }).eq('id', msg.id)
      } else if (attempts >= 5) {
        await supabase.from('notification_outbox').update({
          last_error: `max_attempts_reached: ${msgErr}`,
          processed_at: new Date().toISOString(),
          locked_until: null
        }).eq('id', msg.id)
      } else {
        await supabase.from('notification_outbox').update({
          last_error: msgErr
        }).eq('id', msg.id)
      }
    }
  }
  return { processed }
}

// ✅ Timeout global para evitar 504
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Backend-only: requiere autorización Service Role para evitar invocación desde navegador
  const srvRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!srvRole || authHeader !== `Bearer ${srvRole}`) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 50_000) // 50 segundos

  try {
    const url = new URL(req.url)
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '10')))

    const result = await processPending(limit)
    clearTimeout(timeout)
    return jsonResponse({ success: true, ...result })
  } catch (e) {
    clearTimeout(timeout)
    if (controller.signal.aborted) {
      console.warn('[process-outbox] Global timeout triggered')
      return jsonResponse({ error: 'timeout' }, 408)
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[process-outbox] Fatal:', msg)
    return jsonResponse({ error: msg }, 500)
  }
})
