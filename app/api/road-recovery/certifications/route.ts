import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/**
 * Driver certifications. References the EXISTING public.employees; an optional
 * employeeDocumentId links the scanned copy already held in public.employee_documents.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const employeeId = asText(request.nextUrl.searchParams.get("employeeId"));
    let query = context.ctx.auth.supabase
      .from("rr_driver_certifications")
      .select("*")
      .eq("company_id", context.ctx.companyId)
      .order("expires_at", { ascending: true });

    if (employeeId) query = query.eq("employee_id", employeeId);

    const { data, error } = await query;
    if (error) return errorResponse("Could not load certifications.", 500);
    return NextResponse.json({ ok: true, certifications: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const employeeId = asText(body.employeeId);
    const certificationType = asText(body.certificationType);
    if (!employeeId || !certificationType) {
      return errorResponse("employeeId and certificationType are required.", 400);
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_driver_certifications")
      .upsert(
        {
          company_id: context.ctx.companyId,
          employee_id: employeeId,
          certification_type: certificationType,
          identifier: asText(body.identifier) || null,
          issuing_authority: asText(body.issuingAuthority) || null,
          issued_at: asText(body.issuedAt) || null,
          expires_at: asText(body.expiresAt) || null,
          employee_document_id: asText(body.employeeDocumentId) || null,
          blocks_dispatch: body.blocksDispatch !== false,
          status: asText(body.status) || "active",
          verified_by: context.ctx.auth.email,
          verified_at: new Date().toISOString(),
          created_by: context.ctx.auth.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,employee_id,certification_type" }
      )
      .select("id")
      .single();

    if (error) return errorResponse(error.message, 400);
    return NextResponse.json({ ok: true, certificationId: (data as { id: string }).id });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
