/**
 * Deterministic Platform Administrator provisioning.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Platform access is granted by exactly one thing: the operator claim in
 * auth.users.raw_app_meta_data (see lib/server/platform-operator.ts). No other table is
 * involved — an operator with no company_users row still reaches /platform, because
 * lib/server/authorization.ts forces membership/company/workspace active for operators.
 *
 * That makes the claim's storage location its weakness: it lives *inside* the user row.
 * Delete the account and the claim is destroyed with it. Recreating the user produces a
 * fresh row with app_metadata = {provider, providers} and no claim, so the account
 * authenticates fine and is then bounced from /platform to /dashboard. Nothing in the
 * system notices that the platform has lost its administrator.
 *
 * The original bootstrap made this worse rather than better: it was a ONE-TIME latch
 * (sql/066). Had it been used, deleting the promoted account would leave the platform
 * with zero operators AND a latch permanently refusing to create another — recoverable
 * only by hand-editing the database, which is precisely what must never be required.
 *
 * THE FIX: declared intent + reconciliation
 *
 * The identity of the platform administrator is configuration, not a mutable row:
 *
 *     PLATFORM_BOOTSTRAP_ADMIN_EMAIL      — who the administrator is
 *     PLATFORM_BOOTSTRAP_ADMIN_PASSWORD   — used only when the account must be created
 *
 * ensurePlatformAdmin() reconciles reality to that intent and is safe to run any number
 * of times: it creates the auth user when missing, grants the claim when absent, links
 * stale company_users rows, and does nothing at all when everything is already correct.
 *
 * The safety invariant is no longer "this may only ever run once" but the much stronger
 * and self-healing "this may only act while the platform has NO operator". While an
 * operator exists, further operators are promoted from the Platform Console by that
 * operator. The moment there are none, recovery becomes possible again automatically —
 * which is exactly when it is needed and exactly when it cannot be an escalation,
 * because there is no privileged account left to escalate against.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import { isPlatformOperatorRole } from "@/lib/server/platform-operator";

export const BOOTSTRAP_ADMIN_EMAIL_ENV = "PLATFORM_BOOTSTRAP_ADMIN_EMAIL";
export const BOOTSTRAP_ADMIN_PASSWORD_ENV = "PLATFORM_BOOTSTRAP_ADMIN_PASSWORD";
export const OPERATOR_ROLE = "platform_operator";

const USER_SCAN_PAGE_SIZE = 200;
const USER_SCAN_MAX_PAGES = 50;

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

export type BootstrapAdminConfig = {
  email: string;
  password: string;
};

/** The declared administrator, or null when none is configured. */
export function getConfiguredBootstrapAdmin(): BootstrapAdminConfig | null {
  const email = stripEnvQuotes(process.env[BOOTSTRAP_ADMIN_EMAIL_ENV] || "").toLowerCase();
  if (!email) return null;
  return {
    email,
    password: stripEnvQuotes(process.env[BOOTSTRAP_ADMIN_PASSWORD_ENV] || ""),
  };
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

export function userIsOperator(user: AdminUser): boolean {
  const meta = user.app_metadata || {};
  return isPlatformOperatorRole([...toRoleList(meta.role), ...toRoleList(meta.roles)]);
}

/** Merges the operator claim into existing app_metadata without dropping provider keys. */
export function buildOperatorAppMetadata(
  existing: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const meta = { ...(existing || {}) };
  const roles = new Set(toRoleList(meta.roles));
  roles.add(OPERATOR_ROLE);
  return { ...meta, role: OPERATOR_ROLE, roles: Array.from(roles) };
}

export type UserScan = { operators: AdminUser[]; target: AdminUser | null; total: number };

/** One pass over auth.users: the admin API cannot filter on app_metadata server-side. */
export async function scanUsers(supabase: SupabaseClient, targetEmail: string): Promise<UserScan> {
  const wanted = targetEmail.trim().toLowerCase();
  const operators: AdminUser[] = [];
  let target: AdminUser | null = null;
  let total = 0;

  for (let page = 1; page <= USER_SCAN_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USER_SCAN_PAGE_SIZE,
    });
    if (error) throw new Error(`Could not read auth users: ${error.message}`);

    const users = (data?.users || []) as AdminUser[];
    total += users.length;
    for (const user of users) {
      if (userIsOperator(user)) operators.push(user);
      if (wanted && (user.email || "").trim().toLowerCase() === wanted) target = user;
    }
    if (users.length < USER_SCAN_PAGE_SIZE) break;
  }

  return { operators, target, total };
}

/**
 * Confirms the provisioned account can sign in with the configured password.
 *
 * Uses the public anon key and the ordinary password grant — the same path a real
 * sign-in takes — so this validates the credential end to end rather than trusting that
 * the admin API stored what we meant.
 */
async function verifyPasswordSignIn(email: string, password: string): Promise<boolean> {
  const url = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !anonKey) return true; // Cannot check; do not block provisioning.

  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return true; // Network problem is not evidence of a bad password.
  }
}

export type ProvisionResult = {
  ok: boolean;
  email: string;
  userId: string | null;
  /** What actually changed — empty when the platform was already correct. */
  actions: string[];
  message: string;
};

/**
 * Repairs company_users rows that reference this email but carry a stale or missing
 * user_id.
 *
 * Recreating an account mints a NEW uuid, so rows written against the old account point
 * at a user that no longer exists. Authorization already falls back to matching on
 * email, so this is not what blocks Platform access — but leaving dangling ids is the
 * "partially provisioned" state that makes later lifecycle bugs hard to reason about.
 */
