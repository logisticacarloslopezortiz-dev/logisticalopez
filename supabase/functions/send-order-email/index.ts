/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type ReqBody = {
  to?: string
  subject?: string
  html?: string
  orderId?: number | string
  status?: string
  name?: string
}

const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''

const supabase: any = (SUPABASE_URL && SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

function buildTrackingUrl(orderId?: number | string): string {
  const base = `${SITE_BASE}/seguimiento.html`
  if (!orderId) return base
  const id = String(orderId).trim()
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}orderId=${encodeURIComponent(id)}`
}

function templateForStatus(status?: string, orderId?: number | string, name?: string) {
  const s = String(status || '').toLowerCase()
  const titleMap: Record<string, string> = {
    asignado: 'Orden asignada',
    accepted: 'Orden asignada',
    en_camino_recoger: 'Colaborador en camino a recoger',
    cargando: 'Carga en proceso',
    en_camino_entregar: 'En ruta hacia entrega',
    entregada: 'Orden entregada',
    completada: 'Orden completada',
    cancelada: 'Orden cancelada'
  }
  const bodyMap: Record<string, string> = {
    asignado: 'Un colaborador ha aceptado tu orden y se prepara para el servicio.',
    accepted: 'Un colaborador ha aceptado tu orden y se prepara para el servicio.',
    en_camino_recoger: 'El colaborador va en camino al punto de recogida.',
    cargando: 'El colaborador ha llegado y está cargando tu pedido.',
    en_camino_entregar: 'Tu carga va en camino hacia el destino de entrega.',
    entregada: 'Tu orden ha sido entregada con éxito. ¡Gracias por confiar en Logística López Ortiz!',
    completada: 'Tu orden ha sido completada exitosamente.',
    cancelada: 'Tu orden ha sido cancelada. Si necesitas ayuda, contáctanos.'
  }
  const title = titleMap[s] || `Actualización de tu orden`
  const body = bodyMap[s] || `El estado de tu orden ha cambiado a: ${status || 'actualizado'}.`
  const url = buildTrackingUrl(orderId)
  const customer = name ? `${name}` : 'Cliente'
  const subject = `Actualización de Orden ${orderId ? `#${orderId}` : ''} - Logística López Ortiz`.trim()
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111827;">
      <h2 style="color:#0C375D;margin:0 0 12px 0;">${title}</h2>
      <p style="margin:0 0 12px 0;">Hola ${customer},</p>
      <p style="margin:0 0 12px 0;">${body}</p>
      <p style="margin:0 0 16px 0;">Puedes ver el seguimiento en tiempo real aquí:</p>
      <p>
        <a href="${url}" style="background-color:#0C375D;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;">
          Ver Seguimiento
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#6b7280;margin:0;">Logística López Ortiz • https://logisticalopezortiz.com</p>
    </div>
  `
  return { subject, html }
}

async function sendEmailWithResend(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'missing_resend_api_key' }
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Logística López Ortiz <no-reply@logisticalopezortiz.com>',
      to: [to],
      subject,
      html
    })
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return { ok: false, error: `resend_error_${resp.status}`, details: text }
  }
  const data = await resp.json().catch(() => ({}))
  return { ok: true, data }
}

async function logFn(payload: unknown, level: 'info' | 'error' | 'warning' = 'info', message?: string) {
  try {
    if (!supabase) return
    await supabase.from('function_logs').insert({
      fn_name: 'send-order-email',
      level,
      message: message || null,
      payload
    })
  } catch (_) {}
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json().catch(() => ({})) as ReqBody
    const to = String(body.to || '').trim()
    let subject = String(body.subject || '').trim()
    let html = String(body.html || '').trim()
    const orderId = body.orderId
    const status = body.status
    const name = body.name

    if (!to) {
      return jsonResponse({ success: false, error: 'missing_to' }, 400, req)
    }

    if (!subject || !html) {
      const tpl = templateForStatus(status, orderId, name)
      subject = subject || tpl.subject
      html = html || tpl.html
    }

    const sent = await sendEmailWithResend(to, subject, html)
    await logFn({ to, orderId, status, result: sent }, sent.ok ? 'info' : 'error', sent.ok ? 'email_sent' : 'email_failed')
    if (!sent.ok) {
      return jsonResponse({ success: false, error: sent.error, details: sent.details }, 500, req)
    }
    return jsonResponse({ success: true, id: (sent.data as any)?.id || null }, 200, req)
  } catch (err) {
    await logFn({ error: String(err) }, 'error', 'fatal_error')
    return jsonResponse({ success: false, error: 'internal_error' }, 500, req)
  }
})
