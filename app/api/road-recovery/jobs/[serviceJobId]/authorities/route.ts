import { NextRequest, NextResponse } from "next/server";
import {
  listReleaseAuthorities,
  recordReleaseAuthority,
  verifyReleaseAuthority,
  voidReleaseAuthority,
} from "@/lib/road-recovery/release-service";
import {
  RR_AUTHORITY_PARTIES,
  RR_AUTHORITY_TYPES,
  type RrAuthorityParty,
  type RrAuthorityType,
} from "@/lib/road-recovery/release-authority";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const result = await listReleaseAuthorities(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      asText(resolved.serviceJobId)
    );
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      authorities: result.data.authorities,
      authorityTypes: RR_AUTHORITY_TYPES,
      authorityParties: RR_AUTHORITY_PARTIES,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Records an authority. It is created UNVERIFIED and opens nothing until verified. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const authorityType = asText(body.authorityType);
    const authorityParty = asText(body.authorityParty);
    if (!(RR_AUTHORITY_TYPES as readonly string[]).includes(authorityType)) {
      return errorResponse(`"${authorityType}" is not a recognised authority type.`, 400);
    }
    if (!(RR_AUTHORITY_PARTIES as readonly string[]).includes(authorityParty)) {
      return errorResponse(`"${authorityParty}" is not a recognised authorising party.`, 400);
    }

    const resolved = await params;
    const result = await recordReleaseAuthority(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      authorityType: authorityType as RrAuthorityType,
      authorityParty: authorityParty as RrAuthorityParty,
      authorityPartyName: asText(body.authorityPartyName),
      authorityReference: asText(body.authorityReference),
      counterpartyId: asText(body.counterpartyId) || null,
      authorityContact: asText(body.authorityContact) || null,
      validFrom: asText(body.validFrom) || null,
      expiresAt: asText(body.expiresAt) || null,
      collectorName: asText(body.collectorName) || null,
      collectorIdNumber: asText(body.collectorIdNumber) || null,
      collectorCapacity: asText(body.collectorCapacity) || null,
      collectorContact: asText(body.collectorContact) || null,
      disposalNoticeReference: asText(body.disposalNoticeReference) || null,
      disposalNoticeServedAt: asText(body.disposalNoticeServedAt) || null,
      disposalMethod: asText(body.disposalMethod) || null,
      evidenceId: asText(body.evidenceId) || null,
      notes: asText(body.notes) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, authorityId: result.data.authorityId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Verifies or voids an authority.
 *
 * Verification is the act that actually opens a gate, so the verifier is taken from the
 * SESSION and never from the request body.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const authorityId = asText(body.authorityId);
    const action = asText(body.action);
    if (!authorityId) return errorResponse("authorityId is required.", 400);

    if (action === "verify") {
      const result = await verifyReleaseAuthority(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        actorEmail: context.ctx.auth.email,
        authorityId,
        verificationMethod: asText(body.verificationMethod),
      });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, verified: true });
    }

    if (action === "void") {
      const result = await voidReleaseAuthority(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        actorEmail: context.ctx.auth.email,
        authorityId,
        voidReason: asText(body.voidReason),
      });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, voided: true });
    }

    return errorResponse('action must be "verify" or "void".', 400);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}
