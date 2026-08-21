/**
 * Seed parity: sql/070 vs lib/road-recovery/*.
 *
 * The service catalogue and the workflow state machines necessarily exist twice — once in
 * TypeScript (where the application reasons about them) and once as seed data in the
 * migration (where the database needs them). Duplication like that normally rots.
 *
 * This suite removes the rot risk by making the duplication a verified invariant: it
 * parses the generated blocks back out of sql/070 and compares them, field by field,
 * against serviceTypeSeedRows() and workflowDefinitionSeedJson(). Change the TypeScript
 * without regenerating the migration and this fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  RR_SERVICE_CODES,
  RR_WORKFLOW_KEYS,
  serviceTypeSeedRows,
} from "@/lib/road-recovery/service-types";
import { workflowDefinitionSeedJson } from "@/lib/road-recovery/state-machine";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = readFileSync(
  path.join(REPO_ROOT, "sql", "070-road-recovery-foundation.sql"),
  "utf8"
);

function generatedBlock(label: string): string {
  const start = `-- >>> GENERATED: ${label} (see header) >>>`;
  const end = `-- <<< GENERATED: ${label} <<<`;
  const a = MIGRATION.indexOf(start);
  const b = MIGRATION.indexOf(end);
  assert.ok(a >= 0, `sql/070 is missing the "${label}" generated block start marker`);
  assert.ok(b > a, `sql/070 is missing the "${label}" generated block end marker`);
  return MIGRATION.slice(a + start.length, b);
}

/** Parses the workflow VALUES rows: ('key', 1, $rr_wf${...}$rr_wf$::jsonb) */
function parseWorkflowSeeds(): Map<string, { version: number; definition: unknown }> {
  const block = generatedBlock("WORKFLOW DEFINITIONS");
  const pattern = /\('([a-z_]+)',\s*(\d+),\s*\$rr_wf\$([\s\S]*?)\$rr_wf\$::jsonb\)/g;
  const found = new Map<string, { version: number; definition: unknown }>();
  for (const match of block.matchAll(pattern)) {
    found.set(match[1], { version: Number(match[2]), definition: JSON.parse(match[3]) });
  }
  return found;
}

/**
 * Parses the service catalogue VALUES rows. Splits on top-level commas so the
 * descriptions (which contain commas and escaped quotes) survive intact.
 */
