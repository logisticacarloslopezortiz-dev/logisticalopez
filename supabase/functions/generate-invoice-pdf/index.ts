/// <reference path="../globals.d.ts" />
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'
import {
  PDFDocument,
  rgb,
  StandardFonts
} from 'https://esm.sh/pdf-lib@1.17.1'


// ----------------------------
// TYPES
// ----------------------------

type OrderDataMinimal = {
  id: number
  short_id?: string
  monto_cobrado?: number
  client_id?: string | null
  client_email?: string | null
  email?: string | null
  client_contact_id?: string | null
  name?: string
  phone?: string
  pickup?: string
  delivery?: string
  date?: string
  time?: string
  metodo_pago?: string
  status?: string
  business_id?: number
  service?: { name?: string }
  vehicle?: { name?: string }
}

type BusinessDataMinimal = {
  business_name?: string
  address?: string | null
  phone?: string | null
  email?: string | null
  rnc?: string | null
}


// ----------------------------
// PDF GENERATOR
// ----------------------------

async function generateInvoicePDF(
  order: OrderDataMinimal,
  business: BusinessDataMinimal
): Promise<Uint8Array> {

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const brandDark = rgb(30 / 255, 64 / 255, 90 / 255)
  const brandTurq = rgb(30 / 255, 138 / 255, 149 / 255)

  // ---- LOGO ----
    const fetchLogo = async () => {
      const urls = [
        'https://logisticalopezortiz.com/img/1horizontal%20(1).png',
        'https://logisticalopezortiz.com/img/1vertical.png',
        'https://logisticalopezortiz.com/img/android-chrome-512x512.png'
      ]
      for (const url of urls) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 2000) // 2s timeout per logo
          
          const res = await fetch(url, { signal: controller.signal })
          clearTimeout(timeoutId)
          
          if (!res.ok) continue
          const buf = await res.arrayBuffer()
          return await pdfDoc.embedPng(buf)
        } catch (_e) {
          // console.warn('Logo fetch failed', _e)
        }
      }
      return null
    }

  const logo = await fetchLogo()

  // ---- HEADER ----
  const addPage = () => {
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()

    page.drawRectangle({
      x: 0,
      y: height - 60,
      width,
      height: 60,
      color: brandDark
    })

    page.drawRectangle({
      x: width - 100,
      y: height - 60,
      width: 100,
      height: 60,
      color: brandTurq
    })

    page.drawText(business.business_name || 'Logística López Ortiz', {
      x: 40,
      y: height - 30,
      font: boldFont,
      size: 18,
      color: rgb(1, 1, 1)
    })

    page.drawText(`RNC: ${business.rnc || 'N/A'}`, {
      x: 40,
      y: height - 45,
      font,
      size: 10,
      color: rgb(1, 1, 1)
    })

    if (logo) {
      page.drawImage(logo, {
        x: width - 60,
        y: height - 48,
        width: 36,
        height: 36
      })
    }

    return page
  }

  let page = addPage()
  let { width, height } = page.getSize()
  const margin = 40
  let y = height - 80

  // -------- UTILS ----------
  const wrapText = (text: string, max: number, f: any, size: number) => {
    // Mejora: manejar saltos de línea explícitos en el texto de entrada
    const paragraphs = String(text || '').split('\n')
    const lines: string[] = []

    for (const paragraph of paragraphs) {
      const words = paragraph.split(' ')
      let current = ''

      for (const w of words) {
        const test = current ? current + ' ' + w : w
        if (f.widthOfTextAtSize(test, size) > max) {
          if (current) lines.push(current)
          current = w
        } else {
          current = test
        }
      }
      if (current) {
        // Break long words if necessary
        if (f.widthOfTextAtSize(current, size) > max) {
          let remaining = current
          while (remaining) {
            let chunk = remaining
            while (f.widthOfTextAtSize(chunk, size) > max && chunk.length > 1) {
              chunk = chunk.slice(0, -1)
            }
            lines.push(chunk)
            remaining = remaining.slice(chunk.length)
          }
        } else {
          lines.push(current)
        }
      }
    }
    return lines
  }

  const ensureSpace = (h: number) => {
    // Margen de seguridad aumentado
    if (y - h < margin + 20) {
      page = addPage()
      const s = page.getSize()
      width = s.width
      height = s.height
      y = height - 80
    }
  }

  const drawLabelValue = (label: string, value: string, labelW = 140) => {
    const max = width - margin * 2 - labelW
    const vlines = wrapText(value || 'N/A', max, font, 11)
    // Cálculo de altura más preciso
    const h = Math.max(16, vlines.length * 14)

    ensureSpace(h + 4)

    page.drawText(label, {
      x: margin,
      y: y - 10, // Ajuste para alineación visual
      font: boldFont,
      size: 11,
      color: rgb(0.2, 0.2, 0.2)
    })

    // Dibujar cada línea del valor
    vlines.forEach((line, i) => {
      page.drawText(line, {
        x: margin + labelW,
        y: y - 10 - (i * 14),
        font,
        size: 11,
        color: rgb(0, 0, 0)
      })
    })

    y -= (h + 8) // Espacio extra entre filas
  }

  // TITLE
  page.drawText(`Factura Orden #${order.short_id || order.id}`, {
    x: margin,
    y,
    font: boldFont,
    size: 15,
    color: brandDark
  })
  y -= 18

  page.drawText(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, {
    x: margin,
    y,
    font,
    size: 10
  })
  y -= 22

  page.drawText('Facturar a:', {
    x: margin,
    y,
    font: boldFont,
    size: 12,
    color: brandTurq
  })
  y -= 14

  drawLabelValue('Nombre:', order.name || 'N/A')
  drawLabelValue('Teléfono:', order.phone || 'N/A')

  const addrParts = []
  if (business.address) addrParts.push(business.address)
  if (business.phone) addrParts.push(business.phone)

  page.drawText(addrParts.join(' | '), {
    x: margin,
    y,
    font,
    size: 10
  })
  y -= 22

  // ----------------------------
  // SERVICE DETAILS
  // ----------------------------

  page.drawText('Detalles del Servicio', {
    x: margin,
    y,
    font: boldFont,
    size: 12,
    color: brandTurq
  })
  y -= 16

  const tableX = margin
  const tableW = width - margin * 2
  const col1 = 160

  const statusMap: Record<string, string> = {
    pending: 'Pendiente',
    accepted: 'Aceptada',
    in_progress: 'En proceso',
    completed: 'Completada',
    cancelled: 'Cancelada'
  }

  const drawRow = (label: string, value: string, bold = false) => {
    const f = bold ? boldFont : font
    const lines = wrapText(value || 'N/A', tableW - col1 - 16, f, 11)
    const h = Math.max(20, lines.length * 14)

    ensureSpace(h + 2)

    page.drawRectangle({
      x: tableX,
      y: y - h,
      width: tableW,
      height: h,
      borderColor: rgb(.85, .85, .85),
      borderWidth: .5
    })

    page.drawText(label, {
      x: tableX + 8,
      y: y - 14,
      font: f,
      size: 11
    })

    lines.forEach((line, i) => {
      page.drawText(line, {
        x: tableX + col1,
        y: y - 14 - (i * 14),
        font: f,
        size: 11
      })
    })

    y -= h
  }

  drawRow('Servicio', order.service?.name || 'N/A')
  drawRow('Vehículo', order.vehicle?.name || 'N/A')
  drawRow('Origen', order.pickup || 'N/A')
  drawRow('Destino', order.delivery || 'N/A')
  drawRow('Fecha y Hora', `${order.date || ''} ${order.time || ''}`.trim())
  drawRow('Estado Actual', statusMap[order.status ?? ''] || 'N/A')
  drawRow('Método de Pago', order.metodo_pago || 'N/A')
  drawRow(
    'MONTO TOTAL',
    `$${(order.monto_cobrado || 0).toLocaleString('es-DO', {
      minimumFractionDigits: 2
    })}`,
    true
  )

  return await pdfDoc.save()
}



