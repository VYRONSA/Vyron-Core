import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email: operatorEmail } = auth.context;

  const body = await request.json().catch(() => null);
  const companyId = body?.companyId ? String(body.companyId) : "";
  const userEmail = body?.userEmail ? String(body.userEmail).trim().toLowerCase() : "";
  const password = body?.password ? String(body.password) : "";

  if (!companyId || !userEmail) {
    return NextResponse.json({ ok: false, message: "companyId and userEmail are required." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const { data: mapping, error: mappingError } = await supabase
    .from("company_users")
    .select("user_id")
    .eq("company_id", companyId)
    .ilike("user_email", userEmail)
    .maybeSingle();

  if (mappingError) return NextResponse.json({ ok: false, message: mappingError.message }, { status: 400 });
  if (!mapping?.user_id) {
    return NextResponse.json({ ok: false, message: "No linked auth user found for this email." }, { status: 404 });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(mapping.user_id, { password });
  if (updateError) return NextResponse.json({ ok: false, message: updateError.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: operatorEmail,
    action: "update",
    entityType: "platform_support_password_reset",
    entityId: userEmail,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
