import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, safeAudit } from "@/lib/employee-relations-api";
import { assertTemplateOwnershipById } from "@/lib/contract-intelligence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);

    const now = new Date().toISOString();

    const { error } = await context.ctx.auth.supabase
      .from("contract_templates")
      .update({
        archived: true,
        archived_at: now,
        archived_by: context.ctx.auth.email,
        status: "archived",
        updated_at: now,
      })
      .eq("id", templateId)
      .eq("company_id", context.ctx.companyId);

    if (error) {
      return NextResponse.json({ error: "Could not archive template." }, { status: 500 });
    }

    await context.ctx.auth.supabase
      .from("contract_template_versions")
      .update({ archived: true, archived_at: now, archived_by: context.ctx.auth.email, is_active: false, status: "archived" })
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId);

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "archive",
      entityType: "contract_template",
      entityId: templateId,
      metadata: {
        reason: String(body.reason || ""),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}
