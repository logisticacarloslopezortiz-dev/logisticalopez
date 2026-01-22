/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type ReqBody = {
  to?: string
  subject?: string
  html?: string
  orderId?: number | string
  shortId?: string
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

function buildTrackingUrl(orderId?: number | string, shortId?: string): string {
  const base = `${SITE_BASE}/seguimiento.html`
  // Prefer orderId (PK) for URL, fallback to shortId
  const id = orderId ? String(orderId).trim() : (shortId ? String(shortId).trim() : '')
  if (!id) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}orderId=${encodeURIComponent(id)}`
}

function normalizeStatus(raw?: string): string {
  const s = String(raw || '').toLowerCase().trim().replace(/[\s_-]+/g, ' ')
  if (!s) return ''
  if (s.includes('in progress') || s.includes('procesando')) return 'cargando'
  if (s.includes('in process')) return 'cargando'
  if (s.includes('in prosend')) return 'cargando'
  if (s.includes('cargando')) return 'cargando'
  if (s.includes('en camino') && s.includes('recoger')) return 'en_camino_recoger'
  if (s.includes('en camino') && s.includes('entregar')) return 'en_camino_entregar'
  if (s.includes('entregada')) return 'entregada'
  if (s.includes('completed') || s.includes('completada')) return 'completada'
  if (s.includes('cancelled') || s.includes('cancelada')) return 'cancelada'
  if (s.includes('accepted') || s.includes('asignad')) return 'asignado'
  return ''
}

function templateForStatus(status?: string, orderId?: number | string, shortId?: string, name?: string) {
  const s = normalizeStatus(status)
  // Display Short ID if available, else Order ID
  const displayId = shortId ? `${shortId}` : (orderId ? `#${orderId}` : '')
  
  const titleMap: Record<string, string> = {
    asignado: '¡Orden Asignada!',
    accepted: '¡Orden Asignada!',
    en_camino_recoger: 'Conductor en camino',
    cargando: 'Carga en proceso',
    en_camino_entregar: 'En ruta de entrega',
    entregada: '¡Entrega exitosa!',
    completada: 'Servicio completado',
    cancelada: 'Orden cancelada'
  }
  
  const bodyMap: Record<string, string> = {
    asignado: 'Nos alegra informarte que tu orden ha sido asignada correctamente. Uno de nuestros colaboradores ya está preparado para iniciar el servicio y cuidar cada detalle de tu envío.',
    accepted: 'Nos alegra informarte que tu orden ha sido asignada correctamente. Uno de nuestros colaboradores ya está preparado para iniciar el servicio y cuidar cada detalle de tu envío.',
    en_camino_recoger: 'Tu orden está avanzando. Nuestro colaborador se encuentra en camino al punto de recogida para dar inicio al proceso de transporte de tu carga.',
    cargando: 'Tu carga ya está siendo preparada. En este momento nuestro equipo se encuentra realizando el proceso de carga, asegurando que todo se maneje de forma segura y organizada.',
    en_camino_entregar: '¡Buenas noticias! Tu carga ya va en ruta hacia el destino final. Nuestro compromiso es entregarla de manera segura y en el menor tiempo posible.',
    entregada: 'Tu orden ha sido entregada exitosamente. Agradecemos la confianza que depositaste en Logística López Ortiz. Seguimos trabajando para ofrecerte un servicio puntual y confiable.',
    completada: 'El proceso de tu orden ha sido completado con éxito. Gracias por permitirnos ser parte de tu logística. Estamos a tu disposición para futuros envíos.',
    cancelada: 'Tu orden ha sido cancelada. Si esta acción no fue realizada por ti o necesitas más información, nuestro equipo de soporte está disponible para asistirte.'
  }
  
  const title = titleMap[s] || `Actualización de tu orden`
  const body = bodyMap[s] || `El estado de tu orden ha sido actualizado.`
  const url = buildTrackingUrl(orderId, shortId)
  const customer = name ? `${name}` : 'Cliente'
  const subject = `Actualización de Orden ${displayId} - Logística López Ortiz`.trim()
  
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F9FAFB;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.05);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
          
          <!-- HEADER -->
          <tr>
            <td style="background-color:#0C375D;padding:24px;text-align:center;">
              <img 
                src="${SITE_BASE}/img/1vertical.png" 
                alt="Logística López Ortiz" 
                width="180"
                style="display:block;margin:auto;border:0;outline:none;text-decoration:none;"
              />
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:32px;color:#374151;">
              <h2 style="margin:0 0 12px;color:#0C375D;">
                ${title}
              </h2>

              <p style="margin:0 0 16px;font-size:16px;">
                Hola <strong>${customer}</strong>,
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
                ${body}
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
                En <strong>Logística López Ortiz</strong> trabajamos para que tu envío sea seguro,
                puntual y confiable. Puedes consultar el estado de tu orden en cualquier momento.
              </p>

              <!-- CTA -->
              <div style="text-align:center;margin:32px 0;">
                <a href="${url}" 
                  style="
                    background-color:#0C375D;
                    color:#ffffff;
                    text-decoration:none;
                    padding:14px 24px;
                    border-radius:10px;
                    font-weight:600;
                    display:inline-block;
                  ">
                  Ver seguimiento de mi orden
                </a>
              </div>

              <p style="font-size:14px;color:#6B7280;text-align:center;">
                Orden ${displayId}
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#F3F4F6;padding:20px;text-align:center;font-size:12px;color:#6B7280;">
              <p style="margin:0 0 6px;">
                © ${new Date().getFullYear()} Logística López Ortiz
              </p>
              <p style="margin:0;">
                Transporte & Logística • República Dominicana
              </p>
              <p style="margin:6px 0 0;">
                <a href="https://logisticalopezortiz.com" style="color:#0C375D;text-decoration:none;">
                  logisticalopezortiz.com
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
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
    const shortId = body.shortId
    const status = body.status
    const name = body.name

    if (!to) {
      return jsonResponse({ success: false, error: 'missing_to' }, 400, req)
    }

    if (!subject || !html) {
      const tpl = templateForStatus(status, orderId, shortId, name)
      subject = subject || tpl.subject
      html = html || tpl.html
    }

    const sent = await sendEmailWithResend(to, subject, html)
    await logFn({ to, orderId, shortId, status, result: sent }, sent.ok ? 'info' : 'error', sent.ok ? 'email_sent' : 'email_failed')
    if (!sent.ok) {
      return jsonResponse({ success: false, error: sent.error, details: sent.details }, 500, req)
    }
    return jsonResponse({ success: true, id: (sent.data as any)?.id || null }, 200, req)
  } catch (err) {
    await logFn({ error: String(err) }, 'error', 'fatal_error')
    return jsonResponse({ success: false, error: 'internal_error' }, 500, req)
  }
})
