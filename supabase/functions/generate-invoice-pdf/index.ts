/// <reference path="../globals.d.ts" />
import { createClient } from '@supabase/supabase-js'
import { handleCors, jsonResponse } from '../cors-config.ts'
import { PDFDocument, rgb, StandardFonts } from 'https://cdn.skypack.dev/pdf-lib@^1.17.1'

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
  const page = pdfDoc.addPage()
  const { width, height } = page.getSize()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let y = height - 50

  page.drawText(business.business_name || 'Logística López Ortiz', { x: 50, y, font: boldFont, size: 20, color: rgb(0.11, 0.25, 0.35) })
  y -= 25
  page.drawText(`RNC: ${business.rnc || 'N/A'}`, { x: 50, y, font, size: 10 })
  y -= 15
  page.drawText(`${business.address || ''} | ${business.phone || ''}`, { x: 50, y, font, size: 10 })
  y -= 30

  page.drawText(`Factura Orden #${order.short_id || order.id}`, { x: 50, y, font: boldFont, size: 16 })
  y -= 20
  page.drawText(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, { x: 50, y, font, size: 10 })
  y -= 30

  page.drawText('Facturar a:', { x: 50, y, font: boldFont, size: 12 })
  y -= 15
  page.drawText(order.name || 'N/A', { x: 50, y, font, size: 10 })
  y -= 15
  page.drawText(order.phone || 'N/A', { x: 50, y, font, size: 10 })
  y -= 30

  const table = { x: 50, y, width: width - 100, rowHeight: 20, col1: 150 }
  const drawRow = (label: string, value: string, isHeader = false) => {
    page.drawText(label, { x: table.x + 5, y: table.y - table.rowHeight / 1.5, font: isHeader ? boldFont : font, size: 10 })
    page.drawText(value, { x: table.x + table.col1 + 5, y: table.y - table.rowHeight / 1.5, font: isHeader ? boldFont : font, size: 10 })
    page.drawRectangle({ x: table.x, y: table.y - table.rowHeight, width: table.width, height: table.rowHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 })
    table.y -= table.rowHeight
  }

  drawRow('Descripción', 'Detalle', true)
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