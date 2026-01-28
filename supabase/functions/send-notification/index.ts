import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import webpush from "https://esm.sh/web-push@3.6.7?bundle&target=deno";


serve(async (req) => {
  try {

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { outbox_id } = await req.json();

    if (!outbox_id) {
      return new Response("Missing outbox_id", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response("Missing env vars", { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 🔹 JOB
    const { data: job, error: jobError } = await supabase
      .from("notification_outbox")
      .select(`*, template:notification_templates(*)`)
      .eq("id", outbox_id)
      .single();

    if (jobError || !job) {
      console.error("Job not found", jobError);
      return new Response("Job not found", { status: 404 });
    }

    // 🔹 SUBSCRIPTION
    let pushSub: any = null;

    if (job.recipient_contact_id) {
      const { data } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("client_contact_id", job.recipient_contact_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pushSub = data;
    } else if (job.recipient_id) {
      const { data } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", job.recipient_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pushSub = data;
    }

    if (!pushSub) {
      await supabase.rpc("mark_notification_failed", {
        p_id: outbox_id,
        p_error: "No push subscription found"
      });
      return new Response("No subscription", { status: 200 });
    }

    // 🔹 VAPID
    let vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    let vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    let vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    if (!vapidPublic || !vapidPrivate) {
      const { data: business } = await supabase
        .from("business")
        .select("vapid_public_key, push_vapid_key, email")
        .limit(1)
        .single();

      if (business) {
        vapidPublic = business.vapid_public_key;
        vapidPrivate = business.push_vapid_key;
        if (business.email) {
          vapidSubject = `mailto:${business.email}`;
        }
      }
    }

    if (!vapidPublic || !vapidPrivate) {
      await supabase.rpc("mark_notification_failed", {
        p_id: outbox_id,
        p_error: "Missing VAPID keys"
      });
      return new Response("Missing VAPID", { status: 500 });
    }

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublic,
      vapidPrivate
    );

    // 🔹 PAYLOAD
    let payload: any = {
      title: job.template?.title || "Notificación",
      body: job.template?.body || "Tienes un nuevo mensaje",
      ...job.payload
    };

    if (job.payload) {
      Object.keys(job.payload).forEach((k) => {
        payload.title = payload.title.replace(`{{${k}}}`, String(job.payload[k]));
        payload.body = payload.body.replace(`{{${k}}}`, String(job.payload[k]));
      });
    }

    // 🔹 PARSE KEYS
    const parsedKeys =
      typeof pushSub.keys === "string"
        ? JSON.parse(pushSub.keys)
        : pushSub.keys;

    const subscription = {
      endpoint: pushSub.endpoint,
      keys: parsedKeys
    };

    console.log("Sending push for job", outbox_id);

    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );

    await supabase.rpc("mark_notification_sent", { p_id: outbox_id });

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err: any) {
    console.error("Fatal send-notification error:", err);
    return new Response(err.message, { status: 500 });
  }
});
