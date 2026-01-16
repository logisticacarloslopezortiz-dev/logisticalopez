/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:example@example.com'
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { autoRefreshToken: false, persistSession: false } })
function absolutize(url: string): string {
  try {
    if (!url) return SITE_BASE + '/'
    if (/^https?:\/\//i.test(url)) return url
    return SITE_BASE + (url.startsWith('/') ? '' : '/') + url
  } catch (_) { return SITE_BASE + '/' }
}
async function sendPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: unknown) {
  const { default: webpush } = await import('https://esm.sh/web-push@3.4.5')
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await webpush.sendNotification(subscription as any, JSON.stringify(payload), { TTL: 2592000 })
  } finally {
    clearTimeout(timeout)
  }
}
function validateRequest(body: any) {
  const user_id = String(body?.user_id || '').trim()
  const contact_id = String(body?.contact_id || '').trim()
  const n = body?.notification ?? body ?? {}
  const title = String(n?.title || 'Notificación')
  const bodyText = String(n?.body || '')
  const icon = absolutize(n?.icon || '/img/android-chrome-192x192.png')
  const badge = absolutize(n?.badge || '/img/favicon-32x32.png')
  const dataObj = (typeof n?.data === 'object' && n?.data) ? n.data : {}
  const url = absolutize((dataObj as any)?.url || '/')
  return { user_id, contact_id, payload: { title, body: bodyText, icon, badge, data: { ...dataObj, url } } }
}
async function handleExpired(endpoint: string) {
  try { await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint) } catch (_) {}
}
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  const srvRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!srvRole || authHeader !== `Bearer ${srvRole}`) return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return jsonResponse({ success: false, error: 'missing_vapid' }, 500)
    const body = await req.json().catch(() => ({}))
    const { user_id, contact_id, payload } = validateRequest(body)
    if (!user_id && !contact_id) return jsonResponse({ success: false, error: 'missing_target' }, 400)
    const query = supabase.from('push_subscriptions').select('endpoint, keys')
    const { data: subs } = user_id ? await query.eq('user_id', user_id) : await query.eq('client_contact_id', contact_id)
    if (!subs || subs.length === 0) {
      try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: false, error_message: 'no_subscriptions' }) } catch (_) {}
      return jsonResponse({ success: false, error: 'no_subscriptions' }, 404)
    }
    let sent = 0
    let failed = 0
    for (const sub of subs) {
      const endpoint = String((sub as any).endpoint || '').trim().replace(/`/g, '')
      const rawKeys = (sub as any).keys
      let keys = rawKeys
      if (typeof keys === 'string') { try { keys = JSON.parse(keys) } catch { keys = undefined } }
      const p256 = String((keys?.p256dh || (rawKeys?.p256dh)) || '').trim()
      const auth = String((keys?.auth || (rawKeys?.auth)) || '').trim()
      if (!endpoint || !p256 || !auth) { failed++; continue }
      try {
        await sendPush({ endpoint, keys: { p256dh: p256, auth } }, payload)
        sent++
        try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: true, error_message: null }) } catch (_) {}
      } catch (err) {
        failed++
        const statusCode = (err as any)?.statusCode as number | undefined
        const msg = (err instanceof Error) ? (err.message || 'unknown_error') : (String(err) || 'unknown_error')
        if (statusCode === 404 || statusCode === 410) await handleExpired(endpoint)
        try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: false, error_message: msg }) } catch (_) {}
      }
    }
    return jsonResponse({ success: sent > 0, sent, failed }, 200)
  } catch (error) {
    const msg = error instanceof Error ? (error.message || 'unknown_error') : (String(error) || 'unknown_error')
    return jsonResponse({ success: false, error: msg }, 500)
  }
})
