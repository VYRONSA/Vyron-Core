import { NextRequest, NextResponse } from "next/server";
import {
  listRequirementPolicies,
  publishRequirementPolicy,
  type PolicyItemInput,
} from "@/lib/road-recovery/requirements-service";
import {
  RR_BLOCKING_SCOPES,
  RR_EVIDENCE_KINDS,
  validatePolicy,
  type RrCondition,
} from "@/lib/road-recovery/requirements";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const result = await listRequirementPolicies(
      context.ctx.auth.supabase,
      context.ctx.companyId
    );
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      policies: result.data.policies,
      evidenceKinds: RR_EVIDENCE_KINDS,
      blockingScopes: RR_BLOCKING_SCOPES,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Publishes a new version of a policy.
 *
 * The submitted policy is validated by the SAME pure validator the seeded defaults pass
 * through, so a hand-authored counterparty policy cannot be weaker-formed than a
 * built-in one.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const policyKey = asText(body.policyKey);
    if (!policyKey) return errorResponse("policyKey is required.", 400);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: PolicyItemInput[] = rawItems.map((raw: Record<string, unknown>, index: number) => ({
      requirementCode: asText(raw.requirementCode),
      label: asText(raw.label),
      evidenceKind: asText(raw.evidenceKind),
      mandatory: raw.mandatory !== false,
      condition: (raw.condition ?? { always: true }) as RrCondition,
      minCount: Number(raw.minCount) || 1,
      blockingScopes: Array.isArray(raw.blockingScopes)
        ? raw.blockingScopes.map((scope) => asText(scope))
        : ["invoice"],
      guidance: asText(raw.guidance) || null,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : (index + 1) * 10,
    }));

    // validatePolicy throws on the first structural fault. Reported to the author as a
    // 400 rather than a 500: a malformed policy is bad input, not a server failure.
    try {
      validatePolicy({
        policyKey,
        counterpartyId: asText(body.counterpartyId) || null,
        serviceCode: asText(body.serviceCode) || null,
        version: 1,
        active: true,
        effectiveFrom: asText(body.effectiveFrom) || null,
        effectiveTo: null,
        requirements: items.map((item) => ({
          requirementCode: item.requirementCode,
          label: item.label,
          evidenceKind: item.evidenceKind as (typeof RR_EVIDENCE_KINDS)[number],
          mandatory: item.mandatory !== false,
          condition: item.condition ?? { always: true },
          minCount: item.minCount ?? 1,
          blockingScopes: (item.blockingScopes ?? []) as (typeof RR_BLOCKING_SCOPES)[number][],
          guidance: item.guidance ?? undefined,
          sortOrder: item.sortOrder ?? 100,
        })),
      });
    } catch (validationError: unknown) {
      return errorResponse(parseError(validationError), 400);
    }

    const result = await publishRequirementPolicy(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      policyKey,
      label: asText(body.label) || null,
      notes: asText(body.notes) || null,
      counterpartyId: asText(body.counterpartyId) || null,
      serviceCode: asText(body.serviceCode) || null,
      effectiveFrom: asText(body.effectiveFrom) || null,
      items,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
