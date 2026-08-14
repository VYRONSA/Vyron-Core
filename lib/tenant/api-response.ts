import { NextResponse } from "next/server";
import { UserManagementError } from "@/lib/tenant/user-management";
import { StoreError } from "@/lib/tenant/user-management-store";

/**
 * Turns a service-layer failure into an HTTP response.
 *
 * Only UserManagementError and StoreError carry a message that is safe to show a user;
 * anything else is reported generically so an unexpected database or driver error cannot
 * leak schema details to a customer-facing screen.
 */
export function userManagementErrorResponse(error: unknown): NextResponse {
  if (error instanceof UserManagementError || error instanceof StoreError) {
    return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
  }
  console.error("[user-management] unhandled error", error);
  return NextResponse.json(
    { ok: false, message: "The request could not be completed." },
    { status: 500 }
  );
}

/** Body parser that never throws — an unparseable body is simply an empty object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Normalizes the "modules" field: absent = leave alone, null = inherit all, array = explicit. */
export function readModulesField(
  body: Record<string, unknown>
): string[] | null | undefined {
  if (!("modules" in body)) return undefined;
  const value = body.modules;
  if (value === null) return null;
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || ""));
}

export function readPermissionsField(
  body: Record<string, unknown>
): Record<string, unknown> | null | undefined {
  if (!("permissions" in body)) return undefined;
  const value = body.permissions;
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** "manual" | "generate" | "invite" — anything else is rejected by the service. */
export function readPasswordMode(value: unknown, fallback: string): string {
  const mode = String(value || "").trim().toLowerCase();
  return mode || fallback;
}
