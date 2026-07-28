import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog, type AuditAction } from "@/lib/audit-log";
import { customerSuspendedEmail, customerReactivatedEmail } from "@/lib/platform/email-templates";
import { queueTemplatedNotification } from "@/lib/platform/notifications-dispatch";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["trial", "active", "grace_period", "suspended", "cancelled", "expired"]);

type RouteParams = { params: Promise<{ companyId: string }> };

function auditActionForStatus(status: string): AuditAction {
  if (status === "suspended") return "suspend";
  if (status === "active") return "reactivate";
  if (status === "cancelled") return "cancel";
  return "update";
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;
  const { companyId } = await params;

  const body = await request.json().catch(() => null);
  const status = String(body?.status || "").trim().toLowerCase();

  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { ok: false, message: `status must be one of: ${Array.from(VALID_STATUSES).join(", ")}.` },
      { status: 400 }
    );
  }

  const { data: previous } = await supabase
    .from("companies")
    .select("customer_status")
    .eq("id", companyId)
    .maybeSingle();
  const wasSuspended = previous?.customer_status === "suspended";

  const { data: company, error } = await supabase
    .from("companies")
    .update({ customer_status: status })
    .eq("id", companyId)
    .select("name")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: email,
    action: auditActionForStatus(status),
    entityType: "platform_customer",
    entityId: companyId,
    metadata: { customer_status: status },
  });

  if ((status === "suspended" || (status === "active" && wasSuspended)) && company?.name) {
    const { data: owner } = await supabase
      .from("company_users")
      .select("user_email")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    if (owner?.user_email) {
      const template =
        status === "suspended"
          ? customerSuspendedEmail({ companyName: company.name })
          : customerReactivatedEmail({ companyName: company.name });
      await queueTemplatedNotification(supabase, { to: owner.user_email, template, companyId });
    }
  }

  return NextResponse.json({ ok: true, customerStatus: status });
}
