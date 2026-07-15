import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, safeAudit, asText } from "@/lib/employee-relations-api";
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

    const templateVersionId = asText(body.templateVersionId);
    if (!templateVersionId) {
      return NextResponse.json({ error: "templateVersionId is required." }, { status: 400 });
    }

    await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);

    const { data: selectedVersion, error: selectedError } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .select("id,version_number,file_bucket,file_path")
      .eq("id", templateVersionId)
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId)
      .maybeSingle();

    if (selectedError) {
      return NextResponse.json({ error: "Could not load selected template version." }, { status: 500 });
    }

    if (!selectedVersion) {
      return NextResponse.json({ error: "Template version not found." }, { status: 404 });
    }

    await context.ctx.auth.supabase
      .from("contract_template_versions")
      .update({ is_active: false, status: "draft" })
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId);

    const { error: activateError } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .update({ is_active: true, status: "active", archived: false })
      .eq("id", selectedVersion.id)
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId);

    if (activateError) {
      return NextResponse.json({ error: "Could not activate template version." }, { status: 500 });
    }

    const { error: templateUpdateError } = await context.ctx.auth.supabase
      .from("contract_templates")
      .update({
        active_version_number: selectedVersion.version_number,
        file_bucket: selectedVersion.file_bucket,
        file_path: selectedVersion.file_path,
        status: "active",
        archived: false,
        archived_at: null,
        archived_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId)
      .eq("company_id", context.ctx.companyId);

    if (templateUpdateError) {
      return NextResponse.json({ error: "Version activated but template status update failed." }, { status: 500 });
    }

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "contract_template",
      entityId: templateId,
      metadata: {
        activatedVersionId: selectedVersion.id,
        activatedVersionNumber: selectedVersion.version_number,
      },
    });

    return NextResponse.json({ ok: true, activeVersionNumber: selectedVersion.version_number });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}
