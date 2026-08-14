/**
 * Storage boundary for customer user management.
 *
 * Everything the service in lib/tenant/user-management.ts needs from the outside world
 * — company_users rows, Supabase Auth users, audit records — goes through this narrow
 * interface. Two things fall out of that:
 *
 *   1. The Supabase adapter below is the ONLY place a query is written, so tenant
 *      scoping (`eq("company_id", companyId)` on every single read and write) is
 *      auditable in one file rather than scattered across route handlers.
 *   2. The authorization logic can be exercised against an in-memory implementation in
 *      tests/, with no database and no network.
 *
 * The adapter is constructed from the service-role client (lib/server-api-auth.ts
 * getSupabaseAdminClient), which is server-only. It is never imported from a
 * "use client" module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog, type AuditAction } from "@/lib/audit-log";

export type MembershipRow = {
  id: string;
  company_id: string;
  user_id: string | null;
  user_email: string;
  first_name: string | null;
  last_name: string | null;
  mobile: string | null;
  role: string;
  status: string;
  module_access: string[] | null;
  module_permissions: Record<string, string[]> | null;
  must_change_password: boolean;
  last_login_at: string | null;
  invited_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deactivated_at: string | null;
  deleted_at: string | null;
};

export type CompanyRecord = {
  id: string;
  name: string;
  enabled_modules: string[] | null;
  user_limit: number | null;
  customer_status: string | null;
};

export type AuthUserRecord = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown> | null;
};

export type MembershipInsert = {
  company_id: string;
  user_id: string | null;
  user_email: string;
  first_name: string | null;
  last_name: string | null;
  mobile: string | null;
  role: string;
  status: string;
  module_access: string[] | null;
  module_permissions: Record<string, string[]>;
  must_change_password: boolean;
  created_by: string;
  invited_at: string | null;
};

export type MembershipUpdate = Partial<
  Omit<MembershipInsert, "company_id" | "created_by">
> & {
  deactivated_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string | null;
};

export type AuditEntry = {
  companyId: string;
  actorEmail: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
};

export type CreateAuthUserInput = {
  email: string;
  password: string;
  metadata: Record<string, unknown>;
  emailConfirm: boolean;
};

export type UpdateAuthUserInput = {
  email?: string;
  password?: string;
  metadata?: Record<string, unknown>;
  banDuration?: "none" | "876000h";
};

export interface UserManagementStore {
  getCompany(companyId: string): Promise<CompanyRecord | null>;
  listMemberships(companyId: string, includeDeleted: boolean): Promise<MembershipRow[]>;
  findMembershipById(companyId: string, membershipId: string): Promise<MembershipRow | null>;
  findMembershipByEmail(companyId: string, email: string): Promise<MembershipRow | null>;
  /**
   * Active memberships this address holds in OTHER companies.
   *
   * Supabase Auth identities are global, so one email is one credential across every
   * tenant. Before a customer administrator is allowed to change a password or an email
   * address, this answers "would that reach into another tenant?" — see
   * lib/tenant/user-management.ts, which refuses the operation when it would.
   */
  countOtherCompanyMemberships(email: string, excludeCompanyId: string): Promise<number>;
  insertMembership(values: MembershipInsert): Promise<MembershipRow>;
  updateMembership(
    companyId: string,
    membershipId: string,
    values: MembershipUpdate
  ): Promise<MembershipRow>;

  findAuthUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createAuthUser(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  updateAuthUser(userId: string, input: UpdateAuthUserInput): Promise<AuthUserRecord>;
  inviteAuthUser(
    email: string,
    redirectTo: string | undefined,
    metadata: Record<string, unknown>
  ): Promise<AuthUserRecord>;
  /** Compensating rollback only — used when membership creation fails immediately
   * after this service created a brand new auth user. Never used on pre-existing users. */
  deleteAuthUser(userId: string): Promise<void>;

  writeAudit(entry: AuditEntry): Promise<void>;
}

