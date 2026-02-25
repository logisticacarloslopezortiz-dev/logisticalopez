/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type OrderPayload = Record<string, unknown>

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
const FUNCTIONS_BASE = SUPABASE_URL ? SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') : ''
const SITE_BASE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com').trim()
const SEND_NOTIFICATION_SECRET = (Deno.env.get('SEND_NOTIFICATION_SECRET') || '').trim()
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })

function buildTrackingUrl(shortId?: string): string {
  const base = `${SITE_BASE}/seguimiento.html`
  const code = shortId ? String(shortId).trim() : ''
  if (!code) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}codigo=${encodeURIComponent(code)}`
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'method_not_allowed' }, 405, req)
    }

    const body = await req.json().catch(() => ({})) as { order_payload?: OrderPayload }
    const orderPayload = body.order_payload || {}

    // 1) Crear la orden mediante RPC existente (maneja clientes anónimos y push_subscription)
    const { data: created, error: rpcErr } = await supabase.rpc('create_order_with_contact', { order_payload: orderPayload })
    if (rpcErr) {
      return jsonResponse({ success: false, error: rpcErr.message || 'create_order_failed' }, 500, req)
    }
    const order = Array.isArray(created) ? created[0] : created
    if (!order) {
      return jsonResponse({ success: false, error: 'create_order_empty' }, 500, req)
    }

    const orderId = order.id
    const shortId = order.short_id || null
    const toEmail = order.email || null
    const clientName = order.name || null
    const url = buildTrackingUrl(shortId || undefined)

    // 2) Enviar email de confirmación (solo si tenemos correo)
    let emailSent = false
    if (toEmail) {
      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/send-order-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: toEmail, orderId, shortId, status: 'pending', name: clientName })
        })
        emailSent = resp.ok
      } catch (_) { emailSent = false }
    }

    // 3) Enviar push de confirmación (si hay cliente o contacto asociado)
    let pushSent = false
    try {
      // --- NOTIFICACIÓN AL CLIENTE ---
      let clientOnesignalId = null
      if (order.client_id) {
        const { data: profile } = await supabase.from('profiles').select('onesignal_id').eq('id', order.client_id).single()
        clientOnesignalId = profile?.onesignal_id
      } else if (order.client_contact_id) {
        const { data: client } = await supabase.from('clients').select('onesignal_id').eq('id', order.client_contact_id).single()
        clientOnesignalId = client?.onesignal_id
      }

      if (clientOnesignalId) {
        await fetch(`${FUNCTIONS_BASE}/send-onesignal-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_ids: [clientOnesignalId],
            title: 'Solicitud creada',
            message: `Tu código de seguimiento: ${shortId || orderId}`,
            url
          })
        }).then(r => pushSent = r.ok).catch(() => {})
      }

      // --- NOTIFICACIÓN A ADMINISTRADORES Y COLABORADORES ---
      // Obtener todos los administradores y colaboradores activos que tengan OneSignal ID
      const { data: staff } = await supabase
        .from('collaborators')
        .select('onesignal_id')
        .eq('status', 'activo')
        .not('onesignal_id', 'is', null);

      if (staff && staff.length > 0) {
        const staffIds = staff.map(s => s.onesignal_id).filter(id => id);
        if (staffIds.length > 0) {
          await fetch(`${FUNCTIONS_BASE}/send-onesignal-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              player_ids: staffIds,
              title: '🔔 Nueva Solicitud',
              message: `Nueva orden de ${clientName || 'Cliente'}. Código: ${shortId || orderId}`,
              url: `${SITE_BASE}/inicio.html` // Llevar al admin al inicio
            })
          }).catch(e => console.error('Error notifying staff:', e));
        }
      }
    } catch (e) { 
      console.error('Error in push notification flow:', e);
      pushSent = false; 
    }

    return jsonResponse({ success: true, order, email_sent: emailSent, push_sent: pushSent }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ success: false, error: msg }, 500, req)
  }
})
