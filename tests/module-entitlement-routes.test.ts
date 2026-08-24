import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requiredModuleForRoute } from "@/lib/server/auth-routing";
import {
  hasModuleEntitlement,
  resolveEffectiveModules,
} from "@/lib/server/module-entitlement";

/**
 * Server-side module entitlement for module-gated route families.
 *
 * These cases are the enforcement decision itself. They matter because production holds
 * only two accounts — one entitled tenant and one platform operator — so the DENY path
 * cannot be demonstrated end-to-end in a browser without manufacturing a user. The rule
 * is proved here instead, against the same helper middleware.ts and the Road & Recovery
 * API handler both call.
 */

type StubRow = { data: unknown; error: unknown };

/**
 * Minimal PostgREST double.
 *
 * Records the filters applied so the tests can assert the query is scoped to one company
 * and one identity, not just that the boolean came out right.
 */
function stubSupabase(rows: { companies?: StubRow; company_users?: StubRow }) {
  const calls: { table: string; filters: string[] }[] = [];

  return {
    calls,
    client: {
      from(table: string) {
        const filters: string[] = [];
        calls.push({ table, filters });
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters.push(`${column}=${String(value)}`);
            return builder;
          },
          is: (column: string, value: unknown) => {
            filters.push(`${column} is ${String(value)}`);
            return builder;
          },
          or: (expression: string) => {
            filters.push(`or(${expression})`);
            return builder;
          },
          limit: () => builder,
          maybeSingle: async () =>
            (rows as Record<string, StubRow | undefined>)[table] ?? { data: null, error: null },
        };
        return builder;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const SUBJECT = {
  userId: "11111111-2222-3333-4444-555555555555",
  email: "operator@example.test",
  companyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

describe("module-gated route registry", () => {
  it("requires road_recovery for the Road & Recovery family", () => {
    assert.equal(requiredModuleForRoute("/road-recovery"), "road_recovery");
    assert.equal(requiredModuleForRoute("/road-recovery/dispatch"), "road_recovery");
    assert.equal(requiredModuleForRoute("/road-recovery/driver"), "road_recovery");
  });

  it("leaves every other route ungated", () => {
    assert.equal(requiredModuleForRoute("/dashboard"), null);
    assert.equal(requiredModuleForRoute("/platform"), null);
    assert.equal(requiredModuleForRoute("/leave"), null);
  });

  it("does not gate a route that merely starts with the same characters", () => {
    assert.equal(requiredModuleForRoute("/road-recovery-marketing"), null);
  });
});

describe("effective module entitlement", () => {
  it("grants the module when the company holds it and the user inherits", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: ["road_recovery"] }, error: null },
      company_users: { data: { module_access: null }, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), true);
  });

  it("denies the module when the company's entitlement is empty", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: [] }, error: null },
      company_users: { data: { module_access: null }, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), false);
  });

  it("denies the module when the company holds it but the user's grant excludes it", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: ["road_recovery", "leave"] }, error: null },
      company_users: { data: { module_access: ["leave"] }, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), false);
  });

  it("cannot be widened by a per-user grant beyond the subscription", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: [] }, error: null },
      company_users: { data: { module_access: ["road_recovery"] }, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), false);
  });

  it("denies when the caller has no company to be entitled by", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: ["road_recovery"] }, error: null },
    });
    assert.equal(
      await hasModuleEntitlement(client, { ...SUBJECT, companyId: null }, "road_recovery"),
      false
    );
  });

  it("fails closed when the company row cannot be read", async () => {
    const { client } = stubSupabase({
      companies: { data: null, error: { message: "permission denied" } },
      company_users: { data: { module_access: null }, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), false);
  });

  it("falls back to the company entitlement when no membership row is readable", async () => {
    const { client } = stubSupabase({
      companies: { data: { enabled_modules: ["road_recovery"] }, error: null },
      company_users: { data: null, error: null },
    });
    assert.equal(await hasModuleEntitlement(client, SUBJECT, "road_recovery"), true);
  });

  it("scopes both reads to the caller's company and identity", async () => {
    const { client, calls } = stubSupabase({
      companies: { data: { enabled_modules: ["road_recovery"] }, error: null },
      company_users: { data: { module_access: null }, error: null },
    });
    await resolveEffectiveModules(client, SUBJECT);

    const companies = calls.find((call) => call.table === "companies");
    const members = calls.find((call) => call.table === "company_users");

    assert.ok(companies?.filters.includes(`id=${SUBJECT.companyId}`));
    assert.ok(members?.filters.includes(`company_id=${SUBJECT.companyId}`));
    assert.ok(members?.filters.includes("status=active"));
    assert.ok(
      members?.filters.some(
        (filter) => filter.includes(SUBJECT.userId) && filter.includes(SUBJECT.email)
      )
    );
  });
});
