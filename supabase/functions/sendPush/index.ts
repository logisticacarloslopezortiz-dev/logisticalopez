import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'

type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }

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

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
    const absolutize = (u: string) => /^https?:\/\//i.test(String(u||'')) ? String(u) : SITE_BASE + (String(u||'').startsWith('/') ? '' : '/') + String(u||'')
    const title: string = String(body?.title || 'Notificación')
    const bodyText: string = String(body?.body || '')
    const icon: string = absolutize(body?.icon || '/img/android-chrome-192x192.png')
    const url: string = absolutize(body?.url || '/')
    const rawSub = body?.subscription || {}
    const endpoint: string = String(rawSub?.endpoint || '')
    let keys: SubscriptionKeys | undefined = rawSub?.keys
    if (typeof keys === 'string') { try { keys = JSON.parse(keys) } catch { keys = undefined } }
    if ((!keys?.p256dh || !keys?.auth) && rawSub?.p256dh && rawSub?.auth) { keys = { p256dh: rawSub?.p256dh, auth: rawSub?.auth } }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ error: 'invalid_subscription' }, 400, req)
    }

    const payload = { title, body: bodyText, icon, badge: absolutize('/img/favicon-32x32.png'), data: { url } }

    try {
      await sendWebPush({ endpoint, keys }, payload)
      return jsonResponse({ success: true }, 200, req)
    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      if (statusCode === 404 || statusCode === 410) {
        try {
          const supabase = createClient(
            Deno.env.get('SUPABASE_URL') || '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
            { auth: { autoRefreshToken: false, persistSession: false } }
          )
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
        } catch (_) {}
        return jsonResponse({ success: false, expired: true }, 410, req)
      }
      const message = (err instanceof Error) ? err.message : String(err)
      return jsonResponse({ success: false, error: message, statusCode }, 500, req)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return jsonResponse({ error: message }, 500, req)
  }
})
