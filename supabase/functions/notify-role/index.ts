// supabase/functions/notify-role/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.1';
import { corsHeaders } from '../_shared/cors.ts';

// Tipos
interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Inicializar web-push
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

// Enviar notificación
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

// Eliminar suscripción caducada
async function handleExpiredSubscription(supabase: any, endpoint: string) {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// Obtener suscripciones por rol
async function getSubscriptionsForRole(
  supabase: any,
  role: string,
): Promise<WebPushSubscription[]> {
  const { data, error } = await supabase.rpc('get_subscriptions_by_role', {
    role_name: role,
  });
  if (error) {
    console.error(`Error in RPC get_subscriptions_by_role for role ${role}:`, error);
    return [];
  }
  return data || [];
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
    role, // 'administrador' o 'colaborador'
    title,
    body,
    icon,
    data,
  } = await req.json();

  if (!role) {
    return new Response(JSON.stringify({ error: 'role is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const subscriptions = await getSubscriptionsForRole(supabase, role);

  if (subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ message: `No subscriptions found for role: ${role}` }),
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
      console.error(`Failed to send to role ${role}:`, e);
    }
  }

  // Opcional: registrar una notificación genérica para el rol
  await supabase.from('function_logs').insert({
    fn_name: 'notify-role',
    level: 'info',
    message: `Push notification sent to role: ${role}`,
    payload: { push_success_count: successCount },
  });

  return new Response(
    JSON.stringify({
      message: `Sent to ${successCount} of ${subscriptions.length} subscriptions for role ${role}.`,
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
