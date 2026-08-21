/**
 * Phase 4 SERVICE-LAYER integration and end-to-end.
 *
 * Calls the REAL service functions against a REAL PostgreSQL database, as `authenticated`
 * with a tenant's JWT claims, so RLS, triggers, CHECK constraints and grants are all live.
 *
 * THE TWO THINGS THIS SUITE EXISTS TO PROVE
 *
 *   1. PROVISIONING
 *        enable Road & Recovery -> provision -> verified -> the tenant can create a job
 *        provision twice        -> no duplicates, no customisation overwritten
 *
 *   2. THE RELEASE AND DISPOSAL GUARDS
 *        The storage workflow has declared `release_authorised` and `disposal_authorised`
 *        since Phase 0 and nothing ever resolved them, so both transitions were
 *        unreachable — the same defect Phase 3 closed for `evidence_complete`. Both
 *        directions are proven here, including that a client asserting either guard is
 *        ignored.
 *
 * SKIPS (rather than fails) without a disposable database, and never falls back to a
 * default connection, so it cannot reach a real project.
 *
 *   RR_TEST_PSQL=<path to psql> RR_TEST_DB=rr_itest npm test
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import { createServiceJob, transitionServiceJob } from "@/lib/road-recovery/job-service";
import { decideAuthority, resolveAuthorityGuard } from "@/lib/road-recovery/release-authority";
import {
  listReleaseAuthorities,
  recordReleaseAuthority,
  verifyReleaseAuthority,
  voidReleaseAuthority,
} from "@/lib/road-recovery/release-service";
import {
  getCustodyChain,
  handOverCustodyItem,
  loadJobCapability,
  recordCustodyEvent,
  recordCustodyItem,
} from "@/lib/road-recovery/custody-service";
import {
  checkVehicleIntoStorage,
  checkVehicleOutOfStorage,
  computeStorageAccrual,
  evaluateReleaseEligibility,
  getStoragePosition,
} from "@/lib/road-recovery/storage-service";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";
const CONTROLLER = "controller@alpha.test";
const YARD = "11110000-0000-4000-8000-00000000aaaa";

let db: PgTestClient;
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 4 integration", () => {
    it("skipped: set RR_TEST_PSQL and RR_TEST_DB to run against a disposable database", () => {
      assert.ok(true);
    });
  });
}

before(() => {
  if (!CONFIG) return;
  db = createPgTestClient(CONFIG, { kind: "authenticated", email: CONTROLLER });
  owner = createPgTestClient(CONFIG, { kind: "owner" });
});

function suffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createStorageJob(title: string) {
  const created = await createServiceJob(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceCode: "storage",
    title,
    originLabel: "Alpha Main Yard",
    vehicleRegistration: `CA ${suffix()}`,
  });
  assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
  return created.data;
}

/** Satisfies every RELEASE-scope requirement the job's snapshot declares. */
async function satisfyReleaseEvidence(serviceJobId: string, fieldJobId: string) {
  const { evaluateJobCompliance } = await import("@/lib/road-recovery/requirements-service");
  const { linkEvidenceToRequirements } = await import("@/lib/road-recovery/requirements-service");

  const compliance = await evaluateJobCompliance(db as never, {
    companyId: ALPHA,
    serviceJobId,
    scope: "release",
  });
  assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);

  for (const result of compliance.data.compliance.results) {
    if (!result.blocking) continue;
    if (result.evidenceKind === "gps" || result.evidenceKind === "authorisation") continue;
    const needed = Math.max(1, result.minCount - result.capturedCount);
    for (let index = 0; index < needed; index += 1) {
      const rows = owner.sql(
        `INSERT INTO public.mobile_workforce_evidence
           (company_id, employee_id, job_id, service_job_id, evidence_type,
            storage_bucket, storage_path, captured_by_role)
         VALUES ('${ALPHA}', 'd0000000-0000-4000-8000-00000000000a', '${fieldJobId}',
           '${serviceJobId}', 'other', 'rr-evidence',
           '${ALPHA}/${serviceJobId}/${suffix()}.jpg', 'driver')
         RETURNING id`
      );
      const linked = await linkEvidenceToRequirements(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        evidenceId: String((rows[0] as { id: string }).id),
        requirementCodes: [result.requirementCode],
      });
      assert.ok(linked.ok, linked.ok ? "" : linked.message);
    }
  }
}

