import type { UserManagementActor } from "@/lib/tenant/user-management";
import type { CustomerRole } from "@/lib/tenant/user-roles";

export const COMPANY_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const COMPANY_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** A customer-side actor. platformOperator is false — exactly what lib/tenant/api-auth.ts builds. */
export function customerActor(
  overrides: Partial<UserManagementActor> & { companyId: string; role: CustomerRole }
): UserManagementActor {
  return {
    email: overrides.email ?? "admin@company-a.test",
    companyId: overrides.companyId,
    role: overrides.role,
    platformOperator: false,
    membershipId: overrides.membershipId ?? null,
  };
}

/** A VYRON platform operator acting on a named customer through the console routes. */
export function platformActor(companyId: string): UserManagementActor {
  return {
    email: "operator@vyron.test",
    companyId,
    role: "owner",
    platformOperator: true,
    membershipId: null,
  };
}
