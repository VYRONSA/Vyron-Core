import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";

export const runtime = "nodejs";

const QUEUE_NAMES = ["email", "notification", "storage", "ai"] as const;
const STATUSES = ["pending", "processing", "completed", "failed"] as const;

/**
 * Monitoring view over platform_job_queue. This is a tracking/audit table, not a
 * live async worker engine — there is no background consumer processing these rows
 * yet (that would need Vercel Queues or a similar worker runtime).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("platform_job_queue")
    .select("queue_name,status,created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const rows = data || [];
  const counts: Record<string, Record<string, number>> = {};
  for (const name of QUEUE_NAMES) {
    counts[name] = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  }
  for (const row of rows) {
    if (counts[row.queue_name] && row.status in counts[row.queue_name]) {
      counts[row.queue_name][row.status] += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    counts,
    recent: rows.slice(0, 20),
    isWorkerWired: false,
  });
}