function parseServiceSeeds(): Array<Record<string, unknown>> {
  const block = generatedBlock("SERVICE CATALOGUE");
  const rows: Array<Record<string, unknown>> = [];

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(")) continue;

    const inner = trimmed.replace(/^\(/, "").replace(/\),?$/, "");
    const fields: string[] = [];
    let current = "";
    let inString = false;

    for (let index = 0; index < inner.length; index += 1) {
      const char = inner[index];
      if (char === "'") {
        // '' inside a string literal is an escaped single quote.
        if (inString && inner[index + 1] === "'") {
          current += "'";
          index += 1;
          continue;
        }
        inString = !inString;
        continue;
      }
      if (char === "," && !inString) {
        fields.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    fields.push(current.trim());

    assert.equal(fields.length, 13, `expected 13 columns, got ${fields.length} in: ${trimmed}`);

    const bool = (value: string) => {
      assert.ok(value === "true" || value === "false", `not a boolean: ${value}`);
      return value === "true";
    };

    rows.push({
      service_code: fields[0],
      name: fields[1],
      description: fields[2],
      workflow_key: fields[3],
      billing_basis: fields[4],
      kpi_set_key: fields[5],
      requires_authorisation: bool(fields[6]),
      requires_destination: bool(fields[7]),
      requires_custody: bool(fields[8]),
      requires_storage: bool(fields[9]),
      can_spawn_recovery_job: bool(fields[10]),
      bills_standing_time: bool(fields[11]),
      sort_order: Number(fields[12]),
    });
  }

  return rows;
}

describe("service catalogue seed parity", () => {
  it("seeds exactly the eight service types the catalogue declares", () => {
    const seeded = parseServiceSeeds();
    assert.equal(seeded.length, 8);
    assert.deepEqual(
      seeded.map((row) => row.service_code).sort(),
      [...RR_SERVICE_CODES].sort()
    );
  });

  it("matches serviceTypeSeedRows() field for field", () => {
    const expected = serviceTypeSeedRows();
    const seeded = parseServiceSeeds();

    assert.equal(seeded.length, expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      assert.deepEqual(
        seeded[index],
        expected[index] as unknown as Record<string, unknown>,
        `sql/070 service row ${index} (${expected[index].service_code}) differs from lib/road-recovery/service-types.ts`
      );
    }
  });

  it("seeds BYSTAND with its own workflow, standing-time billing and own KPI set", () => {
    const bystand = parseServiceSeeds().find((row) => row.service_code === "bystand");
    assert.ok(bystand, "the seed does not include BYSTAND");
    assert.equal(bystand?.workflow_key, "bystand");
    assert.equal(bystand?.billing_basis, "per_hour_standing");
    assert.equal(bystand?.bills_standing_time, true);
    assert.equal(bystand?.kpi_set_key, "bystand");
    assert.equal(bystand?.requires_destination, false);
    assert.equal(bystand?.requires_custody, false);
    assert.equal(bystand?.requires_storage, false);
    assert.equal(bystand?.can_spawn_recovery_job, true);
  });

  it("seeds no other service onto the bystand workflow or KPI set", () => {
    for (const row of parseServiceSeeds()) {
      if (row.service_code === "bystand") continue;
      assert.notEqual(row.workflow_key, "bystand", `${row.service_code} claims the bystand workflow`);
      assert.notEqual(row.kpi_set_key, "bystand", `${row.service_code} claims the bystand KPI set`);
    }
  });
});

describe("workflow definition seed parity", () => {
  it("seeds exactly the six declared workflows", () => {
    const seeded = parseWorkflowSeeds();
    assert.deepEqual([...seeded.keys()].sort(), [...RR_WORKFLOW_KEYS].sort());
  });

  for (const key of RR_WORKFLOW_KEYS) {
    it(`${key}: stored definition matches workflowDefinitionSeedJson() at version 1`, () => {
      // sql/070 seeded VERSION 1 of every workflow. Later phases may publish new versions
      // (Phase 2 adds bystand v2 via sql/072), so this file is pinned to v1 — which is
      // exactly the guarantee that matters: the graph a historical job runs under must
      // never change underneath it.
      const seeded = parseWorkflowSeeds().get(key);
      assert.ok(seeded, `sql/070 does not seed the ${key} workflow`);
      assert.equal(seeded?.version, 1);
      assert.deepEqual(
        seeded?.definition,
        workflowDefinitionSeedJson(key, 1) as unknown,
        `sql/070 ${key} definition differs from version 1 in lib/road-recovery/state-machine.ts`
      );
    });
  }

  it("stores a version on the row that matches the version inside the JSON", () => {
    // rr_workflow_definitions_version_matches enforces this in the database; assert the
    // seed satisfies it so the migration cannot fail on its own data.
    for (const [key, row] of parseWorkflowSeeds()) {
      const definition = row.definition as { version: number; workflow_key: string };
      assert.equal(definition.version, row.version, `${key} version mismatch`);
      assert.equal(definition.workflow_key, key, `${key} workflow_key mismatch`);
    }
  });

  it("satisfies the rr_workflow_definitions_self_consistent constraint", () => {
    for (const [key, row] of parseWorkflowSeeds()) {
      const definition = row.definition as {
        states: unknown[];
        transitions: unknown[];
        initial_state: string;
      };
      assert.ok(Array.isArray(definition.states) && definition.states.length > 0, `${key} states`);
      assert.ok(
        Array.isArray(definition.transitions) && definition.transitions.length > 0,
        `${key} transitions`
      );
      assert.ok(definition.initial_state, `${key} initial_state`);
    }
  });

  it("maps every seeded state to one of the six field_jobs.status values", () => {
    const allowed = new Set([
      "Pending",
      "Dispatched",
      "Travelling",
      "On Site",
      "Completed",
      "Cancelled",
    ]);
    for (const [key, row] of parseWorkflowSeeds()) {
      const states = (row.definition as { states: Array<{ state: string; physical_status: string }> })
        .states;
      for (const entry of states) {
        assert.ok(
          allowed.has(entry.physical_status),
          `${key}/${entry.state} maps to "${entry.physical_status}", which field_jobs.status cannot hold`
        );
      }
    }
  });

  it("seeds the bystand graph with no towing state", () => {
    const bystand = parseWorkflowSeeds().get("bystand");
    assert.ok(bystand);
    const states = new Set(
      (bystand?.definition as { states: Array<{ state: string }> }).states.map(
        (entry) => entry.state
      )
    );
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
      assert.ok(!states.has(towOnly), `the seeded bystand graph contains towing state "${towOnly}"`);
    }
    assert.ok(states.has("standing_by"));
  });

  it("seeds the bystand standing clock on exactly one state, and only for bystand", () => {
    for (const [key, row] of parseWorkflowSeeds()) {
      const states = (
        row.definition as { states: Array<{ state: string; billable_standing_clock: boolean }> }
      ).states;
      const standing = states.filter((entry) => entry.billable_standing_clock);
      if (key === "bystand") {
        assert.equal(standing.length, 1);
        assert.equal(standing[0].state, "standing_by");
      } else {
        assert.equal(standing.length, 0, `${key} seeds a billable standing clock`);
      }
    }
  });

  it("seeds convert_to_recovery as a spawn, not a change of workflow", () => {
    const bystand = parseWorkflowSeeds().get("bystand");
    const transitions = (
      bystand?.definition as {
        transitions: Array<{ code: string; from: string; to: string; spawns_linked_job: boolean }>;
      }
    ).transitions;
    const conversion = transitions.find((entry) => entry.code === "convert_to_recovery");
    assert.ok(conversion, "the seeded bystand graph cannot convert to a recovery");
    assert.equal(conversion?.from, "standing_by");
    assert.equal(conversion?.spawns_linked_job, true);
  });

  it("contains no tow_subtype anywhere in the seeded data", () => {
    for (const [key, row] of parseWorkflowSeeds()) {
      assert.ok(
        !/tow_subtype/i.test(JSON.stringify(row.definition)),
        `the seeded ${key} graph references a tow subtype`
      );
    }
  });
});
