import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";

export type Batch9Context = {
  supabase: SupabaseClient;
  companyId: string;
};

export async function resolveBatch9Context(
  request: NextRequest,
  companyIdValue: string | null
): Promise<{ ok: true; ctx: Batch9Context } | { ok: false; response: NextResponse }> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: auth.message }, { status: auth.status }),
    };
  }

  const companyId = String(companyIdValue || "").trim();
  if (!companyId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "companyId is required." }, { status: 400 }),
    };
  }

  const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId, {
    platformOperator: auth.platformOperator,
  });
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: access.message }, { status: access.status }),
    };
  }

  return {
    ok: true,
    ctx: {
      supabase: auth.supabase,
      companyId,
    },
  };
}

export function asPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}
