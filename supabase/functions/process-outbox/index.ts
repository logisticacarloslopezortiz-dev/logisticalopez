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

const SITE_BASE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com').trim()
const DEFAULT_ICON = Deno.env.get('DEFAULT_PUSH_ICON') || '/img/android-chrome-192x192.png'

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
  try {
    const b64 = pub.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (pub.length % 4)) % 4)
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('invalid_vapid_public_key')
  } catch (_) {
    throw new Error('invalid_vapid_public_key')
  }

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
}

interface NotificationEvent {
  id: string
  type: string
  target_type: 'user' | 'contact'
  target_id: string
  payload: any
  status: string
  attempts: number
}

async function resolveSubscriptions(targetType: 'user' | 'contact', targetId: string) {
  const subs: WebPushSubscription[] = []
  
  let query = supabase.from('push_subscriptions').select('endpoint, keys')
  if (targetType === 'user') {
    query = query.eq('user_id', targetId)
  } else {
    query = query.eq('client_contact_id', targetId)
  }
  
  const { data } = await query
  
  for (const row of data || []) {
    const endpoint = String(row.endpoint || '').trim().replace(/`/g, '')
    const keys = normalizeKeys((row as any).keys)
    if (endpoint && keys) subs.push({ endpoint, keys })
  }
  
  return subs
}

async function handleEvent(event: NotificationEvent) {
  // attempts already incremented by RPC, status already set to 'processing'
  const attempts = event.attempts
  
  try {
    // 1. Resolve subscriptions
    const subs = await resolveSubscriptions(event.target_type, event.target_id)

    if (!subs.length) {
      await supabase.from('notification_events').update({
        status: 'failed',
        last_error: 'missing_subscription',
        processed_at: new Date().toISOString()
      }).eq('id', event.id)
      return false
    }

    // 2. Prepare payload & Validate
    let n: any = event.payload || {}
    if (typeof n === 'string') {
      try { n = JSON.parse(n) } catch { n = {} }
    }

    if (!n.title || !n.body) {
       throw new Error('invalid_payload: missing title or body')
    }

    const payload = {
      title: String(n.title),
      body: String(n.body),
      icon: absolutize(n.icon || DEFAULT_ICON),
      badge: absolutize('/img/favicon-32x32.png'),
      data: {
        ...(typeof n.data === 'object' ? n.data : {}),
        url: absolutize((n.data?.url) || '/')
      }
    }

    // 3. Send to all endpoints
    let delivered = 0
    let failures = 0
    
    const logs: Array<{ event_id: string; endpoint: string; status_code: number | null; error: string | null }> = []
    for (const s of subs) {
      const cleanEndpoint = String(s.endpoint).trim().replace(/`/g, '')
      const cleanKeys = { p256dh: s.keys.p256dh.trim(), auth: s.keys.auth.trim() }
      try {
        await sendWebPush({ endpoint: cleanEndpoint, keys: cleanKeys }, payload)
        delivered++
        logs.push({ event_id: event.id, endpoint: cleanEndpoint, status_code: 201, error: null })
      } catch (err) {
        failures++
        const code = (err as any)?.statusCode
        logs.push({ event_id: event.id, endpoint: cleanEndpoint, status_code: typeof code === 'number' ? code : null, error: String((err as any)?.message || err).slice(0, 300) })
        if (code === 404 || code === 410) {
          // Suscripción expirada: eliminarla
          try {
            await supabase.from('push_subscriptions').delete().eq('endpoint', cleanEndpoint)
          } catch (_) {}
        }
      }
    }
    if (logs.length) {
      try { await supabase.from('push_delivery_attempts').insert(logs) } catch (_) {}
    }

    // 4. Update status
    if (delivered > 0) {
      await supabase.from('notification_events').update({
        status: 'sent',
        processed_at: new Date().toISOString(),
        last_error: failures > 0 ? `delivered:${delivered}, failed:${failures}` : null
      }).eq('id', event.id)
      return true
    } else {
      // If we are here, it means we had subscriptions but all failed (e.g. 404s, 500s from FCM/Mozilla)
      // If they were all 404/410, retrying won't help. 
      // But if it was a network error, maybe it helps.
      // For simplicity, we treat "delivery_failed_all_endpoints" as a failure that might be retried if < 5,
      // but usually if all endpoints failed it's often fatal or temporary.
      // Let's follow the general retry logic below by throwing an error or handling it here.
      throw new Error(`all_endpoints_failed: ${failures} errors`)
    }

  } catch (err) {
    const msgErr = err instanceof Error ? err.message : String(err)
    
    // Retry logic
    const nextStatus = attempts >= 5 ? 'failed' : 'retry'
    
    await supabase.from('notification_events').update({
      status: nextStatus,
      last_error: msgErr.slice(0, 300),
      processed_at: nextStatus === 'failed' ? new Date().toISOString() : null
    }).eq('id', event.id)
    
    return false
  }
}

async function processPending(limit = 10) {
  // Atomic Claim via RPC
  const { data: events, error } = await supabase
    .rpc('claim_notification_events', { p_limit: limit })

  if (error) throw new Error(`claim_error: ${error.message}`)
  if (!events?.length) return { processed: 0 }

  // Process
  let processed = 0
  const queue = [...(events as NotificationEvent[])]
  const concurrency = Math.min(3, queue.length)

  async function worker() {
    for (;;) {
      const next = queue.shift()
      if (!next) break
      const ok = await handleEvent(next)
      if (ok) processed++
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { processed }
}

Deno.serve(async (req: Request) => {
  console.log('[process-outbox] invoked') // Debug: confirma que la función fue llamada
  
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Auth: ONLY Internal Secret
  const internalSecret = Deno.env.get('PUSH_INTERNAL_SECRET')
  const reqSecret = req.headers.get('x-internal-secret')
  
  if (!internalSecret || reqSecret !== internalSecret) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  }

  try {
    const url = new URL(req.url)
    let limit = parseInt(url.searchParams.get('limit') || '')
    if (!Number.isFinite(limit) || limit < 1) {
      try {
        const j = await req.json()
        const b = typeof (j as any)?.limit === 'number' ? (j as any).limit : parseInt(String((j as any)?.limit || ''))
        limit = Number.isFinite(b) && b > 0 ? b : 10
      } catch (_) {
        limit = 10
      }
    }
    limit = Math.min(20, Math.max(1, limit))

    const result = await processPending(limit)
    return jsonResponse({ success: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[process-outbox] Fatal:', msg)
    return jsonResponse({ error: msg }, 500)
  }
})
