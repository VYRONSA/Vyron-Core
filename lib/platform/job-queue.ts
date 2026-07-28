import type { SupabaseClient } from "@supabase/supabase-js";

/** Lightweight tracking log for the System > Queues monitoring page — not an async
 * worker engine. Failures here are swallowed (best-effort telemetry only). */
export async function logQueueJob(
  supabase: SupabaseClient,
  params: {
    queueName: "email" | "notification" | "storage" | "ai";
    payload: Record<string, unknown>;
    status?: "pending" | "processing" | "completed" | "failed";
  }
): Promise<void> {
  const status = params.status || "completed";
  try {
    await supabase.from("platform_job_queue").insert({
      queue_name: params.queueName,
      payload: params.payload,
      status,
      processed_at: status === "completed" || status === "failed" ? new Date().toISOString() : null,
    });
  } catch {
    // best-effort only
  }
}
