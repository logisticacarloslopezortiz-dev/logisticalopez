import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as webPush from 'https://esm.sh/jsr/@negrel/webpush'

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

function normalizeKeys(raw: unknown): SubscriptionKeys | null {
  try {
    const k = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown> | null;
    const p256dh = String(k?.p256dh ?? '').trim();
    const auth = String(k?.auth ?? '').trim();
    if (!p256dh || !auth) return null;
    return { p256dh, auth };
  } catch (_) {
    return null;
  }
}

async function sendWebPush(sub: WebPushSubscription, payload: unknown) {
  const pub = (Deno.env.get('VAPID_PUBLIC_KEY') || '').trim()
  const priv = (Deno.env.get('VAPID_PRIVATE_KEY') || '').trim()
  const subject = (Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com').trim()
  
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  // Validación mínima de formato de la pública: debe decodificar a 65 bytes y comenzar con 0x04
  try {
    const b64 = pub.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (pub.length % 4)) % 4)
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('invalid_vapid_public_key')
  } catch (_) {
    throw new Error('invalid_vapid_public_key')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  
  try {
    return await webPush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys as unknown as webPush.SubscriptionKeys },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject,
          publicKey: pub,
          privateKey: priv
        },
        TTL: 2592000
      }
    )
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

async function resolveSubscriptions(userId?: string | null, contactId?: string | null) {
  const subs: WebPushSubscription[] = []
  if (userId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('user_id', userId)
    for (const row of data || []) {
      const endpoint = String(row.endpoint || '').trim().replace(/`/g, '')
      const keys = normalizeKeys((row as any).keys)
      if (endpoint && keys) subs.push({ endpoint, keys })
    }
  }
  if (contactId) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('client_contact_id', contactId)
    for (const row of data || []) {
      const endpoint = String(row.endpoint || '').trim().replace(/`/g, '')
      const keys = normalizeKeys((row as any).keys)
      if (endpoint && keys) subs.push({ endpoint, keys })
    }
  }
  return subs
}

async function handleMessage(msg: OutboxMessage) {
  const attempts = msg.attempts || 1
  try {
    const subs = await resolveSubscriptions(msg.target_user_id, msg.target_contact_id)

    if (!subs.length) {
      await supabase.from('notification_outbox').update({
        last_error: 'missing_subscription',
        processed_at: new Date().toISOString(),
        locked_until: null
      }).eq('id', msg.id)
      return false
    }

    // Parsear payload si viene como string JSON
    let n: any = msg.payload || {}
    if (typeof n === 'string') {
      try { n = JSON.parse(n) } catch { n = {} }
    }

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

    let delivered = 0
    for (const s of subs) {
      const cleanEndpoint = String(s.endpoint).trim().replace(/`/g, '')
      const cleanKeys = { p256dh: s.keys.p256dh.trim(), auth: s.keys.auth.trim() }
      try {
        await sendWebPush({ endpoint: cleanEndpoint, keys: cleanKeys }, payload)
        delivered++
      } catch (err) {
        const code = (err as any)?.statusCode
        if (code === 404 || code === 410) {
          // Suscripción expirada: eliminarla
          try {
            await supabase.from('push_subscriptions').delete().eq('endpoint', cleanEndpoint)
          } catch (_) {}
        }
      }
    }

    if (delivered > 0) {
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
      } catch (_) {}

      await supabase.from('notification_outbox').update({
        processed_at: new Date().toISOString(),
        last_error: null,
        locked_until: null
      }).eq('id', msg.id)
      return true
    } else {
      await supabase.from('notification_outbox').update({
        last_error: 'delivery_failed_all_endpoints',
        locked_until: null
      }).eq('id', msg.id)
      return false
    }
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
        last_error: msgErr.slice(0, 300)
      }).eq('id', msg.id)
    }
    return false
  }
}

async function processPending(limit = 10) {
  const { data: messages, error } = await supabase.rpc('claim_outbox_messages', { batch_size: limit })
  if (error) throw new Error(`outbox_claim_error: ${error.message}`)
  if (!messages?.length) return { processed: 0 }

  const queue = [...(messages as OutboxMessage[])]
  let processed = 0
  const concurrency = Math.min(3, queue.length)

  async function worker() {
    for (;;) {
      const next = queue.shift()
      if (!next) break
      const ok = await handleMessage(next)
      if (ok) processed++
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
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
