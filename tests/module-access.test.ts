import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  companyAvailableModules,
  companyModuleOptions,
  effectiveUserModules,
  resolveModuleGrant,
  summarizeModuleAccess,
} from "@/lib/tenant/module-access";

const PROFESSIONAL = ["clocking", "employees", "leave", "rostering"];

describe("company module entitlement", () => {
  it("normalises and orders the company's enabled modules", () => {
    const result = companyAvailableModules(["LEAVE", " employees ", "leave"]);
    assert.deepEqual(result, ["employees", "leave"]);
  });

  it("returns an empty entitlement when nothing is enabled", () => {
    assert.deepEqual(companyAvailableModules(null), []);
    assert.deepEqual(companyAvailableModules([]), []);
  });

  it("labels modules from the shared platform catalogue", () => {
    const options = companyModuleOptions(["clocking", "ai_copilot"]);
    assert.deepEqual(options, [
      { code: "clocking", label: "Clocking" },
      { code: "ai_copilot", label: "AI Copilot" },
    ]);
  });
});

describe("per-user module grants", () => {
  it("rejects modules the subscription does not include", () => {
    const grant = resolveModuleGrant(["leave", "payroll_intelligence"], PROFESSIONAL);
    assert.deepEqual(grant.modules, ["leave"]);
    assert.deepEqual(grant.rejected, ["payroll_intelligence"]);
  });

  it("treats null as inherit-everything and stores it as null", () => {
    const grant = resolveModuleGrant(null, PROFESSIONAL);
    assert.equal(grant.modules, null);
    assert.deepEqual(grant.rejected, []);
  });

  it("treats an empty array as no access, not as inherit", () => {
    const grant = resolveModuleGrant([], PROFESSIONAL);
    assert.deepEqual(grant.modules, []);
  });

  it("de-duplicates and normalises requested codes", () => {
    const grant = resolveModuleGrant([" Leave ", "leave", "CLOCKING"], PROFESSIONAL);
    // Ordered by the platform catalogue (leave precedes clocking there), not by input order.
    assert.deepEqual(grant.modules, ["leave", "clocking"]);
    assert.deepEqual(grant.rejected, []);
  });
});

describe("effective module access", () => {
  it("inherits the whole subscription when no grant is stored", () => {
    assert.deepEqual(effectiveUserModules(null, PROFESSIONAL), [
      "employees",
      "leave",
      "clocking",
      "rostering",
    ]);
  });

  it("narrows automatically when the company's subscription is downgraded", () => {
    // The user was granted four modules while on Professional.
    const stored = ["employees", "leave", "clocking", "rostering"];
    // The company drops to a plan with two.
    const afterDowngrade = effectiveUserModules(stored, ["employees", "leave"]);
    assert.deepEqual(afterDowngrade, ["employees", "leave"]);
  });

  it("returns nothing when the company has no modules at all", () => {
    assert.deepEqual(effectiveUserModules(["leave"], []), []);
    assert.deepEqual(effectiveUserModules(null, []), []);
  });
});

describe("access summary", () => {
  it("describes full access", () => {
    assert.equal(summarizeModuleAccess(null, PROFESSIONAL), "All 4 modules");
  });

  it("lists a small explicit grant", () => {
    assert.equal(summarizeModuleAccess(["leave", "clocking"], PROFESSIONAL), "Leave, Clocking");
  });

  it("truncates a large explicit grant", () => {
    const many = ["employees", "leave", "clocking", "rostering", "reports", "documents"];
    assert.equal(
      summarizeModuleAccess(["employees", "leave", "clocking", "reports"], many),
      "Employees, Leave +2 more"
    );
  });

  it("reports no access clearly", () => {
    assert.equal(summarizeModuleAccess([], PROFESSIONAL), "No module access");
    assert.equal(
      summarizeModuleAccess(null, []),
      "No modules enabled for this company"
    );
  });
});
