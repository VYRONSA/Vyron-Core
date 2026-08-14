/**
 * Customer (tenant) role model for user management.
 *
 * This deliberately does NOT introduce a second role system. The roles below are the
 * existing VYRON tenant roles from lib/tenant-rbac.ts (VYRON_TENANT_ROLES /
 * TENANT_RBAC_ROLE_OPTIONS) with one difference: `super_admin` is excluded, because it
 * is a platform-level claim and must never be assignable from a customer workspace.
 *
 * Two role universes exist in VYRON CORE and they must never mix:
 *
 *   PLATFORM roles  — super_admin, platform_admin, platform_operator ("Supervisor
 *                     Tools"). Stored in auth.users.app_metadata, checked by
 *                     lib/server/platform-operator.ts, and the only thing that opens
 *                     /platform. Never written by any customer-facing endpoint.
 *
 *   CUSTOMER roles  — owner, admin, manager, supervisor, employee. Stored in
 *                     public.company_users.role, scoped to exactly one company_id.
 *
 * Every function here operates on the customer universe only.
 */

import { PLATFORM_OPERATOR_ROLE_CLAIMS } from "@/lib/server/platform-operator";
import { TENANT_RBAC_ROLE_OPTIONS, type VyronTenantRole } from "@/lib/tenant-rbac";

/** Roles a customer administrator may assign inside their own company. */
export const CUSTOMER_ASSIGNABLE_ROLES = [
  "owner",
  "admin",
  "manager",
  "supervisor",
  "employee",
] as const;

export type CustomerRole = (typeof CUSTOMER_ASSIGNABLE_ROLES)[number];

const CUSTOMER_ROLE_SET = new Set<string>(CUSTOMER_ASSIGNABLE_ROLES);

export const CUSTOMER_ROLE_DESCRIPTION: Record<CustomerRole, string> = {
  owner: "Full workspace control including billing, company setup and user management.",
  admin: "Manages users, employees, HR, rosters and leave. No billing or company governance.",
  manager: "Runs their teams — approvals, rosters, leave and reports.",
  supervisor: "Day-to-day team oversight without reporting or compliance centres.",
  employee: "Self-service only — clocking, leave requests and their own profile.",
};

/**
 * Role labels for the UI. Labels come from TENANT_RBAC_ROLE_OPTIONS so the customer
 * user-management screens and the rest of the app can never drift apart.
 */
export const CUSTOMER_ROLE_OPTIONS: { value: CustomerRole; label: string; description: string }[] =
  CUSTOMER_ASSIGNABLE_ROLES.map((value) => ({
    value,
    label:
      TENANT_RBAC_ROLE_OPTIONS.find((option) => option.value === value)?.label ||
      value.replace(/\b\w/g, (char) => char.toUpperCase()),
    description: CUSTOMER_ROLE_DESCRIPTION[value],
  }));

/**
 * Every role string that grants (or aliases to) platform privilege. A customer request
 * naming any of these is rejected outright rather than silently downgraded, so an
 * escalation attempt is visible in the audit trail instead of looking like a typo.
 *
 * Includes the canonical claim set from lib/server/platform-operator.ts plus the
 * spellings ROLE_ALIASES in lib/tenant-rbac.ts maps onto super_admin.
 */
export const PLATFORM_LEVEL_ROLE_NAMES = new Set<string>([
  ...PLATFORM_OPERATOR_ROLE_CLAIMS,
  "superadmin",
  "super admin",
  "platform admin",
  "platform operator",
  "platform_owner",
  "vyron_admin",
  "supervisor_tools",
]);

/** Rank for "an actor may never act on, or create, a role above their own". */
const ROLE_RANK: Record<CustomerRole, number> = {
  owner: 50,
  admin: 40,
  manager: 30,
  supervisor: 20,
  employee: 10,
};

/** Roles permitted to manage other users inside their company. */
const USER_MANAGEMENT_ROLES = new Set<CustomerRole>(["owner", "admin"]);

export const MODULE_PERMISSION_LEVELS = [
  "view",
  "create",
  "edit",
  "approve",
  "delete",
  "export",
  "admin",
] as const;

export type ModulePermissionLevel = (typeof MODULE_PERMISSION_LEVELS)[number];

