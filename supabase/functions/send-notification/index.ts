/// <reference path="../globals.d.ts" />
import webpush from 'https://esm.sh/web-push@3.6.1'
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
    const { subscription, notification } = await req.json();

    if (!subscription || !notification) {
      throw new Error('Falta la suscripción o el payload de la notificación');
    }

    const options = {
      vapidDetails: {
        subject: VAPID_SUBJECT,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
      },
    };

    // Enviar la notificación push usando la librería web-push
    await webpush.sendNotification(
      subscription,
      JSON.stringify(notification),
      options
    );

    return jsonResponse({ message: 'Notificación push enviada con éxito' }, 200);
  } catch (error) {
    console.error('Error al enviar notificación push:', error);
    const msg = error instanceof Error ? error.message : 'Fallo inesperado';
    return jsonResponse({ error: msg }, 500);
  }
});