// supabase/functions/process-outbox/index.ts
// Visita https://esm.sh para encontrar URLs de CDN para NPM.
// Usa `npm:package-name@version` o `npm:package-name` para obtener la última versión.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.1'; // Asegúrate de que la versión es compatible
import { corsHeaders } from '../_shared/cors.ts';

// Tipos de datos para el manejo de notificaciones
interface NotificationOutbox {
  id: number;
  order_id: number;
  new_status: string;
  target_role?: string;
  target_user_id?: string;
  target_contact_id?: string; // Columna añadida para consistencia
  payload: {
    title: string;
    body: string;
    icon?: string;
    data?: Record<string, unknown>;
  };
  created_at: string;
  processed_at?: string;
}

interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ============================================================================
// HELPERS
// ============================================================================

// Centralizar la inicialización del cliente de Supabase
function getSupabaseClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Authorization header is missing');
  }
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authHeader } },
      auth: {
        persistSession: false,
      },
    },
  );
}

// Inicializar web-push
function initializeWebPush() {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('VAPID keys are not configured in environment variables.');
    throw new Error('VAPID keys are missing');
  }

  webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidPublicKey,
    vapidPrivateKey,
  );
}

// Función para registrar logs en la base de datos
async function logToDb(
  supabase: SupabaseClient,
  level: 'info' | 'error',
  message: string,
  payload: Record<string, unknown> = {},
) {
  try {
    await supabase.from('function_logs').insert({
      fn_name: 'process-outbox',
      level,
      message,
      payload,
    });
  } catch (dbError) {
    console.error(`Failed to log to DB: ${dbError.message}`);
  }
}

// ============================================================================
// LÓGICA DE OBTENCIÓN DE SUSCRIPCIONES
// ============================================================================

async function getSubscriptionsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<WebPushSubscription[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId);

  if (error) {
    console.error(`Error fetching subscriptions for user ${userId}:`, error);
    return [];
  }
  return data || [];
}

async function getSubscriptionsForContact(
  supabase: SupabaseClient,
  contactId: string,
): Promise<WebPushSubscription[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('client_contact_id', contactId);

  if (error) {
    console.error(
      `Error fetching subscriptions for contact ${contactId}:`,
      error,
    );
    return [];
  }
  return data || [];
}

async function getSubscriptionsForRole(
  supabase: SupabaseClient,
  role: string,
): Promise<WebPushSubscription[]> {
  // RPC para obtener suscripciones por rol de forma segura
  const { data, error } = await supabase.rpc('get_subscriptions_by_role', {
    role_name: role,
  });

  if (error) {
    console.error(`Error fetching subscriptions for role ${role}:`, error);
    return [];
  }
  return data || [];
}

// ============================================================================
// LÓGICA PRINCIPAL DE ENVÍO
// ============================================================================

async function sendNotification(
  subscription: WebPushSubscription,
  payload: string,
) {
  try {
    return await webpush.sendNotification(subscription, payload, {
      TTL: 2592000, // 30 días
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
    // Si el error indica que la suscripción no es válida, hay que eliminarla
    if (error.statusCode === 404 || error.statusCode === 410) {
      return { expired: true, endpoint: subscription.endpoint };
    }
    throw error;
  }
}

async function handleExpiredSubscription(
  supabase: SupabaseClient,
  endpoint: string,
) {
  console.log(`Deleting expired subscription: ${endpoint}`);
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) {
    console.error(`Failed to delete expired subscription: ${endpoint}`, error);
  }
}

// ============================================================================
// HANDLER PRINCIPAL DE LA FUNCIÓN
// ============================================================================

Deno.serve(async (req) => {
  // Manejo de CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Verificar que la solicitud es POST
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

  // 1. Obtener notificaciones pendientes de la outbox
  const { data: notifications, error } = await supabase
    .from('notification_outbox')
    .select('*')
    .is('processed_at', null)
    .limit(50); // Procesar en lotes de 50 para no sobrecargar

  if (error) {
    await logToDb(supabase, 'error', 'Failed to fetch from outbox', {
      error: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!notifications || notifications.length === 0) {
    return new Response(JSON.stringify({ message: 'No notifications to process.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let successCount = 0;
  let failureCount = 0;
  const processedIds: number[] = [];

  // 2. Iterar y procesar cada notificación
  for (const notification of notifications) {
    let subscriptions: WebPushSubscription[] = [];

    // Determinar destinatarios
    if (notification.target_user_id) {
      subscriptions = await getSubscriptionsForUser(
        supabase,
        notification.target_user_id,
      );
    } else if (notification.target_contact_id) {
      subscriptions = await getSubscriptionsForContact(
        supabase,
        notification.target_contact_id,
      );
    } else if (notification.target_role) {
      subscriptions = await getSubscriptionsForRole(
        supabase,
        notification.target_role,
      );
    }

    if (subscriptions.length === 0) {
      console.log(
        `No subscriptions found for notification ${notification.id}. Marking as processed.`,
      );
      processedIds.push(notification.id);
      continue;
    }

    const payload = JSON.stringify({
      notification: {
        title: notification.payload.title,
        body: notification.payload.body,
        icon: notification.payload.icon || '/img/logo-tlc.png',
        data: {
          orderId: notification.order_id,
          ...notification.payload.data,
        },
      },
    });

    let sentToAtLeastOne = false;
    for (const sub of subscriptions) {
      try {
        const result = await sendNotification(sub, payload);
        if (result && result.expired) {
          await handleExpiredSubscription(supabase, result.endpoint);
        }
        sentToAtLeastOne = true;
        successCount++;
      } catch (e) {
        failureCount++;
        await logToDb(supabase, 'error', 'Failed to send notification', {
          outbox_id: notification.id,
          endpoint: sub.endpoint,
          error: e.message,
        });
      }
    }

    // Marcar como procesada solo si se intentó enviar (incluso si falló)
    if (sentToAtLeastOne || subscriptions.length > 0) {
      processedIds.push(notification.id);
    }
  }

  // 3. Marcar las notificaciones procesadas en la base de datos
  if (processedIds.length > 0) {
    const { error: updateError } = await supabase
      .from('notification_outbox')
      .update({ processed_at: new Date().toISOString() })
      .in('id', processedIds);

    if (updateError) {
      await logToDb(supabase, 'error', 'Failed to mark notifications as processed', {
        ids: processedIds,
        error: updateError.message,
      });
    }
  }

  const responsePayload = {
    message: 'Processing complete.',
    processedCount: processedIds.length,
    successCount,
    failureCount,
  };

  await logToDb(supabase, 'info', 'Outbox processed successfully', responsePayload);

  return new Response(JSON.stringify(responsePayload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
