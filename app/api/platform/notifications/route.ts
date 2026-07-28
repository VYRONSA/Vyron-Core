import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { getNotificationThresholds } from "@/lib/platform/settings";

export const runtime = "nodejs";

type Notification = {
  type:
    | "trial_expiring"
    | "subscription_expiring"
    | "customer_suspended"
    | "customer_inactive"
    | "failed_job";
  severity: "info" | "warning" | "critical";
  companyId: string | null;
  title: string;
  message: string;
};

/**
 * Computed at request time from real data (no persisted notification-delivery
 * pipeline / email-sending for these — that would need a scheduled worker, which
 * this app does not have). "Storage full" / "AI credits exhausted" / "system errors"
 * are intentionally omitted — no usage or error telemetry exists yet to compute them from.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const now = Date.now();
  const thresholds = await getNotificationThresholds(supabase);
  const SOON_MS = thresholds.expiringSoonDays * 24 * 60 * 60 * 1000;
  const INACTIVE_MS = thresholds.inactiveDays * 24 * 60 * 60 * 1000;

  const [companiesRes, usersRes, failedJobsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id,name,customer_status,trial_ends_at,licence_expires_at")
      .is("deleted_at", null),
    supabase.from("company_users").select("company_id,last_login_at").eq("status", "active"),
    supabase
      .from("platform_job_queue")
      .select("id,queue_name,payload,created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ ok: false, message: companiesRes.error.message }, { status: 500 });
  }

  const lastLoginByCompany = new Map<string, string | null>();
  for (const row of usersRes.data || []) {
    const current = lastLoginByCompany.get(row.company_id);
    if (!current || (row.last_login_at && row.last_login_at > current)) {
      lastLoginByCompany.set(row.company_id, row.last_login_at);
    }
  }

  const notifications: Notification[] = [];

  for (const company of companiesRes.data || []) {
    if (company.customer_status === "trial" && company.trial_ends_at) {
      const msLeft = new Date(company.trial_ends_at).getTime() - now;
      if (msLeft > 0 && msLeft < SOON_MS) {
        notifications.push({
          type: "trial_expiring",
          severity: "warning",
          companyId: company.id,
          title: `${company.name}: trial expiring soon`,
          message: `Trial ends ${company.trial_ends_at.slice(0, 10)}.`,
        });
      }
    }

    if (company.licence_expires_at) {
      const msLeft = new Date(company.licence_expires_at).getTime() - now;
      if (msLeft > 0 && msLeft < SOON_MS) {
        notifications.push({
          type: "subscription_expiring",
          severity: "warning",
          companyId: company.id,
          title: `${company.name}: licence expiring soon`,
          message: `Licence expires ${company.licence_expires_at.slice(0, 10)}.`,
        });
      }
    }

    if (company.customer_status === "suspended") {
      notifications.push({
        type: "customer_suspended",
        severity: "critical",
        companyId: company.id,
        title: `${company.name} is suspended`,
        message: "This customer cannot currently sign in.",
      });
    }

    const lastLogin = lastLoginByCompany.get(company.id);
    if (company.customer_status === "active" && lastLogin) {
      const inactiveMs = now - new Date(lastLogin).getTime();
      if (inactiveMs > INACTIVE_MS) {
        notifications.push({
          type: "customer_inactive",
          severity: "info",
          companyId: company.id,
          title: `${company.name}: inactive`,
          message: `No login in over ${Math.round(inactiveMs / (24 * 60 * 60 * 1000))} days.`,
        });
      }
    }
  }

  for (const job of failedJobsRes.data || []) {
    notifications.push({
      type: "failed_job",
      severity: "critical",
      companyId: null,
      title: `Failed ${job.queue_name} job`,
      message: `Job created ${job.created_at.slice(0, 19).replace("T", " ")}.`,
    });
  }

  return NextResponse.json({ ok: true, notifications });
}
