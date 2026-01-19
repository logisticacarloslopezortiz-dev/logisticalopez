import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
const ANON_KEY = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim()
const FUNCTIONS_BASE = SUPABASE_URL ? SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') : ''
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
const supabaseAnon: SupabaseClient | null = ANON_KEY ? createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null
const ORDER_EVENT_SECRET = (Deno.env.get('ORDER_EVENT_SECRET') || '').trim()
const SEND_NOTIFICATION_SECRET = (Deno.env.get('SEND_NOTIFICATION_SECRET') || '').trim()

function absolutize(url: string): string {
  try {
    if (!url) return SITE_BASE + '/'
    if (/^https?:\/\//i.test(url)) return url
    return SITE_BASE + (url.startsWith('/') ? '' : '/') + url
  } catch (_) { return SITE_BASE + '/' }
}

function normalizeStatus(s: string): string {
  const ns = String(s || '').toLowerCase()
  if (['pendiente','pending'].includes(ns)) return 'pendiente'
  if (['aceptada','accepted'].includes(ns)) return 'aceptada'
  if (['en_camino_recoger','cargando','en_camino_entregar','in_progress','en curso'].includes(ns)) {
    if (ns === 'in_progress' || ns === 'en curso') return 'en_camino_recoger'
    return ns
  }
  if (['entregada','completed','completada','entregado'].includes(ns)) return 'entregada'
  if (['cancelada','cancelled','anulada'].includes(ns)) return 'cancelada'
  return ns
}

function templateFor(role: 'colaborador' | 'cliente', status: string, orderId: string | number) {
  const id = String(orderId)
  const s = normalizeStatus(status)
  if (role === 'colaborador') {
    const title = 'Actualización de tu trabajo'
    const body =
      s === 'aceptada' ? `Orden #${id} aceptada`
      : s === 'en_camino_recoger' ? `Orden #${id}: en camino a recoger`
      : s === 'cargando' ? `Orden #${id}: cargando mercancía`
      : s === 'en_camino_entregar' ? `Orden #${id}: en ruta a entregar`
      : s === 'entregada' ? `Orden #${id}: entrega completada`
      : s === 'cancelada' ? `Orden #${id} cancelada`
      : `Orden #${id} cambió a "${s}"`
    return { title, body }
  } else {
    const title = 'Actualización de tu orden'
    const body =
      s === 'aceptada' ? `Tu orden #${id} ha sido aceptada`
      : s === 'en_camino_recoger' ? `Tu orden #${id}: el repartidor va en camino a recoger`
      : s === 'cargando' ? `Tu orden #${id}: tu carga está en proceso`
      : s === 'en_camino_entregar' ? `Tu orden #${id} va en camino a entregar`
      : s === 'entregada' ? `Tu orden #${id} ha sido entregada`
      : s === 'cancelada' ? `Tu orden #${id} ha sido cancelada`
      : `Tu orden #${id} cambió a "${s}"`
    return { title, body }
  }
}

async function resolveOrderId(id: unknown) {
  try {
    const n = typeof id === 'number' ? id : (typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null)
    if (Number.isFinite(n)) return n as number
    const sid = String(id || '').trim()
    if (!sid) return null
    const { data } = await supabase.from('orders').select('id').eq('short_id', sid).maybeSingle()
    return data?.id || null
  } catch (_) { return null }
}

async function sendTo(target: { user_id?: string; contact_id?: string }, notification: any) {
  const body = target.user_id ? { user_id: target.user_id, notification } : { contact_id: target.contact_id, notification }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const resp = await fetch(`${FUNCTIONS_BASE}/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SEND_NOTIFICATION_SECRET}`, 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const data = await resp.json().catch(() => ({}))
    return { ok: resp.ok, data }
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req: Request) => {
  const correlationId = req.headers.get('x-correlation-id') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
  const cors = handleCors(req)
  if (cors) return cors
  console.log('[order-event] REQUEST', { method: req.method, url: req.url, correlation_id: correlationId })
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ success: false, error: 'server_misconfigured' }, 500)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''

  let callerId: string | null = null
  let isAdmin = false
  let authMode: 'secret' | 'user' | 'none' = 'none'

  if (ORDER_EVENT_SECRET && authHeader === `Bearer ${ORDER_EVENT_SECRET}`) {
    authMode = 'secret'
    isAdmin = true
  } else if (authHeader?.toLowerCase().startsWith('bearer ')) {
    authMode = 'user'
    const token = authHeader.slice(7)
    try {
      const { data, error } = await supabase.auth.getUser(token)
      if (error || !data?.user?.id) {
        console.log('[order-event] invalid user token', { correlation_id: correlationId })
        return jsonResponse({ success: false, error: 'unauthorized' }, 401)
      }
      callerId = String(data.user.id)
      const { data: collab } = await supabase
        .from('collaborators')
        .select('role')
        .eq('id', callerId)
        .maybeSingle()
      const role = String(collab?.role || '').toLowerCase().trim()
      isAdmin = ['admin', 'administrador', 'superadmin'].includes(role)
    } catch (e) {
      console.log('[order-event] user auth error', e instanceof Error ? e.message : String(e), { correlation_id: correlationId })
      return jsonResponse({ success: false, error: 'unauthorized' }, 401)
    }
  } else {
    console.log('[order-event] unauthorized request', { correlation_id: correlationId })
    return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  }
  let body: any = {}
  try { body = await req.json() } catch (err) { console.error('[order-event] invalid JSON', err, { correlation_id: correlationId }); return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400) }
  console.log('[order-event] BODY', { body, correlation_id: correlationId })
  const eventType = String(body?.event || '').trim()
  const rawOrderId = body?.orderId
  const collaborator_id = String(body?.collaborator_id || '').trim() || null
  const extra = typeof body?.extra === 'object' ? body.extra : {}
  if (!eventType || !rawOrderId) {
    console.log('[order-event] missing parameters', { body, correlation_id: correlationId })
    return jsonResponse({ success: false, error: 'Missing event or orderId' }, 400)
  }

  async function getTemplate(event: 'created' | 'status_changed', role: 'cliente' | 'colaborador' | 'admin', status?: string) {
    try {
      const s = status ? String(status).toLowerCase() : null
      let q = supabase.from('notification_templates').select('*').eq('event_type', event).eq('role', role).eq('is_active', true).limit(1)
      if (s) q = q.eq('status', s)
      const { data } = await q
      if (Array.isArray(data) && data.length) {
        return { title: String(data[0].title || ''), body: String(data[0].body || '') }
      }
    } catch (_) {}
    if (event === 'created') {
      if (role === 'cliente') return { title: 'Orden creada', body: 'Tu orden #{{id}} fue creada correctamente. Te avisaremos cada avance.' }
      if (role === 'admin') return { title: 'Nueva orden creada', body: 'Se creó la orden #{{id}}. Requiere asignación.' }
      return { title: 'Nueva orden disponible', body: 'Hay una nueva orden #{{id}} pendiente de asignación.' }
    }
    if (role === 'cliente') return templateFor('cliente', status || '', '{{id}}')
    return templateFor('colaborador', status || '', '{{id}}')
  }

  const resolvedId = await resolveOrderId(rawOrderId)
  if (!resolvedId) return jsonResponse({ success: false, error: 'order_not_found' }, 404)
  const { data: ord } = await supabase.from('orders').select('id, short_id, assigned_to, completed_by, client_id, client_contact_id').eq('id', resolvedId).maybeSingle()
  const orderKey = ord?.short_id || resolvedId
  const url = absolutize(`/inicio.html?orderId=${orderKey}`)

  let sent = 0
  let targets = 0

  try {
  // Permission checks:
  // - secret mode → full access
  // - user mode:
  //    - created → only admin
  //    - status_changed → admin or assigned collaborator
  if (authMode === 'user') {
    if (eventType === 'created' && !isAdmin) {
      return jsonResponse({ success: false, error: 'forbidden' }, 403)
    }
    if (eventType !== 'created' && !(isAdmin || (callerId && String(ord?.assigned_to || '').trim() === callerId))) {
      return jsonResponse({ success: false, error: 'forbidden' }, 403)
    }
  }

  if (eventType === 'created') {
    const uniqueTargets = new Map<string, { type: 'user' | 'contact'; id: string }>()
    const addTarget = (type: 'user' | 'contact', id?: string) => {
      const clean = String(id || '').trim()
      if (!clean) return
      uniqueTargets.set(`${type}:${clean}`, { type, id: clean })
    }
    const clientUserId = String(ord?.client_id || '').trim()
    const contactId = String(ord?.client_contact_id || '').trim()
    addTarget('user', clientUserId)
    addTarget('contact', contactId)
    const { data: business } = await supabase.from('business').select('owner_user_id').eq('id', 1).maybeSingle()
    const ownerId = String((business as any)?.owner_user_id || '').trim()
    addTarget('user', ownerId)
    const { data: collaborators } = await supabase.from('collaborators').select('id').eq('status', 'activo')
    for (const c of collaborators || []) {
      const cid = String((c as any).id || '').trim()
      addTarget('user', cid)
    }
    const jobs: Array<{ t: { type: 'user' | 'contact'; id: string }; title: string; bodyStr: string; p: Promise<{ ok: boolean; data: any }> }> = []
    for (const t of uniqueTargets.values()) {
      const role = t.type === 'contact' ? 'cliente' : (t.id === ownerId ? 'admin' as const : 'colaborador' as const)
      const tpl = await getTemplate('created', role)
      const title = tpl.title.replace('{{id}}', String(orderKey))
      const bodyStr = tpl.body.replace('{{id}}', String(orderKey))
      const payload = { title, body: bodyStr, icon: absolutize('/img/android-chrome-192x192.png'), badge: absolutize('/img/favicon-32x32.png'), data: { orderId: resolvedId, short_id: ord?.short_id || null, url } }
      const p = sendTo(t.type === 'user' ? { user_id: t.id } : { contact_id: t.id }, payload, correlationId).catch(() => ({ ok: false, data: null }))
      jobs.push({ t, title, bodyStr, p })
    }
    targets = uniqueTargets.size
    const results = await Promise.allSettled(jobs.map(j => j.p))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        sent++
        const j = jobs[i]
        try {
          await supabase.rpc('dispatch_notification', {
            p_user_id: j.t.type === 'user' ? j.t.id : null,
            p_contact_id: j.t.type === 'contact' ? j.t.id : null,
            p_title: j.title,
            p_body: j.bodyStr,
            p_data: { orderId: resolvedId }
          })
        } catch (_) {}
      }
    }
    return jsonResponse({ success: true, event: 'created', targets, sent, correlation_id: correlationId })
  }

  const rpcPayload = { order_id: resolvedId, new_status: body?.status, collaborator_id, extra }
  const { data: rpcData, error: rpcError } = await supabase.rpc('update_order_status', rpcPayload)
  if (rpcError) return jsonResponse({ success: false, error: rpcError.message || 'rpc_error' }, 400)
  const updated = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const dbs = String(updated?.status || '').toLowerCase()
  const uiStatus = dbs === 'pending' ? 'pendiente' : dbs === 'accepted' ? 'aceptada' : dbs === 'completed' ? 'entregada' : dbs === 'cancelled' ? 'cancelada' : 'en_camino_recoger'

  if (String(ord?.assigned_to || collaborator_id || '').trim()) {
    const t = await getTemplate('status_changed', 'colaborador', uiStatus)
    const payload = { title: t.title.replace('{{id}}', String(orderKey)), body: t.body.replace('{{id}}', String(orderKey)), icon: absolutize('/img/android-chrome-192x192.png'), badge: absolutize('/img/favicon-32x32.png'), data: { status: uiStatus, orderId: orderKey, url } }
    const res = await sendTo({ user_id: String(ord?.assigned_to || collaborator_id) }, payload, correlationId)
    targets++
    if (res.ok) sent++
    try { await supabase.rpc('dispatch_notification', { p_user_id: String(ord?.assigned_to || collaborator_id), p_contact_id: null, p_title: payload.title, p_body: payload.body, p_data: { orderId: resolvedId } }) } catch (_) {}
  }
  const clientUserId = String(ord?.client_id || '').trim()
  const contactId = String(ord?.client_contact_id || '').trim()
  if (clientUserId || contactId) {
    const t = await getTemplate('status_changed', 'cliente', uiStatus)
    const payload = { title: t.title.replace('{{id}}', String(orderKey)), body: t.body.replace('{{id}}', String(orderKey)), icon: absolutize('/img/android-chrome-192x192.png'), badge: absolutize('/img/favicon-32x32.png'), data: { status: uiStatus, orderId: orderKey, url } }
    const res = await sendTo(clientUserId ? { user_id: clientUserId } : { contact_id: contactId }, payload, correlationId)
    targets++
    if (res.ok) sent++
    try { await supabase.rpc('dispatch_notification', { p_user_id: clientUserId || null, p_contact_id: clientUserId ? null : contactId, p_title: payload.title, p_body: payload.body, p_data: { orderId: resolvedId } }) } catch (_) {}
  }
  return jsonResponse({ success: true, event: 'status_changed', updated: !!rpcData, targets, sent, correlation_id: correlationId })
  } catch (err) {
    console.error('[order-event] fatal error', err, { correlation_id: correlationId })
    return jsonResponse({ success: false, error: 'internal error' }, 500)
  }
})
