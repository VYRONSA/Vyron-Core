/**
 * In-memory UserManagementStore for the user-management suites.
 *
 * It implements the same contract as the Supabase adapter, including the parts that
 * matter for security: every membership lookup is company-scoped, so a test that reaches
 * for another tenant's row gets exactly what production would — nothing.
 *
 * It also records every Auth call, which is how the suites assert that a password
 * actually reached Supabase Auth (rather than a database column), and that a
 * cross-tenant identity's credential is left alone.
 */

import type {
  AuditEntry,
  AuthUserRecord,
  CompanyRecord,
  CreateAuthUserInput,
  MembershipInsert,
  MembershipRow,
  MembershipUpdate,
  UpdateAuthUserInput,
  UserManagementStore,
} from "@/lib/tenant/user-management-store";

export type AuthCall =
  | { kind: "create"; email: string; password: string; emailConfirm: boolean }
  | { kind: "update"; userId: string; input: UpdateAuthUserInput }
  | { kind: "invite"; email: string }
  | { kind: "delete"; userId: string };

export type FakeAuthUser = AuthUserRecord & { password: string | null; banned: boolean };

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function membership(overrides: Partial<MembershipRow> & { company_id: string }): MembershipRow {
  return {
    id: overrides.id ?? nextId("member"),
    company_id: overrides.company_id,
    user_id: overrides.user_id ?? nextId("auth"),
    user_email: (overrides.user_email ?? `user${sequence}@example.com`).toLowerCase(),
    first_name: overrides.first_name ?? "Test",
    last_name: overrides.last_name ?? "User",
    mobile: overrides.mobile ?? null,
    role: overrides.role ?? "employee",
    status: overrides.status ?? "active",
    module_access: overrides.module_access === undefined ? null : overrides.module_access,
    module_permissions: overrides.module_permissions ?? {},
    must_change_password: overrides.must_change_password ?? false,
    last_login_at: overrides.last_login_at ?? null,
    invited_at: overrides.invited_at ?? null,
    created_by: overrides.created_by ?? "system",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00.000Z",
    deactivated_at: overrides.deactivated_at ?? null,
    deleted_at: overrides.deleted_at ?? null,
  };
}

export function company(overrides: Partial<CompanyRecord> & { id: string }): CompanyRecord {
  return {
    id: overrides.id,
    name: overrides.name ?? `Company ${overrides.id}`,
    enabled_modules:
      overrides.enabled_modules === undefined
        ? ["employees", "leave", "clocking"]
        : overrides.enabled_modules,
    user_limit: overrides.user_limit ?? null,
    customer_status: overrides.customer_status ?? "active",
  };
}

export type FakeStoreOptions = {
  companies: CompanyRecord[];
  memberships: MembershipRow[];
  authUsers?: FakeAuthUser[];
  /** Forces the next insertMembership to throw — exercises the rollback path. */
  failNextInsert?: boolean;
};

export class FakeStore implements UserManagementStore {
  companies: CompanyRecord[];
  memberships: MembershipRow[];
  authUsers: FakeAuthUser[];
  audits: AuditEntry[] = [];
  authCalls: AuthCall[] = [];
  failNextInsert: boolean;

  constructor(options: FakeStoreOptions) {
    this.companies = options.companies;
    this.memberships = options.memberships;
    this.authUsers = options.authUsers ?? [];
    this.failNextInsert = options.failNextInsert ?? false;
  }

  async getCompany(companyId: string): Promise<CompanyRecord | null> {
    return this.companies.find((row) => row.id === companyId) ?? null;
  }

  async listMemberships(companyId: string, includeDeleted: boolean): Promise<MembershipRow[]> {
    return this.memberships.filter(
      (row) => row.company_id === companyId && (includeDeleted || row.deleted_at === null)
    );
  }

  async findMembershipById(companyId: string, membershipId: string): Promise<MembershipRow | null> {
    return (
      this.memberships.find((row) => row.company_id === companyId && row.id === membershipId) ?? null
    );
  }