const MEMBERSHIP_COLUMNS =
  "id,company_id,user_id,user_email,first_name,last_name,mobile,role,status," +
  "module_access,module_permissions,must_change_password,last_login_at,invited_at," +
  "created_by,created_at,updated_at,deactivated_at,deleted_at";

/** Missing-column errors (42703 / PGRST204) mean sql/069 has not been applied yet. */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("does not exist") && message.includes("column");
}

const MIGRATION_HINT =
  "Customer user management columns are missing. Run sql/069-customer-user-management.sql " +
  "in the Supabase SQL editor, wait ~30 seconds for the schema cache, then retry.";

function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

function toMembershipRow(row: Record<string, unknown>): MembershipRow {
  const permissions = row.module_permissions;
  return {
    id: String(row.id || ""),
    company_id: String(row.company_id || ""),
    user_id: row.user_id ? String(row.user_id) : null,
    user_email: normalizeEmail(String(row.user_email || "")),
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    mobile: (row.mobile as string | null) ?? null,
    role: String(row.role || "employee"),
    status: String(row.status || "active"),
    module_access: Array.isArray(row.module_access) ? (row.module_access as string[]) : null,
    module_permissions:
      permissions && typeof permissions === "object" && !Array.isArray(permissions)
        ? (permissions as Record<string, string[]>)
        : {},
    must_change_password: Boolean(row.must_change_password),
    last_login_at: (row.last_login_at as string | null) ?? null,
    invited_at: (row.invited_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    deactivated_at: (row.deactivated_at as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

export class StoreError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

/** Production adapter. Every call is scoped by company_id — there is no unscoped read. */
export function createSupabaseUserManagementStore(admin: SupabaseClient): UserManagementStore {
  return {
    async getCompany(companyId) {
      const { data, error } = await admin
        .from("companies")
        .select("id,name,enabled_modules,user_limit,customer_status")
        .eq("id", companyId)
        .maybeSingle();

      if (error) throw new StoreError(error.message, 500);
      if (!data) return null;
      return {
        id: String(data.id),
        name: String(data.name || ""),
        enabled_modules: Array.isArray(data.enabled_modules) ? data.enabled_modules : null,
        user_limit: (data.user_limit as number | null) ?? null,
        customer_status: (data.customer_status as string | null) ?? null,
      };
    },

    async listMemberships(companyId, includeDeleted) {
      let query = admin
        .from("company_users")
        .select(MEMBERSHIP_COLUMNS)
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (!includeDeleted) query = query.is("deleted_at", null);

      const { data, error } = await query;
      if (error) {
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 500);
      }
      return (data || []).map((row) => toMembershipRow(row as unknown as Record<string, unknown>));
    },

    async findMembershipById(companyId, membershipId) {
      const { data, error } = await admin
        .from("company_users")
        .select(MEMBERSHIP_COLUMNS)
        .eq("company_id", companyId)
        .eq("id", membershipId)
        .maybeSingle();

      if (error) {
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 500);
      }
      return data ? toMembershipRow(data as unknown as Record<string, unknown>) : null;
    },

    async findMembershipByEmail(companyId, email) {
      const { data, error } = await admin
        .from("company_users")
        .select(MEMBERSHIP_COLUMNS)
        .eq("company_id", companyId)
        .ilike("user_email", normalizeEmail(email))
        .limit(1);

      if (error) {
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 500);
      }
      const row = (data || [])[0];
      return row ? toMembershipRow(row as unknown as Record<string, unknown>) : null;
    },

    async countOtherCompanyMemberships(email, excludeCompanyId) {
      const { data, error } = await admin
        .from("company_users")
        .select("id,company_id")
        .ilike("user_email", normalizeEmail(email))
        .eq("status", "active")
        .neq("company_id", excludeCompanyId);

      if (error) {
        // A missing deleted_at column (pre-069) must not fail closed into "no other
        // tenants" — surface it instead.
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 500);
      }
      return (data || []).length;
    },

    async insertMembership(values) {
      const { data, error } = await admin
        .from("company_users")
        .insert({ ...values, updated_at: new Date().toISOString() })
        .select(MEMBERSHIP_COLUMNS)
        .single();

      if (error) {
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 400);
      }
      return toMembershipRow(data as unknown as Record<string, unknown>);
    },

    async updateMembership(companyId, membershipId, values) {
      const { data, error } = await admin
        .from("company_users")
        .update({ ...values, updated_at: new Date().toISOString() })
        // Both predicates matter: the id alone would let a mistaken caller reach across
        // tenants, so company scope is re-asserted at the statement itself.
        .eq("company_id", companyId)
        .eq("id", membershipId)
        .select(MEMBERSHIP_COLUMNS)
        .maybeSingle();

      if (error) {
        throw new StoreError(isMissingColumnError(error) ? MIGRATION_HINT : error.message, 400);
      }
      if (!data) throw new StoreError("User not found in this company.", 404);
      return toMembershipRow(data as unknown as Record<string, unknown>);
    },

    async findAuthUserByEmail(email) {
      const wanted = normalizeEmail(email);
      const perPage = 200;

      for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw new StoreError(error.message, 500);

        const users = data?.users || [];
        const hit = users.find((user) => normalizeEmail(user.email || "") === wanted);
        if (hit) {
          return {
            id: hit.id,
            email: normalizeEmail(hit.email || ""),
            app_metadata: (hit.app_metadata as Record<string, unknown>) || null,
          };
        }
        if (users.length < perPage) break;
      }

      return null;
    },

    async createAuthUser(input) {
      const { data, error } = await admin.auth.admin.createUser({
        email: normalizeEmail(input.email),
        password: input.password,
        email_confirm: input.emailConfirm,
        // Display-only profile data. app_metadata is deliberately NOT written here:
        // it is the platform privilege claim and must never be set by a customer-facing
        // or customer-provisioning path.
        user_metadata: input.metadata,
      });

      if (error || !data?.user) {
        throw new StoreError(error?.message || "Auth user could not be created.", 400);
      }
      return {
        id: data.user.id,
        email: normalizeEmail(data.user.email || input.email),
        app_metadata: (data.user.app_metadata as Record<string, unknown>) || null,
      };
    },

    async updateAuthUser(userId, input) {
      const patch: Record<string, unknown> = {};
      if (input.email !== undefined) {
        patch.email = normalizeEmail(input.email);
        // Administrator-initiated address change: confirm it so the user is not locked
        // out waiting for a verification mail they never asked for.
        patch.email_confirm = true;
      }
      if (input.password !== undefined) patch.password = input.password;
      if (input.metadata !== undefined) patch.user_metadata = input.metadata;
      if (input.banDuration !== undefined) patch.ban_duration = input.banDuration;

      const { data, error } = await admin.auth.admin.updateUserById(userId, patch);
      if (error || !data?.user) {
        throw new StoreError(error?.message || "Auth user could not be updated.", 400);
      }
      return {
        id: data.user.id,
        email: normalizeEmail(data.user.email || ""),
        app_metadata: (data.user.app_metadata as Record<string, unknown>) || null,
      };
    },

    async inviteAuthUser(email, redirectTo, metadata) {
      const address = normalizeEmail(email);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(address, {
        redirectTo,
        data: metadata,
      });

      if (!error && data?.user) {
        return {
          id: data.user.id,
          email: normalizeEmail(data.user.email || address),
          app_metadata: (data.user.app_metadata as Record<string, unknown>) || null,
        };
      }

      const message = (error?.message || "").toLowerCase();
      const alreadyExists =
        message.includes("already been registered") ||
        message.includes("already registered") ||
        message.includes("already invited");

      if (!alreadyExists) {
        throw new StoreError(error?.message || "Invitation could not be sent.", 400);
      }

      const existing = await this.findAuthUserByEmail(address);
      if (!existing) throw new StoreError(error?.message || "Invitation could not be sent.", 400);
      return existing;
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new StoreError(error.message, 500);
    },

    async writeAudit(entry) {
      await writeAuditLog(admin, {
        companyId: entry.companyId,
        userEmail: entry.actorEmail,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
      });
    },
  };
}
