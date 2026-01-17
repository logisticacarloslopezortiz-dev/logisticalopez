import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
const FUNCTIONS_BASE = SUPABASE_URL ? SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') : ''
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
const SEND_NOTIFICATION_SECRET = (Deno.env.get('SEND_NOTIFICATION_SECRET') || '').trim()

function absolutize(url: string): string {
  try {
    if (!url) return SITE_BASE + '/'
    if (/^https?:\/\//i.test(url)) return url
    return SITE_BASE + (url.startsWith('/') ? '' : '/') + url
  } catch (_) { return SITE_BASE + '/' }
}

Deno.serve(async (req: Request) => {
  console.log('[notify-user-push] START', { method: req.method, url: req.url })
  const cors = handleCors(req)
  if (cors) { console.log('[notify-user-push] CORS preflight'); return cors }
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405, req)
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ success: false, error: 'server_misconfigured' }, 500, req)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!SEND_NOTIFICATION_SECRET || authHeader !== `Bearer ${SEND_NOTIFICATION_SECRET}`) { console.warn('[notify-user-push] Unauthorized'); return jsonResponse({ success: false, error: 'unauthorized' }, 401, req) }

  let body: any = {}
  try { body = await req.json(); console.log('[notify-user-push] BODY', body) } catch { console.error('[notify-user-push] Invalid JSON'); return jsonResponse({ success: false, error: 'invalid_json' }, 400, req) }

  const user_id = String(body?.user_id || '').trim()
  const contact_id = String(body?.contact_id || '').trim()
  const n = body?.notification || body || {}
  const title = String(n?.title || 'Notificación')
  const bodyText = String(n?.body || '').trim()
  const icon = absolutize(n?.icon || '/img/android-chrome-192x192.png')
  const badge = absolutize(n?.badge || '/img/favicon-32x32.png')
  const dataObj = (typeof n?.data === 'object' && n?.data) ? n.data : {}
  const url = absolutize((dataObj as any)?.url || '/')
  const payload = { title, body: bodyText, icon, badge, data: { ...dataObj, url } }

  if (!bodyText) return jsonResponse({ success: false, error: 'missing_body' }, 400, req)
  if (!user_id && !contact_id) return jsonResponse({ success: false, error: 'missing_target' }, 400, req)

  try {
    console.log('[notify-user-push] Delegating', { target: user_id || contact_id })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 9000)
    let resp: Response
    try {
      resp = await fetch(`${FUNCTIONS_BASE}/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SEND_NOTIFICATION_SECRET}`, 'Accept': 'application/json' },
        body: JSON.stringify(user_id ? { user_id, notification: payload } : { contact_id, notification: payload }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
    const data = await resp.json().catch(() => ({}))
    console.log('[notify-user-push] send-notification response', { status: resp.status, ok: resp.ok, data })
    if (resp.ok && data && data.success) {
      return jsonResponse({ success: true, delegated: true, data }, 200, req)
    } else {
      try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: false, error_message: String(data?.error || 'delegate_failed') }) } catch (_) {}
      return jsonResponse({ success: false, error: 'delegate_failed' }, 502, req)
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.message || 'unknown_error') : String(e)
    console.error('[notify-user-push] ERROR', msg)
    try { await supabase.from('notification_logs').insert({ user_id: user_id || null, payload, success: false, error_message: msg }) } catch (_) {}
    return jsonResponse({ success: false, error: msg }, 500, req)
  }
})