// -------------------------------------------------------
// MAIN HANDLER
// -------------------------------------------------------

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supaUrl || !supaKey) {
      return jsonResponse({ error: 'config_error' }, 500, req)
    }

    const supabase: SupabaseClient = createClient(supaUrl, supaKey)

    const body = await req.json().catch(() => null)
    const orderId = body?.orderId

    if (!orderId) {
      return jsonResponse({ error: 'missing_orderId' }, 400, req)
    }

    const isNum = /^\d+$/.test(String(orderId))

    const q = supabase
      .from('orders')
      .select('*, service:services(name), vehicle:vehicles(name), collaborator:assigned_to(name)')

    const { data: order, error: oErr } = isNum
      ? await q.eq('id', Number(orderId)).single()
      : await q.eq('short_id', String(orderId)).single()

    if (oErr || !order) {
      return jsonResponse({ error: 'order_not_found' }, 404, req)
    }

    const { data: business, error: bErr } = await supabase
      .from('business')
      .select('*')
      .eq('id', order.business_id)
      .single()

    if (bErr || !business) {
      return jsonResponse({ error: 'business_not_found' }, 404, req)
    }

    const pdfBytes = await generateInvoicePDF(order, business)

    if (!pdfBytes || pdfBytes.length < 500) {
      return jsonResponse({ error: 'pdf_invalid' }, 500, req)
    }

    // Storage filename
    const invoiceNum = `INV-${order.short_id || order.id}`
    const filePath = `${order.client_id || 'anon'}/${invoiceNum}.pdf`

    // Upload
    const { error: uploadErr } = await supabase.storage
      .from('invoices')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (uploadErr) {
      return jsonResponse({ error: 'upload_failed', details: uploadErr }, 500, req)
    }

    // Public URL
    const { data: pub } = supabase.storage.from('invoices').getPublicUrl(filePath)
    const pdfUrl = (pub as any)?.publicUrl

    if (!pdfUrl) {
      return jsonResponse({ error: 'public_url_failed' }, 500, req)
    }

    // ----------------------------
    // SEND EMAIL
    // ----------------------------
    let emailResult = { success: false, messageId: null }
    const clientEmail = order.client_email || order.email
    
    if (clientEmail) {
       try {
         emailResult = await sendEmailWithInvoice(order, clientEmail, pdfUrl, invoiceNum)
       } catch (emailErr) {
         console.error('Email sending failed:', emailErr)
       }
    }

    return jsonResponse(
      {
        success: true,
        pdfUrl,
        filePath,
        invoiceNumber: invoiceNum,
        emailSent: emailResult.success
      },
      200,
      req
    )

  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, req)
  }
})

