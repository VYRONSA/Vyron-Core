import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTemplate } from "@/lib/platform/email-templates";
import { logQueueJob } from "@/lib/platform/job-queue";

/**
 * Renders a template and records it in the notification queue for traceability.
 * Status is "pending", not "completed" — there is no live email provider consuming
 * this queue yet, so nothing is actually delivered. This exists so the templates in
 * lib/platform/email-templates.ts are exercised end-to-end (visible in System >
 * Queues) rather than dead code, without falsely claiming delivery.
 */
export async function queueTemplatedNotification(
  supabase: SupabaseClient,
  params: { to: string; template: EmailTemplate; companyId?: string | null }
): Promise<void> {
  await logQueueJob(supabase, {
    queueName: "notification",
    payload: { to: params.to, subject: params.template.subject, companyId: params.companyId || null },
    status: "pending",
  });
}
