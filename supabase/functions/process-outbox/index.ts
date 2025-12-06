import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'

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
  const webpush = await import('jsr:@negrel/webpush')
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  const vapidKeys = { publicKey: pub, privateKey: priv }
  const appServer = await webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await appServer.push(sub as any, JSON.stringify(payload), { ttl: 2592000, urgency: 'high', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

interface OutboxMessage {
  id: number
  subscription_endpoint?: string | null
  subscription_keys?: SubscriptionKeys | null
  user_id?: string | null
  payload_json?: any
  attempts?: number
  status?: string
  created_at?: string
}

async function processPending(limit = 50) {
  const { data: messages, error } = await supabase
    .from('notification_outbox')
    .select('*')
    .in('status', ['pending', 'retry'])
    .lte('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`outbox_select_error: ${error.message}`)
  if (!messages || !messages.length) return { processed: 0 }

  let processed = 0
  for (const msg of messages as OutboxMessage[]) {
    const attempts = (msg.attempts || 0) + 1
    try {
      // Resolver suscripción
      let endpoint = String(msg.subscription_endpoint || '')
      let keys = msg.subscription_keys || undefined
      if ((!endpoint || !keys?.p256dh || !keys?.auth) && msg.user_id) {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('user_id', msg.user_id)
          .limit(1)
        if (subs && subs.length) {
          endpoint = subs[0].endpoint
          keys = { p256dh: subs[0].p256dh, auth: subs[0].auth }
        }
      }
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw new Error('missing_subscription')
      }

      const n = msg.payload_json || {}
      const payload = {
        title: String(n.title || 'Notificación'),
        body: String(n.body || ''),
        icon: absolutize(n.icon || '/img/android-chrome-192x192.png'),
        badge: absolutize('/img/favicon-32x32.png'),
        data: { ...(typeof n.data === 'object' ? n.data : {}), url: absolutize((n?.data?.url) || '/') }
      }

      await sendWebPush({ endpoint, keys: keys as SubscriptionKeys }, payload)

      // Éxito: marcar como sent
      await supabase.from('notification_outbox').update({ status: 'sent', attempts }).eq('id', msg.id)
      processed++
    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      const message = err instanceof Error ? (err.message || 'unknown_error') : String(err)
      if (statusCode === 404 || statusCode === 410) {
        // Limpieza de suscripciones muertas
        try {
          if (msg.subscription_endpoint) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', msg.subscription_endpoint)
          }
        } catch (_) {}
        // Mover a failed inmediatamente
        await supabase.from('notification_outbox_failed').insert({
          outbox_id: msg.id,
          reason: `expired_subscription_${statusCode}`,
          error_message: message,
          payload_json: msg.payload_json,
          created_at: new Date().toISOString()
        })
        await supabase.from('notification_outbox').update({ status: 'failed', attempts }).eq('id', msg.id)
      } else if (attempts >= 3) {
        // Dead-letter
        await supabase.from('notification_outbox_failed').insert({
          outbox_id: msg.id,
          reason: 'max_attempts_reached',
          error_message: message,
          payload_json: msg.payload_json,
          created_at: new Date().toISOString()
        })
        await supabase.from('notification_outbox').update({ status: 'failed', attempts }).eq('id', msg.id)
      } else {
        // Reintento
        await supabase.from('notification_outbox').update({ status: 'retry', attempts }).eq('id', msg.id)
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

