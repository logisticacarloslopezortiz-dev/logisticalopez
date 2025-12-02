/// <reference path="../globals.d.ts" />
import { createClient } from '@supabase/supabase-js'
import { handleCors, jsonResponse } from '../cors-config.ts'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

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
  address?: string
  phone?: string
  email?: string
  rnc?: string
}

async function generateInvoicePDF(order: OrderDataMinimal, business: BusinessDataMinimal): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const brandDark = rgb(30 / 255, 64 / 255, 90 / 255)
  const brandTurq = rgb(30 / 255, 138 / 255, 149 / 255)

  const fetchLogo = async () => {
    const tryUrls = [
      'https://logisticalopezortiz.com/img/1horizontal%20(1).png',
      'https://logisticalopezortiz.com/img/1vertical.png',
      'https://logisticalopezortiz.com/img/android-chrome-512x512.png'
    ]
    for (const url of tryUrls) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const buf = await res.arrayBuffer()
        return await pdfDoc.embedPng(buf)
      } catch (_) { /* next */ }
    }
    return null
  }

  const logo = await fetchLogo()

  const addPageWithHeader = () => {
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: brandDark })
    page.drawRectangle({ x: width - 100, y: height - 60, width: 100, height: 60, color: brandTurq })
    page.drawText(business.business_name || 'Logística López Ortiz', { x: 40, y: height - 30, font: boldFont, size: 18, color: rgb(1, 1, 1) })
    page.drawText(`RNC: ${business.rnc || 'N/A'}`, { x: 40, y: height - 45, font, size: 10, color: rgb(1, 1, 1) })
    if (logo) {
      const w = 36, h = 36
      page.drawImage(logo, { x: width - 60, y: height - 48, width: w, height: h })
    }
    return page
  }

  let page = addPageWithHeader()
  let { width, height } = page.getSize()
  const margin = 40
  let y = height - 80

  const wrapText = (text: string, maxWidth: number, fontRef: any, size: number): string[] => {
    const words = String(text || '').split(' ')
    const lines: string[] = []
    let current = ''
    for (const w of words) {
      const test = current ? current + ' ' + w : w
      const tw = fontRef.widthOfTextAtSize(test, size)
      if (tw > maxWidth) { if (current) lines.push(current); current = w } else { current = test }
    }
    if (current) lines.push(current)
    return lines
  }

  const ensureSpace = (needed = 16) => {
    if (y - needed < margin) {
      page = addPageWithHeader()
      const s = page.getSize()
      width = s.width; height = s.height
      y = height - 80
    }
  }

  const drawTextBlock = (text: string, size = 11, lineHeight = 14, x = margin, maxW = width - margin * 2, color = rgb(0, 0, 0), fontRef = font) => {
    const lines = wrapText(String(text || ''), maxW, fontRef, size)
    const h = Math.max(lineHeight, lines.length * lineHeight)
    ensureSpace(h + 4)
    page.drawText(lines.join('\n'), { x, y, font: fontRef, size, color })
    y -= h
  }

  const drawLabelValue = (label: string, value: string, labelW = 140) => {
    const maxW = width - margin * 2 - labelW
    const vLines = wrapText(String(value || 'N/A'), maxW, font, 11)
    const h = Math.max(16, vLines.length * 14)
    ensureSpace(h + 2)
    page.drawText(label, { x: margin, y: y, font: boldFont, size: 11 })
    page.drawText(vLines.join('\n'), { x: margin + labelW, y: y, font: font, size: 11 })
    y -= h
  }

  page.drawText(`Factura Orden #${order.short_id || order.id}`, { x: margin, y, font: boldFont, size: 15, color: brandDark })
  y -= 18
  page.drawText(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, { x: margin, y, font, size: 10 })
  y -= 22

  page.drawText('Facturar a:', { x: margin, y, font: boldFont, size: 12, color: brandTurq })
  y -= 14
  drawLabelValue('Nombre:', order.name || 'N/A')
  drawLabelValue('Teléfono:', order.phone || 'N/A')
  const addrLine = `${business.address || ''} ${business.phone ? '| ' + business.phone : ''}`
  drawTextBlock(addrLine, 10)

  y -= 10
  page.drawText('Detalles del Servicio', { x: margin, y, font: boldFont, size: 12, color: brandTurq })
  y -= 14

  const tableX = margin
  const tableW = width - margin * 2
  const col1 = 160

  const drawRow = (label: string, value: string, strong = false) => {
    const fontRef = strong ? boldFont : font
    const vLines = wrapText(String(value || ''), tableW - col1 - 16, fontRef, 11)
    const rowH = Math.max(20, vLines.length * 14)
    ensureSpace(rowH + 2)
    page.drawRectangle({ x: tableX, y: y - rowH, width: tableW, height: rowH, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 })
    page.drawText(label, { x: tableX + 8, y: y - 14, font: fontRef, size: 11 })
    page.drawText(vLines.join('\n'), { x: tableX + col1, y: y - 14, font: fontRef, size: 11 })
    y -= rowH
  }

  drawRow('Servicio', order.service?.name || 'N/A')
  drawRow('Vehículo', order.vehicle?.name || 'N/A')
  drawRow('Origen', order.pickup || 'N/A')
  drawRow('Destino', order.delivery || 'N/A')
  drawRow('Fecha y Hora', `${order.date || ''} ${order.time || ''}`)
  drawRow('Estado Actual', order.status || 'N/A')
  drawRow('Método de Pago', order.metodo_pago || 'No especificado')
  drawRow('MONTO TOTAL', `$${(order.monto_cobrado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`, true)

  const pdfBytes = await pdfDoc.save()
  return pdfBytes
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return jsonResponse({ error: 'config_error' }, 500, req)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE) as unknown as SupabaseClientLike
    const { orderId } = await req.json()
    if (!orderId) return jsonResponse({ error: 'missing_orderId' }, 400, req)

    const isNumericId = typeof orderId === 'number' || (typeof orderId === 'string' && /^\d+$/.test(orderId))
    const q = supabase.from('orders').select('*, service:services(name), vehicle:vehicles(name)') as SelectOrdersBuilder
    const { data: order, error: orderError } = isNumericId ? await q.eq('id', Number(orderId)).single() : await q.eq('short_id', String(orderId)).single()
    if (orderError || !order) return jsonResponse({ error: 'order_not_found' }, 404, req)

    const { data: business, error: businessError } = await supabase.from('business').select('*').eq('id', 1).single()
    if (businessError || !business) return jsonResponse({ error: 'business_not_found' }, 404, req)

    const pdfBytes = await generateInvoicePDF(order as OrderDataMinimal, business as BusinessDataMinimal)
    const invoiceNumber = `INV-${order.short_id || order.id}`
    const filePath = `${order.client_id || 'anon'}/${invoiceNumber}-${Date.now()}.pdf`

    try { await supabase.storage.createBucket('invoices', { public: true }) } catch (_) {}
    const { error: uploadError } = await supabase.storage.from('invoices').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) return jsonResponse({ error: 'upload_failed' }, 500, req)

    const { data: pub } = await supabase.storage.from('invoices').getPublicUrl(filePath)
    const pdfUrl = (pub && (pub as any).publicUrl) || null
    if (!pdfUrl) return jsonResponse({ error: 'public_url_failed' }, 500, req)

    return jsonResponse({ success: true, pdfUrl, filePath, invoiceNumber }, 200, req)
  } catch (e) {
    const err = e instanceof Error ? e.message : 'unknown_error'
    return jsonResponse({ error: err }, 500, req)
  }
})

type QueryBuilder = {
  eq: (column: string, value: string | number) => QueryBuilder
  single: () => Promise<{ data?: any; error?: any }>
  maybeSingle: () => Promise<{ data?: any; error?: any }>
}

type SupabaseClientLike = {
  from: (table: 'orders' | 'business') => { select: (columns: string) => QueryBuilder }
  storage: {
    from: (bucket: string) => {
      upload: (path: string, data: Uint8Array, opts: { contentType?: string; upsert?: boolean }) => Promise<{ data?: unknown; error?: unknown }>
      getPublicUrl: (path: string) => Promise<{ data?: unknown; error?: unknown }>
    }
    createBucket: (name: string, opts: { public?: boolean }) => Promise<{ data?: unknown; error?: unknown }>
  }
}