/** Records AND verifies a release authority. Verification is what opens the gate. */
async function grantReleaseAuthority(
  serviceJobId: string,
  overrides: { expiresAt?: string | null; verify?: boolean } = {}
) {
  const recorded = await recordReleaseAuthority(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    authorityType: "release",
    authorityParty: "owner",
    authorityPartyName: "J Smith",
    authorityReference: `REL-${suffix()}`,
    collectorName: "J Smith",
    collectorCapacity: "registered owner",
    collectorIdNumber: "8001015009087",
    expiresAt: overrides.expiresAt ?? null,
  });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);

  if (overrides.verify !== false) {
    const verified = await verifyReleaseAuthority(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      authorityId: recorded.data.authorityId,
      verificationMethod: "called the owner back on the number on file",
    });
    assert.ok(verified.ok, verified.ok ? "" : verified.message);
  }
  return recorded.data.authorityId;
}

async function grantDisposalAuthority(serviceJobId: string, verify = true) {
  const recorded = await recordReleaseAuthority(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    authorityType: "disposal",
    authorityParty: "municipality",
    authorityPartyName: "City of Cape Town",
    authorityReference: `DIS-${suffix()}`,
    disposalNoticeReference: `NOTICE-${suffix()}`,
    disposalNoticeServedAt: "2026-01-15T09:00:00.000Z",
    disposalMethod: "scrap",
  });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);

  if (verify) {
    const verified = await verifyReleaseAuthority(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      authorityId: recorded.data.authorityId,
      verificationMethod: "disposal notice on file, 30-day period elapsed",
    });
    assert.ok(verified.ok, verified.ok ? "" : verified.message);
  }
  return recorded.data.authorityId;
}

// ---------------------------------------------------------------------------
// 1. PROVISIONING
// ---------------------------------------------------------------------------

