import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as webPush from 'https://esm.sh/jsr/@negrel/webpush'

/* =========================
   Helpers
========================= */
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

/* =========================
   Types
========================= */
type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }

interface NotificationOutboxRow {
  id: string
  recipient_type: 'user' | 'contact'
  recipient_id: string
  payload: any
  attempts: number
}

/* =========================
   Env & Config
========================= */
const SITE_BASE =
  (Deno.env.get('PUBLIC_SITE_URL') || '').replace(/\/$/, '')

const DEFAULT_ICON =
  Deno.env.get('DEFAULT_PUSH_ICON') || '/img/android-chrome-192x192.png'

const VAPID = {
  publicKey: (Deno.env.get('VAPID_PUBLIC_KEY') || '').trim(),
  privateKey: (Deno.env.get('VAPID_PRIVATE_KEY') || '').trim(),
  subject:
    (Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com').trim()
}

/* =========================
   Supabase Client
========================= */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

/* =========================
   Utils
========================= */
const absolutize = (url: string) =>
  /^https?:\/\//i.test(url)
    ? url
    : `${SITE_BASE}${url.startsWith('/') ? '' : '/'}${url}`

const normalizeKeys = (raw: any): SubscriptionKeys | null => {
  try {
    const k = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!k?.p256dh || !k?.auth) return null
    return {
      p256dh: String(k.p256dh).trim(),
      auth: String(k.auth).trim()
    }
  } catch {
    return null
  }
}

/* =========================
   Push Sender
========================= */
const sendWebPush = async (
  sub: WebPushSubscription,
  payload: unknown
) =>
  webPush.sendNotification(
    { endpoint: sub.endpoint, keys: sub.keys as any },
    JSON.stringify(payload),
    {
      vapidDetails: VAPID,
      TTL: 60 * 60 * 24 * 30
    }
  )

/* =========================
   Resolve Subscriptions
========================= */
async function resolveSubscriptions(
  type: 'user' | 'contact',
  id: string
): Promise<WebPushSubscription[]> {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq(type === 'user' ? 'user_id' : 'client_contact_id', id)

  return (
    data
      ?.map(r => {
        const keys = normalizeKeys(r.keys)
        if (!r.endpoint || !keys) return null
        return { endpoint: String(r.endpoint).trim(), keys }
      })
      .filter(Boolean) as WebPushSubscription[]
  ) || []
}

/* =========================
   Event Processor
========================= */
async function handleEvent(
  event: NotificationOutboxRow
): Promise<boolean> {
  try {
    const subs = await resolveSubscriptions(
      event.recipient_type,
      event.recipient_id
    )

    if (!subs.length) {
      await supabase
        .from('notification_outbox')
        .update({
          status: 'failed',
          attempts: event.attempts + 1,
          last_error: 'missing_subscription',
          failed_reason: 'missing_subscription',
          failed_at: new Date().toISOString(),
          processed_at: new Date().toISOString()
        })
        .eq('id', event.id)
      return false
    }

    let payloadData = event.payload
    if (typeof payloadData === 'string') {
      payloadData = JSON.parse(payloadData)
    }

    if (!payloadData?.title || !payloadData?.body) {
      throw new Error('invalid_payload')
    }

    const payload = {
      title: String(payloadData.title),
      body: String(payloadData.body),
      icon: absolutize(payloadData.icon || DEFAULT_ICON),
      badge: absolutize('/img/favicon-32x32.png'),
      data: {
        ...(payloadData.data || {}),
        url: absolutize(payloadData.data?.url || '/')
      }
    }

    let delivered = 0
    let failed = 0
    const logs = []

    for (const s of subs) {
      try {
        await sendWebPush(s, payload)
        delivered++
        logs.push({
          event_id: event.id,
          endpoint: s.endpoint,
          status_code: 201
        })
      } catch (e: any) {
        failed++
        logs.push({
          event_id: event.id,
          endpoint: s.endpoint,
          status_code: e?.statusCode || null,
          error: String(e?.message || e).slice(0, 300)
        })

        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', s.endpoint)
        }
      }
    }

    if (logs.length) {
      await supabase.from('push_delivery_attempts').insert(logs)
    }

    if (delivered > 0) {
      await supabase
        .from('notification_outbox')
        .update({
          status: 'sent',
          processed_at: new Date().toISOString(),
          last_error: failed ? `failed:${failed}` : null
        })
        .eq('id', event.id)
      return true
    }

    throw new Error('all_endpoints_failed')
  } catch (err: any) {
    const nextStatus = event.attempts >= 5 ? 'failed' : 'retry'
    const errorMsg = String(err?.message || err).slice(0, 300)

    await supabase
      .from('notification_outbox')
      .update({
        status: nextStatus,
        attempts: event.attempts + 1,
        last_error: errorMsg,
        failed_reason: nextStatus === 'failed' ? errorMsg : null,
        failed_at: nextStatus === 'failed' ? new Date().toISOString() : null,
        processed_at:
          nextStatus === 'failed' ? new Date().toISOString() : null
      })
      .eq('id', event.id)

    return false
  }
}

/* =========================
   Batch Processor
========================= */
async function processPending(limit = 10) {
  const { data, error } = await supabase.rpc(
    'claim_notification_outbox',
    { p_limit: limit }
  )

  if (error) throw error
  if (!data?.length) return { processed: 0 }

  let processed = 0
  const queue = [...(data as NotificationOutboxRow[])]
  const workers = Math.min(3, queue.length)

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const ev = queue.shift()
        if (ev && (await handleEvent(ev))) processed++
      }
    })
  )

  return { processed }
}

/* =========================
   HTTP Handler
========================= */
Deno.serve(async req => {
  const INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET')
  const REQ_SECRET = req.headers.get('x-internal-secret')
  if (!INTERNAL_SECRET || REQ_SECRET !== INTERNAL_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  if (!VAPID.publicKey || !VAPID.privateKey) {
    return jsonResponse({ error: 'VAPID keys not configured' }, 500)
  }
  if (!['POST', 'GET'].includes(req.method)) {
    return new Response('Method not allowed', { status: 405 })
  }

  const limit = Math.min(
    20,
    Math.max(
      1,
      Number(new URL(req.url).searchParams.get('limit')) || 10
    )
  )

  const result = await processPending(limit)
  return jsonResponse({ success: true, ...result })
})
