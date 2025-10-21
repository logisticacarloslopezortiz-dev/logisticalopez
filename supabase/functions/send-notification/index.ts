import { serve } from 'http'
import webpush from 'web-push'

// --- Configuración de Claves VAPID ---
// Estas claves debes configurarlas como "secrets" en tu panel de Supabase.
// Ve a Project Settings > Edge Functions > Add new secret
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:example@example.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Manejar la solicitud de pre-vuelo (preflight) de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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

    return new Response(JSON.stringify({ message: 'Notificación push enviada con éxito' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error al enviar notificación push:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});