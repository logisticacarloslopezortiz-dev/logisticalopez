import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCors, jsonResponse } from "../cors-config.ts";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing env vars");
      return jsonResponse({ error: "Config error" }, 500, req);
    }

    // ✅ CORS preflight
    const corsResp = handleCors(req);
    if (corsResp) return corsResp;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 🔹 HEARTBEAT
    const { error: hbError } = await supabase
      .from("worker_heartbeat")
      .upsert({
        worker_name: "process-notifications",
        last_seen: new Date().toISOString()
      });

    if (hbError) {
      console.error("Heartbeat failed:", hbError);
    } else {
      console.log("Heartbeat ok");
    }

    // 🔹 CLAIM JOBS
    let jobs: any[] = [];

    const { data: claimed, error: claimError } =
      await supabase.rpc("claim_notification_outbox", {
        p_batch_size: 10
      });

    if (claimError) {
      console.error("RPC claim failed:", claimError);

      const { data: manualJobs, error: manualError } = await supabase
        .from("notification_outbox")
        .select("*")
        .eq("status", "pending")
        .lte("next_retry_at", new Date().toISOString())
        .limit(10);

      if (manualError) {
        console.error("Manual select failed:", manualError);
      } else {
        jobs = manualJobs || [];
        if (jobs.length) {
          await supabase
            .from("notification_outbox")
            .update({ status: "processing" })
            .in("id", jobs.map(j => j.id));
        }
      }
    } else {
      jobs = claimed || [];
    }

    console.log(`Jobs claimed: ${jobs.length}`);

    // 🔹 PROCESS
    for (const job of jobs) {
      try {
        console.log("Sending job", job.id);

        const res = await fetch(
          `${supabaseUrl}/functions/v1/send-notification`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ outbox_id: job.id })
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} ${text}`);
        }

        await supabase
          .from("notification_outbox")
          .update({
            status: "sent",
            processed_at: new Date().toISOString()
          })
          .eq("id", job.id);

      } catch (err: any) {
        console.error("Job failed", job.id, err);

        await supabase.rpc("mark_notification_failed", {
          p_id: job.id,
          p_error: err.message
        });
      }
    }

    return jsonResponse({ ok: true, processed: jobs.length }, 200, req);

  } catch (err: any) {
    console.error("Fatal error:", err);
    return jsonResponse({ error: err.message || String(err) }, 500, req);
  }
});
