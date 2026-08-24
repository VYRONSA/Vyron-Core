/**
 * Server-side module entitlement for a signed-in caller.
 *
 * This is NOT a second entitlement system. The rule lives in exactly one place —
 * effectiveUserModules() in lib/tenant/module-access.ts — which intersects the per-user
 * grant (company_users.module_access) with the company's subscription entitlement
 * (companies.enabled_modules). This file only fetches those two values server-side and
 * asks that resolver the question, so a plan downgrade narrows routes, navigation and the
 * user management screen at the same instant with nothing to keep in step.
 *
 * Why it reads through the CALLER'S client rather than the service role: `companies` and
 * `company_users` both carry RLS policies that scope a row to the caller's own
 * memberships, so the caller's client can read its own entitlement and cannot read anyone
 * else's. Nothing here runs with elevated rights, which also keeps it usable from
 * middleware on the Edge runtime.
 *
 * Every failure path returns NO modules. Entitlement must fail closed: a transient read
 * error has to deny a paid-module route, never open one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveUserModules } from "@/lib/tenant/module-access";

export type ModuleEntitlementSubject = {
  userId?: string | null;
  email?: string | null;
  companyId?: string | null;
};

function normalizeEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}

function toStringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) ? (value as string[]) : null;
}

/**
 * The caller's effective module codes in the workspace they resolve to.
 *
 * Returns [] when there is no workspace to be entitled by — a caller with no company has
 * bought nothing, so no module-gated route is theirs.
 */
export async function resolveEffectiveModules(
  supabase: SupabaseClient,
  subject: ModuleEntitlementSubject
): Promise<string[]> {
  const companyId = (subject.companyId || "").trim();
  if (!companyId) return [];

  try {
    const email = normalizeEmail(subject.email);
    const userId = (subject.userId || "").trim();

    // A membership is identified by user_id where the linkage exists and by email
    // otherwise — the same either/or lib/server/authorization.ts resolves a seat with, so
    // a row that has not been backfilled still resolves to its real grant.
    // Commas would break PostgREST's or() grammar; the address is only ever compared.
    const identityFilters = [
      userId ? `user_id.eq.${userId}` : "",
      email ? `user_email.eq.${email.replace(/,/g, "")}` : "",
    ].filter(Boolean);

    if (identityFilters.length === 0) return [];

    const [companyRes, membershipRes] = await Promise.all([
      supabase.from("companies").select("enabled_modules").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_users")
        .select("module_access")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null)
        .or(identityFilters.join(","))
        .limit(1)
        .maybeSingle(),
    ]);

    /**
     * The company row IS the entitlement, so an unreadable one denies.
     *
     * Precondition worth stating: the RLS policy on `companies` scopes a row by
     * `company_users.user_id = auth.uid()`, so a membership linked only by email would
     * read nothing here and be denied a module its company holds. The invite and
     * user-creation paths in lib/tenant/user-management.ts always write user_id, and
     * sql/091 backfilled the rows that predated that, so a signed-in user always has the
     * linkage. Any seat that lacks it also lacks an auth account to sign in with.
     *
     * The alternative — treating "cannot read" as "allow" — would turn a transient error
     * into an open door, which is the one outcome an entitlement check must never have.
     */
    if (companyRes.error || !companyRes.data) return [];

    const enabled = toStringArrayOrNull(
      (companyRes.data as { enabled_modules?: unknown }).enabled_modules
    );

    // A missing membership row is the inherit-everything case that effectiveUserModules()
    // already models as NULL: the caller then holds whatever the company holds. It is not
    // a widening — the company entitlement above still bounds the answer.
    const granted = membershipRes.error
      ? null
      : toStringArrayOrNull((membershipRes.data as { module_access?: unknown } | null)?.module_access);

    return effectiveUserModules(granted, enabled);
  } catch {
    return [];
  }
}

/** True when the caller's workspace entitles them to `moduleCode`. Fails closed. */
export async function hasModuleEntitlement(
  supabase: SupabaseClient,
  subject: ModuleEntitlementSubject,
  moduleCode: string
): Promise<boolean> {
  const code = String(moduleCode || "").trim().toLowerCase();
  if (!code) return true;
  return (await resolveEffectiveModules(supabase, subject)).includes(code);
}
