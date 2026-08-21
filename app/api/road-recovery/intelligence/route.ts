import { NextRequest, NextResponse } from "next/server";
import {
  computeRoadRecoveryIntelligence,
  RR_INTELLIGENCE_ROW_LIMIT,
} from "@/lib/road-recovery/intelligence-service";
import { asNumberOrNull, asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * Road & Recovery Executive & Operations Intelligence.
 *
 * GET-ONLY. Reading intelligence never writes anything: no action is prepared, no metric
 * is cached, no threshold is created. Acting on a recommendation is a separate, deliberate
 * POST to /intelligence/actions.
 *
 * The tenant boundary is the same requireApiContext() gate every Road & Recovery route
 * uses: the caller's companyId is verified against their own membership, and the queries
 * then run under their RLS context. The three intelligence views are security_invoker, so
 * those policies apply through the views as well.
 */
export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const context = await requireApiContext(request, search.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const result = await computeRoadRecoveryIntelligence(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      fromIso: asText(search.get("from")) || null,
      toIso: asText(search.get("to")) || null,
      asOfIso: asText(search.get("asOf")) || null,
      serviceCode: asText(search.get("serviceCode")) || null,
      counterpartyId: asText(search.get("counterpartyId")) || null,
      rowLimit: asNumberOrNull(search.get("rowLimit")),
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json(
      { ok: true, intelligence: result.data, rowLimit: RR_INTELLIGENCE_ROW_LIMIT },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
