/// <reference path="../globals.d.ts" />
// Función para generar y enviar facturas por email
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponse } from '../cors-config.ts';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const SUPABASE_SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
const DEBUG_MODE = ((Deno.env.get('DEBUG_MODE') || '').trim().toLowerCase() === 'true')

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v ?? '').trim())
}

function logDebug(message: string, data?: unknown) {
  const msg = `[DEBUG] ${message}`
  if (data instanceof Error) {
    const payload = { name: data.name, message: data.message, stack: data.stack }
    console.error(msg, JSON.stringify(payload))
    return
  }
  if (typeof data !== 'undefined') {
    if (!DEBUG_MODE) return
    try { console.log(msg, JSON.stringify(data)) } catch { console.log(msg, String(data)) }
    return
  }
  if (DEBUG_MODE) console.log(msg)
}

type OrderDataMinimal = { 
  id: number; 
  short_id?: string; 
  monto_cobrado?: number; 
  client_id?: string | null; 
  client_email?: string | null; 
  email?: string | null; 
  client_contact_id?: string | null;
  name?: string;
  phone?: string;
  pickup?: string;
  delivery?: string;
  date?: string;
  time?: string;
  metodo_pago?: string;
  status?: string;
  service?: { name?: string };
  vehicle?: { name?: string };
};
type BusinessDataMinimal = { 
  business_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  rnc?: string;
};

function wrapLongText(text: string | undefined | null, max = 60): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const words = t.split(/\s+/);
  let line = '';
  let result = '';
  for (const word of words) {
    if ((line + word).length > max) {
      result += line + '\n';
      line = word + ' ';
    } else {
      line += word + ' ';
    }
  }
  return (result + line).trim();
}

function sanitizePdfText(text: string | undefined | null): string {
  return (text || '')
    .replace(/→/g, '->')
    .replace(/✓/g, 'OK')
    .replace(/✔/g, 'OK')
    .replace(/❌/g, 'X')
    .replace(/⚠️/g, '!')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
}

function buildInvoiceData(order: OrderDataMinimal) {
  return {
    invoiceNumber: `INV-${order.short_id || order.id}`,
    clientName: order.name || 'Cliente',
    clientEmail: order.client_email || order.email || '',
    clientPhone: order.phone || '',
    rnc: null as string | null,
    serviceName: order.service?.name || 'Servicio',
    description: wrapLongText((order as any)?.service?.description || '', 70),
    route: wrapLongText(`${order.pickup || ''} -> ${order.delivery || ''}`, 60),
    amount: Number(order.monto_cobrado || 0),
    paymentMethod: order.metodo_pago || 'Pendiente',
    date: new Date((order as any)?.created_at || Date.now()).toLocaleDateString('es-DO')
  };
}

