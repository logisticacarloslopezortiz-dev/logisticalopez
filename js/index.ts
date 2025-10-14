// Import necessary modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import webpush from "https://deno.land/x/web_push@0.2.5/mod.ts";

// --- VAPID Keys Configuration ---
// These keys should be set as environment variables in your Supabase project settings.
// Go to Project Settings > Edge Functions > Add new secret
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")! || "mailto:tu-correo@ejemplo.com";

// --- CORS Headers ---
// These headers are necessary to allow your web application to call this Edge Function.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Or specify your app's domain for better security
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Ensure the request is a POST request
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // Parse the request body to get subscription and notification data
    const { subscription, notification } = await req.json();

    // Validate that the necessary data is present
    if (!subscription || !notification) {
      return new Response("Missing subscription or notification payload", { status: 400, headers: corsHeaders });
    }

    // Prepare the payload to be sent
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: notification.icon,
      badge: notification.badge,
      data: notification.data,
    });

    // Send the push notification using the web-push library
    await webpush.sendNotification(
      subscription,
      payload,
      {
        vapidDetails: {
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: VAPID_PRIVATE_KEY,
          subject: VAPID_SUBJECT,
        },
      }
    );

    // Return a success response
    return new Response("Push notification sent successfully", { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error("Error sending push notification:", error);
    // Return an error response
    return new Response(`Failed to send push notification: ${error.message}`, { status: 500, headers: corsHeaders });
  }
});