describeIf("Phase 4 — provisioning", () => {
  function newCompany(name: string): string {
    const rows = owner.sql(
      `INSERT INTO public.companies (name, enabled_modules)
       VALUES ('${name.replace(/'/g, "''")}', '["road_recovery"]'::jsonb) RETURNING id`
    );
    return String((rows[0] as { id: string }).id);
  }

  function status(companyId: string): { component: string; ok: boolean; detail: string }[] {
    return owner.sql(
      `SELECT component, ok, detail FROM public.rr_provisioning_status('${companyId}')`
    ) as unknown as { component: string; ok: boolean; detail: string }[];
  }

  it("E2E — enable the module, provision, verify, and the tenant can create a job", async () => {
    const companyId = newCompany(`Provisioned Co ${suffix()}`);

    // Before: nothing.
    assert.equal(
      status(companyId).every((entry) => entry.ok),
      false,
      "a brand new company verified as already provisioned"
    );

    const provisioned = owner.sql(
      `SELECT component, ok, detail FROM public.rr_provision_company('${companyId}')`
    ) as unknown as { component: string; ok: boolean; detail: string }[];

    const failed = provisioned.filter((entry) => !entry.ok);
    assert.equal(failed.length, 0, `not provisioned: ${failed.map((e) => e.detail).join(" ")}`);

    // Every baseline component is genuinely there.
    const counts = owner.sql(
      `SELECT
         (SELECT count(*)::int FROM public.rr_service_types WHERE company_id='${companyId}') AS services,
         (SELECT count(*)::int FROM public.rr_workflow_definitions WHERE company_id='${companyId}') AS workflows,
         (SELECT count(*)::int FROM public.rr_bystand_reason_codes WHERE company_id='${companyId}') AS reasons,
         (SELECT count(*)::int FROM public.rr_requirement_policies WHERE company_id='${companyId}') AS policies`
    )[0] as Record<string, number>;

    assert.equal(Number(counts.services), 8);
    assert.ok(Number(counts.workflows) >= 6);
    assert.ok(Number(counts.reasons) > 0, "BYSTAND reason codes were not provisioned");
    assert.equal(Number(counts.policies), 8);

    // BYSTAND v2 is the active version.
    const bystand = owner.sql(
      `SELECT version FROM public.rr_workflow_definitions
        WHERE company_id='${companyId}' AND workflow_key='bystand' AND active`
    );
    assert.equal(Number((bystand[0] as { version: number }).version), 2);

    // AND the tenant can actually create a job — the point of provisioning.
    const tenant = createPgTestClient(CONFIG!, { kind: "owner" });
    const created = await createServiceJob(tenant as never, {
      companyId,
      actorEmail: "owner@provisioned.test",
      serviceCode: "tow_in",
      title: "First job after provisioning",
      vehicleRegistration: `CA ${suffix()}`,
    });
    assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
    assert.ok(created.data.requirementCount > 0, "the new job got no requirement snapshot");
  });

  it("IDEMPOTENCE — provisioning twice creates no duplicates and overwrites no customisation", () => {
    const companyId = newCompany(`Idempotent Co ${suffix()}`);
    owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`);

    // The customer makes it theirs.
    owner.sql(
      `UPDATE public.rr_service_types SET name='Our Rapid Tow', active=false
        WHERE company_id='${companyId}' AND service_code='tow_in' RETURNING id`
    );
    owner.sql(
      `UPDATE public.rr_requirement_items SET min_count=9
        WHERE company_id='${companyId}' AND requirement_code='registration_photo' RETURNING id`
    );

    const fingerprint = () =>
      owner.sql(
        `SELECT 'svc:'||service_code||'|'||name||'|'||active AS line FROM public.rr_service_types WHERE company_id='${companyId}'
         UNION ALL SELECT 'wf:'||workflow_key||'|'||version||'|'||active FROM public.rr_workflow_definitions WHERE company_id='${companyId}'
         UNION ALL SELECT 'reason:'||reason_code||'|'||active FROM public.rr_bystand_reason_codes WHERE company_id='${companyId}'
         UNION ALL SELECT 'pol:'||policy_key||'|'||version||'|'||active FROM public.rr_requirement_policies WHERE company_id='${companyId}'
         UNION ALL SELECT 'item:'||requirement_code||'|'||min_count FROM public.rr_requirement_items WHERE company_id='${companyId}'
         ORDER BY line`
      );

    const before = fingerprint();

    owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`);
    owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`);

    assert.deepEqual(fingerprint(), before, "re-provisioning changed the tenant's data");
  });

  it("PARTIAL FAILURE — nothing is half-applied, and a retry completes", () => {
    const companyId = newCompany(`Retry Co ${suffix()}`);

    owner.exec(
      `CREATE OR REPLACE FUNCTION public.p4_test_break() RETURNS trigger LANGUAGE plpgsql AS $b$
       BEGIN RAISE EXCEPTION 'simulated failure during requirement policy seeding'; END $b$;
       CREATE TRIGGER p4_test_break BEFORE INSERT ON public.rr_requirement_policies
         FOR EACH ROW EXECUTE FUNCTION public.p4_test_break()`
    );

    assert.throws(
      () => owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`),
      /simulated failure/
    );

    // The whole operation is one transaction, so NOTHING was applied.
    const partial = owner.sql(
      `SELECT
         (SELECT count(*)::int FROM public.rr_service_types WHERE company_id='${companyId}') AS services,
         (SELECT count(*)::int FROM public.rr_workflow_definitions WHERE company_id='${companyId}') AS workflows,
         (SELECT count(*)::int FROM public.rr_bystand_reason_codes WHERE company_id='${companyId}') AS reasons`
    )[0] as Record<string, number>;
    assert.equal(Number(partial.services), 0, "a failed provision left service types behind");
    assert.equal(Number(partial.workflows), 0, "a failed provision left workflows behind");
    assert.equal(Number(partial.reasons), 0, "a failed provision left reason codes behind");

    owner.exec(
      `DROP TRIGGER p4_test_break ON public.rr_requirement_policies;
       DROP FUNCTION public.p4_test_break()`
    );

    const retried = owner.sql(
      `SELECT component, ok, detail FROM public.rr_provision_company('${companyId}')`
    ) as unknown as { component: string; ok: boolean; detail: string }[];
    const stillFailing = retried.filter((entry) => !entry.ok);
    assert.equal(stillFailing.length, 0, `retry incomplete: ${stillFailing.map((e) => e.detail).join(" ")}`);
  });

  it("refuses to provision a company that does not hold the module", () => {
    const rows = owner.sql(
      `INSERT INTO public.companies (name, enabled_modules)
       VALUES ('Unentitled Co ${suffix()}', '[]'::jsonb) RETURNING id`
    );
    const companyId = String((rows[0] as { id: string }).id);
    assert.throws(
      () => owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`),
      /does not hold the road_recovery module/
    );
  });

  it("DISABLING the module deletes nothing", async () => {
    const companyId = newCompany(`Disabled Co ${suffix()}`);
    owner.sql(`SELECT ok FROM public.rr_provision_company('${companyId}')`);

    const tenant = createPgTestClient(CONFIG!, { kind: "owner" });
    const created = await createServiceJob(tenant as never, {
      companyId,
      actorEmail: "owner@disabled.test",
      serviceCode: "tow_in",
      title: "Job that must survive a module revocation",
      vehicleRegistration: `CA ${suffix()}`,
    });
    assert.ok(created.ok, created.ok ? "" : created.message);

    // Revoke entitlement, exactly as the module toggle does.
    owner.sql(`UPDATE public.companies SET enabled_modules='[]'::jsonb WHERE id='${companyId}' RETURNING id`);

    const survived = owner.sql(
      `SELECT
         (SELECT count(*)::int FROM public.rr_service_jobs WHERE company_id='${companyId}') AS jobs,
         (SELECT count(*)::int FROM public.rr_service_types WHERE company_id='${companyId}') AS services,
         (SELECT count(*)::int FROM public.rr_requirement_policies WHERE company_id='${companyId}') AS policies,
         (SELECT count(*)::int FROM public.rr_evidence_requirements WHERE company_id='${companyId}') AS requirements`
    )[0] as Record<string, number>;

    assert.equal(Number(survived.jobs), 1, "revoking the module deleted a job");
    assert.equal(Number(survived.services), 8, "revoking the module deleted the catalogue");
    assert.equal(Number(survived.policies), 8, "revoking the module deleted requirement policies");
    assert.ok(Number(survived.requirements) > 0, "revoking the module deleted job requirements");
  });
});

// ---------------------------------------------------------------------------
// 2. CUSTODY
// ---------------------------------------------------------------------------

describeIf("Phase 4 — chain of custody", () => {
  it("records possession, and the projection follows the log", async () => {
    const job = await createStorageJob("Custody chain");

    const taken = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
      locationLabel: "N1 northbound",
      latitude: -33.9249,
      longitude: 18.4241,
    });
    assert.ok(taken.ok, taken.ok ? "" : taken.message);

    const moved = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "transferred",
      holderType: "yard",
      holderName: "Alpha Main Yard",
      yardId: YARD,
    });
    assert.ok(moved.ok, moved.ok ? "" : moved.message);

    const chain = await getCustodyChain(db as never, ALPHA, job.serviceJobId);
    assert.ok(chain.ok, chain.ok ? "" : chain.message);
    assert.equal(chain.data.events.length, 2);
    assert.equal(String(chain.data.holding?.holder_type), "yard");
    assert.equal(Number(chain.data.holding?.event_count), 2);
  });

  it("refuses a release that does not name who received the vehicle", async () => {
    const job = await createStorageJob("Custody anonymous release");
    const result = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "released",
      holderType: "owner",
      holderName: "Someone",
    });
    assert.equal(result.ok, false);
  });

  it("tracks keys and documents to a named recipient", async () => {
    const job = await createStorageJob("Custody items");

    const taken = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
    });
    assert.ok(taken.ok, taken.ok ? "" : taken.message);

    const item = await recordCustodyItem(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      itemType: "key",
      description: "Ignition key with remote",
      quantity: 2,
      itemCondition: "good",
      receivedEventId: taken.data.eventId,
    });
    assert.ok(item.ok, item.ok ? "" : item.message);

    const handed = await handOverCustodyItem(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      itemId: item.data.itemId,
      handedOverToName: "J Smith",
      handedOverToCapacity: "registered owner",
    });
    assert.ok(handed.ok, handed.ok ? "" : handed.message);

    const chain = await getCustodyChain(db as never, ALPHA, job.serviceJobId);
    assert.ok(chain.ok, chain.ok ? "" : chain.message);
    const stored = chain.data.items[0] as Record<string, unknown>;
    assert.equal(String(stored.handed_over_to_name), "J Smith");
    assert.ok(stored.handed_over_at);
  });

  it("BYSTAND cannot take custody — refused from the capability flag, not the service name", async () => {
    const created = await createServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceCode: "bystand",
      title: "BYSTAND custody attempt",
      originLabel: "N2",
      vehicleRegistration: `CA ${suffix()}`,
    });
    assert.ok(created.ok, created.ok ? "" : created.message);

    const capability = await loadJobCapability(db as never, ALPHA, created.data.serviceJobId);
    assert.ok(capability.ok, capability.ok ? "" : capability.message);
    assert.equal(capability.data.requiresCustody, false);
    assert.equal(capability.data.requiresStorage, false);

    const attempt = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: created.data.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
    });
    assert.equal(attempt.ok, false, "a BYSTAND job took custody");

    const storage = await checkVehicleIntoStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: created.data.serviceJobId,
      yardId: YARD,
    });
    assert.equal(storage.ok, false, "a BYSTAND job was checked into storage");
  });

  it("cannot record custody on another tenant's job", async () => {
    const job = await createStorageJob("Cross-tenant custody");
    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const attempt = await recordCustodyEvent(bravo as never, {
      companyId: BRAVO,
      actorEmail: "controller@bravo.test",
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Bravo Recovery",
    });
    assert.equal(attempt.ok, false);

    const leaked = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_custody_events
        WHERE service_job_id='${job.serviceJobId}' AND company_id='${BRAVO}'`
    );
    assert.equal(Number((leaked[0] as { n: number }).n), 0);
  });
});

