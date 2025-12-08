import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'
import webpush from 'https://esm.sh/web-push@3.4.5'

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
  const { data: messages, error } = await supabase
    .from('notification_outbox')
    .select('id, target_user_id, target_contact_id, payload, attempts, created_at')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`outbox_select_error: ${error.message}`)
  if (!messages || !messages.length) return { processed: 0 }

  let processed = 0
  for (const msg of messages as OutboxMessage[]) {
    const attempts = (msg.attempts || 0) + 1
    try {
      const sub = await resolveSubscription(msg.target_user_id || null, msg.target_contact_id || null)
      if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        const next = attempts >= 3
        await supabase.from('notification_outbox').update({ attempts, last_error: 'missing_subscription', processed_at: next ? new Date().toISOString() : null }).eq('id', msg.id)
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

      await supabase.from('notification_outbox').update({ attempts, processed_at: new Date().toISOString(), last_error: null }).eq('id', msg.id)
      processed++
    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      const message = err instanceof Error ? (err.message || 'unknown_error') : String(err)
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('notification_outbox').update({ attempts, last_error: `expired_subscription_${statusCode}`, processed_at: new Date().toISOString() }).eq('id', msg.id)
      } else {
        const next = attempts >= 3
        await supabase.from('notification_outbox').update({ attempts, last_error: message, processed_at: next ? new Date().toISOString() : null }).eq('id', msg.id)
      }
    }
  }
  return { processed }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }
  try {
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw))) : 50
    const result = await processPending(limit)
    return jsonResponse({ success: true, ...result }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? (e.message || 'unknown_error') : String(e)
    return jsonResponse({ error: msg }, 500, req)
  }
})
