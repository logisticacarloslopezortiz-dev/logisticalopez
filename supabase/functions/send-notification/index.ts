/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:example@example.com'
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'

function absolutize(url: string): string {
  try {
    if (!url) return SITE_BASE + '/'
    if (/^https?:\/\//i.test(url)) return url
    return SITE_BASE + (url.startsWith('/') ? '' : '/') + url
  } catch (_) { return SITE_BASE + '/' }
}

async function push(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: unknown) {
  const webpush = await import('jsr:@negrel/webpush')
  const vapidKeys = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
  const appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys })
  return await appServer.push(subscription as any, JSON.stringify(payload), { ttl: 2592000, urgency: 'high' })
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return jsonResponse({ success: false, error: 'Faltan claves VAPID en el servidor' }, 200)
    }

    const body = await req.json().catch(() => ({}))
    const rawSub = body?.subscription || {}
    let keys = rawSub?.keys
    if (typeof keys === 'string') { try { keys = JSON.parse(keys) } catch { keys = undefined } }
    if (!keys?.p256dh && rawSub?.p256dh && rawSub?.auth) { keys = { p256dh: rawSub.p256dh, auth: rawSub.auth } }
    const endpoint: string = String(rawSub?.endpoint || '')
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ success: false, error: 'Suscripción inválida' }, 200)
    }

    const n = body?.notification || body || {}
    const title = String(n?.title || 'Notificación')
    const bodyText = String(n?.body || '')
    const icon = absolutize(n?.icon || '/img/android-chrome-192x192.png')
    const badge = absolutize(n?.badge || '/img/favicon-32x32.png')
    const dataObj = (typeof n?.data === 'object' && n?.data) ? n.data : {}
    const url = absolutize((dataObj as any)?.url || '/')
    const payload = { title, body: bodyText, icon, badge, data: { ...dataObj, url } }

    await push({ endpoint, keys }, payload)
    return jsonResponse({ success: true }, 200)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Fallo inesperado'
    return jsonResponse({ success: false, error: msg }, 200)
  }
})
