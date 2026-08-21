/**
 * BYSTAND Phase 2: workflow v2, generic workflow-awareness, and migration security.
 *
 * Protects three things:
 *   1. v1 is FROZEN — a historical job's graph never changes underneath it
 *   2. v2 lets a PAUSED crew stand down or convert without resuming billable time
 *   3. the service layer resolves states by ROLE, so no service-specific hacks exist
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  activeWorkflowVersion,
  applyTransition,
  assertBystandStateMachineIndependence,
  assertNoTowSubtypeInWorkflows,
  canTransition,
  getWorkflowDefinition,
  nextStates,
  RR_STATE_ROLES,
  RR_WORKFLOW_VERSIONS,
  rolesForWorkflow,
  stateForRole,
  validateAllWorkflowDefinitions,
  workflowDefinitionSeedJson,
} from "@/lib/road-recovery/state-machine";
import { RR_WORKFLOW_KEYS } from "@/lib/road-recovery/service-types";
import { requirementForService } from "@/lib/road-recovery/dispatch";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = readFileSync(
  path.join(REPO_ROOT, "sql", "072-road-recovery-bystand.sql"),
  "utf8"
);
const MIGRATION_SQL = MIGRATION.split("\n")
  .map((line) => (line.includes("$rr_wf2$") ? line : line.replace(/--.*$/, "")))
  .join("\n");
const HARDENING = readFileSync(
  path.join(REPO_ROOT, "sql", "049-release-candidate-security-hardening.sql"),
  "utf8"
);
const JOB_SERVICE = readFileSync(
  path.join(REPO_ROOT, "lib", "road-recovery", "job-service.ts"),
  "utf8"
);

const PHASE2_TABLES = ["rr_bystand_reason_codes", "rr_bystand_details", "rr_standby_summary"] as const;

function createTableBody(table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = MIGRATION.indexOf(marker);
  assert.ok(start >= 0, `sql/072 does not create public.${table}`);
  let depth = 0;
  let index = start + marker.length - 1;
  for (; index < MIGRATION.length; index += 1) {
    const char = MIGRATION[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return MIGRATION.slice(start + marker.length, index);
}

describe("workflow versioning", () => {
  it("all published versions validate", () => {
    validateAllWorkflowDefinitions();
  });

  it("BYSTAND publishes v1 and v2; v2 is active", () => {
    assert.deepEqual(
      RR_WORKFLOW_VERSIONS.bystand.map((entry) => entry.version),
      [1, 2]
    );
    assert.equal(activeWorkflowVersion("bystand"), 2);
  });

  it("every other workflow stays at v1", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      if (key === "bystand") continue;
      assert.equal(activeWorkflowVersion(key), 1, `${key} unexpectedly changed version`);
    }
  });

  it("v1 is FROZEN — it does not gain v2's transitions", () => {
    const v1 = getWorkflowDefinition("bystand", 1);
    assert.ok(v1);
    const codes = (v1?.transitions || []).map((entry) => entry.code);
    for (const added of [
      "request_stand_down_from_authority_hold",
      "request_stand_down_from_weather_hold",
      "convert_to_recovery_from_authority_hold",
      "convert_to_recovery_from_weather_hold",
    ]) {
      assert.ok(!codes.includes(added), `v1 must not contain ${added}`);
    }
    assert.equal(v1?.transitions.length, 29);
  });

  it("v2 adds exactly the four approved transitions", () => {
    const v2 = getWorkflowDefinition("bystand", 2);
    assert.equal(v2?.transitions.length, 33);
  });

  it("a v1 job cannot use a v2 transition", () => {
    const check = canTransition(
      "bystand",
      "weather_hold",
      "stand_down_requested",
      {},
      { workflowVersion: 1 }
    );
    assert.equal(check.allowed, false);
    assert.equal(check.allowed === false && check.reason, "no_such_transition");
  });

  it("a v2 job CAN stand down straight from a paused state", () => {
    for (const paused of ["scene_handover_to_authority", "weather_hold"]) {
      const check = canTransition(
        "bystand",
        paused,
        "stand_down_requested",
        {},
        { workflowVersion: 2 }
      );
      assert.equal(check.allowed, true, `${paused} should reach stand_down_requested in v2`);
    }
  });

  it("a v2 job CAN convert straight from a paused state, and it still spawns", () => {
    for (const paused of ["scene_handover_to_authority", "weather_hold"]) {
      const result = applyTransition({
        workflowKey: "bystand",
        workflowVersion: 2,
        fromState: paused,
        toState: "converted_to_recovery",
        occurredAt: "2026-08-18T06:00:00.000Z",
        reason: "Vehicle cannot be driven away",
      });
      assert.ok(result.ok, `${paused} should convert in v2`);
      assert.equal(result.ok && result.event.spawnsLinkedJob, true);
    }
  });

  it("standing straight from a pause is NOT billable — the clock stays stopped", () => {
    const result = applyTransition({
      workflowKey: "bystand",
      workflowVersion: 2,
      fromState: "weather_hold",
      toState: "stand_down_requested",
      occurredAt: "2026-08-18T06:00:00.000Z",
    });
    assert.ok(result.ok);
    // Leaving a PAUSED state does not re-open the billable clock, so nothing is billed
    // for the act of standing down.
    assert.equal(result.ok && result.event.entersBillableStandingClock, false);
    assert.equal(result.ok && result.event.leavesBillableStandingClock, false);
  });

  it("v2 keeps exactly one billable standing state", () => {
    const v2 = getWorkflowDefinition("bystand", 2);
    const standing = (v2?.states || []).filter((entry) => entry.billableStandingClock === true);
    assert.equal(standing.length, 1);
    assert.equal(standing[0].state, "standing_by");
  });

  it("preserves the BYSTAND structural invariants at v2", () => {
    assertBystandStateMachineIndependence();
    assertNoTowSubtypeInWorkflows();
  });

  it("v2 declares no towing or custody state", () => {
    const v2 = getWorkflowDefinition("bystand", 2);
    const states = new Set((v2?.states || []).map((entry) => entry.state));
    for (const towOnly of [
      "loading",
      "secured",
      "in_transit",
      "arrived_destination",
      "offloading",
      "storage_in",
      "handover_pending",
      "handed_over",
    ]) {
      assert.ok(!states.has(towOnly), `v2 must not declare ${towOnly}`);
    }
  });
});

describe("generic workflow awareness (no service-specific hacks)", () => {
  it("every dispatched workflow declares the roles the service layer needs", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      if (key === "storage") continue; // storage is a custodial sub-workflow, not dispatched
      const roles = rolesForWorkflow(key);
      for (const role of ["offer", "accept", "travel", "arrival", "dispatch_pool"] as const) {
        assert.ok(roles[role], `${key} does not declare a state for the "${role}" role`);
      }
    }
  });

  it("resolves each workflow's own arrival state", () => {
    assert.equal(stateForRole("tow_recovery", "arrival"), "on_scene");
    assert.equal(stateForRole("heavy_recovery", "arrival"), "on_scene");
    assert.equal(stateForRole("roadside_assist", "arrival"), "on_scene");
    // The Phase 1 bug: BYSTAND arrives somewhere else entirely.
    assert.equal(stateForRole("bystand", "arrival"), "arrived_on_scene");
    assert.equal(stateForRole("vehicle_movement", "arrival"), "at_collection");
  });

  it("resolves each workflow's own dispatch pool", () => {
    assert.equal(stateForRole("tow_recovery", "dispatch_pool"), "dispatch_pending");
    // The other Phase 1 bug: BYSTAND has no dispatch_pending at all.
    assert.equal(stateForRole("bystand", "dispatch_pool"), "authorised");
    assert.equal(stateForRole("vehicle_movement", "dispatch_pool"), "collection_scheduled");
  });

  it("only BYSTAND declares a standing role", () => {
    assert.equal(stateForRole("bystand", "standing"), "standing_by");
    for (const key of RR_WORKFLOW_KEYS) {
      if (key === "bystand") continue;
      assert.equal(stateForRole(key, "standing"), null, `${key} must not declare standing`);
    }
  });

  it("assigns at most one state per role per workflow", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      for (const role of RR_STATE_ROLES) {
        const matches = (getWorkflowDefinition(key)?.states || []).filter((entry) =>
          (entry.roles ?? []).includes(role)
        );
        assert.ok(matches.length <= 1, `${key} declares ${matches.length} states for ${role}`);
      }
    }
  });

  it("the service layer contains NO hardcoded workflow state targets", () => {
    const hardcoded = JOB_SERVICE.match(/toState: "[a-z_]+"/g) || [];
    assert.deepEqual(hardcoded, [], `job-service.ts still hardcodes: ${hardcoded.join(", ")}`);
  });

  it("the service layer contains no service-specific branching", () => {
    assert.ok(
      !/serviceCode\s*===\s*["']bystand["']/.test(JOB_SERVICE),
      "job-service.ts must not branch on a service code"
    );
    assert.ok(
      !/workflowKey\s*===\s*["']bystand["']/.test(JOB_SERVICE),
      "job-service.ts must not branch on the bystand workflow key"
    );
  });

  it("BYSTAND has an explicit dispatch requirement and needs no tow class", () => {
    const requirement = requirementForService("bystand");
    assert.deepEqual(requirement.permittedTowClasses, []);
    assert.deepEqual(requirement.requiredCertifications, ["drivers_licence", "prdp"]);
    assert.equal(requirement.requiresWinch, false);
    assert.equal(requirement.requiresBoom, false);
  });
});

describe("Phase 2 migration — security", () => {
  it("creates exactly the three Phase 2 tables", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(created.sort(), [...PHASE2_TABLES].sort());
  });

  for (const table of PHASE2_TABLES) {
    it(`${table}: company_id is uuid NOT NULL referencing companies`, () => {
      const body = createTableBody(table);
      const match = body.match(/company_id\s+([^,\n]+)/);
      assert.ok(match);
      assert.match(match[1], /^uuid\b/);
      assert.match(match[1], /NOT NULL/);
      assert.match(match[1], /REFERENCES public\.companies \(id\)/);
    });

    it(`${table}: RLS enabled and anon revoked`, () => {
      assert.ok(MIGRATION.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`));
      assert.ok(MIGRATION.includes(`REVOKE ALL ON public.${table} FROM anon`));
    });
  }

  it("uses the sql/030 helpers and no permissive policy", () => {
    assert.match(MIGRATION, /public\.vyron_is_platform_operator\(\)/);
    assert.match(MIGRATION, /public\.vyron_user_company_ids\(\)/);
    assert.ok(!/USING\s*\(\s*true\s*\)/i.test(MIGRATION_SQL));
  });

  it("pins cross-tenant relationships with composite foreign keys", () => {
    assert.match(createTableBody("rr_bystand_details"), /FOREIGN KEY \(company_id, service_job_id\)/);
    assert.match(createTableBody("rr_bystand_details"), /FOREIGN KEY \(company_id, reason_code_id\)/);
    assert.match(
      createTableBody("rr_bystand_details"),
      /FOREIGN KEY \(company_id, converted_service_job_id\)/
    );
    assert.match(createTableBody("rr_standby_summary"), /FOREIGN KEY \(company_id, service_job_id\)/);
  });

  it("makes the sealed summary append-only in grants AND trigger", () => {
    assert.match(MIGRATION, /GRANT SELECT, INSERT ON public\.rr_standby_summary TO authenticated/);
    assert.match(
      MIGRATION,
      /REVOKE UPDATE, DELETE, TRUNCATE ON public\.rr_standby_summary FROM authenticated/
    );
    assert.match(MIGRATION, /CREATE TRIGGER rr_standby_summary_append_only/);
    assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON public\.rr_standby_summary/);
  });

  it("is protected from the sql/049 generic grant", () => {
    assert.match(HARDENING, /'rr_standby_summary'/);
  });

  it("a conversion link cannot point at itself", () => {
    assert.match(createTableBody("rr_bystand_details"), /rr_bystand_details_not_self/);
  });
});

describe("Phase 2 migration — reuse, not duplication", () => {
  it("creates no second evidence, GPS, employee, vehicle or job system", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    for (const forbidden of [
      "rr_evidence_items",
      "rr_bystand_evidence",
      "rr_standby_presence_pings",
      "rr_bystand_jobs",
      "rr_bystand_drivers",
      "rr_bystand_events",
    ]) {
      assert.ok(!created.includes(forbidden), `sql/072 duplicates an existing system: ${forbidden}`);
    }
  });

  it("extends the EXISTING evidence table rather than creating another", () => {
    assert.match(MIGRATION, /ALTER TABLE public\.mobile_workforce_evidence/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS storage_bucket text/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS storage_path text/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS service_job_id uuid/);
  });

  it("WIDENS the evidence type list and keeps every original value", () => {
    for (const original of [
      "clock_in",
      "clock_out",
      "arrive_site",
      "complete_job",
      "incident",
      "other",
    ]) {
      assert.ok(
        MIGRATION.includes(`'${original}'`),
        `the widened CHECK dropped the existing type ${original}`
      );
    }
    for (const added of [
      "bystand_scene",
      "bystand_periodic",
      "bystand_stand_down",
      "bystand_report_attachment",
    ]) {
      assert.ok(MIGRATION.includes(`'${added}'`), `the CHECK is missing ${added}`);
    }
  });

  it("does not modify field_jobs, field_job_events or field_job_assignments", () => {
    assert.ok(!/ALTER TABLE public\.field_jobs/i.test(MIGRATION_SQL));
    assert.ok(!/ALTER TABLE public\.field_job_events/i.test(MIGRATION_SQL));
    assert.ok(!/ALTER TABLE public\.field_job_assignments/i.test(MIGRATION_SQL));
    assert.ok(!/field_jobs_status_check/i.test(MIGRATION_SQL));
  });

  it("derives standing time from the EXISTING state event stream", () => {
    // No new event table: the timer reads rr_service_state_events, which Phase 0 already
    // stamps with the standing-clock flags.
    assert.match(MIGRATION, /rr_service_state_events/);
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.ok(!created.some((name) => name.includes("standby_event")));
  });
});

describe("Phase 2 migration — workflow v2 publication", () => {
  it("seeds v2 matching the TypeScript definition exactly", () => {
    const match = MIGRATION.match(/\$rr_wf2\$([\s\S]*?)\$rr_wf2\$/);
    assert.ok(match, "sql/072 does not contain the v2 definition block");
    const seeded = JSON.parse(match[1]);
    assert.deepEqual(seeded, workflowDefinitionSeedJson("bystand", 2) as unknown);
  });

  it("de-activates v1 rather than deleting or editing it", () => {
    assert.match(MIGRATION, /UPDATE public\.rr_workflow_definitions\s+SET active = false/);
    assert.ok(!/DELETE FROM public\.rr_workflow_definitions/i.test(MIGRATION_SQL));
  });

  it("is idempotent — a second run does not republish v2", () => {
    assert.match(MIGRATION, /AND version = 2\s*\)\s*THEN\s*RETURN;/);
  });

  it("seeds configurable reasons rather than a CHECK constraint", () => {
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS public\.rr_bystand_reason_codes/);
    for (const seeded of [
      "customer_safety",
      "accident_scene",
      "waiting_for_recovery",
      "waiting_for_police",
      "waiting_for_medical",
      "vulnerable_person",
      "security_concern",
      "other",
    ]) {
      assert.ok(MIGRATION.includes(`'${seeded}'`), `reason ${seeded} is not seeded`);
    }
    // The reason must NOT be constrained to that list.
    assert.ok(
      !/reason_code IN \(/.test(MIGRATION_SQL),
      "reasons must be extensible data, never a CHECK list"
    );
  });
});

describe("Phase 2 migration — storage bucket", () => {
  it("creates a private rr-evidence bucket", () => {
    assert.match(MIGRATION, /INSERT INTO storage\.buckets/);
    assert.match(MIGRATION, /'rr-evidence'/);
    assert.match(MIGRATION, /public = false/);
  });

  it("scopes storage access by the tenant path prefix", () => {
    assert.match(MIGRATION, /rr_evidence_tenant_select/);
    assert.match(MIGRATION, /rr_evidence_tenant_insert/);
    assert.match(MIGRATION, /split_part\(storage\.objects\.name, '\/', 1\)/);
    assert.match(MIGRATION, /public\.vyron_user_company_ids\(\)/);
  });

  it("does not let ordinary users mutate or delete evidence", () => {
    const updatePolicy = MIGRATION.slice(MIGRATION.indexOf("rr_evidence_tenant_update"));
    assert.match(updatePolicy, /public\.vyron_is_platform_operator\(\)/);
    const deletePolicy = MIGRATION.slice(MIGRATION.indexOf("rr_evidence_tenant_delete"));
    assert.match(deletePolicy, /public\.vyron_is_platform_operator\(\)/);
  });
});

describe("Phase 2 migration — idempotency", () => {
  it("guards every create", () => {
    const creates = [...MIGRATION.matchAll(/^\s*CREATE (TABLE|INDEX|UNIQUE INDEX)([^\n]*)/gim)];
    assert.ok(creates.length > 0);
    for (const [, kind, rest] of creates) {
      assert.match(rest, /IF NOT EXISTS/, `unguarded CREATE ${kind}: ${rest.trim()}`);
    }
  });

  it("adds columns and constraints conditionally", () => {
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS/);
    assert.match(MIGRATION, /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = '\w+'\s*\)/);
  });

  it("is transactional and reloads the API schema", () => {
    assert.match(MIGRATION, /^BEGIN;$/m);
    assert.match(MIGRATION, /^COMMIT;$/m);
    assert.match(MIGRATION, /NOTIFY pgrst, 'reload schema'/);
  });

  it("declares its prerequisites", () => {
    assert.match(MIGRATION, /Prerequisite missing: public\.rr_service_jobs/);
    assert.match(MIGRATION, /Prerequisite missing: public\.rr_dispatch_assignments/);
    assert.match(MIGRATION, /Prerequisite missing: public\.mobile_workforce_evidence/);
  });

  it("has balanced dollar-quoted blocks", () => {
    const tags = [...MIGRATION.matchAll(/\$([a-z_0-9]+)\$/g)].map((match) => match[1]);
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const [tag, count] of counts) {
      assert.equal(count % 2, 0, `unbalanced $${tag}$ (${count})`);
    }
  });
});

describe("BYSTAND remains structurally not a tow", () => {
  it("never gains a destination in any version", () => {
    for (const definition of RR_WORKFLOW_VERSIONS.bystand) {
      const serialised = JSON.stringify(definition);
      assert.ok(!/destination/i.test(serialised), `v${definition.version} mentions a destination`);
      assert.ok(!/custody/i.test(serialised), `v${definition.version} mentions custody`);
    }
  });

  it("conversion still spawns a separate job in v2, and never re-labels this one", () => {
    const v2 = getWorkflowDefinition("bystand", 2);
    const conversions = (v2?.transitions || []).filter((entry) => entry.to === "converted_to_recovery");
    assert.equal(conversions.length, 3, "standing_by + two paused states");
    for (const conversion of conversions) {
      assert.equal(conversion.spawnsLinkedJob, true, `${conversion.code} must spawn`);
      assert.equal(conversion.requiresReason, true, `${conversion.code} must require a reason`);
    }
  });

  it("a converted attendance still reaches its own stand-down and close", () => {
    assert.ok(nextStates("bystand", "converted_to_recovery", 2).includes("stand_down_requested"));
  });
});
