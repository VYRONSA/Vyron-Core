/**
 * Builds the user-management actor for the Platform Console customer-users routes.
 *
 * The elevated boundary is the path parameter, which is only reachable after
 * requirePlatformOperator() has proved BOTH the operator claim and an active Platform
 * Mode elevation (app/api/platform/_shared.ts). Customer-facing code never reaches this
 * helper — lib/tenant/api-auth.ts is the only other actor source, and it pins
 * platformOperator to false.
 *
 * Note that `platformOperator: true` widens WHICH company can be acted on. It does not
 * widen what may be written: lib/tenant/user-management.ts still refuses to put a
 * platform-level role into company_users.role for any actor, because platform privilege
 * lives in auth.users.app_metadata and is granted by a different mechanism entirely.
 */

import type { PlatformAuthContext } from "@/app/api/platform/_shared";
import {
  createSupabaseUserManagementStore,
  type UserManagementStore,
} from "@/lib/tenant/user-management-store";
import type { UserManagementActor } from "@/lib/tenant/user-management";

export function platformUserManagementContext(
  context: PlatformAuthContext,
  companyId: string
): { store: UserManagementStore; actor: UserManagementActor } {
  return {
    store: createSupabaseUserManagementStore(context.supabase),
    actor: {
      email: context.email,
      companyId,
      role: "owner",
      platformOperator: true,
      membershipId: null,
    },
  };
}
