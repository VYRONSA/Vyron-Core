import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase.from("platform_settings").select("*");
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const settings: Record<string, unknown> = {};
  for (const row of data || []) settings[row.key] = row.value;

  return NextResponse.json({ ok: true, settings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const key = body?.key ? String(body.key) : "";
  if (!key || !("value" in (body || {}))) {
    return NextResponse.json({ ok: false, message: "key and value are required." }, { status: 400 });
  }

  let previousEnabled: boolean | null = null;
  if (key === "maintenance_mode") {
    const { data: existing } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    previousEnabled = Boolean((existing?.value as { enabled?: boolean } | null)?.enabled);
  }

  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key, value: body.value, updated_at: new Date().toISOString() });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  if (key === "maintenance_mode") {
    const nextEnabled = Boolean((body.value as { enabled?: boolean } | null)?.enabled);
    if (nextEnabled !== previousEnabled) {
      await writeAuditLog(supabase, {
        userEmail: email,
        action: nextEnabled ? "maintenance_enable" : "maintenance_disable",
        entityType: "platform_maintenance_mode",
        entityId: "maintenance_mode",
        metadata: {},
      });
    }
  } else {
    await writeAuditLog(supabase, {
      userEmail: email,
      action: "update",
      entityType: "platform_setting",
      entityId: key,
      metadata: {},
    });
  }

  return NextResponse.json({ ok: true });
}
