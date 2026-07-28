import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;
  const { companyId } = await params;

  const body = await request.json().catch(() => null);
  const modules = body?.modules;
  if (!Array.isArray(modules) || !modules.every((item) => typeof item === "string")) {
    return NextResponse.json({ ok: false, message: "modules must be an array of strings." }, { status: 400 });
  }

  const { error } = await supabase
    .from("companies")
    .update({ enabled_modules: modules })
    .eq("id", companyId);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: email,
    action: "update",
    entityType: "platform_customer_modules",
    entityId: companyId,
    metadata: { modules },
  });

  return NextResponse.json({ ok: true });
}
