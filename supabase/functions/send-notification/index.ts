/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:example@example.com'
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await appServer.push(subscription as any, JSON.stringify(payload), { ttl: 2592000, urgency: 'high', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return jsonResponse({ success: false, error: 'Faltan claves VAPID en el servidor' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const rawSub = body?.subscription || {}
    let keys = rawSub?.keys
    if (typeof keys === 'string') { try { keys = JSON.parse(keys) } catch { keys = undefined } }
    if ((!keys?.p256dh || !keys?.auth) && rawSub?.p256dh && rawSub?.auth) { keys = { p256dh: rawSub.p256dh, auth: rawSub.auth } }
    const endpoint: string = String(rawSub?.endpoint || '').trim().replace(/`/g, '')
    if (keys && keys.p256dh && keys.auth) { keys = { p256dh: String(keys.p256dh).trim(), auth: String(keys.auth).trim() } }
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ success: false, error: 'Suscripción inválida' }, 400)
    }

    const n = body?.notification ?? body ?? {}
    const title = String(n?.title || 'Notificación')
    const bodyText = String(n?.body || '')
    const icon = absolutize(n?.icon || '/img/android-chrome-192x192.png')
    const badge = absolutize(n?.badge || '/img/favicon-32x32.png')
    const dataObj = (typeof n?.data === 'object' && n?.data) ? n.data : {}
    const url = absolutize((dataObj as any)?.url || '/')
    const payload = { title, body: bodyText, icon, badge, data: { ...dataObj, url } }

    try {
      await push({ endpoint, keys }, payload)
      return jsonResponse({ success: true }, 200)
    } catch (err) {
      const statusCode = (err as any)?.statusCode as number | undefined
      if (statusCode === 404 || statusCode === 410) {
        try { await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint) } catch (_) {}
        return jsonResponse({ success: false, expired: true }, 410)
      }
      const msg = (err instanceof Error) ? (err.message || 'unknown_error') : (String(err) || 'unknown_error')
      return jsonResponse({ success: false, error: msg, statusCode }, 500)
    }
  } catch (error) {
    const msg = error instanceof Error ? (error.message || 'unknown_error') : (String(error) || 'unknown_error')
    return jsonResponse({ success: false, error: msg }, 500)
  }
})
