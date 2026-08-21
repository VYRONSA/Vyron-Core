import { NextRequest, NextResponse } from "next/server";
import {
  RR_BILLING_PACK_CONTRACT_VERSION,
  billingPackToCsv,
  billingPackToJson,
  buildBillingPack,
} from "@/lib/road-recovery/billing-pack";
import { asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * The Invoice Information Pack for one job.
 *
 * GET-ONLY, and it creates NOTHING. The pack is a sealed information dataset assembled
 * from records that already exist; VYRON CORE assigns no invoice number, records no
 * payment and posts nothing to a ledger.
 *
 * `format=json` returns the VYRON FINANCE transfer payload against
 * RR_BILLING_PACK_CONTRACT_VERSION — the same shape a human reads on screen, so what an
 * administrator sees and what Finance would later consume can never diverge.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const result = await buildBillingPack(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    const format = asText(request.nextUrl.searchParams.get("format")).toLowerCase();
    const stamp = result.data.generatedAt.slice(0, 10);
    const name = result.data.job.jobRef || serviceJobId.slice(0, 8);

    if (format === "csv") {
      return new NextResponse(billingPackToCsv(result.data), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="billing-information-${name}-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "download") {
      return new NextResponse(billingPackToJson(result.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="billing-information-${name}-${stamp}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      contractVersion: RR_BILLING_PACK_CONTRACT_VERSION,
      pack: result.data,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
