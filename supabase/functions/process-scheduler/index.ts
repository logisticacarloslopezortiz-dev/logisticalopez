import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing env vars");
      return new Response("Missing env vars", { status: 500 });
    }

    console.log("⏰ Scheduler waking up process-outbox...");

    const response = await fetch(
      `${supabaseUrl}/functions/v1/process-outbox`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        }
      }
    );

    const text = await response.text();
    console.log("👉 process-outbox response:", response.status, text);

    return new Response(
      JSON.stringify({
        ok: response.ok,
        status: response.status,
        result: text
      }),
      { status: 200 }
    );

  } catch (err: any) {
    console.error("🔥 Scheduler error:", err);
    return new Response(err.message, { status: 500 });
  }
});