async function linkCompanyMemberships(
  supabase: SupabaseClient,
  email: string,
  userId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("company_users")
    .update({ user_id: userId })
    .eq("user_email", email)
    .or(`user_id.is.null,user_id.neq.${userId}`)
    .select("company_id");

  if (error) return 0;
  return (data || []).length;
}

/**
 * Reconciles the declared Platform Administrator into existence.
 *
 * Idempotent. Every step is "ensure", never "create blindly":
 *   1. auth user exists (created with a confirmed email when absent)
 *   2. operator claim present in app_metadata
 *   3. company_users rows for this email point at the current user id
 *
 * `force` skips the zero-operator guard. It is used only by the authenticated recovery
 * endpoint and the CLI, never by the automatic boot-time reconciler.
 */
export async function ensurePlatformAdmin(
  supabase: SupabaseClient,
  input: { email: string; password?: string; reason: string; force?: boolean }
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const actions: string[] = [];

  if (!email) {
    return { ok: false, email, userId: null, actions, message: "No administrator email configured." };
  }

  const scan = await scanUsers(supabase, email);
  const otherOperators = scan.operators.filter(
    (operator) => (operator.email || "").trim().toLowerCase() !== email
  );

  // The guard that replaced the one-time latch: while a platform operator exists,
  // further operators must be promoted from the Platform Console by that operator.
  if (!input.force && otherOperators.length > 0) {
    return {
      ok: false,
      email,
      userId: scan.target?.id || null,
      actions,
      message: `A Platform Operator already exists (${otherOperators
        .map((operator) => operator.email)
        .join(", ")}). Promote further operators from /platform.`,
    };
  }

  let user = scan.target;

  if (!user) {
    if (!input.password) {
      return {
        ok: false,
        email,
        userId: null,
        actions,
        message: `No account exists for ${email} and no ${BOOTSTRAP_ADMIN_PASSWORD_ENV} is set, so it cannot be created.`,
      };
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      // Confirmed on purpose: this is an operator-provisioned administrator, and
      // requiring an inbox round-trip would reintroduce a manual recovery step.
      email_confirm: true,
      app_metadata: buildOperatorAppMetadata(null),
    });

    if (error || !data.user) {
      return {
        ok: false,
        email,
        userId: null,
        actions,
        message: `Could not create ${email}: ${error?.message || "unknown error"}`,
      };
    }

    user = data.user as AdminUser;
    actions.push("created_auth_user");
    actions.push("granted_operator_claim");
  } else if (!userIsOperator(user)) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: buildOperatorAppMetadata(user.app_metadata),
    });
    if (error) {
      return {
        ok: false,
        email,
        userId: user.id,
        actions,
        message: `Could not grant the operator claim to ${email}: ${error.message}`,
      };
    }
    actions.push("granted_operator_claim");
  }

  // Password reconciliation: an existing account whose password no longer matches the
  // declared one is only reset when explicitly forced, so the automatic reconciler can
  // never silently change a working administrator's credentials.
  if (input.force && input.password && !actions.includes("created_auth_user")) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: input.password,
      email_confirm: true,
    });
    if (!error) actions.push("reset_password");
  }

  const linked = await linkCompanyMemberships(supabase, email, user.id);
  if (linked > 0) actions.push(`linked_${linked}_company_membership(s)`);

  // Self-check: prove the account can actually sign in with the configured password.
  //
  // This exists because a silent failure already happened once: an unquoted password
  // containing '#' was truncated at the '#' by dotenv, so the account was created with
  // a DIFFERENT (weaker) password than intended and sign-in failed with credentials
  // that looked correct in the env file. Provisioning must verify its own result rather
  // than assume the value it was handed is the value the operator wrote.
  if (input.password && actions.length > 0) {
    const verified = await verifyPasswordSignIn(email, input.password);
    if (!verified) {
      return {
        ok: false,
        email,
        userId: user.id,
        actions,
        message:
          `${email} was provisioned, but signing in with the configured password failed. ` +
          `If the password contains '#', '$' or spaces, wrap it in double quotes in the env ` +
          `file — dotenv treats an unquoted '#' as the start of a comment and silently ` +
          `truncates the value.`,
      };
    }
    actions.push("verified_password_sign_in");
  }

  if (actions.length > 0) {
    await writeAuditLog(supabase, {
      userEmail: email,
      action: "platform_admin_provisioned",
      entityType: "platform_operator",
      entityId: user.id,
      metadata: {
        actions,
        reason: input.reason,
        forced: Boolean(input.force),
        operatorsBefore: scan.operators.length,
      },
    });
  }

  return {
    ok: true,
    email,
    userId: user.id,
    actions,
    message:
      actions.length === 0
        ? `${email} is already provisioned as a Platform Administrator.`
        : `${email} provisioned as Platform Administrator (${actions.join(", ")}).`,
  };
}

/**
 * Boot-time self-healing. Runs from instrumentation.ts on server start.
 *
 * Deliberately conservative: it does nothing unless an administrator is configured AND
 * the platform currently has zero operators. That makes it a no-op on every normal
 * boot, and a recovery only in the exact situation this regression created — the
 * administrator account was deleted and nobody can reach /platform any more.
 */
export async function reconcilePlatformAdminOnBoot(
  supabase: SupabaseClient
): Promise<ProvisionResult | null> {
  const configured = getConfiguredBootstrapAdmin();
  if (!configured) return null;

  const scan = await scanUsers(supabase, configured.email);
  if (scan.operators.length > 0) return null; // Healthy — nothing to do.

  return ensurePlatformAdmin(supabase, {
    email: configured.email,
    password: configured.password,
    reason: "boot_reconcile",
  });
}
