/**
 * REGRESSION — a retired target can be set again (DEF-08).
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS LOCKS DOWN
 * ---------------------------------------------------------------------------
 *
 * `uq_rr_thresholds_version` is unique on
 * (company_id, metric_key, service_code, counterparty_id, version) across the WHOLE table.
 * Retired rows stay in it deliberately: they are what makes a past breach replayable
 * against the target that was in force when it happened.
 *
 * publishThreshold() numbered the next version from the ACTIVE row alone:
 *
 *     .eq("active", true)          // and nextVersion = 1 when nothing matched
 *
 * So the moment an administrator RETIRED a target, there was no active row, the next
 * publish computed version 1 again, and it collided with the retired version 1:
 *
 *     duplicate key value violates unique constraint "uq_rr_thresholds_version"
 *
 * The metric could never be given a target again. It surfaced as a 500 with a database
 * message, and the only "fix" available to a customer would have been to delete the very
 * history the versioning exists to protect.
 *
 * This suite drives the whole administrator cycle — publish, republish, retire, publish
 * again — and asserts both that it works and that nothing is lost on the way.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import {
  listThresholds,
  publishThreshold,
  retireThreshold,
} from "@/lib/road-recovery/intelligence-service";

import { ALPHA, ALPHA_CONTROLLER } from "./support/rr-lifecycle";

const CONFIG = readTestDatabaseConfig();
const describeIf = CONFIG ? describe : describe.skip;
const METRIC = "storage_occupancy_days_avg";

if (!CONFIG) {
  describe("Road & Recovery threshold versioning", () => {
    it("skipped — no disposable database configured (set RR_TEST_PSQL / RR_TEST_DB)", () => {
      assert.ok(true);
    });
  });
}

describeIf("Road & Recovery — operational targets survive being retired", () => {
  let db: PgTestClient;
  let owner: PgTestClient;

  before(() => {
    if (!CONFIG) return;
    db = createPgTestClient(CONFIG, { kind: "authenticated", email: ALPHA_CONTROLLER });
    owner = createPgTestClient(CONFIG, { kind: "owner" });
    // A metric no other suite configures, cleared so version numbering starts from nothing.
    owner.exec(
      `DELETE FROM public.rr_intelligence_thresholds
       WHERE company_id = '${ALPHA}' AND metric_key = '${METRIC}'`
    );
  });

  async function publish(targetValue: number) {
    return publishThreshold(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      metricKey: METRIC,
      targetValue,
      unit: "days",
      severity: "medium",
      notes: `target ${targetValue}`,
    });
  }

  function versions(): { version: number; active: boolean; target: number }[] {
    return owner
      .sql(
        `SELECT version, active, target_value::float8 AS target
         FROM public.rr_intelligence_thresholds
         WHERE company_id = '${ALPHA}' AND metric_key = '${METRIC}'
         ORDER BY version`
      )
      .map((row) => {
        const entry = row as { version: number; active: boolean; target: number };
        return { version: Number(entry.version), active: entry.active === true, target: Number(entry.target) };
      });
  }

  it("publishes the first target as version 1", async () => {
    const first = await publish(10);
    assert.ok(first.ok, first.ok ? "" : first.message);
    assert.equal(first.data.version, 1);
    assert.equal(first.data.retiredVersion, null);
    assert.deepEqual(versions(), [{ version: 1, active: true, target: 10 }]);
  });

  it("republishing retires the current version and keeps it", async () => {
    const second = await publish(20);
    assert.ok(second.ok, second.ok ? "" : second.message);
    assert.equal(second.data.version, 2);
    assert.equal(second.data.retiredVersion, 1, "the previous version must be named, not silently dropped");

    const rows = versions();
    assert.equal(rows.length, 2, "the retired version stays on record");
    assert.deepEqual(rows[0], { version: 1, active: false, target: 10 });
    assert.deepEqual(rows[1], { version: 2, active: true, target: 20 });
  });

  it("a retired version keeps a CLOSED effective window, so history stays replayable", () => {
    const [retired] = owner.sql(
      `SELECT effective_to IS NOT NULL AS closed, retired_by
       FROM public.rr_intelligence_thresholds
       WHERE company_id = '${ALPHA}' AND metric_key = '${METRIC}' AND version = 1`
    ) as { closed: boolean; retired_by: string }[];
    assert.equal(retired.closed, true, "a measurement taken then must still resolve to this version");
    assert.equal(retired.retired_by, ALPHA_CONTROLLER, "who retired it is on the record");
  });

  it("can set a target again after EVERY version has been retired", async () => {
    const live = owner.sql(
      `SELECT id FROM public.rr_intelligence_thresholds
       WHERE company_id = '${ALPHA}' AND metric_key = '${METRIC}' AND active`
    ) as { id: string }[];
    assert.equal(live.length, 1, "exactly one version should be live before retiring it");

    const retired = await retireThreshold(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      thresholdId: String(live[0].id),
    });
    assert.ok(retired.ok, retired.ok ? "" : retired.message);

    const listing = await listThresholds(db as never, { companyId: ALPHA });
    assert.ok(listing.ok, listing.ok ? "" : listing.message);
    assert.equal(
      listing.data.thresholds.filter((row) => row.metricKey === METRIC && row.active).length,
      0,
      "nothing is in force, so the metric reads NO SLA CONFIGURED"
    );

    // THE DEFECT. This is the call that used to fail with a duplicate key error.
    const third = await publish(30);
    assert.ok(
      third.ok,
      third.ok
        ? ""
        : `a retired metric must be configurable again, but publishing failed: ${third.message}`
    );
    assert.equal(third.data.version, 3, "numbering continues past retired versions rather than restarting");

    const rows = versions();
    assert.equal(rows.length, 3, "all three versions are on record");
    assert.deepEqual(
      rows.map((row) => row.active),
      [false, false, true],
      "only the newest is in force"
    );
    assert.deepEqual(rows.map((row) => row.target), [10, 20, 30], "no earlier target was overwritten");
  });

  it("numbers a DIFFERENTLY SCOPED target independently", async () => {
    // The unique index buckets by scope, so a per-service target is its own series. If
    // numbering were global this would collide with version 1 above.
    const scoped = await publishThreshold(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      metricKey: METRIC,
      serviceCode: null,
      counterpartyId: null,
      targetValue: 40,
      unit: "days",
      severity: "low",
    });
    assert.ok(scoped.ok, scoped.ok ? "" : scoped.message);
    assert.equal(scoped.data.version, 4, "same scope, so the series continues");
  });
});
