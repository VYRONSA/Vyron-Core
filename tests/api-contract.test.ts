/**
 * Structural invariants of the user-management HTTP surface.
 *
 * These read the route sources rather than issuing requests: the properties being
 * asserted are architectural ("no handler may take a company id from the request body",
 * "every handler must pass through the gate"), and a structural check catches a
 * regression in a NEW endpoint that a request-level test of the existing ones never
 * would.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectRoutes(relativeDir: string): string[] {
  const absolute = path.join(root, relativeDir);
  const found: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") found.push(full);
    }
  }

  walk(absolute);
  return found;
}

const CUSTOMER_ROUTES = collectRoutes("app/api/company/users");
const PLATFORM_USER_ROUTES = collectRoutes("app/api/platform/customers");

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function handlerCount(source: string): number {
  return (source.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) || []).length;
}

describe("customer user-management endpoints", () => {
  it("exposes the full lifecycle", () => {
    const relative = CUSTOMER_ROUTES.map((file) =>
      path.relative(root, file).replaceAll("\\", "/")
    );
    for (const expected of [
      "app/api/company/users/route.ts",
      "app/api/company/users/[userId]/route.ts",
      "app/api/company/users/[userId]/password/route.ts",
      "app/api/company/users/[userId]/status/route.ts",
      "app/api/company/users/[userId]/invite/route.ts",
    ]) {
      assert.ok(relative.includes(expected), `missing endpoint: ${expected}`);
    }
  });

  it("authenticates every handler through the shared tenant gate", () => {
    for (const file of CUSTOMER_ROUTES) {
      const source = read(file);
      const handlers = handlerCount(source);
      const gates = (source.match(/requireCompanyUserContext\(request\)/g) || []).length;
      assert.equal(
        gates,
        handlers,
        `${path.relative(root, file)} has ${handlers} handler(s) but ${gates} auth gate(s)`
      );
      assert.ok(
        source.includes("if (!gate.ok) return gate.response;"),
        `${path.relative(root, file)} does not return the gate's rejection`
      );
    }
  });

  it("never reads a company id from the request body or query string", () => {
    // The exact attack in the brief: POST {"companyId": "<another tenant>"}.
    const forbidden = [
      /body\.companyId/,
      /body\["companyId"\]/,
      /searchParams\.get\(\s*["']companyId["']\s*\)/,
      /companyId:\s*String\(/,
    ];

    for (const file of [...CUSTOMER_ROUTES, path.join(root, "lib/tenant/api-auth.ts")]) {
      const source = read(file);
      for (const pattern of forbidden) {
        assert.equal(
          pattern.test(source),
          false,
          `${path.relative(root, file)} reads a client-supplied company id (${pattern})`
        );
      }
    }
  });

  it("derives the tenant boundary from the authenticated identity", () => {
    const gate = read(path.join(root, "lib/tenant/api-auth.ts"));
    assert.ok(gate.includes("authenticateApiRequest(request)"));
    assert.ok(gate.includes('.ilike("user_email", email)'));
    assert.ok(gate.includes('.eq("status", "active")'));
    // The customer surface must never be able to act as a platform operator.
    assert.ok(/platformOperator:\s*false/.test(gate));
  });

  it("runs on the Node runtime so the service-role key is available server-side only", () => {
    for (const file of CUSTOMER_ROUTES) {
      assert.ok(
        read(file).includes('export const runtime = "nodejs";'),
        `${path.relative(root, file)} must pin the Node runtime`
      );
    }
  });
});

describe("platform customer user endpoints", () => {
  const userRoutes = PLATFORM_USER_ROUTES.filter((file) =>
    path.relative(root, file).replaceAll("\\", "/").includes("/users")
  );

  it("exists for the console user-management view", () => {
    assert.ok(userRoutes.length >= 4, "expected the console user endpoints to be present");
  });

  it("gates every handler behind requirePlatformOperator", () => {
    for (const file of userRoutes) {
      const source = read(file);
      const handlers = handlerCount(source);
      const gates = (source.match(/requirePlatformOperator\(request\)/g) || []).length;
      assert.equal(
        gates,
        handlers,
        `${path.relative(root, file)} has ${handlers} handler(s) but ${gates} operator gate(s)`
      );
    }
  });
});

describe("service-role key containment", () => {
  it("is never referenced from a client component", () => {
    const clientFiles = [
      "components/settings/UsersAccessPanel.tsx",
      "components/platform/CreateCustomerWizard.tsx",
      "app/(app)/settings/users/page.tsx",
    ];

    for (const relative of clientFiles) {
      const source = read(path.join(root, relative));
      assert.equal(
        source.includes("SUPABASE_SERVICE_ROLE_KEY"),
        false,
        `${relative} must not reference the service-role key`
      );
      assert.equal(
        source.includes("getSupabaseAdminClient"),
        false,
        `${relative} must not construct an admin client`
      );
    }
  });

  it("keeps the password generator out of any browser bundle", () => {
    // node:crypto lives in password-generator.ts; the policy module the forms import
    // must stay free of Node built-ins.
    const policy = read(path.join(root, "lib/tenant/password-policy.ts"));
    assert.equal(policy.includes("node:crypto"), false);

    const generator = read(path.join(root, "lib/tenant/password-generator.ts"));
    assert.ok(generator.includes("node:crypto"));

    const panel = read(path.join(root, "components/settings/UsersAccessPanel.tsx"));
    assert.equal(panel.includes("password-generator"), false);
    assert.equal(panel.includes("user-management-store"), false);
  });
});

describe("audit coverage", () => {
  it("declares an audit action for every privileged user-management operation", () => {
    const auditLog = read(path.join(root, "lib/audit-log.ts"));
    for (const action of [
      "user_created",
      "user_invited",
      "user_updated",
      "user_role_changed",
      "user_module_access_changed",
      "user_permissions_changed",
      "user_password_reset",
      "user_activated",
      "user_deactivated",
      "user_deleted",
      "user_restored",
    ]) {
      assert.ok(auditLog.includes(`"${action}"`), `AUDIT_ACTIONS is missing ${action}`);
    }
  });

  it("routes every audit payload through redaction", () => {
    const service = read(path.join(root, "lib/tenant/user-management.ts"));
    // One helper writes audits, and it redacts. Nothing calls store.writeAudit directly.
    assert.ok(service.includes("metadata: redactSecrets(entry.metadata)"));
    assert.equal(
      /store\.writeAudit\(/.test(service.replace("await store.writeAudit({ ...entry,", "")),
      false,
      "audits must only be written through the redacting helper"
    );
  });
});
