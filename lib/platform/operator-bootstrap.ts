/**
 * First-run bootstrap for the very first Platform Operator (sql/066).
 *
 * The operator claim lives in auth.users.app_metadata, which only the service role
 * can write — so on a fresh project nobody can reach /platform. This module promotes
 * exactly one account, once, and then latches itself shut:
 *
 *   1. the bootstrap secret must match (constant-time, env-configured, fail-closed);
 *   2. public.vyron_platform_bootstrap must be empty (one-row latch, sql/066);
 *   3. auth.users must contain zero accounts carrying an operator claim;
 *   4. the latch row is claimed BEFORE the promotion — a concurrent second request
 *      loses on the primary key (23505) instead of double-promoting.
 *
 * Every later operator is promoted from the Platform Console by an existing operator.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { isPlatformOperatorRole } from "@/lib/server/platform-operator";

export const BOOTSTRAP_LATCH_TABLE = "vyron_platform_bootstrap";
export const BOOTSTRAP_SECRET_ENV = "PLATFORM_BOOTSTRAP_SECRET";
/** A short secret on an unauthenticated endpoint is a guessable privilege grant. */
export const MIN_BOOTSTRAP_SECRET_LENGTH = 32;
/** The claim written to app_metadata.role by the bootstrap. */
export const BOOTSTRAP_GRANTED_ROLE = "platform_operator";

const USER_SCAN_PAGE_SIZE = 200;
const USER_SCAN_MAX_PAGES = 50; // 10k accounts — far beyond any pre-bootstrap project.

export type BootstrapFailure = { ok: false; status: number; message: string };

export type BootstrapLatchRow = {
  promoted_user_id: string | null;
  promoted_email: string;
  method: string;
  performed_by: string | null;
  completed_at: string;
};

function stripEnvQuotes(value: string): string {
  const t = value.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Constant-time secret check. Digesting both sides first keeps the comparison
 * length-independent, so a mismatch leaks neither the secret nor its length.
 */
export function verifyBootstrapSecret(presented: string): { ok: true } | BootstrapFailure {
  const configured = stripEnvQuotes(process.env[BOOTSTRAP_SECRET_ENV] || "");

  if (!configured) {
    return {
      ok: false,
      status: 503,
      message: `Bootstrap is not enabled. Set ${BOOTSTRAP_SECRET_ENV} on the server to enable it.`,
    };
  }

  if (configured.length < MIN_BOOTSTRAP_SECRET_LENGTH) {
    return {
      ok: false,
      status: 503,
      message: `${BOOTSTRAP_SECRET_ENV} must be at least ${MIN_BOOTSTRAP_SECRET_LENGTH} characters.`,
    };
  }

  const a = createHash("sha256").update(configured, "utf8").digest();
  const b = createHash("sha256").update(presented || "", "utf8").digest();

  if (!timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Invalid bootstrap secret." };
  }

  return { ok: true };
}

/** Reads the one-time latch. `row` is non-null once bootstrap has been consumed. */
export async function readBootstrapLatch(
  supabase: SupabaseClient
): Promise<{ ok: true; row: BootstrapLatchRow | null } | BootstrapFailure> {
  const { data, error } = await supabase
    .from(BOOTSTRAP_LATCH_TABLE)
    .select("promoted_user_id,promoted_email,method,performed_by,completed_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isSupabaseMissingTableError(error, BOOTSTRAP_LATCH_TABLE)) {
      return {
        ok: false,
        status: 503,
        message: "Bootstrap is not installed. Run sql/066-platform-operator-bootstrap.sql first.",
      };
    }
    return { ok: false, status: 500, message: error.message };
  }

  return { ok: true, row: (data as BootstrapLatchRow | null) || null };
}

type AdminUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

function toRoleList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string") {
    const role = value.trim().toLowerCase();
    return role ? [role] : [];
  }
  return [];
}

function appMetadataRoles(user: AdminUser): string[] {
  const meta = user.app_metadata || {};
  return [...toRoleList(meta.role), ...toRoleList(meta.roles)];
}

export type UserScan = {
  /** Emails of accounts that already carry an operator claim. */
  existingOperators: string[];
  /** The account matching the requested email, if any. */
  target: AdminUser | null;
};

/**
 * Single pass over auth.users: collects existing operators and locates the target
 * account. Both answers come from one scan because the admin API has no
 * server-side filter for either question.
 */
export async function scanUsers(
  supabase: SupabaseClient,
  targetEmail: string
): Promise<{ ok: true; scan: UserScan } | BootstrapFailure> {
  const wanted = targetEmail.trim().toLowerCase();
  const existingOperators: string[] = [];
  let target: AdminUser | null = null;

  for (let page = 1; page <= USER_SCAN_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USER_SCAN_PAGE_SIZE,
    });

    if (error) {
      return { ok: false, status: 500, message: `Could not read auth users: ${error.message}` };
    }

    const users = (data?.users || []) as AdminUser[];
    for (const user of users) {
      const email = (user.email || "").trim().toLowerCase();
      if (isPlatformOperatorRole(appMetadataRoles(user))) {
        existingOperators.push(email || user.id);
      }
      if (wanted && email === wanted) {
        target = user;
      }
    }

    if (users.length < USER_SCAN_PAGE_SIZE) {
      return { ok: true, scan: { existingOperators, target } };
    }
  }

  // More accounts than the scan ceiling: refuse rather than promote on a partial
  // view, since an operator could exist on an unread page.
  return {
    ok: false,
    status: 500,
    message:
      "Too many auth users to verify that no Platform Operator exists. Use the SQL path: SELECT public.vyron_bootstrap_platform_operator('email').",
  };
}

/** Merges the operator claim into existing app_metadata without dropping other keys. */
export function buildOperatorAppMetadata(
  existing: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const meta = { ...(existing || {}) };
  const roles = new Set(toRoleList(meta.roles));
  roles.add(BOOTSTRAP_GRANTED_ROLE);

  return { ...meta, role: BOOTSTRAP_GRANTED_ROLE, roles: Array.from(roles) };
}

/**
 * Claims the one-time latch. Returns `claimed: false` when another request (or an
 * earlier bootstrap) already holds it — that is the permanent disable.
 */
export async function claimBootstrapLatch(
  supabase: SupabaseClient,
  input: { userId: string; email: string; performedBy: string }
): Promise<{ ok: true; claimed: boolean } | BootstrapFailure> {
  const { error } = await supabase.from(BOOTSTRAP_LATCH_TABLE).insert({
    id: true,
    promoted_user_id: input.userId,
    promoted_email: input.email,
    method: "api",
    performed_by: input.performedBy,
  });

  if (!error) return { ok: true, claimed: true };
  // 23505 = unique_violation on the single-row primary key.
  if (error.code === "23505") return { ok: true, claimed: false };
  return { ok: false, status: 500, message: error.message };
}

/** Releases a latch this request claimed, so a failed promotion is not a permanent lockout. */
export async function releaseBootstrapLatch(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase.from(BOOTSTRAP_LATCH_TABLE).delete().eq("promoted_user_id", userId);
}
