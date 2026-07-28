/**
 * Single source of truth for the platform-operator claim set. Mirrors
 * public.vyron_is_platform_operator() (sql/060) — keep both in sync.
 */
export const PLATFORM_OPERATOR_ROLE_CLAIMS = new Set([
  "super_admin",
  "platform_admin",
  "platform_operator",
  "supervisor tools",
]);

export function isPlatformOperatorRole(roles: string[]): boolean {
  return roles.some((role) => PLATFORM_OPERATOR_ROLE_CLAIMS.has(role));
}

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

/**
 * Operator test for a Supabase Auth session user, for UI gating (e.g. showing the
 * Platform Console link). Accepts both `app_metadata.role` (string) and
 * `app_metadata.roles` (array) — the bootstrap writes both.
 *
 * Deliberately ignores the user object's top-level `role`: GoTrue sets that to the
 * Postgres role "authenticated" for every signed-in user, so it is a session
 * sentinel, never a privilege claim. user_metadata is ignored for the usual reason
 * — it is self-editable via supabase.auth.updateUser().
 *
 * This is a display gate only. The authoritative checks stay server-side in
 * middleware.ts and app/api/platform/_shared.ts.
 */
export function isPlatformOperatorSessionUser(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined
): boolean {
  const meta = user?.app_metadata || {};
  return isPlatformOperatorRole([...toRoleList(meta.role), ...toRoleList(meta.roles)]);
}
