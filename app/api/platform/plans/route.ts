import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

const WRITABLE_FIELDS = [
  "code",
  "name",
  "description",
  "modules",
  "monthly_price",
  "annual_price",
  "trial_period_days",
  "employee_limit",
  "storage_limit_gb",
  "ai_credit_limit",
  "api_request_limit",
  "is_active",
  "sort_order",
] as const;

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plans: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  if (!body?.code || !body?.name) {
    return NextResponse.json({ ok: false, message: "code and name are required." }, { status: 400 });
  }

  const insert: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (field in body) insert[field] = body[field];
  }

  const { data, error } = await supabase.from("subscription_plans").insert(insert).select("id").single();
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "create",
    entityType: "platform_plan",
    entityId: data.id,
    metadata: { code: body.code },
  });

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const id = body?.id ? String(body.id) : "";
  if (!id) return NextResponse.json({ ok: false, message: "id is required." }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, message: "No editable fields provided." }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from("subscription_plans").update(updates).eq("id", id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "update",
    entityType: "platform_plan",
    entityId: id,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json({ ok: true });
}
