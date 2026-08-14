/**
 * Resolves the customer-side actor for /api/company/* user-management endpoints.
 *
 * The tenant boundary is derived here and nowhere else. It comes from:
 *
 *   1. the Supabase session (authenticateApiRequest → verified by the auth server), and
 *   2. that identity's own active public.company_users row.
 *
 * A `companyId` in the request body is never read. A caller who edits one is editing a
 * value this code does not consult, so cross-tenant access cannot be requested — only
 * the workspace the signed-in identity actually belongs to is ever resolved.
 *
 * When the identity belongs to several workspaces, the active one is taken from the
 * tracked session row (vyron_user_sessions.company_id — the same record Force Logout and
 * the idle/absolute timeouts use), falling back to the oldest membership.
 */

import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest, getSupabaseAdminClient } from "@/lib/server-api-auth";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";
import {
  createSupabaseUserManagementStore,
  type UserManagementStore,
} from "@/lib/tenant/user-management-store";
import { toCustomerRole } from "@/lib/tenant/user-roles";
import type { UserManagementActor } from "@/lib/tenant/user-management";

export type TenantApiContext = {
  store: UserManagementStore;
  actor: UserManagementActor;
};

export type TenantApiGate =
  | { ok: true; context: TenantApiContext }
  | { ok: false; response: NextResponse };

type MembershipLookupRow = {
  id: string;
  company_id: string;
  role: string | null;
  status: string | null;
  user_email: string | null;
  created_at: string | null;
};

function deny(message: string, status: number): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ ok: false, message }, { status }),
  };
}

/**
 * Authenticates the request and resolves the caller's own company membership.
 *
 * Returns 401 for an unauthenticated/expired session and 403 when the identity has no
 * active workspace membership — a platform operator with no tenant seat included, since
 * these endpoints are the customer surface and the console has its own routes.
 */
export async function requireCompanyUserContext(request: NextRequest): Promise<TenantApiGate> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return deny(auth.message, auth.status);

  const admin = getSupabaseAdminClient();
  const email = auth.email;

  const { data, error } = await admin
    .from("company_users")
    .select("id,company_id,role,status,user_email,created_at")
    .ilike("user_email", email)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    return deny(error.message, 500);
  }

  const memberships = ((data || []) as MembershipLookupRow[]).filter((row) =>
    Boolean(row.company_id)
  );

  if (memberships.length === 0) {
    return deny(
      "Your account is not linked to an active company workspace.",
      403
    );
  }

  let membership = memberships[0];

  if (memberships.length > 1) {
    const sessionToken = request.cookies.get(VYRON_SESSION_TOKEN_COOKIE)?.value || "";
    if (sessionToken) {
      const { data: sessionRow } = await admin
        .from("vyron_user_sessions")
        .select("company_id")
        .eq("session_token", sessionToken)
        .maybeSingle();
      const sessionCompanyId = (sessionRow as { company_id?: string | null } | null)?.company_id;
      const match = sessionCompanyId
        ? memberships.find((row) => row.company_id === sessionCompanyId)
        : null;
      if (match) membership = match;
    }
  }

  return {
    ok: true,
    context: {
      store: createSupabaseUserManagementStore(admin),
      actor: {
        email,
        companyId: membership.company_id,
        role: toCustomerRole(membership.role),
        // Platform operators use the Platform Console routes for cross-tenant work.
        // On this surface they are treated as an ordinary member of their own workspace,
        // so the customer API never becomes a cross-tenant tool.
        platformOperator: false,
        membershipId: membership.id,
      },
    },
  };
}
