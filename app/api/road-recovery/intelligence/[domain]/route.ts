import { NextRequest, NextResponse } from "next/server";
import { computeRoadRecoveryIntelligence } from "@/lib/road-recovery/intelligence-service";
import {
  RR_DOMAIN_LABELS,
  RR_INTELLIGENCE_DOMAINS,
  isRrIntelligenceDomain,
} from "@/lib/road-recovery/intelligence/types";
import { asNumberOrNull, asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/** One Road & Recovery intelligence domain. GET-only, tenant-scoped. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  try {
    const search = request.nextUrl.searchParams;
    const context = await requireApiContext(request, search.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const domain = asText(resolved.domain);
    if (!isRrIntelligenceDomain(domain)) {
      return errorResponse(
        `"${domain}" is not a Road & Recovery intelligence domain. Available: ${RR_INTELLIGENCE_DOMAINS.join(", ")}.`,
        404
      );
    }

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

    const found = result.data.domains.find((entry) => entry.domain === domain);
    if (!found) {
      return errorResponse(`${RR_DOMAIN_LABELS[domain]} produced no result.`, 500);
    }

    return NextResponse.json(
      {
        ok: true,
        domain: found,
        window: result.data.window,
        truncations: result.data.truncations,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** The domain catalogue, so the UI never hardcodes the list. */
export async function OPTIONS() {
  return NextResponse.json({
    ok: true,
    domains: RR_INTELLIGENCE_DOMAINS.map((domain) => ({ key: domain, label: RR_DOMAIN_LABELS[domain] })),
  });
}
