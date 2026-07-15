import { NextRequest, NextResponse } from "next/server";
import { appendTimelineEvent, asText, parseError, requireApiContext, safeAudit } from "@/lib/employee-relations-api";

async function findHearing(supabase: any, hearingId: string, companyId: string) {
  return supabase
    .from("hearing_cases")
    .select("id,employee_id")
    .eq("id", hearingId)
    .eq("company_id", companyId)
    .maybeSingle();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    if (!hearingId) return NextResponse.json({ error: "hearingId is required." }, { status: 400 });

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_evidence")
      .select("id,evidence_type,file_bucket,file_path,submitted_by,submitted_at,admissibility_status")
      .eq("hearing_case_id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .order("submitted_at", { ascending: false });

    if (error) return NextResponse.json({ error: "Could not load hearing evidence." }, { status: 500 });

    return NextResponse.json({ ok: true, evidence: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    const evidenceType = asText(body.evidenceType);
    if (!hearingId || !evidenceType) {
      return NextResponse.json({ error: "hearingId and evidenceType are required." }, { status: 400 });
    }

    const hearing = await findHearing(context.ctx.auth.supabase, hearingId, context.ctx.companyId);
    if (hearing.error) return NextResponse.json({ error: "Could not load hearing." }, { status: 500 });
    if (!hearing.data) return NextResponse.json({ error: "Hearing not found." }, { status: 404 });

    const fileBase64 = asText(body.fileBase64);
    const fileName = asText(body.fileName) || "evidence.bin";
    const contentType = asText(body.contentType) || "application/octet-stream";

    if (!fileBase64) {
      return NextResponse.json({ error: "fileBase64 is required." }, { status: 400 });
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");
    const path = `${context.ctx.companyId}/${hearing.data.employee_id}/${hearingId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const upload = await context.ctx.auth.supabase.storage
      .from("hearing-evidence")
      .upload(path, fileBuffer, {
        contentType,
        upsert: false,
      });

    if (upload.error) {
      return NextResponse.json({ error: "Could not upload hearing evidence." }, { status: 500 });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_evidence")
      .insert({
        company_id: context.ctx.companyId,
        hearing_case_id: hearingId,
        evidence_type: evidenceType,
        file_bucket: "hearing-evidence",
        file_path: path,
        submitted_by: context.ctx.auth.email,
        admissibility_status: asText(body.admissibilityStatus) || "pending",
      })
      .select("id,evidence_type,file_bucket,file_path,submitted_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Could not save hearing evidence metadata." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: hearing.data.employee_id,
      eventType: "hearing_evidence_uploaded",
      sourceTable: "hearing_evidence",
      sourceId: data.id,
      title: "Hearing evidence uploaded",
      summary: evidenceType,
      metadata: {
        fileBucket: "hearing-evidence",
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "hearing_evidence",
      entityId: data.id,
      metadata: {
        hearingId,
        evidenceType,
      },
    });

    return NextResponse.json({ ok: true, evidence: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}
