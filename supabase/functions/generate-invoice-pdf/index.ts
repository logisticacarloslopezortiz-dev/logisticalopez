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
        const res = await fetch(url)
        if (!res.ok) continue
        const buf = await res.arrayBuffer()
        return await pdfDoc.embedPng(buf)
      } catch (_e) {}
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
    const words = String(text || '').split(' ')
    const lines: string[] = []
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
    if (current) lines.push(current)
    return lines
  }

  const ensureSpace = (h: number) => {
    if (y - h < margin) {
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
    const h = Math.max(16, vlines.length * 14)

    ensureSpace(h + 4)

    page.drawText(label, {
      x: margin,
      y,
      font: boldFont,
      size: 11
    })

    page.drawText(vlines.join('\n'), {
      x: margin + labelW,
      y,
      font,
      size: 11
    })

    y -= h
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

    page.drawText(lines.join('\n'), {
      x: tableX + col1,
      y: y - 14,
      font: f,
      size: 11
    })

    y -= h
  }

  drawRow('Servicio', order.service?.name || 'N/A')
  drawRow('Vehículo', order.vehicle?.name || 'N/A')
  drawRow('Origen', order.pickup || 'N/A')
  drawRow('Destino', order.delivery || 'N/A')
  drawRow('Fecha y Hora', `${order.date || ''} ${order.time || ''}`.trim())
  drawRow('Estado Actual', order.status || 'N/A')
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
      .select('*, service:services(name), vehicle:vehicles(name)')

    const { data: order, error: oErr } = isNum
      ? await q.eq('id', Number(orderId)).single()
      : await q.eq('short_id', String(orderId)).single()

    if (oErr || !order) {
      return jsonResponse({ error: 'order_not_found' }, 404, req)
    }

    const { data: business, error: bErr } = await supabase
      .from('business')
      .select('*')
      .eq('id', 1)
      .single()

    if (bErr || !business) {
      return jsonResponse({ error: 'business_not_found' }, 404, req)
    }

    const pdfBytes = await generateInvoicePDF(order, business)

    // Storage filename
    const invoiceNum = `INV-${order.short_id || order.id}`
    const filePath = `${order.client_id || 'anon'}/${invoiceNum}-${Date.now()}.pdf`

    // Ensure bucket exists
    await supabase.storage.createBucket('invoices', { public: true }).catch(() => {})

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

    return jsonResponse(
      {
        success: true,
        pdfUrl,
        filePath,
        invoiceNumber: invoiceNum
      },
      200,
      req
    )

  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, req)
  }
})