// ---------------------------------------------------------------------------
// 3. THE RELEASE AND DISPOSAL GUARDS
// ---------------------------------------------------------------------------

describeIf("Phase 4 — the release and disposal guards", () => {
  /** storage_pending -> ... -> release_authorisation_pending */
  async function driveToReleaseAuthorisationPending(serviceJobId: string) {
    for (const toState of ["checked_in", "stored", "release_requested", "release_authorisation_pending"]) {
      const result = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        toState,
      });
      assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
    }
  }

  it("RELEASE WITHOUT AUTHORITY — MUST FAIL", async () => {
    const job = await createStorageJob("Release without authority");
    await driveToReleaseAuthorisationPending(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.equal(attempt.ok, false, "release was authorised with no authority on file");

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal(
      String((state[0] as { service_state: string }).service_state),
      "release_authorisation_pending"
    );
  });

  it("RELEASE WITH AN UNVERIFIED AUTHORITY — MUST FAIL", async () => {
    const job = await createStorageJob("Release unverified");
    await driveToReleaseAuthorisationPending(job.serviceJobId);
    await grantReleaseAuthority(job.serviceJobId, { verify: false });

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.equal(attempt.ok, false, "an unverified authority opened the gate");
  });

  it("RELEASE WITH AN EXPIRED AUTHORITY — MUST FAIL", async () => {
    const job = await createStorageJob("Release expired");
    await driveToReleaseAuthorisationPending(job.serviceJobId);
    await grantReleaseAuthority(job.serviceJobId, { expiresAt: "2020-01-01T00:00:00.000Z" });

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.equal(attempt.ok, false, "an expired authority opened the gate");
  });

  it("RELEASE WITH A VOIDED AUTHORITY — MUST FAIL", async () => {
    const job = await createStorageJob("Release voided");
    await driveToReleaseAuthorisationPending(job.serviceJobId);
    const authorityId = await grantReleaseAuthority(job.serviceJobId);

    const voided = await voidReleaseAuthority(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      authorityId,
      voidReason: "The owner withdrew the collection instruction.",
    });
    assert.ok(voided.ok, voided.ok ? "" : voided.message);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.equal(attempt.ok, false, "a voided authority opened the gate");
  });

  it("RELEASE WITH A VALID VERIFIED AUTHORITY — MUST PASS", async () => {
    const job = await createStorageJob("Release authorised");
    await driveToReleaseAuthorisationPending(job.serviceJobId);
    await grantReleaseAuthority(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.ok(attempt.ok, attempt.ok ? "" : `release refused: ${attempt.message}`);

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal(String((state[0] as { service_state: string }).service_state), "release_authorised");
  });

  it("A CLIENT SENDING release_authorised: true — MUST BE IGNORED", async () => {
    const job = await createStorageJob("Release spoofed");
    await driveToReleaseAuthorisationPending(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
      context: { release_authorised: true, disposal_authorised: true } as never,
    });
    assert.equal(attempt.ok, false, "a client-supplied guard value was trusted");
  });

  it("A DISPOSAL AUTHORITY DOES NOT AUTHORISE RELEASE", async () => {
    const job = await createStorageJob("Disposal does not release");
    await driveToReleaseAuthorisationPending(job.serviceJobId);
    await grantDisposalAuthority(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "release_authorised",
    });
    assert.equal(attempt.ok, false, "a disposal authority released a vehicle");
  });

  /** storage_pending -> stored -> unclaimed -> disposal_notice_issued */
  async function driveToDisposalNoticeIssued(serviceJobId: string) {
    for (const toState of ["checked_in", "stored", "unclaimed", "disposal_notice_issued"]) {
      const result = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        toState,
        reason: toState === "unclaimed" ? "No contact from the owner for 60 days." : undefined,
      });
      assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
    }
  }

  it("DISPOSAL WITHOUT AUTHORITY — MUST FAIL", async () => {
    const job = await createStorageJob("Disposal without authority");
    await driveToDisposalNoticeIssued(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "disposal_authorised",
    });
    assert.equal(attempt.ok, false, "disposal was authorised with no authority on file");
  });

  it("A RELEASE AUTHORITY DOES NOT AUTHORISE DISPOSAL", async () => {
    const job = await createStorageJob("Release does not dispose");
    await driveToDisposalNoticeIssued(job.serviceJobId);
    await grantReleaseAuthority(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "disposal_authorised",
    });
    assert.equal(
      attempt.ok,
      false,
      "permission to hand a car back to its owner was treated as permission to scrap it"
    );
  });

  it("DISPOSAL WITH A VALID DISPOSAL AUTHORITY — MUST PASS", async () => {
    const job = await createStorageJob("Disposal authorised");
    await driveToDisposalNoticeIssued(job.serviceJobId);
    await grantDisposalAuthority(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "disposal_authorised",
    });
    assert.ok(attempt.ok, attempt.ok ? "" : `disposal refused: ${attempt.message}`);
  });

  it("A CLIENT SENDING disposal_authorised: true — MUST BE IGNORED", async () => {
    const job = await createStorageJob("Disposal spoofed");
    await driveToDisposalNoticeIssued(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "disposal_authorised",
      context: { disposal_authorised: true } as never,
    });
    assert.equal(attempt.ok, false, "a client-supplied guard value was trusted");
  });

  it("resolves the guard from the database, matching the pure decision", async () => {
    const job = await createStorageJob("Guard resolver agreement");
    await grantReleaseAuthority(job.serviceJobId);

    const at = new Date().toISOString();
    const resolved = await resolveAuthorityGuard(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
      authorityType: "release",
      at,
    });
    assert.equal(resolved.authorised, true);

    const rows = owner.sql(
      `SELECT id, authority_type, status, valid_from, expires_at, verified_at, verified_by
         FROM public.rr_release_authorisations WHERE service_job_id='${job.serviceJobId}'`
    ) as Record<string, unknown>[];

    const pure = decideAuthority(
      rows.map((row) => ({
        id: String(row.id),
        authorityType: String(row.authority_type) as "release" | "disposal",
        status: String(row.status),
        validFrom: row.valid_from ? String(row.valid_from) : null,
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        verifiedAt: row.verified_at ? String(row.verified_at) : null,
        verifiedBy: row.verified_by ? String(row.verified_by) : null,
      })),
      "release",
      at
    );
    assert.equal(pure.authorised, resolved.authorised);
    assert.equal(pure.authorityId, resolved.authorityId);
  });
});

