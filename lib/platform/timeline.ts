import type { AuditLogRow } from "@/lib/audit-log";

export type TimelineEntry = {
  timestamp: string;
  label: string;
  detail: string | null;
  tone: "neutral" | "positive" | "warning" | "critical";
};

const ENTITY_LABELS: Record<string, string> = {
  platform_customer: "Company profile",
  platform_customer_modules: "Modules",
  platform_customer_plan: "Subscription plan",
  platform_customer_licence: "Licence",
  platform_customer_billing: "Billing",
  platform_support_note: "Support note",
  platform_support_password_reset: "Password reset",
  platform_support_unlock_account: "Account unlock",
  platform_support_resend_invite: "Invitation",
  platform_support_temp_admin: "Temporary administrator",
  platform_impersonation: "Support session",
};

function labelForAuditRow(row: AuditLogRow): { label: string; tone: TimelineEntry["tone"] } {
  if (row.action === "create" && row.entity_type === "platform_customer") return { label: "Company created", tone: "positive" };
  if (row.action === "suspend") return { label: "Customer suspended", tone: "critical" };
  if (row.action === "reactivate") return { label: "Customer reactivated", tone: "positive" };
  if (row.action === "cancel") return { label: "Customer cancelled", tone: "critical" };
  if (row.action === "delete") return { label: "Customer soft-deleted", tone: "critical" };
  if (row.action === "restore") return { label: "Customer restored", tone: "positive" };
  if (row.action === "login_as_client") return { label: "Support impersonation started", tone: "warning" };
  if (row.action === "exit_client_mode") return { label: "Support impersonation ended", tone: "neutral" };

  const entityLabel = ENTITY_LABELS[row.entity_type] || row.entity_type;
  if (row.entity_type === "platform_customer_plan") return { label: "Plan changed", tone: "neutral" };
  if (row.entity_type === "platform_customer_modules") return { label: "Modules updated", tone: "neutral" };
  if (row.entity_type === "platform_customer_licence") return { label: "Licence changed", tone: "neutral" };
  if (row.entity_type === "platform_customer_billing") return { label: "Billing details changed", tone: "neutral" };
  if (row.entity_type === "platform_support_note") return { label: "Support note added", tone: "neutral" };
  if (row.entity_type === "platform_support_password_reset") return { label: "Password reset by support", tone: "warning" };
  if (row.entity_type === "platform_support_unlock_account") return { label: "Account unlocked", tone: "positive" };
  if (row.entity_type === "platform_support_resend_invite") return { label: "Invitation resent", tone: "neutral" };
  if (row.entity_type === "platform_support_temp_admin") return { label: "Temporary administrator created", tone: "warning" };

  return { label: `${entityLabel} ${row.action}`, tone: "neutral" };
}

/**
 * Built entirely from real, already-recorded events (audit log + company_users
 * creation + employee-count milestones). "Invitation accepted" and "Payments" are
 * deliberately omitted — nothing in this app records either signal yet.
 */
export function buildCustomerTimeline(input: {
  auditLog: AuditLogRow[];
  companyCreatedAt: string | null;
  administratorInvitedEvents: { email: string; createdAt: string }[];
  employeeMilestones: { count: number; reachedAt: string }[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  if (input.companyCreatedAt) {
    entries.push({ timestamp: input.companyCreatedAt, label: "Company created", detail: null, tone: "positive" });
  }

  for (const invite of input.administratorInvitedEvents) {
    entries.push({
      timestamp: invite.createdAt,
      label: "Administrator invited",
      detail: invite.email,
      tone: "neutral",
    });
  }

  for (const milestone of input.employeeMilestones) {
    entries.push({
      timestamp: milestone.reachedAt,
      label: `Reached ${milestone.count} employees`,
      detail: null,
      tone: "positive",
    });
  }

  for (const row of input.auditLog) {
    if (row.action === "create" && row.entity_type === "platform_customer") continue; // already added above
    const { label, tone } = labelForAuditRow(row);
    entries.push({
      timestamp: row.created_at,
      label,
      detail: row.user_email,
      tone,
    });
  }

  return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
