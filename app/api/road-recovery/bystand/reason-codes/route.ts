import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** Configurable BYSTAND attendance reasons. Never a hardcoded list. */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_bystand_reason_codes")
      .select("id,reason_code,label,description,requires_detail,commonly_converts,sort_order,active")
      .eq("company_id", context.ctx.companyId)
      .eq("active", true)
      .order("sort_order");

    if (error) return errorResponse("Could not load BYSTAND reasons.", 500);
    return NextResponse.json({ ok: true, reasons: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const reasonCode = asText(body.reasonCode).toLowerCase();
    const label = asText(body.label);
    if (!reasonCode || !label) return errorResponse("reasonCode and label are required.", 400);

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_bystand_reason_codes")
      .insert({
        company_id: context.ctx.companyId,
        reason_code: reasonCode,
        label,
        description: asText(body.description) || null,
        requires_detail: body.requiresDetail === true,
        commonly_converts: body.commonlyConverts === true,
        sort_order: Number(body.sortOrder) || 100,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (error) return errorResponse(error.message, 400);
    return NextResponse.json({ ok: true, reasonCodeId: (data as { id: string }).id });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
