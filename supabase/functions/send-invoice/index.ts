/// <reference path="../globals.d.ts" />
// Función para generar y enviar facturas por email
import { createClient } from '@supabase/supabase-js';
import { handleCors, jsonResponse } from '../cors-config.ts';
import { PDFDocument, rgb, StandardFonts } from 'https://cdn.skypack.dev/pdf-lib@^1.17.1';

// Función para registrar logs
function logDebug(message: string, data?: unknown) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
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

// ✅ NUEVO: Función para generar el PDF en memoria en el servidor
async function generateInvoicePDF(order: OrderDataMinimal, business: BusinessDataMinimal): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;

  // Encabezado
  page.drawText(business.business_name || 'Logística López Ortiz', { x: 50, y, font: boldFont, size: 20, color: rgb(0.11, 0.25, 0.35) });
  y -= 25;
  page.drawText(`RNC: ${business.rnc || 'N/A'}`, { x: 50, y, font, size: 10 });
  y -= 15;
  page.drawText(`${business.address || ''} | ${business.phone || ''}`, { x: 50, y, font, size: 10 });
  y -= 30;

  // Título de la factura
  page.drawText(`Factura Orden #${order.short_id || order.id}`, { x: 50, y, font: boldFont, size: 16 });
  y -= 20;
  page.drawText(`Fecha: ${new Date().toLocaleDateString('es-DO')}`, { x: 50, y, font, size: 10 });
  y -= 30;

  // Datos del cliente
  page.drawText('Facturar a:', { x: 50, y, font: boldFont, size: 12 });
  y -= 15;
  page.drawText(order.name || 'N/A', { x: 50, y, font, size: 10 });
  y -= 15;
  page.drawText(order.phone || 'N/A', { x: 50, y, font, size: 10 });
  y -= 30;

  // Tabla de detalles
  const tableTop = y;
  const table = {
    x: 50,
    y: y,
    width: width - 100,
    rowHeight: 20,
    col1: 150,
    col2: width - 100 - 150,
  };

  const drawRow = (label: string, value: string, isHeader = false) => {
    page.drawText(label, { x: table.x + 5, y: table.y - table.rowHeight / 1.5, font: isHeader ? boldFont : font, size: 10 });
    page.drawText(value, { x: table.x + table.col1 + 5, y: table.y - table.rowHeight / 1.5, font: isHeader ? boldFont : font, size: 10 });
    page.drawRectangle({ x: table.x, y: table.y - table.rowHeight, width: table.width, height: table.rowHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
    table.y -= table.rowHeight;
  };

  drawRow('Descripción', 'Detalle', true);
  drawRow('Servicio', order.service?.name || 'N/A');
  drawRow('Vehículo', order.vehicle?.name || 'N/A');
  drawRow('Origen', order.pickup || 'N/A');
  drawRow('Destino', order.delivery || 'N/A');
  drawRow('Fecha y Hora', `${order.date || ''} ${order.time || ''}`);
  drawRow('Estado Actual', order.status || 'N/A');
  drawRow('Método de Pago', order.metodo_pago || 'No especificado');
  drawRow('MONTO TOTAL', `$${(order.monto_cobrado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`, true);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function sendEmailWithInvoice(order: OrderDataMinimal, email: string, pdfUrl: string, invoiceNumber: string, fromEmail?: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const defaultFrom = 'transporteylogisticalopezortiz@gmail.com';
  const from = fromEmail || Deno.env.get('RESEND_FROM') || defaultFrom;
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || defaultFrom;
  const orderIdForDisplay = order.short_id || order.id;
  const trackingLink = `https://logisticalopezortiz.com/seguimiento.html`;

  if (apiKey) {
    const subject = `✅ Solicitud Aceptada y Factura - Orden #${orderIdForDisplay} | Logística López Ortiz`;
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
            <p style="color: #555555; line-height: 1.6;"><a href="${pdfUrl}" target="_blank" style="color: #1E8A95; text-decoration: underline;">Ver o descargar tu factura aquí</a></p>
            <p style="color: #555555; line-height: 1.6; margin-top: 30px;">Gracias por confiar en Logística López Ortiz.</p>
          </div>
          <div style="background-color: #f4f4f4; color: #888888; padding: 20px; text-align: center; font-size: 12px;">
            <p>Este es un correo electrónico generado automáticamente. Por favor, no respondas a este mensaje.</p>
            <p>&copy; ${new Date().getFullYear()} Logística López Ortiz. Todos los derechos reservados.</p>
          </div>
        </div>
      </div>
    `;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: email, subject, html, reply_to: replyTo })
    });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && j?.id;
    return { success: !!ok, messageId: j?.id || null };
  }
  return { success: false, messageId: null };
}

// Manejador principal de la función
Deno.serve(async (req: Request) => {
  // Manejar solicitudes OPTIONS (preflight CORS)
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  try {
    // Obtener variables de entorno
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      logDebug('Variables de entorno faltantes');
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500);
    }
    
    // Crear cliente de Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE) as unknown as SupabaseClientLike;
    
    // Extraer datos del cuerpo de la solicitud
    const { orderId, email, contact_id } = await req.json();
    
    if (!orderId) {
      return jsonResponse({ error: 'Se requiere orderId para generar la factura' }, 400);
    }
    
    // Buscar la orden
    const isNumericId = typeof orderId === 'number' || (typeof orderId === 'string' && /^\d+$/.test(orderId));
    const q = supabase
      .from('orders')
      // ✅ NUEVO: Seleccionar también los nombres de las tablas relacionadas
      .select('*, service:services(name), vehicle:vehicles(name)') as SelectOrdersBuilder;
    const { data: order, error: orderError } = isNumericId
      ? await q.eq('id', Number(orderId)).single()
      : await q.eq('short_id', String(orderId)).single();
    
    if (orderError || !order) {
      logDebug('Error al buscar la orden', orderError);
      return jsonResponse({ error: 'No se encontró la orden especificada' }, 404);
    }
    
    // Buscar datos del negocio
    const { data: business, error: businessError } = await supabase
      .from('business')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (businessError || !business) {
      logDebug('Error al buscar datos del negocio', businessError);
      return jsonResponse({ error: 'No se encontraron los datos del negocio' }, 404);
    }
    
    const pdfBytes = await generateInvoicePDF(order, business);
    const invoiceNumber = `INV-${order.short_id || order.id}`;

    try { await (supabase as any).storage.createBucket('invoices', { public: true }); } catch (_) {}
    const filePath = `${order.client_id || 'anon'}/${invoiceNumber}-${Date.now()}.pdf`;
    await supabase.storage.from('invoices').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    const { data: pub } = await (supabase as any).storage.from('invoices').getPublicUrl(filePath);
    const pdfUrl = (pub && (pub as any).publicUrl) || '';
    
    // Enviar por email si se proporcionó
    let emailResult = null;
    let recipientEmail = email || order.client_email || order.email;
    if (!recipientEmail && order.client_contact_id) {
      try {
        const { data: contactRow } = await supabase
          .from('clients')
          .select('email')
          .eq('id', order.client_contact_id)
          .maybeSingle();
        if (contactRow?.email) recipientEmail = contactRow.email;
      } catch (err) { logDebug('No se pudo obtener email de contacto', err); }
    }
    if (!recipientEmail && contact_id) {
      try {
        const { data: contactRow2 } = await supabase
          .from('clients')
          .select('email')
          .eq('id', contact_id)
          .maybeSingle();
        if (contactRow2?.email) recipientEmail = contactRow2.email;
      } catch (err) { logDebug('No se pudo obtener email por contact_id', err); }
    }
    if (!recipientEmail && order.client_id) {
      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', order.client_id)
          .maybeSingle();
        if (profileRow?.email) recipientEmail = profileRow.email;
      } catch (err) { logDebug('No se pudo obtener email de perfil', err); }
    }
    const senderEmail = business?.email || 'transporteylogisticalopezortiz@gmail.com';
    
    if (recipientEmail && pdfUrl) {
      emailResult = await sendEmailWithInvoice(order, recipientEmail, pdfUrl, invoiceNumber, senderEmail);
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
      order_id: orderId,
      client_id: resolvedClientId,
      file_path: filePath,
      total: order.monto_cobrado ?? 0,
      status: 'generada',
      recipient_email: recipientEmail ?? null,
      data: {
        invoice_number: invoiceNumber,
        email_sent: !!emailResult?.success,
        recipient_email: recipientEmail
      }
    });
    if (invError) {
      logDebug('Error al registrar en invoices', invError);
      return jsonResponse({ error: 'Factura generada pero no registrada en la tabla invoices' }, 500);
    }
    
    return jsonResponse({ 
      success: true, 
      message: 'Factura generada correctamente',
      data: {
        invoiceNumber: invoiceNumber,
        emailSent: !!emailResult?.success,
        recipientEmail
      }
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    return jsonResponse({ error: message }, 500);
  }
});
type QueryBuilder = {
  eq: (column: string, value: string | number) => QueryBuilder;
  single: () => Promise<{ data?: any; error?: any }>;
  maybeSingle: () => Promise<{ data?: any; error?: any }>;
};

type SupabaseClientLike = {
  from: (table: 'orders' | 'business' | 'clients' | 'invoices' | 'profiles') => {
    select: (columns: string) => QueryBuilder;
    insert: (values: unknown) => Promise<{ data?: unknown; error?: unknown }>;
  };
  storage: {
    from: (bucket: string) => {
      upload: (path: string, data: Uint8Array, opts: { contentType?: string; upsert?: boolean }) => Promise<{ data?: unknown; error?: unknown }>;
      getPublicUrl: (path: string) => Promise<{ data?: unknown; error?: unknown }>;
    };
    createBucket: (name: string, opts: { public?: boolean }) => Promise<{ data?: unknown; error?: unknown }>;
  };
};