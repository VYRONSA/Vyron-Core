import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase.from("platform_feature_flags").select("*").order("code");
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, flags: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const code = body?.code ? String(body.code) : "";
  const name = body?.name ? String(body.name) : "";
  if (!code || !name) return NextResponse.json({ ok: false, message: "code and name are required." }, { status: 400 });

  const { error } = await supabase.from("platform_feature_flags").insert({
    code,
    name,
    description: body.description ? String(body.description) : null,
    is_enabled: Boolean(body.isEnabled),
    rollout_scope: body.rolloutScope ? String(body.rolloutScope) : "all",
  });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "create",
    entityType: "platform_feature_flag",
    entityId: code,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const code = body?.code ? String(body.code) : "";
  if (!code) return NextResponse.json({ ok: false, message: "code is required." }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("isEnabled" in (body || {})) updates.is_enabled = Boolean(body.isEnabled);
  if ("rolloutScope" in (body || {})) updates.rollout_scope = String(body.rolloutScope);
  if ("description" in (body || {})) updates.description = body.description ? String(body.description) : null;

  const { error } = await supabase.from("platform_feature_flags").update(updates).eq("code", code);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "update",
    entityType: "platform_feature_flag",
    entityId: code,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json({ ok: true });
}
