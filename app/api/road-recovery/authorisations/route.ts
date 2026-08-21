import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(request.nextUrl.searchParams.get("serviceJobId"));
    let query = context.ctx.auth.supabase
      .from("rr_authorisations")
      .select("*")
      .eq("company_id", context.ctx.companyId)
      .order("authorised_at", { ascending: false });

    if (serviceJobId) query = query.eq("service_job_id", serviceJobId);

    const { data, error } = await query;
    if (error) return errorResponse("Could not load authorisations.", 500);
    return NextResponse.json({ ok: true, authorisations: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(body.serviceJobId);
    const counterpartyId = asText(body.counterpartyId);
    const authorisationNumber = asText(body.authorisationNumber);
    const authorisedServiceCode = asText(body.authorisedServiceCode);

    if (!serviceJobId || !counterpartyId || !authorisationNumber || !authorisedServiceCode) {
      return errorResponse(
        "serviceJobId, counterpartyId, authorisationNumber and authorisedServiceCode are required.",
        400
      );
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_authorisations")
      .insert({
        company_id: context.ctx.companyId,
        service_job_id: serviceJobId,
        counterparty_id: counterpartyId,
        authorisation_number: authorisationNumber,
        claim_reference: asText(body.claimReference) || null,
        po_number: asText(body.poNumber) || null,
        authorised_service_code: authorisedServiceCode,
        authorised_amount: asNumberOrNull(body.authorisedAmount),
        authorised_by_name: asText(body.authorisedByName) || null,
        authorised_by_contact: asText(body.authorisedByContact) || null,
        channel: asText(body.channel) || "phone",
        expires_at: asText(body.expiresAt) || null,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (error) return errorResponse(error.message, 400);

    const authorisationId = (data as { id: string }).id;

    await writeAuditLog(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      userEmail: context.ctx.auth.email,
      action: "approve",
      entityType: "rr_authorisation",
      entityId: authorisationId,
      metadata: { serviceJobId, counterpartyId, authorisationNumber },
    });

    return NextResponse.json({ ok: true, authorisationId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Void an authorisation. Legal records are voided, never deleted. */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const authorisationId = asText(body.authorisationId);
    const voidReason = asText(body.voidReason);
    if (!authorisationId || !voidReason) {
      return errorResponse("authorisationId and voidReason are required.", 400);
    }

    const { error } = await context.ctx.auth.supabase
      .from("rr_authorisations")
      .update({
        status: "void",
        void_reason: voidReason,
        voided_at: new Date().toISOString(),
        voided_by: context.ctx.auth.email,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", context.ctx.companyId)
      .eq("id", authorisationId);

    if (error) return errorResponse(error.message, 400);

    await writeAuditLog(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      userEmail: context.ctx.auth.email,
      action: "cancel",
      entityType: "rr_authorisation",
      entityId: authorisationId,
      metadata: { voidReason },
    });

    return NextResponse.json({ ok: true, voided: true });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
