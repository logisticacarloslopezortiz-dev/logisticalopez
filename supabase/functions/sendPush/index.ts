import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Backend-only: sin CORS y con autorización obligatoria
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
// Import dinámico para reducir cold start
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const absolutize = (u: string) => /^https?:\/\//i.test(String(u||'')) ? String(u) : SITE_BASE + (String(u||'').startsWith('/') ? '' : '/') + String(u||'')
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

type SubscriptionKeys = { p256dh: string; auth: string }
type WebPushSubscription = { endpoint: string; keys: SubscriptionKeys }
interface PushRequestBody {
  title?: string
  body?: string
  icon?: string
  url?: string
  subscription?: WebPushSubscription | any
}

async function sendWebPush(sub: WebPushSubscription, payload: unknown) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  const { default: webpush } = await import('https://esm.sh/web-push@3.4.5')
  webpush.setVapidDetails(subject, pub, priv)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await webpush.sendNotification(sub as any, JSON.stringify(payload), { TTL: 2592000 })
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Requiere autorización de backend (Service Role) para evitar uso desde navegador
  const srvRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!srvRole || authHeader !== `Bearer ${srvRole}`) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  try {
    const body: PushRequestBody = await req.json().catch(() => ({} as PushRequestBody))
    const title: string = String(body?.title || 'Notificación')
    const bodyText: string = String(body?.body || '')
    const icon: string = absolutize(body?.icon || '/img/android-chrome-192x192.png')
    const url: string = absolutize(body?.url || '/')
    const rawSub = body?.subscription || {}
    const endpoint: string = String(rawSub?.endpoint || '').trim().replace(/`/g, '')
    let keys: SubscriptionKeys | undefined = rawSub?.keys
    if (typeof keys === 'string') { try { keys = JSON.parse(keys) } catch { keys = undefined } }
    if ((!keys?.p256dh || !keys?.auth) && rawSub?.p256dh && rawSub?.auth) { keys = { p256dh: rawSub?.p256dh, auth: rawSub?.auth } }
    if (keys && keys.p256dh && keys.auth) { keys = { p256dh: String(keys.p256dh).trim(), auth: String(keys.auth).trim() } }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ error: 'invalid_subscription' }, 400)
    }

    const payload = { title, body: bodyText, icon, badge: absolutize('/img/favicon-32x32.png'), data: { url } }

    try {
      await sendWebPush({ endpoint, keys }, payload)
      return jsonResponse({ success: true }, 200)
    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      if (statusCode === 404 || statusCode === 410) {
        try {
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
        } catch (_) {}
        return jsonResponse({ success: false, expired: true }, 410)
      }
      const message = (err instanceof Error) ? (err.message || 'unknown_error') : (String(err) || 'unknown_error')
      return jsonResponse({ success: false, error: message, statusCode }, 500)
    }
  } catch (e) {
    const message = e instanceof Error ? (e.message || 'unknown_error') : (String(e) || 'unknown_error')
    return jsonResponse({ error: message }, 500)
  }
})
