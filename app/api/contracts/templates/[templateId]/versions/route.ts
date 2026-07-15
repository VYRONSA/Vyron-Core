import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, safeAudit, asText } from "@/lib/employee-relations-api";
import {
  CONTRACT_DOCX_MIME,
  CONTRACT_TEMPLATE_BUCKET,
  assertTemplateOwnershipById,
  extractDocxPlaceholders,
} from "@/lib/contract-intelligence";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    const companyId = request.nextUrl.searchParams.get("companyId");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);

    const { data, error } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .select("id,version_number,is_active,status,effective_date,change_notes,file_bucket,file_path,placeholder_schema,created_by,created_at")
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Could not load template version history." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, versions: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    const formData = await request.formData();

    const companyId = asText(formData.get("companyId"));
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const changeNotes = asText(formData.get("changeNotes"));
    const effectiveDate = asText(formData.get("effectiveDate"));
    const makeActive = asText(formData.get("makeActive")).toLowerCase() === "true";
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "DOCX template file is required." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Only .docx templates are supported." }, { status: 400 });
    }

    const template = await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);

    const { data: latestVersion, error: latestError } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .select("version_number")
      .eq("company_id", context.ctx.companyId)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      return NextResponse.json({ error: "Could not load latest template version." }, { status: 500 });
    }

    const nextVersion = Number(latestVersion?.version_number || 0) + 1;
    const templateBuffer = Buffer.from(await file.arrayBuffer());
    const placeholders = extractDocxPlaceholders(templateBuffer);

    const templatePath = `${context.ctx.companyId}/templates/${template.template_key || templateId}/v${nextVersion}-${Date.now()}.docx`;

    const { error: uploadError } = await context.ctx.auth.supabase.storage
      .from(CONTRACT_TEMPLATE_BUCKET)
      .upload(templatePath, templateBuffer, {
        contentType: CONTRACT_DOCX_MIME,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Could not upload template version file." }, { status: 500 });
    }

    if (makeActive) {
      await context.ctx.auth.supabase
        .from("contract_template_versions")
        .update({ is_active: false })
        .eq("company_id", context.ctx.companyId)
        .eq("template_id", templateId);
    }

    const { data: version, error: versionError } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .insert({
        company_id: context.ctx.companyId,
        template_id: templateId,
        version_number: nextVersion,
        file_bucket: CONTRACT_TEMPLATE_BUCKET,
        file_path: templatePath,
        placeholder_schema: { placeholders },
        questionnaire_schema: {},
        change_notes: changeNotes || null,
        is_active: makeActive,
        status: makeActive ? "active" : "draft",
        effective_date: effectiveDate || null,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (versionError || !version) {
      return NextResponse.json({ error: "Could not create new template version." }, { status: 500 });
    }

    if (makeActive) {
      await context.ctx.auth.supabase
        .from("contract_templates")
        .update({
          active_version_number: nextVersion,
          file_bucket: CONTRACT_TEMPLATE_BUCKET,
          file_path: templatePath,
          status: "active",
          archived: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", templateId)
        .eq("company_id", context.ctx.companyId);
    }

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "contract_template_version",
      entityId: String(version.id),
      metadata: {
        templateId,
        version: nextVersion,
        makeActive,
      },
    });

    return NextResponse.json({
      ok: true,
      templateVersionId: version.id,
      versionNumber: nextVersion,
      placeholders,
      active: makeActive,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}