const PERMISSION_LEVEL_SET = new Set<string>(MODULE_PERMISSION_LEVELS);

/** Default permission levels granted when an administrator does not set them explicitly. */
export const ROLE_DEFAULT_PERMISSIONS: Record<CustomerRole, ModulePermissionLevel[]> = {
  owner: ["view", "create", "edit", "approve", "delete", "export", "admin"],
  admin: ["view", "create", "edit", "approve", "delete", "export"],
  manager: ["view", "create", "edit", "approve", "export"],
  supervisor: ["view", "create", "edit"],
  employee: ["view"],
};

function normalize(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** True when the string names a platform-level role in any of its spellings. */
export function isPlatformLevelRoleName(role: string | null | undefined): boolean {
  const raw = (role || "").trim().toLowerCase();
  return PLATFORM_LEVEL_ROLE_NAMES.has(raw) || PLATFORM_LEVEL_ROLE_NAMES.has(normalize(raw));
}

/** True when the string names a role a customer administrator may assign. */
export function isCustomerRole(role: string | null | undefined): role is CustomerRole {
  return CUSTOMER_ROLE_SET.has(normalize(role));
}

/**
 * Coerces a stored company_users.role into a customer role for display and comparison.
 * Unknown values fall back to the least-privileged role — never to a higher one.
 */
export function toCustomerRole(role: string | null | undefined): CustomerRole {
  const normalized = normalize(role);
  if (CUSTOMER_ROLE_SET.has(normalized)) return normalized as CustomerRole;
  // Legacy spellings that pre-date the RBAC matrix (see ROLE_ALIASES in lib/tenant-rbac.ts).
  if (normalized === "super_user" || normalized === "superuser") return "owner";
  if (normalized === "user" || normalized === "staff" || normalized === "limited_user") {
    return "employee";
  }
  return "employee";
}

/** A tenant role usable by lib/tenant-rbac.ts helpers. */
export function toTenantRole(role: string | null | undefined): VyronTenantRole {
  return toCustomerRole(role);
}

export function roleRank(role: CustomerRole): number {
  return ROLE_RANK[role];
}

/** Owners and admins manage users; everyone else is read-only on this surface. */
export function canManageCompanyUsers(role: CustomerRole): boolean {
  return USER_MANAGEMENT_ROLES.has(role);
}

/**
 * Only an owner may create or modify another owner. This keeps an `admin` from minting
 * a peer with billing/workspace-governance rights they do not themselves hold.
 */
export function canActorAssignRole(actorRole: CustomerRole, targetRole: CustomerRole): boolean {
  if (!canManageCompanyUsers(actorRole)) return false;
  return roleRank(targetRole) <= roleRank(actorRole);
}

/** Filters a requested permission list down to the levels this application defines. */
export function normalizePermissionLevels(values: unknown): ModulePermissionLevel[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<ModulePermissionLevel>();
  for (const value of values) {
    const level = String(value || "").trim().toLowerCase();
    if (PERMISSION_LEVEL_SET.has(level)) seen.add(level as ModulePermissionLevel);
  }
  return MODULE_PERMISSION_LEVELS.filter((level) => seen.has(level));
}

/**
 * Normalizes a { module: [levels] } map, dropping unknown modules and unknown levels.
 * `allowedModules` is the already subscription-filtered module set for the user.
 */
export function normalizeModulePermissions(
  value: unknown,
  allowedModules: string[]
): Record<string, ModulePermissionLevel[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(allowedModules);
  const result: Record<string, ModulePermissionLevel[]> = {};
  for (const [moduleCode, levels] of Object.entries(value as Record<string, unknown>)) {
    const code = String(moduleCode || "").trim().toLowerCase();
    if (!code || !allowed.has(code)) continue;
    const normalized = normalizePermissionLevels(levels);
    if (normalized.length > 0) result[code] = normalized;
  }
  return result;
}

/** Effective permissions for a module: explicit grant when present, role default otherwise. */
export function effectiveModulePermissions(
  role: CustomerRole,
  moduleCode: string,
  explicit: Record<string, ModulePermissionLevel[]> | null | undefined
): ModulePermissionLevel[] {
  const grant = explicit?.[moduleCode];
  if (grant && grant.length > 0) return grant;
  return ROLE_DEFAULT_PERMISSIONS[role];
}
