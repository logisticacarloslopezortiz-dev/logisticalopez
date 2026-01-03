// Edge Function: send-rating-email
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = { orderId?: string };

const SITE_BASE_URL = Deno.env.get("SITE_BASE_URL") || "https://logisticalopezortiz.com";

serve(async (req) => {
  try {
    const { orderId } = await req.json().catch(() => ({ orderId: undefined })) as ReqBody;
    if (!orderId) return new Response(JSON.stringify({ error: "Missing orderId" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!url || !key || !resendKey) {
      return new Response(JSON.stringify({ error: "Missing env configuration" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(url, key);
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, short_id, name, email, client_email, client_contact_id")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    if (!order) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

    const toEmail = order.client_email || order.email;
    if (!toEmail) return new Response(JSON.stringify({ error: "No client email found" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const ratingLink = `${SITE_BASE_URL}/calificar.html?pedido=${encodeURIComponent(String(order.short_id || order.id))}`;
    const subject = `Tu opinión sobre el servicio #${order.short_id || order.id}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
        <h2>Gracias por elegir Logística López Ortiz</h2>
        <p>Tu pedido #${order.short_id || order.id} ha sido completado.</p>
        <p>Nos ayudaría conocer tu experiencia. Por favor, califica el servicio en el siguiente enlace seguro:</p>
        <p><a href="${ratingLink}" target="_blank" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Calificar Servicio</a></p>
        <p>Si el botón no funciona, copia este enlace:</p>
        <p><a href="${ratingLink}" target="_blank">${ratingLink}</a></p>
      </div>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Logística López Ortiz <no-reply@logisticalopezortiz.com>",
        to: [toEmail],
        subject,
        html,
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({ error: "Email send failed", details: txt }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