// ---------------------------------------------------------------------------
// 4. STORAGE, AND THE FULL END-TO-END
// ---------------------------------------------------------------------------

describeIf("Phase 4 — storage and release, end to end", () => {
  it("charges storage from a server-stamped clock and seals it", async () => {
    const job = await createStorageJob("Storage accrual");

    const custody = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
    });
    assert.ok(custody.ok, custody.ok ? "" : custody.message);

    const checkedIn = await checkVehicleIntoStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      yardId: YARD,
      bayReference: "B12",
      rateBasis: "per_day",
      rateAmount: 150,
      freeDays: 1,
      storageCondition: "secure_compound",
      conditionOnArrival: "Front-end damage, driver door dented.",
    });
    assert.ok(checkedIn.ok, checkedIn.ok ? "" : checkedIn.message);

    // Checking in produced BOTH facts.
    const chain = await getCustodyChain(db as never, ALPHA, job.serviceJobId);
    assert.ok(chain.ok, chain.ok ? "" : chain.message);
    assert.equal(String(chain.data.holding?.holder_type), "yard");

    const position = await getStoragePosition(db as never, ALPHA, job.serviceJobId);
    assert.ok(position.ok, position.ok ? "" : position.message);
    assert.equal(position.data.bookings.length, 1);

    // Accrual six days on, evaluated at an instant we pass in.
    //
    // Anchored to the SERVER-stamped check-in rather than the client clock: the two differ
    // by milliseconds, and `per_day` counts any started day, so a check-in a fraction of a
    // second earlier than the client thinks would correctly bill a seventh day.
    const stored = owner.sql(
      `SELECT checked_in_at FROM public.rr_storage_bookings WHERE id='${checkedIn.data.bookingId}'`
    );
    const checkedInAt = new Date(String((stored[0] as { checked_in_at: string }).checked_in_at));
    const at = new Date(checkedInAt.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const accrual = await computeStorageAccrual(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
      at,
    });
    assert.ok(accrual.ok, accrual.ok ? "" : accrual.message);
    assert.equal(accrual.data.accrual.elapsedDays, 6);
    assert.equal(accrual.data.accrual.freeDaysApplied, 1);
    assert.equal(accrual.data.accrual.chargeableDays, 5);
    assert.equal(accrual.data.accrual.amount, 750);
  });

  it("RELEASE IS BLOCKED without authority, and says why", async () => {
    const job = await createStorageJob("Release eligibility blocked");
    await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
    });
    await checkVehicleIntoStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      yardId: YARD,
      rateAmount: 100,
    });

    const eligibility = await evaluateReleaseEligibility(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(eligibility.ok, eligibility.ok ? "" : eligibility.message);
    assert.equal(eligibility.data.eligible, false);
    assert.equal(eligibility.data.authorityOk, false);
    assert.ok(eligibility.data.reasons.length > 0);

    const attempt = await checkVehicleOutOfStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      collectorName: "Opportunist",
      collectorCapacity: "claims to be a friend",
    });
    assert.equal(attempt.ok, false, "a vehicle left the yard with no release authority");

    // Still in the yard, and nothing was billed.
    const position = await getStoragePosition(db as never, ALPHA, job.serviceJobId);
    assert.ok(position.ok, position.ok ? "" : position.message);
    assert.equal(String((position.data.bookings[0] as Record<string, unknown>).status), "stored");
    assert.equal(position.data.accruals.length, 0);
  });

  it("E2E — CREATE -> CUSTODY -> STORAGE -> AUTHORITY -> RELEASE", async () => {
    const job = await createStorageJob("Full storage E2E");

    // CUSTODY
    const taken = await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
      locationLabel: "N1 northbound",
    });
    assert.ok(taken.ok, taken.ok ? "" : taken.message);

    // STORAGE
    const checkedIn = await checkVehicleIntoStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      yardId: YARD,
      bayReference: "C4",
      rateBasis: "per_day",
      rateAmount: 200,
    });
    assert.ok(checkedIn.ok, checkedIn.ok ? "" : checkedIn.message);

    // RELEASE AUTHORISATION
    await grantReleaseAuthority(job.serviceJobId);

    // RELEASE EVIDENCE
    await satisfyReleaseEvidence(job.serviceJobId, job.fieldJobId);

    const eligibility = await evaluateReleaseEligibility(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(eligibility.ok, eligibility.ok ? "" : eligibility.message);
    assert.equal(
      eligibility.data.eligible,
      true,
      `still blocked: ${eligibility.data.reasons.join(" ")}`
    );

    // RELEASE
    const released = await checkVehicleOutOfStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      collectorName: "J Smith",
      collectorCapacity: "registered owner",
      collectorIdNumber: "8001015009087",
      conditionOnDeparture: "As received.",
    });
    assert.ok(released.ok, released.ok ? "" : `release failed: ${released.message}`);
    assert.ok(released.data.accrualId, "the storage charge was not sealed");

    // The chain ends with a named recipient.
    const chain = await getCustodyChain(db as never, ALPHA, job.serviceJobId);
    assert.ok(chain.ok, chain.ok ? "" : chain.message);
    assert.equal(chain.data.holding?.released, true);
    const last = chain.data.events[chain.data.events.length - 1] as Record<string, unknown>;
    assert.equal(String(last.event_type), "released");
    assert.equal(String(last.receiving_party_name), "J Smith");
    assert.ok(last.authority_id, "the release event did not record the authority it acted under");

    // The booking is closed and the charge is sealed and immutable.
    const position = await getStoragePosition(db as never, ALPHA, job.serviceJobId);
    assert.ok(position.ok, position.ok ? "" : position.message);
    assert.equal(String((position.data.bookings[0] as Record<string, unknown>).status), "checked_out");
    assert.equal(position.data.accruals.length, 1);
    assert.equal(
      String((position.data.accruals[0] as Record<string, unknown>).calculator_version),
      "rr-storage-accrual-1.0.0"
    );

    assert.throws(
      () =>
        owner.sql(
          `UPDATE public.rr_storage_accrual SET amount = 1
            WHERE id='${String((position.data.accruals[0] as Record<string, unknown>).id)}'
            RETURNING id`
        ),
      /append-only|not permitted/i
    );
  });

  it("a released vehicle cannot be released twice", async () => {
    const job = await createStorageJob("Double release");
    await recordCustodyEvent(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      eventType: "taken",
      holderType: "operator",
      holderName: "Alpha Recovery",
    });
    await checkVehicleIntoStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      yardId: YARD,
      rateAmount: 100,
    });
    await grantReleaseAuthority(job.serviceJobId);
    await satisfyReleaseEvidence(job.serviceJobId, job.fieldJobId);

    const first = await checkVehicleOutOfStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      collectorName: "J Smith",
      collectorCapacity: "registered owner",
    });
    assert.ok(first.ok, first.ok ? "" : first.message);

    const second = await checkVehicleOutOfStorage(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      collectorName: "Someone Else",
      collectorCapacity: "opportunist",
    });
    assert.equal(second.ok, false, "the same vehicle was released twice");
  });

  it("lists a job's authorities with their verification state", async () => {
    const job = await createStorageJob("Authority listing");
    await grantReleaseAuthority(job.serviceJobId);
    await grantDisposalAuthority(job.serviceJobId, false);

    const listed = await listReleaseAuthorities(db as never, ALPHA, job.serviceJobId);
    assert.ok(listed.ok, listed.ok ? "" : listed.message);
    assert.equal(listed.data.authorities.length, 2);

    const release = listed.data.authorities.find(
      (row) => String((row as Record<string, unknown>).authority_type) === "release"
    ) as Record<string, unknown>;
    const disposal = listed.data.authorities.find(
      (row) => String((row as Record<string, unknown>).authority_type) === "disposal"
    ) as Record<string, unknown>;

    assert.ok(release.verified_at, "the verified release authority shows as unverified");
    assert.equal(disposal.verified_at, null, "an unverified disposal authority shows as verified");
  });
});
