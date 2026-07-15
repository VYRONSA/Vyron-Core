import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";
import { writeAuditLog } from "@/lib/audit-log";
import { renderDocxTemplate } from "@/lib/contract-intelligence";

export const runtime = "nodejs";

function cleanFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 90);
}

function asStringMap(values: Record<string, unknown>) {
  const output: Record<string, string> = {};

  Object.entries(values || {}).forEach(([key, value]) => {
    output[key] = value === null || value === undefined ? "" : String(value);
  });

  return output;
}

async function assertTemplateOwnership(
  supabase: SupabaseClient,
  companyId: string,
  templateBucket: string,
  templatePath: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("contract_templates")
    .select("id")
    .eq("company_id", companyId)
    .eq("file_bucket", templateBucket)
    .eq("file_path", templatePath)
    .eq("status", "active")
    .limit(1);

  if (error) {
    return { ok: false, status: 500, message: "Template ownership check failed." };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      status: 403,
      message: "Template does not belong to this company workspace.",
    };
  }

  return { ok: true };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "render-contract",
    message: "DOCX render route is available.",
    authRequired: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(
      request.headers.get("authorization"),
      request.cookies.get(VYRON_SESSION_TOKEN_COOKIE)?.value || ""
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const body = await request.json();

    const documentId = String(body.documentId || "");
    const companyId = String(body.companyId || "").trim();
    const templateBucket = String(body.templateBucket || "");
    const templatePath = String(body.templatePath || "");
    const outputTitle = String(body.outputTitle || "generated-contract");
    const employeeId = String(body.employeeId || "unknown-employee");
    const values = asStringMap(body.values || {});

    if (!documentId) {
      return NextResponse.json({ error: "documentId is required." }, { status: 400 });
    }

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required." }, { status: 400 });
    }

    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId);
    if (!access.ok) {
      return NextResponse.json({ error: access.message }, { status: access.status });
    }

    if (!templateBucket || !templatePath) {
      return NextResponse.json({ error: "Template bucket and path are required." }, { status: 400 });
    }

    const templateAccess = await assertTemplateOwnership(
      auth.supabase,
      companyId,
      templateBucket,
      templatePath
    );
    if (!templateAccess.ok) {
      return NextResponse.json({ error: templateAccess.message }, { status: templateAccess.status });
    }

    const { data: documentRow, error: documentError } = await auth.supabase
      .from("employee_generated_documents")
      .select("id,company_id,employee_id")
      .eq("id", documentId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (documentError) {
      return NextResponse.json({ error: documentError.message }, { status: 500 });
    }

    if (!documentRow) {
      return NextResponse.json({ error: "Document not found for this company." }, { status: 404 });
    }

    const { data: templateBlob, error: downloadError } = await auth.supabase.storage
      .from(templateBucket)
      .download(templatePath);

    if (downloadError || !templateBlob) {
      return NextResponse.json({ error: "Could not load the selected template." }, { status: 500 });
    }

    const templateArrayBuffer = await templateBlob.arrayBuffer();

    let renderedBuffer: Buffer;
    try {
      renderedBuffer = await renderDocxTemplate(Buffer.from(templateArrayBuffer), values);
    } catch (renderError: unknown) {
      const message = renderError instanceof Error ? renderError.message : "DOCX placeholder rendering failed.";
      return NextResponse.json(
        {
          error: `DOCX render failed. Check placeholders in the Word template. ${message}`,
        },
        { status: 400 }
      );
    }

    const outputPath = `${companyId}/${employeeId}/${documentId}/${Date.now()}-${cleanFileName(outputTitle)}.docx`;

    const { error: uploadError } = await auth.supabase.storage
      .from("hr-signed-documents")
      .upload(outputPath, renderedBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Could not save rendered contract file." }, { status: 500 });
    }

    const { error: updateError } = await auth.supabase
      .from("employee_generated_documents")
      .update({
        file_bucket: "hr-signed-documents",
        file_path: outputPath,
        generated_word_html:
          "Generated from actual uploaded DOCX template. Download/open the DOCX file for exact layout.",
      })
      .eq("id", documentId)
      .eq("company_id", companyId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    void writeAuditLog(auth.supabase, {
      companyId,
      userEmail: auth.email,
      action: "create",
      entityType: "contract_render",
      entityId: documentId,
      metadata: {
        templateBucket,
        outputBucket: "hr-signed-documents",
      },
    });

    return NextResponse.json({
      ok: true,
      document_id: documentId,
      file_bucket: "hr-signed-documents",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected DOCX render error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
