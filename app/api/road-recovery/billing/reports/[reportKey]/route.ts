import { NextRequest, NextResponse } from "next/server";
import {
  RR_BILLING_REPORTS,
  RR_BILLING_REPORT_LABELS,
  billingReportToCsv,
  runBillingReport,
  type RrBillingReportKey,
} from "@/lib/road-recovery/billing-reports";
import { asNumberOrNull, asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * Road & Recovery operational billing reports.
 *
 * GET-ONLY. A report never writes, and the tenant boundary is enforced by the same
 * requireApiContext() gate every other Road & Recovery route uses: the caller's companyId
 * is verified against their own membership, and the query then runs under their RLS
 * context, so a report cannot reach another tenant's data even if a filter were forgotten.
 *
 * These are OPERATIONAL reports. None of them reads or writes an invoice, a payment or an
 * accounting document, because VYRON CORE has none — those belong to VYRON FINANCE.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportKey: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const reportKey = asText(resolved.reportKey);
    if (!(RR_BILLING_REPORTS as readonly string[]).includes(reportKey)) {
      return errorResponse(
        `"${reportKey}" is not a recognised billing report. Available: ${RR_BILLING_REPORTS.join(", ")}.`,
        404
      );
    }

    const search = request.nextUrl.searchParams;
    const result = await runBillingReport(
      context.ctx.auth.supabase,
      reportKey as RrBillingReportKey,
      {
        companyId: context.ctx.companyId,
        from: asText(search.get("from")) || null,
        to: asText(search.get("to")) || null,
        counterpartyId: asText(search.get("counterpartyId")) || null,
        serviceCode: asText(search.get("serviceCode")) || null,
        limit: asNumberOrNull(search.get("limit")) ?? 500,
      }
    );
    if (!result.ok) return errorResponse(result.message, result.status);

    // CSV opens directly in Excel, which is what a billing administrator actually wants.
    if (asText(search.get("format")).toLowerCase() === "csv") {
      return new NextResponse(billingReportToCsv(result.data), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="vyron-${reportKey}-${result.data.generatedAt.slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ ok: true, report: result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** The report catalogue, so the UI never hardcodes the list. */
export async function OPTIONS() {
  return NextResponse.json({
    ok: true,
    reports: RR_BILLING_REPORTS.map((key) => ({ key, label: RR_BILLING_REPORT_LABELS[key] })),
  });
}
