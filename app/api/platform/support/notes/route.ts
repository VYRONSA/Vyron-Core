import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const companyId = request.nextUrl.searchParams.get("companyId") || "";
  if (!companyId) return NextResponse.json({ ok: false, message: "companyId is required." }, { status: 400 });

  const { data, error } = await supabase
    .from("platform_support_notes")
    .select("id,operator_email,note,created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, notes: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const companyId = body?.companyId ? String(body.companyId) : "";
  const note = body?.note ? String(body.note).trim() : "";

  if (!companyId || !note) {
    return NextResponse.json({ ok: false, message: "companyId and note are required." }, { status: 400 });
  }

  const { error } = await supabase.from("platform_support_notes").insert({
    company_id: companyId,
    operator_email: email,
    note,
  });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: email,
    action: "create",
    entityType: "platform_support_note",
    entityId: null,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