  async findMembershipByEmail(companyId: string, email: string): Promise<MembershipRow | null> {
    const wanted = email.trim().toLowerCase();
    return (
      this.memberships.find(
        (row) => row.company_id === companyId && row.user_email === wanted
      ) ?? null
    );
  }

  async countOtherCompanyMemberships(email: string, excludeCompanyId: string): Promise<number> {
    const wanted = email.trim().toLowerCase();
    return this.memberships.filter(
      (row) =>
        row.user_email === wanted &&
        row.company_id !== excludeCompanyId &&
        row.status === "active" &&
        row.deleted_at === null
    ).length;
  }

  async insertMembership(values: MembershipInsert): Promise<MembershipRow> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("simulated membership insert failure");
    }
    const row = membership({ ...values, id: nextId("member") });
    this.memberships.push(row);
    return row;
  }

  async updateMembership(
    companyId: string,
    membershipId: string,
    values: MembershipUpdate
  ): Promise<MembershipRow> {
    const index = this.memberships.findIndex(
      (row) => row.company_id === companyId && row.id === membershipId
    );
    if (index === -1) throw new Error("User not found in this company.");
    const merged = { ...this.memberships[index], ...values } as MembershipRow;
    merged.updated_at = new Date().toISOString();
    this.memberships[index] = merged;
    return merged;
  }

  async findAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const wanted = email.trim().toLowerCase();
    return this.authUsers.find((user) => user.email === wanted) ?? null;
  }

  async createAuthUser(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const email = input.email.trim().toLowerCase();
    this.authCalls.push({
      kind: "create",
      email,
      password: input.password,
      emailConfirm: input.emailConfirm,
    });
    const user: FakeAuthUser = {
      id: nextId("auth"),
      email,
      app_metadata: null,
      password: input.password,
      banned: false,
    };
    this.authUsers.push(user);
    return { id: user.id, email: user.email, app_metadata: user.app_metadata };
  }

  async updateAuthUser(userId: string, input: UpdateAuthUserInput): Promise<AuthUserRecord> {
    this.authCalls.push({ kind: "update", userId, input });
    const user = this.authUsers.find((entry) => entry.id === userId);
    if (!user) throw new Error("auth user not found");
    if (input.email !== undefined) user.email = input.email.trim().toLowerCase();
    if (input.password !== undefined) user.password = input.password;
    if (input.banDuration !== undefined) user.banned = input.banDuration !== "none";
    return { id: user.id, email: user.email, app_metadata: user.app_metadata };
  }

  async inviteAuthUser(email: string): Promise<AuthUserRecord> {
    const address = email.trim().toLowerCase();
    this.authCalls.push({ kind: "invite", email: address });
    const existing = this.authUsers.find((user) => user.email === address);
    if (existing) return { id: existing.id, email: existing.email, app_metadata: null };
    const user: FakeAuthUser = {
      id: nextId("auth"),
      email: address,
      app_metadata: null,
      password: null,
      banned: false,
    };
    this.authUsers.push(user);
    return { id: user.id, email: user.email, app_metadata: null };
  }

  async deleteAuthUser(userId: string): Promise<void> {
    this.authCalls.push({ kind: "delete", userId });
    this.authUsers = this.authUsers.filter((user) => user.id !== userId);
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry);
  }

  // --- helpers used by assertions -------------------------------------------

  auditActions(): string[] {
    return this.audits.map((entry) => entry.action);
  }

  auditBlob(): string {
    return JSON.stringify(this.audits);
  }

  authUser(email: string): FakeAuthUser | undefined {
    return this.authUsers.find((user) => user.email === email.trim().toLowerCase());
  }
}

export function fakeAuthUser(email: string, password: string | null = "ExistingPass1"): FakeAuthUser {
  return {
    id: nextId("auth"),
    email: email.toLowerCase(),
    app_metadata: null,
    password,
    banned: false,
  };
}