async function sendEmailWithInvoice(order: any, email: string, pdfUrl: string, invoiceNumber: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const defaultFrom = 'transporteylogisticalopezortiz@gmail.com'
  const from = Deno.env.get('RESEND_FROM') || defaultFrom
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || defaultFrom
  
  const orderIdForDisplay = order.short_id || order.id
  const trackingLink = `https://logisticalopezortiz.com/seguimiento.html`

  if (!apiKey) return { success: false, messageId: null }

  const subject = `✅ Solicitud Aceptada y Factura - Orden #${orderIdForDisplay} | Logística López Ortiz`
  
  const html = `
    <div style="background-color: #f4f4f4; padding: 20px; font-family: Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
        <div style="background-color: #1E405A; padding: 20px; text-align: center;">
          <img src="https://logisticalopezortiz.com/img/1vertical.png" alt="Logística López Ortiz" style="max-width: 150px; height: auto;">
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #1E405A; font-size: 24px; margin-top: 0;">¡Tu solicitud ha sido aceptada!</h2>
          <p style="color: #555555; line-height: 1.6;">Hola,</p>
          <p style="color: #555555; line-height: 1.6;">Nos complace informarte que tu solicitud de servicio ha sido aceptada y está siendo procesada.</p>
          <p style="color: #555555; line-height: 1.6;">Puedes darle seguimiento en tiempo real usando el siguiente número de orden:</p>
          <div style="background-color: #f0f5f9; border: 1px dashed #1E8A95; padding: 15px; text-align: center; margin: 20px 0; border-radius: 5px;">
            <p style="font-size: 28px; font-weight: bold; color: #1E405A; margin: 0;">${orderIdForDisplay}</p>
          </div>
          <p style="color: #555555; line-height: 1.6;">Simplemente ingresa ese número en nuestra página de seguimiento.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${trackingLink}" style="display: inline-block; padding: 14px 28px; background-color: #1E8A95; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Ir a la Página de Seguimiento</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">
          <h3 style="color: #1E405A; font-size: 20px;">Detalles de tu Factura</h3>
          <p style="color: #555555; line-height: 1.6;">Tu factura ha sido generada.</p>
          <p style="color: #555555; line-height: 1.6;"><strong>Número de Factura:</strong> ${invoiceNumber}</p>
          <p style="color: #555555; line-height: 1.6;"><strong>Total:</strong> ${(order.monto_cobrado || 0).toLocaleString('es-DO', { style: 'currency', currency: 'DOP' })}</p>
          
          <p style="color: #555555; line-height: 1.6; margin-top: 20px;">Puede ver y descargar su factura desde el siguiente enlace seguro:</p>
          <p style="margin: 20px 0;">
            <a href="${pdfUrl}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline; font-size: 16px;">Descargar factura (PDF)</a>
          </p>

          <p style="color: #555555; line-height: 1.6; margin-top: 30px;">Gracias por confiar en Logística López Ortiz.</p>
        </div>
        <div style="background-color: #f4f4f4; color: #888888; padding: 20px; text-align: center; font-size: 12px;">
          <p>Este es un correo electrónico generado automáticamente. Por favor, no respondas a este mensaje.</p>
          <p>&copy; ${new Date().getFullYear()} Logística López Ortiz. Todos los derechos reservados.</p>
        </div>
      </div>
    </div>
  `

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: email, subject, html, reply_to: replyTo })
  })

  const j = await r.json().catch(() => ({}))
  return { success: r.ok && !!j?.id, messageId: j?.id || null }
}
