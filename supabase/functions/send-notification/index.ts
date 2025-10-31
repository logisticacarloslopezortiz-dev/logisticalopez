/// <reference path="../globals.d.ts" />
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts'

// --- Configuración de Claves VAPID ---
// Estas claves debes configurarlas como "secrets" en tu panel de Supabase.
// Ve a Project Settings > Edge Functions > Add new secret
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
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

    const options = {
      vapidDetails: {
        subject: VAPID_SUBJECT,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
      },
    };

    // Importar dinámicamente la librería web-push para evitar fallos en inicialización
    const { default: webpush } = await import('https://esm.sh/web-push@3.6.1');

    // Enviar la notificación push usando la librería web-push
    await webpush.sendNotification(
      subscription,
      JSON.stringify(notification),
      options
    );

    return jsonResponse({ success: true, message: 'Notificación push enviada con éxito' }, 200);
  } catch (error) {
    console.error('Error al enviar notificación push:', error);
    const msg = error instanceof Error ? error.message : 'Fallo inesperado';
    // Responder siempre 200 con success:false para manejo uniforme en cliente
    return jsonResponse({ success: false, error: msg }, 200);
  }
});