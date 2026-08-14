/**
 * Customer user management — the single implementation behind both surfaces:
 *
 *   Settings → Users & Access                  (customer administrators)
 *   Platform Console → Customer → Users        (VYRON platform operators)
 *
 * Every authorization decision lives here rather than in a route handler or a React
 * component, so both surfaces are governed by exactly the same rules and a new endpoint
 * cannot accidentally ship without them.
 *
 * THE SECURITY MODEL
 *
 *   * The tenant boundary is `actor.companyId`, resolved server-side from the
 *     authenticated identity (lib/tenant/api-auth.ts). A company id in a request body is
 *     never consulted — for the customer surface there is no company id in the body at
 *     all, and for the platform surface the path parameter is only reachable behind
 *     requirePlatformOperator + Platform Mode elevation.
 *   * Every store call is scoped by that company id, so a target that belongs to another
 *     tenant simply does not resolve.
 *   * Platform-level roles (super_admin / platform_admin / platform_operator) can never
 *     be written by any path in this file, including the platform one: platform
 *     privilege lives in auth.users.app_metadata, and nothing here writes app_metadata.
 *   * Passwords go to Supabase Auth and nowhere else. Every audit payload is passed
 *     through redactSecrets() before it is written.
 */

import { moduleLabel } from "@/lib/platform/module-catalog";
import {
  companyAvailableModules,
  effectiveUserModules,
  resolveModuleGrant,
  summarizeModuleAccess,
} from "@/lib/tenant/module-access";
import { generateTemporaryPassword } from "@/lib/tenant/password-generator";
import {
  redactSecrets,
  validatePassword,
  type PasswordMode,
} from "@/lib/tenant/password-policy";
import {
  canActorAssignRole,
  canManageCompanyUsers,
  CUSTOMER_ROLE_OPTIONS,
  isCustomerRole,
  isPlatformLevelRoleName,
  normalizeModulePermissions,
  roleRank,
  toCustomerRole,
  type CustomerRole,
  type ModulePermissionLevel,
} from "@/lib/tenant/user-roles";
import { formatTenantRbacRoleLabel } from "@/lib/tenant-rbac";
import type {
  AuditEntry,
  CompanyRecord,
  MembershipRow,
  UserManagementStore,
} from "@/lib/tenant/user-management-store";

export class UserManagementError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserManagementError";
    this.status = status;
  }
}

/**
 * Who is performing the operation. Built only by lib/tenant/api-auth.ts (customer) or
 * the platform route handlers (operator) — never from request input.
 */
export type UserManagementActor = {
  email: string;
  /** Authoritative tenant boundary. */
  companyId: string;
  role: CustomerRole;
  platformOperator: boolean;
  /** company_users.id of the actor's own seat, when they have one. */
  membershipId: string | null;
};

export const USER_STATUSES = ["active", "pending", "inactive", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type CompanyUserView = {
  id: string;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  mobile: string | null;
  role: CustomerRole;
  roleLabel: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  invitedAt: string | null;
  deletedAt: string | null;
  mustChangePassword: boolean;
  /** Modules this user resolves to today (grant ∩ company subscription). */
  modules: string[];
  moduleLabels: string[];
  /** "all" when the user inherits the company's whole module set. */
  moduleAccessMode: "all" | "custom";
  permissions: Record<string, ModulePermissionLevel[]>;
  accessSummary: string;
  isSelf: boolean;
  /** Server-computed capability flags. The UI mirrors these; the API re-checks them. */
  canEdit: boolean;
  canDelete: boolean;
  canResetPassword: boolean;
  canChangeStatus: boolean;
};

export type CompanyUserDirectory = {
  company: { id: string; name: string; userLimit: number | null; customerStatus: string | null };
  availableModules: { code: string; label: string }[];
  roleOptions: typeof CUSTOMER_ROLE_OPTIONS;
  users: CompanyUserView[];
  activeUserCount: number;
  seatLimitReached: boolean;
  actor: { email: string; role: CustomerRole; platformOperator: boolean; canManage: boolean };
};

export type { PasswordMode };

export type CreateCompanyUserInput = {
  firstName: string;
  lastName: string;
  email: string;
  mobile?: string | null;
  role: string;
  status?: "active" | "inactive";
  passwordMode: PasswordMode;
  password?: string;
  confirmPassword?: string;
  /** null / omitted = inherit every module the company subscription includes. */
  modules?: string[] | null;
  permissions?: Record<string, unknown> | null;
  inviteRedirectTo?: string;
};

export type UpdateCompanyUserInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string | null;
  role?: string;
  status?: "active" | "inactive";
  modules?: string[] | null;
  permissions?: Record<string, unknown> | null;
};

