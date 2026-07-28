import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

const WRITABLE_FIELDS = [
  "name",
  "description",
  "status",
  "requires_enterprise",
  "requires_ai_credits",
  "employee_limit",
  "user_limit",
  "version",
] as const;

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("platform_modules")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, modules: data || [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const moduleCode = body?.moduleCode ? String(body.moduleCode) : "";
  if (!moduleCode) return NextResponse.json({ ok: false, message: "moduleCode is required." }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, message: "No editable fields provided." }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from("platform_modules").update(updates).eq("module_code", moduleCode);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "update",
    entityType: "platform_module",
    entityId: moduleCode,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json({ ok: true });
}
