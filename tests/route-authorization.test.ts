/**
 * Route-level authorization — what middleware.ts enforces before a page renders.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAccessRouteForRole,
  isProtectedPath,
  normalizeRbacRole,
  type VyronRbacRole,
} from "@/lib/server/auth-routing";
import { isPlatformOperatorRole, isPlatformOperatorSessionUser } from "@/lib/server/platform-operator";

const CUSTOMER_ROLES: VyronRbacRole[] = ["owner", "manager", "supervisor", "employee"];

describe("Platform Console is unreachable for customers", () => {
  it("only a platform operator may enter /platform", () => {
    assert.equal(canAccessRouteForRole("platform_operator", "/platform"), true);
    for (const role of CUSTOMER_ROLES) {
      assert.equal(canAccessRouteForRole(role, "/platform"), false, `${role} reached /platform`);
    }
  });

  it("blocks every sub-route of the console, including customer user management", () => {
    const paths = [
      "/platform/customers",
      "/platform/customers/aaaa/users",
      "/platform/plans",
      "/platform/system",
    ];
    for (const path of paths) {
      assert.equal(canAccessRouteForRole("owner", path), false, `owner reached ${path}`);
      assert.equal(canAccessRouteForRole("manager", path), false, `manager reached ${path}`);
      assert.equal(canAccessRouteForRole("platform_operator", path), true);
    }
  });

  it("a company administrator's tenant role never normalises to platform_operator", () => {
    for (const role of ["owner", "admin", "manager", "supervisor", "employee", "user", "staff"]) {
      assert.notEqual(normalizeRbacRole(role), "platform_operator", `${role} escalated`);
    }
    assert.equal(normalizeRbacRole("platform_operator"), "platform_operator");
    assert.equal(normalizeRbacRole("super_admin"), "platform_operator");
  });

  it("treats /platform as a protected path", () => {
    assert.equal(isProtectedPath("/platform"), true);
    assert.equal(isProtectedPath("/platform/customers"), true);
  });
});

describe("Settings → Users & Access route gating", () => {
  it("is reachable by company owners and admins (admin normalises to manager)", () => {
    assert.equal(normalizeRbacRole("admin"), "manager");
    assert.equal(canAccessRouteForRole("owner", "/settings/users"), true);
    assert.equal(canAccessRouteForRole("manager", "/settings/users"), true);
  });

  it("is blocked for supervisors and employees", () => {
    assert.equal(canAccessRouteForRole("supervisor", "/settings/users"), false);
    assert.equal(canAccessRouteForRole("employee", "/settings/users"), false);
  });

  it("is a protected path, so an unauthenticated request is redirected", () => {
    assert.equal(isProtectedPath("/settings/users"), true);
  });
});

describe("platform operator claim", () => {
  it("is read only from app_metadata, never user_metadata", () => {
    assert.equal(
      isPlatformOperatorSessionUser({ app_metadata: { role: "platform_operator" } }),
      true
    );
    assert.equal(isPlatformOperatorSessionUser({ app_metadata: { roles: ["super_admin"] } }), true);
    assert.equal(isPlatformOperatorSessionUser({ app_metadata: { role: "owner" } }), false);
    assert.equal(isPlatformOperatorSessionUser({ app_metadata: {} }), false);
    assert.equal(isPlatformOperatorSessionUser(null), false);

    // A self-editable claim must be ignored entirely.
    const selfPromoted = {
      app_metadata: { role: "owner" },
      user_metadata: { role: "platform_operator", roles: ["super_admin"] },
    } as { app_metadata: Record<string, unknown> };
    assert.equal(isPlatformOperatorSessionUser(selfPromoted), false);
  });

  it("does not treat a tenant role as an operator claim", () => {
    for (const role of ["owner", "admin", "manager", "supervisor", "employee"]) {
      assert.equal(isPlatformOperatorRole([role]), false, `${role} was treated as an operator`);
    }
  });
});
