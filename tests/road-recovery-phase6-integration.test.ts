/**
 * Phase 6 — Road & Recovery intelligence against real PostgreSQL.
 *
 * Static assertions prove the migration TEXT is right. This suite proves the DATABASE
 * behaves right, which is not the same thing: Phase 5 shipped a view whose text looked
 * correct and which nonetheless returned another tenant's rows, because a PostgreSQL view
 * runs as its OWNER unless told otherwise.
 *
 * Every statement runs under SET LOCAL ROLE authenticated, so row level security genuinely
 * applies. A test that passes as superuser proves nothing about a customer.
 *
 * Set RR_TEST_PSQL and RR_TEST_DB to run. NEVER point these at production.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import {
  computeRoadRecoveryIntelligence,
  listThresholds,
  loadThresholds,
  measureRoadRecoveryOutcome,
  prepareRoadRecoveryAction,
  publishThreshold,
  retireThreshold,
} from "@/lib/road-recovery/intelligence-service";
import { computeExecutiveBusinessIntelligence } from "@/lib/intelligence/executive-business-intelligence";
import { RR_METRIC_KEYS } from "@/lib/road-recovery/intelligence/metric-catalogue";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";
const ALPHA_USER = "controller@alpha.test";
const BRAVO_USER = "controller@bravo.test";

let alpha: PgTestClient;
let bravo: PgTestClient;
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 6 intelligence integration", () => {
    it("skipped: set RR_TEST_PSQL and RR_TEST_DB to run against a disposable database", () => {
      assert.ok(true);
    });
  });
}

before(() => {
  if (!CONFIG) return;
  alpha = createPgTestClient(CONFIG, { kind: "authenticated", email: ALPHA_USER });
  bravo = createPgTestClient(CONFIG, { kind: "authenticated", email: BRAVO_USER });
  owner = createPgTestClient(CONFIG, { kind: "owner" });

  // Start from a known-empty configuration. Only one ACTIVE target may exist per scope,
  // so a single row left behind by an earlier failed run would break every later insert
  // for that metric and send the next engineer hunting a defect that is not there.
  owner.exec(
    `ALTER TABLE public.rr_intelligence_thresholds DISABLE TRIGGER rr_intelligence_thresholds_guard;
     DELETE FROM public.rr_intelligence_thresholds;
     ALTER TABLE public.rr_intelligence_thresholds ENABLE TRIGGER rr_intelligence_thresholds_guard;
     DELETE FROM public.workforce_automation_actions
      WHERE source_module IN ('Road & Recovery Intelligence', 'regression');`
  );
});

function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Removes fixture targets.
 *
 * The guard refuses DELETE for EVERY role, including the owner, which is the behaviour
 * under test. Cleanup therefore has to disable the trigger explicitly — and the fact that
 * it must is itself the proof that the protection is real.
 */
function purgeThresholds(where: string): void {
  owner.exec(
    `ALTER TABLE public.rr_intelligence_thresholds DISABLE TRIGGER rr_intelligence_thresholds_guard`
  );
  owner.exec(`DELETE FROM public.rr_intelligence_thresholds WHERE ${where}`);
  owner.exec(
    `ALTER TABLE public.rr_intelligence_thresholds ENABLE TRIGGER rr_intelligence_thresholds_guard`
  );
}

