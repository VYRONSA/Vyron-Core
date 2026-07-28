/**
 * Recent Platform Activity — the "what happened last" strip on the Platform dashboard.
 *
 * Read-only over public.vyron_audit_log. Each card is the most recent matching audit
 * event, so this needs no new storage and stays accurate automatically as routes write
 * their existing audit entries.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";

export const runtime = "nodejs";

const AUDIT_TABLE = "vyron_audit_log";

type AuditRow = {
  action: string;
  user_email: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ActivityKey =
  | "lastPlatformLogin"
  | "lastCustomerCreated"
  | "lastSuspension"
  | "lastImpersonation"
  | "lastRelease"
  | "lastMaintenanceWindow";

/**
 * Which audit event backs each card. `action` alone is not enough for the generic
 * create/update actions, so entityType narrows them — that is how the platform routes
 * already record these events (see app/api/platform/*).
 */
const SOURCES: { key: ActivityKey; label: string; action: string; entityType?: string }[] = [
  { key: "lastPlatformLogin", label: "Last Platform Login", action: "platform_elevation_granted" },
  { key: "lastCustomerCreated", label: "Last Customer Created", action: "create", entityType: "platform_customer" },
  { key: "lastSuspension", label: "Last Suspension", action: "suspend" },
  { key: "lastImpersonation", label: "Last Impersonation", action: "login_as_client" },
  { key: "lastRelease", label: "Last Release", action: "create", entityType: "platform_release_note" },
  { key: "lastMaintenanceWindow", label: "Last Maintenance Window", action: "maintenance_enable" },
];

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const results = await Promise.all(
    SOURCES.map(async (source) => {
      let query = supabase
        .from(AUDIT_TABLE)
        .select("action,user_email,entity_type,entity_id,metadata,created_at")
        .eq("action", source.action)
        .order("created_at", { ascending: false })
        .limit(1);

      if (source.entityType) query = query.eq("entity_type", source.entityType);

      const { data, error } = await query.maybeSingle();
      const row = (data as AuditRow | null) || null;

      return {
        key: source.key,
        label: source.label,
        // `available: false` distinguishes "audit log unreadable" from the ordinary
        // "this has genuinely never happened yet" — they should not look the same.
        available: !error,
        at: row?.created_at || null,
        operator: row?.user_email || null,
        entityId: row?.entity_id || null,
        detail: describe(source.key, row),
      };
    })
  );

  return NextResponse.json({ ok: true, activity: results });
}

function describe(key: ActivityKey, row: AuditRow | null): string | null {
  if (!row) return null;
  const meta = row.metadata || {};

  if (key === "lastCustomerCreated") {
    return (meta.companyName as string) || (meta.name as string) || null;
  }
  if (key === "lastSuspension") {
    return (meta.customer_status as string) || null;
  }
  if (key === "lastImpersonation") {
    return (meta.companyName as string) || (row.entity_id as string) || null;
  }
  if (key === "lastPlatformLogin") {
    const via = meta.via as string | undefined;
    return via ? `via ${via} secret` : null;
  }
  if (key === "lastRelease") {
    return (meta.title as string) || (meta.version as string) || null;
  }
  if (key === "lastMaintenanceWindow") {
    return (meta.message as string) || null;
  }
  return null;
}
