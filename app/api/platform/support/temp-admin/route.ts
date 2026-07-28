import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { createClientLoginUser } from "@/lib/create-client-login-user";
import { writeAuditLog } from "@/lib/audit-log";
import { administratorCreatedEmail } from "@/lib/platform/email-templates";
import { queueTemplatedNotification } from "@/lib/platform/notifications-dispatch";

export const runtime = "nodejs";

function generateTemporaryPassword(): string {
  return `Vy${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}!`;
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email: operatorEmail } = auth.context;

  const body = await request.json().catch(() => null);
  const companyId = body?.companyId ? String(body.companyId) : "";
  const userEmail = body?.userEmail ? String(body.userEmail) : "";

  if (!companyId || !userEmail) {
    return NextResponse.json({ ok: false, message: "companyId and userEmail are required." }, { status: 400 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const result = await createClientLoginUser({
    email: userEmail,
    password: temporaryPassword,
    companyId,
    role: "admin",
  });

  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: operatorEmail,
    action: "create",
    entityType: "platform_support_temp_admin",
    entityId: userEmail,
    metadata: {},
  });

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  if (company?.name) {
    await queueTemplatedNotification(supabase, {
      to: userEmail,
      template: administratorCreatedEmail({ companyName: company.name, adminEmail: userEmail }),
      companyId,
    });
  }

  return NextResponse.json({ ok: true, email: result.email, temporaryPassword });
}
