/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as webPush from 'https://esm.sh/jsr/@negrel/webpush'
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
let VAPID_PUBLIC_KEY = (Deno.env.get('VAPID_PUBLIC_KEY') || '').trim()
let VAPID_PRIVATE_KEY = (Deno.env.get('VAPID_PRIVATE_KEY') || '').trim()
let VAPID_SUBJECT = (Deno.env.get('VAPID_SUBJECT') || 'mailto:contacto@logisticalopezortiz.com').trim()
const SITE_BASE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com').trim()
const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { autoRefreshToken: false, persistSession: false } })
const SEND_NOTIFICATION_SECRET = (Deno.env.get('SEND_NOTIFICATION_SECRET') || '').trim()
function absolutize(url: string): string {
  try {
    if (!url) return SITE_BASE + '/'
    if (/^https?:\/\//i.test(url)) return url
    return SITE_BASE + (url.startsWith('/') ? '' : '/') + url
  } catch (_) { return SITE_BASE + '/' }
}
async function hydrateVapidFromDb() {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) return;
  try {
    const { data } = await supabase.from('business').select('vapid_public_key,push_vapid_key').limit(1).maybeSingle()
    const pub = (data?.vapid_public_key || '').trim()
    const priv = (data?.push_vapid_key || '').trim()
    if (pub) VAPID_PUBLIC_KEY = pub
    if (priv) VAPID_PRIVATE_KEY = priv
  } catch (_) {}
}

async function validateVapid() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    await hydrateVapidFromDb()
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) throw new Error('missing_vapid')
  try {
    const b64 = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4)
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('invalid_vapid_public_key')
  } catch (_) { throw new Error('invalid_vapid_public_key') }
}
async function sendPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: unknown) {
  await validateVapid()
  return await webPush.sendNotification(
    { endpoint: subscription.endpoint, keys: subscription.keys as unknown as webPush.SubscriptionKeys },
    JSON.stringify(payload),
    {
      vapidDetails: {
        subject: VAPID_SUBJECT,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY
      },
      TTL: 2592000
    }
  )
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
  if (!bodyText.trim()) throw new Error('missing_notification_body')
  return { user_id, contact_id, payload: { title, body: bodyText, icon, badge, data: { ...dataObj, url } } }
}
async function handleExpired(endpoint: string) {
  try { await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint) } catch (_) {}
}
Deno.serve(async (req: Request) => {
  const correlationId = req.headers.get('x-correlation-id') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
  console.log('[send-notification] START', { correlation_id: correlationId })
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!SEND_NOTIFICATION_SECRET || authHeader !== `Bearer ${SEND_NOTIFICATION_SECRET}`) return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  try {
    const body = await req.json().catch(() => ({}))
    let user_id = ''
    let contact_id = ''
    let payload: any
    try {
      const validated = validateRequest(body)
      user_id = validated.user_id
      contact_id = validated.contact_id
      payload = validated.payload
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'missing_notification_body') return jsonResponse({ success: false, error: 'missing_body' }, 400)
      return jsonResponse({ success: false, error: msg }, 400)
    }
    console.log('[send-notification] Target', { user_id, contact_id, correlation_id: correlationId })
    if (!user_id && !contact_id) return jsonResponse({ success: false, error: 'missing_target' }, 400)
    const query = supabase.from('push_subscriptions').select('endpoint, keys')
    const { data: subs } = user_id ? await query.eq('user_id', user_id) : await query.eq('client_contact_id', contact_id)
    console.log('[send-notification] Subscriptions', subs ? subs.length : 0, { correlation_id: correlationId })
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
        console.log('[send-notification] Sending push', { endpoint, correlation_id: correlationId })
        await sendPush({ endpoint, keys: { p256dh: p256, auth } }, payload)
        sent++
      } catch (err) {
        failed++
        const statusCode = (err as any)?.statusCode as number | undefined
        const msg = (err instanceof Error) ? (err.message || 'unknown_error') : (String(err) || 'unknown_error')
        console.error('[send-notification] Push error', msg, { correlation_id: correlationId })
        if (statusCode === 404 || statusCode === 410) await handleExpired(endpoint)
      }
    }
    try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: sent > 0, error_message: failed ? `${failed} failed` : null }) } catch (_) {}
    return jsonResponse({ success: sent > 0, sent, failed, correlation_id: correlationId }, 200)
  } catch (error) {
    const msg = error instanceof Error ? (error.message || 'unknown_error') : (String(error) || 'unknown_error')
    return jsonResponse({ success: false, error: msg, correlation_id: correlationId }, 500)
  }
})
