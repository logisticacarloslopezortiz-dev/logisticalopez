import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'

type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }

async function sendWebPush(sub: WebPushSubscription, payload: unknown) {
  const webpush = await import('jsr:@negrel/webpush')
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const jwk = Deno.env.get('VAPID_JWK')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  let vapidKeys: any
  try {
    vapidKeys = jwk ? webpush.importVapidKeys(JSON.parse(jwk)) : { publicKey: pub, privateKey: priv }
  } catch (_) {
    vapidKeys = { publicKey: pub, privateKey: priv }
  }
  const appServer = await webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys })
  return await appServer.push(sub as any, JSON.stringify(payload), { ttl: 2592000, urgency: 'high' })
}

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const title: string = String(body?.title || '')
    const bodyText: string = String(body?.body || '')
    const icon: string = body?.icon || '/img/android-chrome-192x192.png'
    const url: string = body?.url || '/'
    const rawSub = body?.subscription || {}
    const endpoint: string = String(rawSub?.endpoint || '')
    const keys: SubscriptionKeys = rawSub?.keys || { p256dh: rawSub?.p256dh, auth: rawSub?.auth }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ error: 'invalid_subscription' }, 400, req)
    }

    const payload = {
      notification: {
        title,
        body: bodyText,
        icon,
        badge: '/img/favicon-32x32.png',
        data: { url }
      }
    }

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