export type ResetPasswordInput = {
  passwordMode: "manual" | "generate";
  password?: string;
  confirmPassword?: string;
  /** Defaults to true — the user is asked to replace an administrator-set credential. */
  requirePasswordChange?: boolean;
};

export type MutationResult = {
  user: CompanyUserView;
  /** Present ONLY when this request asked the server to generate a password. A password
   * supplied by the caller is never echoed back. Shown once and never stored. */
  temporaryPassword?: string;
  /** Operator-facing notes (e.g. an existing account was linked rather than created). */
  notices: string[];
};

const ACTIVE_STATUS: UserStatus = "active";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, max = 120): string {
  return String(value ?? "").trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toStatus(value: string | null | undefined, deletedAt: string | null): UserStatus {
  if (deletedAt) return "deleted";
  const status = (value || "active").trim().toLowerCase();
  if (status === "active") return "active";
  if (status === "pending" || status === "invited") return "pending";
  if (status === "deleted" || status === "removed") return "deleted";
  return "inactive";
}

function displayName(row: MembershipRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || row.user_email;
}

// ---------------------------------------------------------------------------
// Authorization primitives
// ---------------------------------------------------------------------------

function assertCanManage(actor: UserManagementActor): void {
  if (actor.platformOperator) return;
  if (!canManageCompanyUsers(actor.role)) {
    throw new UserManagementError(
      "You do not have permission to manage users in this company.",
      403
    );
  }
}

/**
 * Rejects any attempt to write a platform-level role into a tenant membership, and any
 * attempt by a customer administrator to mint a role above their own.
 *
 * The platform check runs for platform operators too. Platform privilege is granted by
 * app_metadata (lib/server/platform-operator.ts), never by company_users.role, so a
 * platform role string in this column would be a confusing no-op at best and a source of
 * privilege-confusion bugs at worst.
 */
function resolveAssignableRole(actor: UserManagementActor, requested: string): CustomerRole {
  const raw = String(requested || "").trim();

  if (isPlatformLevelRoleName(raw)) {
    throw new UserManagementError(
      "Platform-level roles cannot be assigned to a customer user.",
      403
    );
  }
  if (!isCustomerRole(raw)) {
    throw new UserManagementError(`"${raw || "(empty)"}" is not a valid company role.`, 400);
  }

  const role = toCustomerRole(raw);
  if (!actor.platformOperator && !canActorAssignRole(actor.role, role)) {
    throw new UserManagementError(
      `You cannot assign the ${formatTenantRbacRoleLabel(role)} role.`,
      403
    );
  }
  return role;
}

function isSelf(actor: UserManagementActor, row: MembershipRow): boolean {
  if (actor.membershipId && actor.membershipId === row.id) return true;
  return normalizeEmail(actor.email) === normalizeEmail(row.user_email);
}

/** A customer administrator may never act on a seat that outranks their own. */
function assertTargetManageable(actor: UserManagementActor, row: MembershipRow): void {
  if (row.company_id !== actor.companyId) {
    // Defence in depth — every fetch is already company-scoped.
    throw new UserManagementError("User not found in this company.", 404);
  }
  if (actor.platformOperator) return;

  const targetRole = toCustomerRole(row.role);
  if (roleRank(targetRole) > roleRank(actor.role)) {
    throw new UserManagementError(
      `You cannot manage a ${formatTenantRbacRoleLabel(targetRole)} account.`,
      403
    );
  }
}

/**
 * A company must always retain at least one active owner, otherwise the workspace can be
 * locked out of its own governance and only VYRON can recover it.
 */
function assertNotLastActiveOwner(
  members: MembershipRow[],
  target: MembershipRow,
  action: "deactivate" | "delete" | "demote"
): void {
  if (toCustomerRole(target.role) !== "owner") return;
  if (toStatus(target.status, target.deleted_at) !== ACTIVE_STATUS) return;

  const otherActiveOwners = members.filter(
    (row) =>
      row.id !== target.id &&
      toCustomerRole(row.role) === "owner" &&
      toStatus(row.status, row.deleted_at) === ACTIVE_STATUS
  );

  if (otherActiveOwners.length === 0) {
    const verb =
      action === "demote"
        ? "change the role of"
        : action === "delete"
          ? "delete"
          : "deactivate";
    throw new UserManagementError(
      `You cannot ${verb} the last active Owner. Promote another user to Owner first.`,
      400
    );
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function buildUserView(
  actor: UserManagementActor,
  company: CompanyRecord,
  row: MembershipRow
): CompanyUserView {
  const role = toCustomerRole(row.role);
  const status = toStatus(row.status, row.deleted_at);
  const modules = effectiveUserModules(row.module_access, company.enabled_modules);
  const self = isSelf(actor, row);
  const canManage = actor.platformOperator || canManageCompanyUsers(actor.role);
  const outranksActor = !actor.platformOperator && roleRank(role) > roleRank(actor.role);
  const manageable = canManage && !outranksActor && status !== "deleted";

  return {
    id: row.id,
    userId: row.user_id,
    email: row.user_email,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: displayName(row),
    mobile: row.mobile,
    role,
    roleLabel: formatTenantRbacRoleLabel(role),
    status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invitedAt: row.invited_at,
    deletedAt: row.deleted_at,
    mustChangePassword: row.must_change_password,
    modules,
    moduleLabels: modules.map(moduleLabel),
    moduleAccessMode: row.module_access === null ? "all" : "custom",
    permissions: (row.module_permissions || {}) as Record<string, ModulePermissionLevel[]>,
    accessSummary: summarizeModuleAccess(row.module_access, company.enabled_modules),
    isSelf: self,
    canEdit: manageable,
    // Self-service on your own account is deliberately narrower than managing others:
    // an administrator can edit their own profile but cannot delete or disable
    // themselves, and cannot change their own role.
    canDelete: manageable && !self,
    canResetPassword: manageable,
    canChangeStatus: manageable && !self,
  };
}

async function loadCompany(
  store: UserManagementStore,
  companyId: string
): Promise<CompanyRecord> {
  const company = await store.getCompany(companyId);
  if (!company) throw new UserManagementError("Company workspace not found.", 404);
  return company;
}

async function audit(
  store: UserManagementStore,
  entry: Omit<AuditEntry, "metadata"> & { metadata: Record<string, unknown> }
): Promise<void> {
  await store.writeAudit({ ...entry, metadata: redactSecrets(entry.metadata) });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listCompanyUsers(
  store: UserManagementStore,
  actor: UserManagementActor,
  options?: { includeDeleted?: boolean }
): Promise<CompanyUserDirectory> {
  const company = await loadCompany(store, actor.companyId);
  const rows = await store.listMemberships(actor.companyId, Boolean(options?.includeDeleted));

  const users = rows.map((row) => buildUserView(actor, company, row));
  const activeUserCount = users.filter((user) => user.status === ACTIVE_STATUS).length;

  return {
    company: {
      id: company.id,
      name: company.name,
      userLimit: company.user_limit,
      customerStatus: company.customer_status,
    },
    availableModules: companyAvailableModules(company.enabled_modules).map((code) => ({
      code,
      label: moduleLabel(code),
    })),
    roleOptions: CUSTOMER_ROLE_OPTIONS,
    users,
    activeUserCount,
    seatLimitReached: company.user_limit !== null && activeUserCount >= company.user_limit,
    actor: {
      email: actor.email,
      role: actor.role,
      platformOperator: actor.platformOperator,
      canManage: actor.platformOperator || canManageCompanyUsers(actor.role),
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCompanyUser(
  store: UserManagementStore,
  actor: UserManagementActor,
  input: CreateCompanyUserInput
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const email = normalizeEmail(input.email);
  const firstName = cleanText(input.firstName);
  const lastName = cleanText(input.lastName);
  const mobile = cleanText(input.mobile ?? "", 40) || null;

  if (!firstName) throw new UserManagementError("First name is required.", 400);
  if (!lastName) throw new UserManagementError("Surname is required.", 400);
  if (!isValidEmail(email)) throw new UserManagementError("A valid email address is required.", 400);

  const role = resolveAssignableRole(actor, input.role);
  const status: UserStatus = input.status === "inactive" ? "inactive" : ACTIVE_STATUS;

  const grant = resolveModuleGrant(input.modules ?? null, company.enabled_modules);
  if (grant.rejected.length > 0) {
    throw new UserManagementError(
      `This company's subscription does not include: ${grant.rejected.join(", ")}.`,
      400
    );
  }
  const permissions = normalizeModulePermissions(
    input.permissions,
    effectiveUserModules(grant.modules, company.enabled_modules)
  );

  const existingMembership = await store.findMembershipByEmail(actor.companyId, email);
  if (existingMembership && !existingMembership.deleted_at) {
    throw new UserManagementError("This email already has access to this company.", 409);
  }

  const members = await store.listMemberships(actor.companyId, false);
  if (
    company.user_limit !== null &&
    status === ACTIVE_STATUS &&
    members.filter((row) => toStatus(row.status, row.deleted_at) === ACTIVE_STATUS).length >=
      company.user_limit
  ) {
    throw new UserManagementError(
      `This company's licence allows ${company.user_limit} active users. Deactivate a user or request a licence increase.`,
      400
    );
  }

  // --- Password / invitation -------------------------------------------------
  const notices: string[] = [];
  let generatedPassword: string | undefined;
  let password: string | undefined;

  if (input.passwordMode === "manual") {
    const validation = validatePassword(input.password || "", input.confirmPassword);
    if (!validation.ok) throw new UserManagementError(validation.message, 400);
    password = input.password;
  } else if (input.passwordMode === "generate") {
    generatedPassword = generateTemporaryPassword();
    password = generatedPassword;
  }

  const metadata = { first_name: firstName, last_name: lastName, mobile };

  // --- Auth user -------------------------------------------------------------
  //
  // Supabase Auth identities are global. If the address already has an account we link
  // to it instead of creating a duplicate, and we deliberately do NOT touch its password:
  // that credential may also unlock a different tenant, and changing it from here would
  // be a cross-tenant action. The administrator is told exactly what happened.
  const existingAuthUser = await store.findAuthUserByEmail(email);
  let authUserId: string;
  let createdAuthUser = false;
  let passwordApplied = false;
  let invited = false;

  if (existingAuthUser) {
    authUserId = existingAuthUser.id;
    if (input.passwordMode === "invite") {
      await store.inviteAuthUser(email, input.inviteRedirectTo, metadata);
      invited = true;
      notices.push(`An account already existed for ${email}; an invitation was re-sent.`);
    } else {
      notices.push(
        `An account already exists for ${email}. It has been granted access to ${company.name} and its existing password was left unchanged.`
      );
    }
  } else if (input.passwordMode === "invite") {
    const invitedUser = await store.inviteAuthUser(email, input.inviteRedirectTo, metadata);
    authUserId = invitedUser.id;
    createdAuthUser = true;
    invited = true;
  } else {
    const created = await store.createAuthUser({
      email,
      password: password as string,
      metadata,
      // A user provisioned by an administrator is usable immediately. There is no
      // separate email-confirmation policy in this application, so requiring an inbox
      // round-trip would only produce accounts that cannot sign in.
      emailConfirm: true,
    });
    authUserId = created.id;
    createdAuthUser = true;
    passwordApplied = true;
  }

  // --- Membership ------------------------------------------------------------
  //
  // If this fails after we minted a brand new auth user, that user is removed again:
  // an auth identity with no membership cannot sign in to anything and would otherwise
  // block a retry with "email already registered".
  let membership: MembershipRow;
  try {
    if (existingMembership?.deleted_at) {
      membership = await store.updateMembership(actor.companyId, existingMembership.id, {
        user_id: authUserId,
        user_email: email,
        first_name: firstName,
        last_name: lastName,
        mobile,
        role,
        status: invited ? "pending" : status,
        module_access: grant.modules,
        module_permissions: permissions,
        // Only a credential this request actually set can be required to change. When an
        // existing cross-tenant identity was linked, its password was deliberately left
        // alone, so demanding a change would be a lie about what happened.
        must_change_password: input.passwordMode === "generate" && passwordApplied,
        invited_at: invited ? nowIso() : null,
        deleted_at: null,
        deactivated_at: status === ACTIVE_STATUS ? null : nowIso(),
      });
      notices.push("A previously removed membership for this address was restored.");
    } else {
      membership = await store.insertMembership({
        company_id: actor.companyId,
        user_id: authUserId,
        user_email: email,
        first_name: firstName,
        last_name: lastName,
        mobile,
        role,
        status: invited ? "pending" : status,
        module_access: grant.modules,
        module_permissions: permissions,
        // Only a credential this request actually set can be required to change. When an
        // existing cross-tenant identity was linked, its password was deliberately left
        // alone, so demanding a change would be a lie about what happened.
        must_change_password: input.passwordMode === "generate" && passwordApplied,
        created_by: actor.email,
        invited_at: invited ? nowIso() : null,
      });
    }
  } catch (error) {
    if (createdAuthUser && !invited) {
      await store.deleteAuthUser(authUserId).catch(() => undefined);
    }
    throw error instanceof UserManagementError
      ? error
      : new UserManagementError(
          error instanceof Error ? error.message : "The user could not be created.",
          400
        );
  }

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: invited ? "user_invited" : "user_created",
    entityType: "company_user",
    entityId: membership.id,
    metadata: {
      targetEmail: email,
      role,
      status: membership.status,
      moduleAccess: grant.modules === null ? "all" : grant.modules,
      permissions,
      // Called "method", not "passwordMode" or "credentialMethod": redactSecrets() strips
      // every key matching pass|secret|token|credential by design, and HOW the credential
      // was issued is exactly the detail the audit trail must keep.
      method: input.passwordMode,
      passwordApplied,
      linkedExistingAuthUser: Boolean(existingAuthUser),
    },
  });

  return {
    user: buildUserView(actor, company, membership),
    // Only surfaced when the generated password was actually applied. Showing an
    // operator a password that was never set would be worse than showing none.
    temporaryPassword: passwordApplied ? generatedPassword : undefined,
    notices,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateCompanyUser(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string,
  input: UpdateCompanyUserInput
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const target = await store.findMembershipById(actor.companyId, membershipId);
  if (!target) throw new UserManagementError("User not found in this company.", 404);
  assertTargetManageable(actor, target);

  const self = isSelf(actor, target);
  const members = await store.listMemberships(actor.companyId, false);
  const notices: string[] = [];
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];

  if (input.firstName !== undefined) {
    const value = cleanText(input.firstName);
    if (!value) throw new UserManagementError("First name is required.", 400);
    if (value !== (target.first_name || "")) {
      patch.first_name = value;
      changed.push("firstName");
    }
  }
  if (input.lastName !== undefined) {
    const value = cleanText(input.lastName);
    if (!value) throw new UserManagementError("Surname is required.", 400);
    if (value !== (target.last_name || "")) {
      patch.last_name = value;
      changed.push("lastName");
    }
  }
  if (input.mobile !== undefined) {
    const value = cleanText(input.mobile ?? "", 40) || null;
    if (value !== target.mobile) {
      patch.mobile = value;
      changed.push("mobile");
    }
  }

  // --- Email -----------------------------------------------------------------
  let newEmail: string | null = null;
  if (input.email !== undefined) {
    const value = normalizeEmail(input.email);
    if (!isValidEmail(value)) {
      throw new UserManagementError("A valid email address is required.", 400);
    }
    if (value !== target.user_email) {
      const clash = await store.findMembershipByEmail(actor.companyId, value);
      if (clash && clash.id !== target.id && !clash.deleted_at) {
        throw new UserManagementError("Another user in this company already uses that email.", 409);
      }
      // The address is the login credential shared across every tenant this identity
      // belongs to. Changing it from one company would silently rename the other.
      if (!actor.platformOperator) {
        const otherTenants = await store.countOtherCompanyMemberships(
          target.user_email,
          actor.companyId
        );
        if (otherTenants > 0) {
          throw new UserManagementError(
            "This account is also used in another VYRON CORE workspace, so its email address cannot be changed from here. Contact VYRON support.",
            409
          );
        }
      }
      newEmail = value;
      patch.user_email = value;
      changed.push("email");
    }
  }

  // --- Role ------------------------------------------------------------------
  let newRole: CustomerRole | null = null;
  if (input.role !== undefined) {
    const role = resolveAssignableRole(actor, input.role);
    if (role !== toCustomerRole(target.role)) {
      if (self && !actor.platformOperator) {
        throw new UserManagementError("You cannot change your own role.", 403);
      }
      if (roleRank(role) < roleRank(toCustomerRole(target.role))) {
        assertNotLastActiveOwner(members, target, "demote");
      }
      newRole = role;
      patch.role = role;
      changed.push("role");
    }
  }

  // --- Module access + permissions -------------------------------------------
  let moduleChanged = false;
  let effectiveModules = effectiveUserModules(target.module_access, company.enabled_modules);
  if (input.modules !== undefined) {
    const grant = resolveModuleGrant(input.modules, company.enabled_modules);
    if (grant.rejected.length > 0) {
      throw new UserManagementError(
        `This company's subscription does not include: ${grant.rejected.join(", ")}.`,
        400
      );
    }
    const before = JSON.stringify(target.module_access);
    const after = JSON.stringify(grant.modules);
    if (before !== after) {
      patch.module_access = grant.modules;
      moduleChanged = true;
      changed.push("moduleAccess");
    }
    effectiveModules = effectiveUserModules(grant.modules, company.enabled_modules);
  }

  let permissionsChanged = false;
  if (input.permissions !== undefined) {
    const permissions = normalizeModulePermissions(input.permissions, effectiveModules);
    if (JSON.stringify(permissions) !== JSON.stringify(target.module_permissions || {})) {
      patch.module_permissions = permissions;
      permissionsChanged = true;
      changed.push("permissions");
    }
  } else if (moduleChanged) {
    // Keep stored permissions consistent with the narrowed module set.
    const pruned = normalizeModulePermissions(target.module_permissions || {}, effectiveModules);
    if (JSON.stringify(pruned) !== JSON.stringify(target.module_permissions || {})) {
      patch.module_permissions = pruned;
      permissionsChanged = true;
    }
  }

  // --- Status ----------------------------------------------------------------
  let statusChange: "activated" | "deactivated" | null = null;
  if (input.status !== undefined) {
    const nextStatus: UserStatus = input.status === "inactive" ? "inactive" : ACTIVE_STATUS;
    const currentStatus = toStatus(target.status, target.deleted_at);
    if (nextStatus !== currentStatus) {
      if (self) throw new UserManagementError("You cannot change your own status.", 403);
      if (nextStatus === "inactive") assertNotLastActiveOwner(members, target, "deactivate");
      patch.status = nextStatus;
      patch.deactivated_at = nextStatus === ACTIVE_STATUS ? null : nowIso();
      statusChange = nextStatus === ACTIVE_STATUS ? "activated" : "deactivated";
      changed.push("status");
    }
  }

  if (changed.length === 0) {
    return { user: buildUserView(actor, company, target), notices: ["No changes were made."] };
  }

  // Auth first: if the address cannot be changed in Auth, the membership must not drift
  // away from it. A failure here throws before anything in public is written.
  if (newEmail && target.user_id) {
    await store.updateAuthUser(target.user_id, { email: newEmail });
  }
  if ((patch.first_name || patch.last_name || patch.mobile !== undefined) && target.user_id) {
    await store.updateAuthUser(target.user_id, {
      metadata: {
        first_name: (patch.first_name as string) ?? target.first_name,
        last_name: (patch.last_name as string) ?? target.last_name,
        mobile: patch.mobile !== undefined ? (patch.mobile as string | null) : target.mobile,
      },
    });
  }
  if (!target.user_id) {
    notices.push(
      "This membership is not linked to a sign-in account yet, so only the company record was updated."
    );
  }

  const updated = await store.updateMembership(actor.companyId, membershipId, patch);

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: "user_updated",
    entityType: "company_user",
    entityId: membershipId,
    metadata: { targetEmail: updated.user_email, fields: changed },
  });

  if (newRole) {
    await audit(store, {
      companyId: actor.companyId,
      actorEmail: actor.email,
      action: "user_role_changed",
      entityType: "company_user",
      entityId: membershipId,
      metadata: {
        targetEmail: updated.user_email,
        from: toCustomerRole(target.role),
        to: newRole,
      },
    });
  }
  if (moduleChanged) {
    await audit(store, {
      companyId: actor.companyId,
      actorEmail: actor.email,
      action: "user_module_access_changed",
      entityType: "company_user",
      entityId: membershipId,
      metadata: {
        targetEmail: updated.user_email,
        from: target.module_access === null ? "all" : target.module_access,
        to: updated.module_access === null ? "all" : updated.module_access,
      },
    });
  }
  if (permissionsChanged) {
    await audit(store, {
      companyId: actor.companyId,
      actorEmail: actor.email,
      action: "user_permissions_changed",
      entityType: "company_user",
      entityId: membershipId,
      metadata: { targetEmail: updated.user_email, permissions: updated.module_permissions },
    });
  }
  if (statusChange) {
    await audit(store, {
      companyId: actor.companyId,
      actorEmail: actor.email,
      action: statusChange === "activated" ? "user_activated" : "user_deactivated",
      entityType: "company_user",
      entityId: membershipId,
      metadata: { targetEmail: updated.user_email },
    });
  }

  return { user: buildUserView(actor, company, updated), notices };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function setCompanyUserStatus(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string,
  active: boolean
): Promise<MutationResult> {
  return updateCompanyUser(store, actor, membershipId, {
    status: active ? "active" : "inactive",
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function resetCompanyUserPassword(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string,
  input: ResetPasswordInput
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const target = await store.findMembershipById(actor.companyId, membershipId);
  if (!target) throw new UserManagementError("User not found in this company.", 404);
  assertTargetManageable(actor, target);

  if (!target.user_id) {
    throw new UserManagementError(
      "This user has no sign-in account yet. Send them an invitation instead.",
      400
    );
  }

  // Same reasoning as the email change: one credential, many possible tenants.
  if (!actor.platformOperator) {
    const otherTenants = await store.countOtherCompanyMemberships(
      target.user_email,
      actor.companyId
    );
    if (otherTenants > 0) {
      throw new UserManagementError(
        "This account is also used in another VYRON CORE workspace, so its password cannot be reset from here. Contact VYRON support.",
        409
      );
    }
  }

  let generatedPassword: string | undefined;
  let password: string;

  if (input.passwordMode === "generate") {
    generatedPassword = generateTemporaryPassword();
    password = generatedPassword;
  } else {
    const validation = validatePassword(input.password || "", input.confirmPassword);
    if (!validation.ok) throw new UserManagementError(validation.message, 400);
    password = input.password as string;
  }

  await store.updateAuthUser(target.user_id, { password });

  const mustChange = input.requirePasswordChange ?? true;
  const updated = await store.updateMembership(actor.companyId, membershipId, {
    must_change_password: mustChange,
  });

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: "user_password_reset",
    entityType: "company_user",
    entityId: membershipId,
    metadata: {
      targetEmail: updated.user_email,
      // Called "method", not "passwordMode" or "credentialMethod": redactSecrets() strips
      // every key matching pass|secret|token|credential by design, and HOW the credential
      // was issued is exactly the detail the audit trail must keep.
      method: input.passwordMode,
      mustChangePassword: mustChange,
    },
  });

  return {
    user: buildUserView(actor, company, updated),
    temporaryPassword: generatedPassword,
    notices: [],
  };
}

// ---------------------------------------------------------------------------
// Delete / restore
// ---------------------------------------------------------------------------

export async function deleteCompanyUser(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const target = await store.findMembershipById(actor.companyId, membershipId);
  if (!target) throw new UserManagementError("User not found in this company.", 404);
  assertTargetManageable(actor, target);

  if (isSelf(actor, target)) {
    throw new UserManagementError("You cannot delete your own account.", 403);
  }

  const members = await store.listMemberships(actor.companyId, false);
  assertNotLastActiveOwner(members, target, "delete");

  const notices: string[] = [];

  // Soft delete. The membership row is retained so audit history, created_by references
  // and any business records this user produced keep resolving to a real identity.
  const updated = await store.updateMembership(actor.companyId, membershipId, {
    status: "deleted",
    deleted_at: nowIso(),
    deactivated_at: nowIso(),
  });

  // The Auth identity is only revoked when this was its last remaining workspace —
  // otherwise disabling it here would lock the person out of a different tenant.
  if (target.user_id) {
    const otherTenants = await store.countOtherCompanyMemberships(
      target.user_email,
      actor.companyId
    );
    if (otherTenants === 0) {
      // Banned, not destroyed: auth.users.id is referenced by company_users.user_id and
      // by historical records, and a hard delete would orphan them.
      await store.updateAuthUser(target.user_id, { banDuration: "876000h" });
      notices.push("The sign-in account was disabled.");
    } else {
      notices.push(
        "Access to this company was removed. The sign-in account remains active because it is used in another workspace."
      );
    }
  }

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: "user_deleted",
    entityType: "company_user",
    entityId: membershipId,
    metadata: {
      targetEmail: updated.user_email,
      role: toCustomerRole(target.role),
      softDelete: true,
    },
  });

  return { user: buildUserView(actor, company, updated), notices };
}

export async function restoreCompanyUser(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const target = await store.findMembershipById(actor.companyId, membershipId);
  if (!target) throw new UserManagementError("User not found in this company.", 404);
  assertTargetManageable(actor, target);

  const updated = await store.updateMembership(actor.companyId, membershipId, {
    status: ACTIVE_STATUS,
    deleted_at: null,
    deactivated_at: null,
  });

  if (target.user_id) {
    await store.updateAuthUser(target.user_id, { banDuration: "none" });
  }

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: "user_restored",
    entityType: "company_user",
    entityId: membershipId,
    metadata: { targetEmail: updated.user_email },
  });

  return { user: buildUserView(actor, company, updated), notices: [] };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function resendCompanyUserInvite(
  store: UserManagementStore,
  actor: UserManagementActor,
  membershipId: string,
  redirectTo?: string
): Promise<MutationResult> {
  assertCanManage(actor);

  const company = await loadCompany(store, actor.companyId);
  const target = await store.findMembershipById(actor.companyId, membershipId);
  if (!target) throw new UserManagementError("User not found in this company.", 404);
  assertTargetManageable(actor, target);

  const authUser = await store.inviteAuthUser(target.user_email, redirectTo, {
    first_name: target.first_name,
    last_name: target.last_name,
    mobile: target.mobile,
  });

  const updated = await store.updateMembership(actor.companyId, membershipId, {
    invited_at: nowIso(),
    user_id: target.user_id || authUser.id,
  });

  await audit(store, {
    companyId: actor.companyId,
    actorEmail: actor.email,
    action: "user_invited",
    entityType: "company_user",
    entityId: membershipId,
    metadata: { targetEmail: updated.user_email, resend: true },
  });

  return {
    user: buildUserView(actor, company, updated),
    notices: [`Invitation sent to ${updated.user_email}.`],
  };
}
