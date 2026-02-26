/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type OrderPayload = Record<string, unknown>

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
const FUNCTIONS_BASE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : ''
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

  console.log('--- Iniciando create-order-and-notify ---');

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'method_not_allowed' }, 405, req)
    }

    const body = await req.json().catch(() => ({})) as { order_payload?: OrderPayload }
    const orderPayload = body.order_payload || {}

    console.log('Payload recibido:', JSON.stringify(orderPayload).substring(0, 100) + '...');

    // 1) Crear la orden mediante RPC existente
    const { data: created, error: rpcErr } = await supabase.rpc('create_order_with_contact', { order_payload: orderPayload })
    if (rpcErr) {
      console.error('Error RPC create_order_with_contact:', rpcErr);
      return jsonResponse({ success: false, error: rpcErr.message || 'create_order_failed' }, 500, req)
    }
    
    const order = Array.isArray(created) ? created[0] : created
    if (!order) {
      console.error('No se devolvió ninguna orden del RPC');
      return jsonResponse({ success: false, error: 'create_order_empty' }, 500, req)
    }

    console.log('Orden creada ID:', order.id, 'ShortID:', order.short_id);

    const orderId = order.id
    const shortId = order.short_id || null
    const toEmail = order.email || null
    const clientName = order.name || null
    const url = buildTrackingUrl(shortId || undefined)

    // 2) Enviar email de confirmación
    let emailSent = false
    if (toEmail) {
      try {
        console.log('Intentando enviar email a:', toEmail);
        const resp = await fetch(`${FUNCTIONS_BASE}/send-order-email`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_ROLE}`
          },
          body: JSON.stringify({ to: toEmail, orderId, shortId, status: 'pending', name: clientName })
        })
        emailSent = resp.ok
        console.log('Respuesta email:', resp.status);
      } catch (e) { 
        console.error('Fallo envío email:', e);
        emailSent = false 
      }
    }

    // 3) Enviar push de confirmación
    let pushSent = false
    try {
      // --- NOTIFICACIÓN AL CLIENTE ---
      let clientOnesignalId = orderPayload.onesignal_player_id || null
      
      if (!clientOnesignalId) {
        if (order.client_id) {
          console.log('Buscando onesignal_id para profile:', order.client_id);
          const { data: profile } = await supabase.from('profiles').select('onesignal_id').eq('id', order.client_id).maybeSingle()
          clientOnesignalId = profile?.onesignal_id
        } else if (order.client_contact_id) {
          console.log('Buscando onesignal_id para client contact:', order.client_contact_id);
          const { data: client } = await supabase.from('clients').select('onesignal_id').eq('id', order.client_contact_id).maybeSingle()
          clientOnesignalId = client?.onesignal_id
        }
      }

      if (clientOnesignalId) {
        console.log('Enviando notificación OneSignal al cliente:', clientOnesignalId);
        const resp = await fetch(`${FUNCTIONS_BASE}/send-onesignal-notification`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_ROLE}`
          },
          body: JSON.stringify({
            player_ids: [clientOnesignalId],
            title: 'Solicitud creada',
            message: `Tu código de seguimiento: ${shortId || orderId}`,
            url
          })
        });
        pushSent = resp.ok;
        console.log('Respuesta OneSignal cliente:', resp.status);
      } else {
        console.log('No se encontró onesignal_id para el cliente.');
      }

      // --- NOTIFICACIÓN A ADMINISTRADORES Y COLABORADORES ---
      console.log('Buscando staff para notificar...');
      const { data: staff, error: staffErr } = await supabase
        .from('collaborators')
        .select('onesignal_id')
        .eq('status', 'activo')
        .not('onesignal_id', 'is', null);

      if (staffErr) {
        console.error('Error buscando staff:', staffErr);
      }

      if (staff && staff.length > 0) {
        const staffIds = staff.map(s => s.onesignal_id).filter(id => id);
        console.log(`Notificando a ${staffIds.length} miembros del staff.`);
        if (staffIds.length > 0) {
          const resp = await fetch(`${FUNCTIONS_BASE}/send-onesignal-notification`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_ROLE}`
            },
            body: JSON.stringify({
              player_ids: staffIds,
              title: '🔔 Nueva Solicitud',
              message: `Nueva orden de ${clientName || 'Cliente'}. Código: ${shortId || orderId}`,
              url: `${SITE_BASE}/inicio.html`
            })
          });
          console.log('Respuesta OneSignal staff:', resp.status);
        }
      }
    } catch (e) { 
      console.error('Error en el flujo de notificaciones push:', e);
      pushSent = false; 
    }

    console.log('--- Fin create-order-and-notify exitoso ---');
    return jsonResponse({ success: true, order, email_sent: emailSent, push_sent: pushSent }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ success: false, error: msg }, 500, req)
  }
})
