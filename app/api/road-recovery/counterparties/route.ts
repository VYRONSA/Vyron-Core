import { NextRequest, NextResponse } from "next/server";
import {
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

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_counterparties")
      .select(
        "id,counterparty_code,counterparty_type,legal_name,trading_name,branch_label,requires_authorisation,status,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .order("legal_name");

    if (error) return errorResponse("Could not load counterparties.", 500);
    return NextResponse.json({ ok: true, counterparties: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const code = asText(body.counterpartyCode);
    const legalName = asText(body.legalName);
    const type = asText(body.counterpartyType);
    if (!code || !legalName || !type) {
      return errorResponse("counterpartyCode, legalName and counterpartyType are required.", 400);
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_counterparties")
      .insert({
        company_id: context.ctx.companyId,
        counterparty_code: code,
        counterparty_type: type,
        legal_name: legalName,
        trading_name: asText(body.tradingName) || null,
        branch_label: asText(body.branchLabel) || null,
        registration_number: asText(body.registrationNumber) || null,
        vat_number: asText(body.vatNumber) || null,
        requires_authorisation: body.requiresAuthorisation !== false,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (error) return errorResponse(error.message, 400);
    return NextResponse.json({ ok: true, counterpartyId: (data as { id: string }).id });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