function wrapByWidth(text: string, f: any, size: number, maxWidth: number) {
  const safeText = sanitizePdfText(text);
  const words = (safeText ?? '').split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? current + ' ' + w : w;
    const width = f.widthOfTextAtSize(test, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
async function generateInvoicePDF(order: OrderDataMinimal, business: BusinessDataMinimal): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;

  // Encabezado
  const safeBizName = sanitizePdfText(business.business_name || 'Logistica Lopez Ortiz');
  const safeBizRnc = sanitizePdfText(business.rnc || 'N/A');
  const safeBizAddr = sanitizePdfText(business.address || '');
  const safeBizPhone = sanitizePdfText(business.phone || '');
  
  page.drawText(safeBizName, { x: 50, y, font: boldFont, size: 20, color: rgb(0.11, 0.25, 0.35) });
  y -= 25;
  page.drawText(`RNC: ${safeBizRnc}`, { x: 50, y, font, size: 10 });
  y -= 15;
  const bizContactLine = safeBizAddr && safeBizPhone ? `${safeBizAddr} | ${safeBizPhone}` : (safeBizAddr || safeBizPhone || '');
  page.drawText(bizContactLine, { x: 50, y, font, size: 10 });
  y -= 30;

  // Titulo de la factura
  const safeOrderId = sanitizePdfText(order.short_id || String(order.id));
  page.drawText(`Factura Orden #${safeOrderId}`, { x: 50, y, font: boldFont, size: 16 });
  y -= 20;
  page.drawText(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, { x: 50, y, font, size: 10 });
  y -= 30;

  // Datos del cliente
  const safeClientName = sanitizePdfText(order.name || 'N/A');
  const safeClientPhone = sanitizePdfText(order.phone || 'N/A');
  page.drawText('Facturar a:', { x: 50, y, font: boldFont, size: 12 });
  y -= 15;
  page.drawText(safeClientName, { x: 50, y, font, size: 10 });
  y -= 15;
  page.drawText(safeClientPhone, { x: 50, y, font, size: 10 });
  y -= 30;

  // Tabla de detalles
  const table = {
    x: 50,
    y: y,
    width: width - 100,
    col1: 150,
    col2: width - 100 - 150,
  };

  const lineHeight = 12;
  const drawRow = (label: string, value: string, isHeader = false) => {
    const safeLabel = sanitizePdfText(label);
    const safeValue = sanitizePdfText(value);
    const labelY = table.y - lineHeight;
    page.drawText(safeLabel, { x: table.x + 5, y: labelY, font: isHeader ? boldFont : font, size: 10 });
    const lines = wrapByWidth(safeValue, font, 10, table.col2 - 10);
    const totalHeight = Math.max(lineHeight, lines.length * lineHeight + 6);
    let vY = table.y - lineHeight;
    for (const line of lines) {
      page.drawText(line, { x: table.x + table.col1 + 5, y: vY, font: isHeader ? boldFont : font, size: 10 });
      vY -= lineHeight;
    }
    page.drawRectangle({ x: table.x, y: table.y - totalHeight, width: table.width, height: totalHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
    table.y -= totalHeight;
  };

  drawRow('Descripción', 'Detalle', true);
  drawRow('Servicio', order.service?.name || 'N/A');
  drawRow('Vehículo', order.vehicle?.name || 'N/A');
  drawRow('Origen', order.pickup || 'N/A');
  drawRow('Destino', order.delivery || 'N/A');
  const routeText = sanitizePdfText(`${order.pickup || ''} -> ${order.delivery || ''}`);
  drawRow('Ruta', routeText);
  drawRow('Fecha y Hora', `${order.date || ''} ${order.time || ''}`);
  drawRow('Estado Actual', order.status || 'N/A');
  drawRow('Método de Pago', order.metodo_pago || 'No especificado');
  drawRow('MONTO TOTAL', `$${(order.monto_cobrado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`, true);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function sendEmailWithInvoice(order: OrderDataMinimal, email: string, pdfUrl: string, invoiceNumber: string, fromEmail?: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const defaultFrom = 'Logística López Ortiz <facturacion@logisticalopezortiz.com>';
  const from = fromEmail || defaultFrom;
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || defaultFrom;
  const orderIdForDisplay = order.short_id || order.id;
  const trackingLink = `https://logisticalopezortiz.com/seguimiento.html`;
  const normalized = buildInvoiceData(order);
  const routeHtml = wrapLongText(normalized.route, 60).split('\n').map(l => l.trim()).join('<br>');
  const descHtml = wrapLongText(normalized.description, 70).split('\n').map(l => l.trim()).join('<br>');

  if (!apiKey) {
    logDebug('RESEND_API_KEY not set');
    return { success: false, messageId: null };
  }

  if (!isValidEmail(email || '')) {
    logDebug('Invalid recipient email', email);
    return { success: false, messageId: null };
  }

  const s = (order.status ?? '').toLowerCase();
  let subject = `📄 Factura de tu servicio - Orden #${orderIdForDisplay} | Logística López Ortiz`;
  let introTitle = 'Tu factura está lista';
  let introBody = 'Hemos generado la factura de tu servicio. Puedes descargarla desde el enlace.';
  if (s === 'completed' || s === 'completada' || s === 'entregada') {
    subject = `✅ Entrega completada y factura - Orden #${orderIdForDisplay} | Logística López Ortiz`;
    introTitle = '¡Tu servicio fue entregado!';
    introBody = 'Tu servicio ha sido completado. Adjuntamos tu factura y el enlace de descarga.';
  } else if (s === 'accepted' || s === 'aceptada' || s === 'in_progress' || s === 'en_camino_recoger' || s === 'cargando' || s === 'en_camino_entregar') {
    subject = `🔔 Actualización de estado y factura - Orden #${orderIdForDisplay} | Logística López Ortiz`;
    introTitle = 'Actualización de tu solicitud';
    introBody = 'Tu solicitud está en curso. Te compartimos tu factura y el enlace de descarga.';
  } else if (s === 'cancelled' || s === 'cancelada') {
    subject = `⚠️ Solicitud cancelada - Información y factura | Logística López Ortiz`;
    introTitle = 'Tu solicitud fue cancelada';
    introBody = 'Se genera factura solo si aplica. Revisa los detalles y el enlace de descarga.';
  }
  const html = `
    <div style="background-color: #f4f4f4; padding: 20px; font-family: Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
        <div style="background-color: #1E405A; padding: 20px; text-align: center;">
          <img src="https://logisticalopezortiz.com/img/1vertical.png" alt="Logística López Ortiz" style="max-width: 150px; height: auto;">
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #1E405A; font-size: 24px; margin-top: 0;">${introTitle}</h2>
          <p style="color: #555555; line-height: 1.6;">Hola,</p>
          <p style="color: #555555; line-height: 1.6;">${introBody}</p>
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
          <div style="margin-top:14px; padding:12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;">
            <p style="margin:0 0 8px 0; color:#374151; font-weight:600;">Servicio</p>
            <p style="margin:0; color:#374151; white-space:normal; word-break:break-word; overflow-wrap:break-word; line-height:1.4;">${normalized.serviceName}</p>
            <p style="margin:12px 0 8px 0; color:#374151; font-weight:600;">Descripción</p>
            <p style="margin:0; color:#374151; white-space:normal; word-break:break-word; overflow-wrap:break-word; line-height:1.4;">${descHtml}</p>
            <p style="margin:12px 0 8px 0; color:#374151; font-weight:600;">Ruta</p>
            <p style="margin:0; color:#374151; white-space:normal; word-break:break-word; overflow-wrap:break-word; line-height:1.4;">${routeHtml}</p>
          </div>
          
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
  `;

  // Retry logic: up to 2 attempts
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      logDebug(`Attempting email send (attempt ${attempt}) for order ${orderIdForDisplay}`);
      const payload: any = { from, to: [email], subject, html };
      if (replyTo) payload.reply_to = [replyTo];
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        logDebug(`Resend API error on attempt ${attempt}:`, { status: r.status, response: j });
        if (attempt === 2) {
          return { success: false, messageId: null };
        }
        continue;
      }

      if (!j?.id) {
        logDebug(`No message ID from Resend on attempt ${attempt}:`, j);
        if (attempt === 2) {
          return { success: false, messageId: null };
        }
        continue;
      }

      logDebug(`Email sent successfully on attempt ${attempt}, messageId: ${j.id}`);
      return { success: true, messageId: j.id };

    } catch (error) {
      logDebug(`Fetch error on attempt ${attempt}:`, error);
      if (attempt === 2) {
        return { success: false, messageId: null };
      }
    }
  }

  return { success: false, messageId: null };
}

// Manejador principal de la función
Deno.serve(async (req: Request) => {
  // Manejar solicitudes OPTIONS (preflight CORS)
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req);
  }
  
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      logDebug('Variables de entorno faltantes');
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500, req);
    }
    
    // Crear cliente de Supabase
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    
    const body = await req.json().catch(() => ({}));
    const rawOrderId =
      (body as any).orderId ??
      (body as any).order_id ??
      (body as any).id ??
      null;
    const email =
      (body as any).email ??
      (body as any).recipientEmail ??
      null;
    const contact_id =
      (body as any).contact_id ??
      null;
    
    if (!rawOrderId) {
      return jsonResponse({ error: 'Se requiere orderId para generar la factura' }, 400, req);
    }
    
    const isNumericId =
      typeof rawOrderId === 'number' ||
      (typeof rawOrderId === 'string' && /^\d+$/.test(rawOrderId));
    const q = supabase
      .from('orders')
      .select('*, service:services(name, description), vehicle:vehicles(name)');
    const filter = isNumericId
      ? `id.eq.${Number(rawOrderId)},short_id.eq.${String(rawOrderId)}`
      : `short_id.eq.${String(rawOrderId)}`
    const { data: order, error: orderError } = isNumericId
      ? await q.or(filter).maybeSingle()
      : await q.eq('short_id', String(rawOrderId)).maybeSingle();
    
    if (orderError || !order) {
      logDebug('Error al buscar la orden', orderError);
      return jsonResponse({ error: 'No se encontró la orden especificada' }, 404, req);
    }
    
    // Buscar datos del negocio (independientemente del ID)
    const { data: business, error: businessError } = await supabase
      .from('business')
      .select('*')
      .limit(1)
      .maybeSingle();
    
    if (businessError || !business) {
      logDebug('Error al buscar datos del negocio', businessError);
      return jsonResponse({ error: 'Debe configurar los datos del negocio en el panel administrativo antes de generar facturas.' }, 404, req);
    }
    
    const pdfBytes = await (async () => {
      try {
        return await generateInvoicePDF(order, business);
      } catch (err) {
        logDebug('Error generando PDF', err);
        throw new Error(`No se pudo generar el PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    const invoiceNumber = `INV-${order.short_id || order.id}`;

    const filePath = `${order.client_id || 'anon'}/${invoiceNumber}.pdf`;
    await ensureInvoicesBucket(supabase);
    const { error: uploadError } = await supabase.storage.from('invoices').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      logDebug('Error subiendo PDF', uploadError);
      return jsonResponse({ error: 'No se pudo subir la factura' }, 500, req);
    }
    const { data: pub } = supabase.storage.from('invoices').getPublicUrl(filePath);
    const pdfUrl = ((pub as any)?.publicUrl) || '';
    const fileUrl = pdfUrl;
    if (!pdfUrl) {
      return jsonResponse({ error: 'No se pudo obtener la URL pública del PDF' }, 500, req);
    }
    
    let recipientEmail = email || order.client_email || order.email || null;
    if (recipientEmail && !isValidEmail(recipientEmail)) {
      recipientEmail = null;
    }
    if (recipientEmail) {
      const emailResult = await sendEmailWithInvoice(
        order,
        recipientEmail,
        pdfUrl,
        invoiceNumber,
        business.email || undefined
      );
      if (!emailResult.success) {
        logDebug('No se pudo enviar el correo de factura');
      }
    }
    
    // Resolver client_id si está vacío usando el email del perfil
    let resolvedClientId = order.client_id ?? null;
    if (!resolvedClientId && recipientEmail) {
      try {
        const { data: profileByEmail } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', recipientEmail)
          .maybeSingle();
        if (profileByEmail?.id) resolvedClientId = profileByEmail.id;
      } catch (err) { logDebug('No se pudo resolver client_id por email', err); }
    }

    // Registrar la factura en tabla invoices
    const { error: invError } = await supabase.from('invoices').insert({
      order_id: order.id,
      client_id: resolvedClientId,
      file_path: filePath,
      file_url: fileUrl,
      total: order.monto_cobrado ?? 0,
      status: 'generada',
      recipient_email: recipientEmail ?? null,
      data: {
        invoice_number: invoiceNumber,
        recipient_email: recipientEmail,
        pdf_url: pdfUrl
      }
    });
    if (invError) {
      logDebug('Error al registrar en invoices', invError);
      return jsonResponse({ error: 'Factura generada pero no registrada en la tabla invoices' }, 500, req);
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Factura generada correctamente',
      data: {
        invoiceNumber,
        pdfUrl,
        recipientEmail
      }
    }, 200, req);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    return jsonResponse({ error: message }, 500, req);
  }
});
type QueryBuilder = {
  eq: (column: string, value: string | number) => QueryBuilder;
  single: () => Promise<{ data?: any; error?: any }>;
  maybeSingle: () => Promise<{ data?: any; error?: any }>;
};

type SupabaseClientLike = SupabaseClient;

async function ensureInvoicesBucket(supabase: SupabaseClientLike): Promise<void> {
  try {
    // Try quick check via listBuckets
    const anySupabase: any = supabase as any;
    if (anySupabase?.storage?.listBuckets) {
      const { data: buckets } = await anySupabase.storage.listBuckets();
      const exists = Array.isArray(buckets) && buckets.some((b: any) => b?.name === 'invoices');
      if (!exists && anySupabase.storage.createBucket) {
        await anySupabase.storage.createBucket('invoices', { public: true });
      }
      return;
    }
  } catch (_) {}
  // Fallback: attempt create, ignore error if already exists
  try {
    const anySupabase: any = supabase as any;
    if (anySupabase?.storage?.createBucket) {
      await anySupabase.storage.createBucket('invoices', { public: true });
    }
  } catch (_) {}
}
