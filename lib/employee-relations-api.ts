import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
  type AuthenticatedApiContext,
} from "@/lib/server-api-auth";
import { writeAuditLog, type AuditAction } from "@/lib/audit-log";

export type ApiContext = {
  auth: Extract<AuthenticatedApiContext, { ok: true }>;
  companyId: string;
};

export function asText(value: unknown): string {
  return String(value ?? "").trim();
}

export function asMaybeText(value: unknown): string | null {
  const text = asText(value);
  return text ? text : null;
}

export function asIsoDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function asUuid(value: unknown): string | null {
  const text = asText(value);
  return text || null;
}

export function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

export function parseError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected request failure.";
}

export async function requireApiContext(
  request: NextRequest,
  companyIdValue: unknown
): Promise<{ ok: true; ctx: ApiContext } | { ok: false; status: number; message: string }> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return { ok: false, status: auth.status, message: auth.message };
  }

  const companyId = asText(companyIdValue);
  if (!companyId) {
    return { ok: false, status: 400, message: "companyId is required." };
  }

  const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId, {
    platformOperator: auth.platformOperator,
  });
  if (!access.ok) {
    return { ok: false, status: access.status, message: access.message };
  }

  return {
    ok: true,
    ctx: {
      auth,
      companyId,
    },
  };
}

export async function assertEmployeeBelongsToCompany(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, message: "Could not verify employee ownership." };
  }

  if (!data) {
    return { ok: false, status: 404, message: "Employee not found in this company workspace." };
  }

  return { ok: true };
}

export async function appendTimelineEvent(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    eventType: string;
    sourceTable?: string;
    sourceId?: string | null;
    title?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown> | null;
    createdBy: string;
    eventDate?: string | null;
  }
): Promise<{ ok: true; eventId: string } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("employee_relations_timeline_events")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      event_type: input.eventType,
      event_date: input.eventDate || new Date().toISOString(),
      source_table: input.sourceTable || null,
      source_id: input.sourceId || null,
      title: input.title || null,
      summary: input.summary || null,
      metadata: input.metadata || {},
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return { ok: false, message: "Could not append timeline event." };
  }

  return { ok: true, eventId: data.id as string };
}

export async function safeAudit(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    email: string;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.email,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId || null,
    metadata: input.metadata || {},
  });
}
