import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ONESIGNAL_APP_ID = "751b4b08-a3e9-473b-bbf5-636a1c083727";
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log('--- Iniciando send-onesignal-notification ---');

  try {
    const body = await req.json().catch(() => ({}));
    const { player_ids, title, message, url, data } = body;

    console.log('Notificación solicitada para:', player_ids ? player_ids.length : 0, 'dispositivos');
    console.log('Título:', title);

    if (!player_ids || !Array.isArray(player_ids) || player_ids.length === 0) {
      console.error('Error: Faltan player_ids');
      return new Response(JSON.stringify({ error: "Missing player_ids" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ONESIGNAL_API_KEY) {
      console.error('Error: ONESIGNAL_API_KEY no configurada en variables de entorno.');
      return new Response(JSON.stringify({ error: "API Key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: player_ids,
      contents: { en: message, es: message },
      headings: { en: title, es: title },
      url: url || undefined,
      data: data || {},
    };

    console.log('Enviando a OneSignal API...');
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log('Respuesta de OneSignal:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: response.status,
    });
  } catch (error) {
    console.error('Error crítico en send-onesignal-notification:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