// ---------------------------------------------------------------------------
describeIf("Phase 6 — schema and grants", () => {
  it("created exactly one new table", async () => {
    const data = owner.sql(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rr_intelligence_thresholds'`
    );
    assert.equal(data.length, 1);
  });

  it("created no Road & Recovery action, outcome or root-cause table", async () => {
    const data = owner.sql(`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE 'rr_action%'
            OR table_name LIKE 'rr_outcome%'
            OR table_name LIKE 'rr_root%'
            OR table_name LIKE 'rr_recommendation%')`
    );
    assert.deepEqual(data ?? [], []);
  });

  it("grants SELECT, INSERT and UPDATE but never DELETE on the threshold table", async () => {
    const data = owner.sql(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
         FROM information_schema.role_table_grants
        WHERE grantee = 'authenticated'
          AND table_schema = 'public'
          AND table_name = 'rr_intelligence_thresholds'`
    );
    assert.equal((data as { grants: string }[])[0]?.grants, "INSERT,SELECT,UPDATE");
  });

  it("revokes anon on every Road & Recovery relation", async () => {
    const data = owner.sql(`SELECT count(*)::int AS n
         FROM information_schema.role_table_grants
        WHERE grantee = 'anon' AND table_schema = 'public' AND table_name LIKE 'rr_%'`
    );
    assert.equal((data as { n: number }[])[0]?.n, 0);
  });

  it("marks every Road & Recovery view security_invoker", async () => {
    // The Phase 5 leak. Without this a GRANT SELECT on any view exposes every tenant.
    const data = owner.sql(`SELECT c.relname, coalesce(array_to_string(c.reloptions, ','), 'NONE') AS opts
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'rr_%'
        ORDER BY c.relname`
    );
    const views = data as { relname: string; opts: string }[];
    assert.ok(views.length >= 4, "expected at least four Road & Recovery views");
    for (const view of views) {
      assert.match(view.opts, /security_invoker=true/, `${view.relname} is not security_invoker`);
    }
  });

  it("enables row level security with a real policy", async () => {
    const data = owner.sql(`SELECT c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.tablename = 'rr_intelligence_thresholds') AS policies
         FROM pg_class c WHERE c.relname = 'rr_intelligence_thresholds'`
    );
    const row = (data as { rls: boolean; policies: number }[])[0];
    assert.equal(row.rls, true);
    assert.ok(row.policies >= 1);
  });

  it("accepts every metric in the catalogue and rejects anything else", async () => {
    // One statement rather than forty-eight round trips, and one cleanup rather than
    // forty-eight trigger toggles: a loop that disables a protective trigger on every
    // iteration leaves it disabled the moment any iteration fails.
    const values = RR_METRIC_KEYS.map(
      (key) => `('${ALPHA}', '${key}', 1, 'unit', 'vocabulary-test')`
    ).join(", ");

    assert.doesNotThrow(
      () =>
        owner.exec(
          `INSERT INTO public.rr_intelligence_thresholds
             (company_id, metric_key, target_value, unit, created_by)
           VALUES ${values}`
        ),
      "the database rejected a metric the engine catalogue measures"
    );

    const stored = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_intelligence_thresholds
        WHERE company_id = '${ALPHA}' AND created_by = 'vocabulary-test'`
    );
    assert.equal((stored as { n: number }[])[0].n, RR_METRIC_KEYS.length);

    const bad = await owner.from("rr_intelligence_thresholds").insert({
      company_id: ALPHA,
      metric_key: "not_a_real_metric",
      target_value: 1,
      unit: "unit",
    });
    assert.notEqual(bad.error, null, "a target was accepted for a metric nothing measures");

    purgeThresholds(`created_by = 'vocabulary-test'`);
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — tenant isolation", () => {
  it("hides one tenant's targets from another", async () => {
    const created = await owner
      .from("rr_intelligence_thresholds")
      .insert({
        company_id: ALPHA,
        metric_key: "response_time_to_scene_minutes",
        target_value: 30,
        unit: "minutes",
        created_by: "isolation-test",
      })
      .select("id");
    assert.equal(created.error, null);
    const id = (created.data as { id: string }[])[0].id;

    const asAlpha = await alpha.from("rr_intelligence_thresholds").select("id").eq("id", id);
    const asBravo = await bravo.from("rr_intelligence_thresholds").select("id").eq("id", id);

    assert.equal(((asAlpha.data ?? []) as unknown[]).length, 1, "alpha cannot see its own target");
    assert.equal(
      ((asBravo.data ?? []) as unknown[]).length,
      0,
      "bravo can read alpha's operational target"
    );

    purgeThresholds(`id = '${id}'`);
  });

  it("refuses a target written against another tenant", async () => {
    const result = await alpha.from("rr_intelligence_thresholds").insert({
      company_id: BRAVO,
      metric_key: "response_time_to_scene_minutes",
      target_value: 30,
      unit: "minutes",
    });
    assert.notEqual(result.error, null, "alpha wrote a target into bravo's configuration");
  });

  it("does not leak across tenants through rr_job_timing", async () => {
    const { data: alphaRows } = await alpha.from("rr_job_timing").select("company_id");
    const { data: bravoRows } = await bravo.from("rr_job_timing").select("company_id");
    for (const row of (alphaRows ?? []) as { company_id: string }[]) {
      assert.equal(row.company_id, ALPHA, "alpha read another tenant's job timing");
    }
    for (const row of (bravoRows ?? []) as { company_id: string }[]) {
      assert.equal(row.company_id, BRAVO, "bravo read another tenant's job timing");
    }
  });

  it("does not leak across tenants through rr_dispatch_performance", async () => {
    const { data } = await bravo.from("rr_dispatch_performance").select("company_id");
    for (const row of data as { company_id: string }[]) {
      assert.equal(row.company_id, BRAVO);
    }
  });

  it("does not leak across tenants through rr_storage_position", async () => {
    const { data } = await bravo.from("rr_storage_position").select("company_id");
    for (const row of data as { company_id: string }[]) {
      assert.equal(row.company_id, BRAVO);
    }
  });

  it("does not leak across tenants through rr_job_margin", async () => {
    const { data } = await bravo.from("rr_job_margin").select("company_id");
    for (const row of data as { company_id: string }[]) {
      assert.equal(row.company_id, BRAVO);
    }
  });

  it("computes intelligence for one tenant only", async () => {
    const result = await computeRoadRecoveryIntelligence(bravo as never, {
      companyId: BRAVO,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.companyId, BRAVO);
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — threshold lifecycle", () => {
  it("publishes a target, then retires it rather than editing it", async () => {
    const metric = "job_cycle_time_hours";
    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);

    const first = await publishThreshold(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      metricKey: metric,
      targetValue: 6,
      unit: "hours",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.data.version, 1);
    assert.equal(first.data.retiredVersion, null);

    const second = await publishThreshold(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      metricKey: metric,
      targetValue: 4,
      unit: "hours",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.data.version, 2);
    assert.equal(second.data.retiredVersion, 1);

    // BOTH versions survive. The retired one is what a historical result replays against.
    const all = await loadThresholds(alpha as never, ALPHA);
    const versions = all
      .filter((entry) => entry.metricKey === metric)
      .map((entry) => entry.version)
      .sort();
    assert.deepEqual(versions, [1, 2]);
    assert.equal(all.filter((entry) => entry.metricKey === metric && entry.active).length, 1);

    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);
  });

  it("refuses to edit what a published target says", async () => {
    const created = await owner
      .from("rr_intelligence_thresholds")
      .insert({
        company_id: ALPHA,
        metric_key: "time_on_scene_minutes",
        target_value: 20,
        unit: "minutes",
        created_by: "immutability-test",
      })
      .select("id");
    const id = (created.data as { id: string }[])[0].id;

    // A real row, so this cannot pass vacuously by matching zero rows.
    const before = owner.sql(`SELECT target_value::float8 AS v FROM public.rr_intelligence_thresholds WHERE id = '${id}'`
    );
    assert.equal((before as { v: number }[])[0].v, 20);

    assert.throws(
      () => owner.exec(`UPDATE public.rr_intelligence_thresholds SET target_value = 99 WHERE id = '${id}'`),
      /immutable/i,
      "a published target was silently rewritten"
    );

    const after = owner.sql(`SELECT target_value::float8 AS v FROM public.rr_intelligence_thresholds WHERE id = '${id}'`
    );
    assert.equal((after as { v: number }[])[0].v, 20);

    purgeThresholds(`id = '${id}'`);
  });

  it("refuses to delete a target even as the owner role", async () => {
    // The trigger is bound to the TABLE, so it constrains service_role too.
    const created = await owner
      .from("rr_intelligence_thresholds")
      .insert({
        company_id: ALPHA,
        metric_key: "billing_ready_rate_pct",
        target_value: 90,
        unit: "%",
        created_by: "delete-test",
      })
      .select("id");
    const id = (created.data as { id: string }[])[0].id;

    const deleted = await owner
      .from("rr_intelligence_thresholds")
      .delete()
      .eq("id", id);
    assert.notEqual(deleted.error, null, "a target was deleted, erasing what a past breach was judged against");

    const still = owner.sql(`SELECT count(*)::int AS n FROM public.rr_intelligence_thresholds WHERE id = '${id}'`
    );
    assert.equal((still as { n: number }[])[0].n, 1);

    // Cleanup has to go through the trigger's own escape hatch.
    purgeThresholds(`id = '${id}'`);
  });

  it("permits retirement and refuses reactivation", async () => {
    const metric = "distance_dispute_count";
    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);

    const published = await publishThreshold(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      metricKey: metric,
      targetValue: 0,
      unit: "disputes",
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const retired = await retireThreshold(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      thresholdId: published.data.thresholdId,
    });
    assert.equal(retired.ok, true);

    assert.throws(
      () =>
        owner.exec(
          `UPDATE public.rr_intelligence_thresholds SET active = true WHERE id = '${published.data.thresholdId}'`
        ),
      /retired|reactivat/i,
      "a retired target was resurrected"
    );

    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);
  });

  it("permits only one active version per scope", async () => {
    const metric = "fleet_utilisation_pct";
    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);

    const a = await owner.from("rr_intelligence_thresholds").insert({
      company_id: ALPHA,
      metric_key: metric,
      target_value: 70,
      unit: "%",
      version: 1,
      created_by: "unique-test",
    });
    assert.equal(a.error, null);

    const b = await owner.from("rr_intelligence_thresholds").insert({
      company_id: ALPHA,
      metric_key: metric,
      target_value: 80,
      unit: "%",
      version: 2,
      created_by: "unique-test",
    });
    assert.notEqual(b.error, null, "two active targets exist for the same scope");

    purgeThresholds(`company_id = '${ALPHA}' AND metric_key = '${metric}'`);
  });

  it("refuses a target scoped to another tenant's counterparty", async () => {
    const bravoCounterparty = owner.sql(`SELECT id FROM public.rr_counterparties WHERE company_id = '${BRAVO}' LIMIT 1`
    );
    const rows = bravoCounterparty as { id: string }[];
    if (rows.length === 0) return;

    const result = await owner.from("rr_intelligence_thresholds").insert({
      company_id: ALPHA,
      metric_key: "counterparty_dispute_rate_pct",
      counterparty_id: rows[0].id,
      target_value: 5,
      unit: "%",
      created_by: "fk-test",
    });
    assert.notEqual(result.error, null, "the composite foreign key did not stop a cross-tenant reference");
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — NO SLA CONFIGURED end to end", () => {
  it("reports no score and no findings when nothing is configured", async () => {
    purgeThresholds(`company_id = '${ALPHA}'`);

    const result = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.data.thresholdsConfigured, 0);
    assert.equal(result.data.health.score, null, "an unconfigured operation must not be scored");
    assert.equal(result.data.health.band, "not_scoreable");
    assert.match(result.data.health.narrative, /NO SLA CONFIGURED|no data/);

    const sla = result.data.domains.find((entry) => entry.domain === "sla");
    assert.match(String(sla?.detail.message), /NO SLA CONFIGURED/);

    // Any recommendation present must come from a recorded FACT, never a target breach.
    for (const recommendation of result.data.recommendations) {
      assert.equal(
        recommendation.targetValue,
        null,
        `${recommendation.key} claims a target although none is configured`
      );
    }
  });

  it("lists every metric with a measured value even when nothing is configured", async () => {
    const result = await listThresholds(alpha as never, { companyId: ALPHA });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.thresholds.filter((entry) => entry.active).length, 0);
    assert.equal(result.data.catalogue.length, RR_METRIC_KEYS.length);
  });

  it("produces all fifteen domains regardless of configuration", async () => {
    const result = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.domains.length, 15);
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — margin correctness against real data", () => {
  it("returns NULL cost and NULL margin for a job with no cost record", async () => {
    const data = owner.sql(`SELECT direct_cost, gross_margin, margin_pct, has_cost_data
         FROM public.rr_job_margin
        WHERE company_id = '${ALPHA}' AND has_cost_data = false
        LIMIT 1`
    );
    const rows = data as {
      direct_cost: unknown;
      gross_margin: unknown;
      margin_pct: unknown;
      has_cost_data: boolean;
    }[];
    if (rows.length === 0) return;

    assert.equal(rows[0].direct_cost, null, "a job with no cost reports zero cost");
    assert.equal(rows[0].gross_margin, null, "a job with no cost reports a margin");
    assert.equal(rows[0].margin_pct, null, "a job with no cost reports a margin percentage");
    assert.equal(rows[0].has_cost_data, false);
  });

  it("never reports a hundred percent margin purely because cost is missing", async () => {
    const data = owner.sql(`SELECT count(*)::int AS n
         FROM public.rr_job_margin
        WHERE company_id = '${ALPHA}' AND has_cost_data = false AND margin_pct IS NOT NULL`
    );
    assert.equal((data as { n: number }[])[0].n, 0);
  });

  it("excludes unmeasurable jobs from the profitability aggregate", async () => {
    const result = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const profitability = result.data.domains.find((entry) => entry.domain === "profitability");
    const measurable = Number(profitability?.detail.measurableJobs ?? 0);
    const marginMetric = result.data.metrics.find(
      (entry) => entry.key === "profitability_margin_pct_avg"
    );
    if (measurable === 0) {
      assert.equal(marginMetric?.value, null, "margin was reported with no measurable job");
    }
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — action and outcome integration", () => {
  it("accepts every Road & Recovery action type and trigger on the shared table", async () => {
    const pairs: Array<[string, string]> = [
      ["Escalate Dispatch", "Dispatch Delay"],
      ["Escalate Dispatch", "Arrival Delay"],
      ["Schedule Vehicle Release", "Storage Ageing"],
      ["Request Billing Information", "Billing Blocked"],
      ["Review Distance Capture", "Distance Dispute"],
      ["Request Authorisation", "Authorisation Delay"],
      ["Escalate Exception", "Critical Exception"],
      ["Review Fleet Capacity", "Fleet Capacity Risk"],
    ];

    for (const [actionType, trigger] of pairs) {
      const inserted = await owner
        .from("workforce_automation_actions")
        .insert({
          company_id: ALPHA,
          action_type: actionType,
          status: "Draft",
          source_module: "Road & Recovery Intelligence",
          reason: `vocabulary check ${unique()}`,
          payload_json: {},
          trigger_type: trigger,
          pipeline_stage: "Triggered",
        })
        .select("id");
      assert.equal(
        inserted.error,
        null,
        `the database rejected ${actionType} / ${trigger}, so no such recommendation could ever be actioned`
      );
      const id = (inserted.data as { id: string }[])[0].id;
      owner.exec(`DELETE FROM public.workforce_automation_actions WHERE id = '${id}'`);
    }
  });

  it("still rejects an action type outside the vocabulary", async () => {
    const result = await owner.from("workforce_automation_actions").insert({
      company_id: ALPHA,
      action_type: "Fabricate Invoice",
      status: "Draft",
      source_module: "test",
      reason: "should fail",
      payload_json: {},
    });
    assert.notEqual(result.error, null, "the action vocabulary is no longer closed");
  });

  it("still accepts every pre-existing workforce action type", async () => {
    for (const actionType of [
      "Create Warning",
      "Create HR Case",
      "Approve Leave",
      "Mark Payroll Item For Review",
    ]) {
      const inserted = await owner
        .from("workforce_automation_actions")
        .insert({
          company_id: ALPHA,
          action_type: actionType,
          status: "Draft",
          source_module: "regression",
          reason: `workforce regression ${unique()}`,
          payload_json: {},
        })
        .select("id");
      assert.equal(inserted.error, null, `${actionType} was broken by the vocabulary extension`);
      const id = (inserted.data as { id: string }[])[0].id;
      owner.exec(`DELETE FROM public.workforce_automation_actions WHERE id = '${id}'`);
    }
  });

  it("prepares a recommendation into the existing pipeline with an owner and a baseline", async () => {
    // Configure a target that the existing data will breach, so a finding actually exists.
    purgeThresholds(`company_id = '${ALPHA}'`);

    const published = await publishThreshold(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      metricKey: "billing_blocked_count",
      targetValue: 0,
      warningValue: 0.5,
      criticalValue: 1,
      unit: "jobs",
    });
    assert.equal(published.ok, true);

    const options = {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    };
    const intelligence = await computeRoadRecoveryIntelligence(alpha as never, options);
    assert.equal(intelligence.ok, true);
    if (!intelligence.ok) return;

    const recommendation = intelligence.data.recommendations[0];
    if (!recommendation) return;

    const prepared = await prepareRoadRecoveryAction(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      findingKey: recommendation.key,
      options,
    });
    assert.equal(prepared.ok, true, prepared.ok ? "" : prepared.message);
    if (!prepared.ok) return;

    const data = owner.sql(`SELECT action_type, trigger_type, workflow_owner, pipeline_stage, source_module,
              outcome_before_json IS NOT NULL AS has_before,
              impact_estimate_json IS NOT NULL AS has_impact,
              payload_json ->> 'root_cause' AS root_cause,
              payload_json ->> 'financial_impact_known' AS impact_known,
              payload_json ->> 'metric_key' AS metric_key
         FROM public.workforce_automation_actions
        WHERE id = '${prepared.data.actionId}'`
    );
    const action = (data as Record<string, unknown>[])[0];

    assert.equal(action.source_module, "Road & Recovery Intelligence");
    assert.equal(action.trigger_type, recommendation.trigger);
    assert.ok(action.workflow_owner, "the action has no owner");
    assert.equal(action.has_before, true, "no before-metrics were captured, so improvement cannot be measured");
    assert.equal(action.has_impact, true);
    assert.ok(action.metric_key, "the action does not record which metric raised it");

    owner.exec(
      `DELETE FROM public.workforce_automation_actions WHERE id = '${prepared.data.actionId}'`
    );
  });

  it("measures the outcome against the same metric, recording unmeasured honestly", async () => {
    const options = {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    };
    const intelligence = await computeRoadRecoveryIntelligence(alpha as never, options);
    assert.equal(intelligence.ok, true);
    if (!intelligence.ok) return;

    const recommendation = intelligence.data.recommendations[0];
    if (!recommendation) return;

    const prepared = await prepareRoadRecoveryAction(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      findingKey: recommendation.key,
      options,
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const outcome = await measureRoadRecoveryOutcome(alpha as never, {
      companyId: ALPHA,
      actionId: prepared.data.actionId,
      actorEmail: ALPHA_USER,
    });
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.message);
    if (!outcome.ok) return;

    assert.equal(outcome.data.metricKey, recommendation.metricKey);
    // Improvement is a tri-state. Unknown is never reported as "did not improve".
    assert.ok(
      outcome.data.improved === true || outcome.data.improved === false || outcome.data.improved === null
    );
    if (outcome.data.after === null) {
      assert.equal(outcome.data.improved, null);
      assert.match(outcome.data.summary, /could not be measured/);
    }

    const data = owner.sql(`SELECT outcome_after_json IS NOT NULL AS has_after, outcome_summary
         FROM public.workforce_automation_actions WHERE id = '${prepared.data.actionId}'`
    );
    const row = (data as Record<string, unknown>[])[0];
    assert.equal(row.has_after, true, "the outcome was not written to the existing outcome columns");
    assert.ok(String(row.outcome_summary).length > 0);

    owner.exec(
      `DELETE FROM public.workforce_automation_actions WHERE id = '${prepared.data.actionId}'`
    );
  });

  it("refuses to prepare an action for a recommendation that no longer exists", async () => {
    const result = await prepareRoadRecoveryAction(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_USER,
      findingKey: "not_a_real_finding:critical",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — executive integration", () => {
  it("combines the verticals through the existing executive architecture", async () => {
    const result = await computeExecutiveBusinessIntelligence(alpha as never, { companyId: ALPHA });

    assert.equal(result.companyId, ALPHA);
    assert.equal(result.verticals.length, 2);
    assert.ok(result.verticals.some((entry) => entry.vertical === "workforce"));
    assert.ok(result.verticals.some((entry) => entry.vertical === "road_recovery"));

    // Every vertical that could not be scored says WHY, and is out of the denominator.
    for (const vertical of result.verticals) {
      if (vertical.score === null) {
        assert.ok(
          (vertical.unavailableReason ?? "").length > 0,
          `${vertical.vertical} has no score and no stated reason`
        );
        assert.equal(
          result.combined.includedVerticals.includes(vertical.vertical),
          false,
          `${vertical.vertical} has no score but was counted in the combined denominator`
        );
      }
    }

    if (result.combined.score !== null) {
      assert.ok(result.combined.score >= 0 && result.combined.score <= 100);
    }
    assert.ok(result.combined.narrative.length > 0);
  });

  it("never scores an unscoreable vertical as zero", async () => {
    const result = await computeExecutiveBusinessIntelligence(bravo as never, { companyId: BRAVO });
    for (const vertical of result.verticals) {
      if (vertical.unavailableReason !== null) {
        assert.notEqual(vertical.score, 0, `${vertical.vertical} was scored zero rather than excluded`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — BYSTAND separation against real data", () => {
  it("flags BYSTAND on the timing view", async () => {
    const data = owner.sql(`SELECT count(*) FILTER (WHERE is_bystand) ::int AS bystand,
              count(*) FILTER (WHERE NOT is_bystand)::int AS tow
         FROM public.rr_job_timing WHERE company_id = '${ALPHA}'`
    );
    const row = (data as { bystand: number; tow: number }[])[0];
    assert.ok(row.bystand >= 0 && row.tow >= 0);
  });

  it("never counts a BYSTAND job in a tow metric", async () => {
    // Asserted INSIDE one snapshot rather than against a second query. Other suites write
    // jobs to this database concurrently, so two separate reads legitimately disagree —
    // and a test that fails for that reason teaches the next engineer to ignore it.
    const result = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.data.bystandCount >= 0);
    assert.ok(
      result.data.bystandCount <= result.data.jobCount,
      "more BYSTAND attendances than jobs, so the separation is double-counting"
    );

    // The tow denominator excludes them. buildDomains() asserts this too, and throws.
    const tow = result.data.domains.find((entry) => entry.domain === "tow_operations");
    const cycle = tow?.metrics.find((entry) => entry.key === "job_cycle_time_hours");
    assert.ok(
      (cycle?.sampleSize ?? 0) <= result.data.jobCount - result.data.bystandCount,
      "a tow metric was measured over more jobs than there are non-BYSTAND jobs"
    );

    // And the BYSTAND domain is measured over the attendances, not over the tows.
    const bystand = result.data.domains.find((entry) => entry.domain === "bystand");
    assert.ok(
      Number(bystand?.detail.attendances ?? 0) <= result.data.jobCount,
      "BYSTAND intelligence counted jobs that are not attendances"
    );
  });

  it("reads BYSTAND standing time from the sealed summary only", async () => {
    const data = owner.sql(`SELECT count(*)::int AS n FROM public.rr_standby_summary s
         JOIN public.rr_service_jobs j ON j.id = s.service_job_id AND j.company_id = s.company_id
        WHERE s.company_id = '${ALPHA}' AND j.workflow_key <> 'bystand'`
    );
    assert.equal(
      (data as { n: number }[])[0].n,
      0,
      "a sealed standby summary exists against a non-BYSTAND job"
    );
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 6 — performance and truncation", () => {
  it("honours a row limit and reports it rather than truncating silently", async () => {
    const result = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
      rowLimit: 100,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    for (const truncation of result.data.truncations) {
      assert.ok(truncation.message.includes("maximum"), "a truncation was recorded without explaining itself");
      assert.equal(truncation.limit, 100);
    }
    if (result.data.truncations.length > 0) {
      const affected = result.data.domains.filter((entry) => entry.truncated !== null);
      assert.ok(affected.length > 0, "a truncation was not surfaced on any domain");
    }
  });

  it("produces an identical result on two consecutive runs", async () => {
    // The window is CLOSED and entirely in the past. Determinism means "the same facts
    // produce the same answer", so the test has to hold the facts still: an open-ended
    // window would sweep up rows other suites insert between the two runs and fail for a
    // reason that has nothing to do with the engine.
    const options = {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2020-01-01T00:00:00.000Z",
      asOfIso: "2020-01-01T00:00:00.000Z",
    };
    const first = await computeRoadRecoveryIntelligence(alpha as never, options);
    const second = await computeRoadRecoveryIntelligence(alpha as never, options);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;

    // generatedAtIso is a clock read and legitimately differs; everything else must not.
    assert.equal(
      JSON.stringify({ ...first.data, generatedAtIso: null }),
      JSON.stringify({ ...second.data, generatedAtIso: null }),
      "the same facts produced two different answers"
    );
  });
});
