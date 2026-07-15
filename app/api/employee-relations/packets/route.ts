import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";

const SUPPORTED_PACKET_TYPES = new Set([
  "disciplinary_packet",
  "hearing_packet",
  "employee_relations_packet",
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const packetType = asText(body.packetType);
    const employeeId = asText(body.employeeId);
    if (!packetType || !SUPPORTED_PACKET_TYPES.has(packetType)) {
      return NextResponse.json({ error: "Unsupported packetType." }, { status: 400 });
    }

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_packet_exports")
      .insert({
        company_id: context.ctx.companyId,
        employee_id: employeeId,
        hr_case_id: asText(body.caseId) || null,
        hearing_case_id: asText(body.hearingId) || null,
        packet_type: packetType,
        export_status: "queued",
        metadata: {
          requested_by: context.ctx.auth.email,
          sections: Array.isArray(body.sections) ? body.sections : [],
        },
        created_by: context.ctx.auth.email,
      })
      .select("id,packet_type,export_status,created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Could not queue packet export." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      eventType: "hr_packet_export_requested",
      sourceTable: "hr_packet_exports",
      sourceId: data.id,
      title: "HR packet export requested",
      summary: packetType,
      metadata: {
        status: data.export_status,
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "hr_packet_export",
      entityId: data.id,
      metadata: {
        packetType,
        employeeId,
      },
    });

    return NextResponse.json({ ok: true, packet: data }, { status: 202 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const status = asText(request.nextUrl.searchParams.get("status") || "");

    let query = context.ctx.auth.supabase
      .from("hr_packet_exports")
      .select("id,employee_id,packet_type,export_status,file_bucket,file_path,metadata,created_at")
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (status) query = query.eq("export_status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Could not load packet exports." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, packets: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}
