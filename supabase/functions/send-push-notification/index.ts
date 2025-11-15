// supabase/functions/send-push-notification/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.1';
import { corsHeaders } from '../_shared/cors.ts';

// Tipos, igual que en process-outbox
interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Inicializar web-push (reutilizado)
function initializeWebPush() {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error('VAPID keys are missing');
  }
  webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidPublicKey,
    vapidPrivateKey,
  );
}

// Enviar notificación (reutilizado)
async function sendNotification(subscription: WebPushSubscription, payload: string) {
  try {
    return await webpush.sendNotification(subscription, payload, { TTL: 2592000 });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      return { expired: true, endpoint: subscription.endpoint };
    }
    throw error;
  }
}

// Eliminar suscripción caducada (reutilizado)
async function handleExpiredSubscription(supabase: any, endpoint: string) {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// Obtener suscripciones por userId (reutilizado)
async function getSubscriptionsForUser(
  supabase: any,
  userId: string,
): Promise<WebPushSubscription[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId);
  return error ? [] : data || [];
}

// Obtener suscripciones por contactId (reutilizado)
async function getSubscriptionsForContact(
  supabase: any,
  contactId: string,
): Promise<WebPushSubscription[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('client_contact_id', contactId);
  return error ? [] : data || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    initializeWebPush();
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    userId, // Campo unificado
    contactId,
    title,
    body,
    icon,
    data,
  } = await req.json();

  if (!userId && !contactId) {
    return new Response(
      JSON.stringify({ error: 'userId or contactId is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  let subscriptions: WebPushSubscription[] = [];
  if (userId) {
    subscriptions = await getSubscriptionsForUser(supabase, userId);
  } else if (contactId) {
    subscriptions = await getSubscriptionsForContact(supabase, contactId);
  }

  if (subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No subscriptions found for the target.' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const payload = JSON.stringify({
    notification: {
      title,
      body,
      icon: icon || '/img/logo-tlc.png',
      data: data || {},
    },
  });

  let successCount = 0;
  for (const sub of subscriptions) {
    try {
      const result = await sendNotification(sub, payload);
      if (result && result.expired) {
        await handleExpiredSubscription(supabase, result.endpoint);
      } else {
        successCount++;
      }
    } catch (e) {
      console.error(`Failed to send to ${sub.endpoint}:`, e);
    }
  }

  // Opcional: registrar la notificación en la tabla `notifications`
  // (Esta función es principalmente para PUSH, no para la UI interna)
  if (userId) {
    await supabase.from('notifications').insert({
      user_id: userId,
      title,
      body,
      data: { push_success_count: successCount },
    });
  }

  return new Response(
    JSON.stringify({
      message: `Sent to ${successCount} of ${subscriptions.length} subscriptions.`,
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
