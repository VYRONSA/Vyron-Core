import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_ASSIGNABLE_ROLES,
  CUSTOMER_ROLE_OPTIONS,
  canActorAssignRole,
  canManageCompanyUsers,
  effectiveModulePermissions,
  isCustomerRole,
  isPlatformLevelRoleName,
  normalizeModulePermissions,
  normalizePermissionLevels,
  roleRank,
  toCustomerRole,
} from "@/lib/tenant/user-roles";
import { PLATFORM_OPERATOR_ROLE_CLAIMS } from "@/lib/server/platform-operator";

describe("customer role model", () => {
  it("never exposes a platform role as assignable", () => {
    for (const claim of PLATFORM_OPERATOR_ROLE_CLAIMS) {
      assert.equal(
        CUSTOMER_ASSIGNABLE_ROLES.includes(claim as never),
        false,
        `${claim} must not be customer-assignable`
      );
      assert.equal(isPlatformLevelRoleName(claim), true);
      assert.equal(isCustomerRole(claim), false);
    }
  });

  it("recognises platform roles in every spelling an attacker might send", () => {
    const attempts = [
      "super_admin",
      "SUPER_ADMIN",
      "  Super Admin  ",
      "superadmin",
      "platform_admin",
      "platform admin",
      "platform_operator",
      "Platform Operator",
      "supervisor tools",
      "supervisor_tools",
    ];
    for (const attempt of attempts) {
      assert.equal(isPlatformLevelRoleName(attempt), true, `${attempt} should be blocked`);
    }
  });

  it("does not confuse a legitimate customer role with a platform role", () => {
    for (const role of CUSTOMER_ASSIGNABLE_ROLES) {
      assert.equal(isPlatformLevelRoleName(role), false);
      assert.equal(isCustomerRole(role), true);
    }
    // "supervisor" is a customer role; "supervisor tools" is the platform claim.
    assert.equal(isPlatformLevelRoleName("supervisor"), false);
  });

  it("falls back to the least-privileged role for unknown values", () => {
    assert.equal(toCustomerRole("wizard"), "employee");
    assert.equal(toCustomerRole(""), "employee");
    assert.equal(toCustomerRole(null), "employee");
    assert.equal(toCustomerRole("super_user"), "owner");
  });

  it("only lets owners and admins manage users", () => {
    assert.equal(canManageCompanyUsers("owner"), true);
    assert.equal(canManageCompanyUsers("admin"), true);
    assert.equal(canManageCompanyUsers("manager"), false);
    assert.equal(canManageCompanyUsers("supervisor"), false);
    assert.equal(canManageCompanyUsers("employee"), false);
  });

  it("stops an actor minting a role above their own", () => {
    assert.equal(canActorAssignRole("admin", "owner"), false);
    assert.equal(canActorAssignRole("admin", "admin"), true);
    assert.equal(canActorAssignRole("admin", "manager"), true);
    assert.equal(canActorAssignRole("owner", "owner"), true);
    assert.equal(canActorAssignRole("manager", "employee"), false);
    assert.ok(roleRank("owner") > roleRank("admin"));
  });

  it("publishes a label and description for every assignable role", () => {
    assert.equal(CUSTOMER_ROLE_OPTIONS.length, CUSTOMER_ASSIGNABLE_ROLES.length);
    for (const option of CUSTOMER_ROLE_OPTIONS) {
      assert.ok(option.label.length > 0);
      assert.ok(option.description.length > 0);
    }
  });
});

describe("module permission levels", () => {
  it("drops permission levels the application does not define", () => {
    assert.deepEqual(
      normalizePermissionLevels(["view", "sudo", "EDIT", 7, null]),
      ["view", "edit"]
    );
  });

  it("drops permissions for modules the user does not hold", () => {
    const result = normalizeModulePermissions(
      { leave: ["view", "approve"], payroll_intelligence: ["admin"] },
      ["leave", "clocking"]
    );
    assert.deepEqual(result, { leave: ["view", "approve"] });
  });

  it("ignores malformed permission payloads", () => {
    assert.deepEqual(normalizeModulePermissions(null, ["leave"]), {});
    assert.deepEqual(normalizeModulePermissions(["leave"], ["leave"]), {});
    assert.deepEqual(normalizeModulePermissions({ leave: "view" }, ["leave"]), {});
  });

  it("falls back to the role default when no explicit grant exists", () => {
    assert.deepEqual(effectiveModulePermissions("employee", "leave", {}), ["view"]);
    assert.deepEqual(effectiveModulePermissions("employee", "leave", { leave: ["approve"] }), [
      "approve",
    ]);
  });
});
