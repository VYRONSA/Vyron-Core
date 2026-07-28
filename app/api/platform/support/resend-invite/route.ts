import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { resendClientActivationEmail } from "@/lib/client-invite-resend";
import { writeAuditLog } from "@/lib/audit-log";
import { logQueueJob } from "@/lib/platform/job-queue";

export const runtime = "nodejs";

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

  const redirectTo = `${request.nextUrl.origin}/invite`;
  const result = await resendClientActivationEmail(userEmail, redirectTo);

  await writeAuditLog(supabase, {
    companyId,
    userEmail: operatorEmail,
    action: "update",
    entityType: "platform_support_resend_invite",
    entityId: userEmail,
    metadata: { result: result.ok ? result.kind : result.code },
  });

  await logQueueJob(supabase, {
    queueName: "email",
    payload: { to: userEmail, kind: "invite_resend" },
    status: result.ok ? "completed" : "failed",
  });

  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}
