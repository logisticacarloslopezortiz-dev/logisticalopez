/// <reference path="../globals.d.ts" />
// Función para generar y enviar facturas por email
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

// Función para generar PDF de factura (simulada)
async function generateInvoicePDF(orderData: any, businessData: any) {
  // Por ahora retornamos un PDF simulado
  // En el futuro se puede integrar con una librería de PDF como jsPDF
  const invoiceContent = {
    business: businessData,
    order: orderData,
    generatedAt: new Date().toISOString(),
    invoiceNumber: `INV-${orderData.short_id || orderData.id}`,
    total: orderData.monto_cobrado || 0
  };
  
  return invoiceContent;
}

// Función para enviar email (simulada)
async function sendEmailWithInvoice(email: string, invoiceData: any) {
  // Aquí se integraría con un servicio de email como SendGrid, Resend, etc.
  logDebug('Enviando factura por email', { email, invoiceNumber: invoiceData.invoiceNumber });
  
  // Simulamos el envío exitoso
  return { success: true, messageId: `msg_${Date.now()}` };
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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    
    // Extraer datos del cuerpo de la solicitud
    const { orderId, email } = await req.json();
    
    if (!orderId) {
      return jsonResponse({ error: 'Se requiere orderId para generar la factura' }, 400);
    }
    
    // Buscar la orden
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    
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
    
    // Generar la factura
    const invoiceData = await generateInvoicePDF(order, business);
    
    // Enviar por email si se proporcionó
    let emailResult = null;
    const recipientEmail = email || order.email;
    
    if (recipientEmail) {
      emailResult = await sendEmailWithInvoice(recipientEmail, invoiceData);
    }
    
    // Registrar la generación de factura
    await supabase.from('notifications').insert({
      order_id: orderId,
      title: 'Factura generada',
      body: `Factura ${invoiceData.invoiceNumber} generada correctamente`,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });
    
    return jsonResponse({ 
      success: true, 
      message: 'Factura generada correctamente',
      data: {
        invoiceNumber: invoiceData.invoiceNumber,
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