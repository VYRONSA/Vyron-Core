import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

/** "Unlock" — this app has no failed-login-attempt lockout counter; the practical
 * unlock action is reactivating a company_users seat that was set to inactive. */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email: operatorEmail } = auth.context;

  const body = await request.json().catch(() => null);
  const companyId = body?.companyId ? String(body.companyId) : "";
  const userEmail = body?.userEmail ? String(body.userEmail).trim().toLowerCase() : "";

  if (!companyId || !userEmail) {
    return NextResponse.json({ ok: false, message: "companyId and userEmail are required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("company_users")
    .update({ status: "active" })
    .eq("company_id", companyId)
    .ilike("user_email", userEmail);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: operatorEmail,
    action: "update",
    entityType: "platform_support_unlock_account",
    entityId: userEmail,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
