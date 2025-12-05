/// <reference path="../globals.d.ts" />
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts'

// --- Configuración de Claves VAPID ---
// Estas claves debes configurarlas como "secrets" en tu panel de Supabase.
// Ve a Project Settings > Edge Functions > Add new secret
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_JWK = Deno.env.get('VAPID_JWK') || null
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:example@example.com'

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Validación de método
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed' }, 200);
    }

    // Validar secretos VAPID en runtime
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return jsonResponse({ success: false, error: 'Faltan claves VAPID en el servidor' }, 200);
    }

    const { subscription, notification } = await req.json();

    if (!subscription || !notification) {
      return jsonResponse({ success: false, error: 'Falta la suscripción o el payload de la notificación' }, 200);
    }

    const webpush = await import('jsr:@negrel/webpush')
    let vapidKeys: any
    try {
      vapidKeys = VAPID_JWK ? webpush.importVapidKeys(JSON.parse(VAPID_JWK)) : { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
    } catch (_) {
      vapidKeys = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
    }
    const appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys })
    await appServer.push(subscription, JSON.stringify(notification), { ttl: 2592000, urgency: 'high' })

    return jsonResponse({ success: true, message: 'Notificación push enviada con éxito' }, 200);
  } catch (error) {
    console.error('Error al enviar notificación push:', error);
    const msg = error instanceof Error ? error.message : 'Fallo inesperado';
    // Responder siempre 200 con success:false para manejo uniforme en cliente
    return jsonResponse({ success: false, error: msg }, 200);
  }
});
