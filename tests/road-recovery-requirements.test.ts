/**
 * Phase 3 — pure requirements & compliance engine.
 *
 * Everything here is I/O-free. The engine is the thing that decides whether a job may be
 * invoiced, so it is tested as a function: facts in, verdict out, no database, no clock.
 *
 * The load-bearing assertions:
 *   - a waiver never SILENTLY satisfies a requirement
 *   - evidence_complete is false whenever anything blocking is outstanding
 *   - the same inputs always produce the same verdict
 *   - BYSTAND requires nothing about towing, destinations or custody
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALWAYS,
  RR_BLOCKING_SCOPES,
  RR_COMPLIANCE_ENGINE_VERSION,
  RR_EVIDENCE_KINDS,
  RR_EXCEPTION_CODES,
  RR_WAIVER_REASON_CODES,
  applicableRequirements,
  evaluateCompliance,
  evaluateCondition,
  resolveRequirementPolicy,
  validatePolicy,
  validateRequirementDefinition,
  type RrBlockingScope,
  type RrRequirementDefinition,
  type RrRequirementPolicy,
  type RrWaiverRecord,
} from "@/lib/road-recovery/requirements";

import {
  RR_DEFAULT_REQUIREMENT_POLICIES,
  assertBystandRequirementSeparation,
  defaultPolicyForService,
  policySeedRows,
  validateDefaultPolicies,
} from "@/lib/road-recovery/requirement-catalogue";

const AT = "2026-03-01T08:00:00.000Z";

function requirement(
  code: string,
  overrides: Partial<RrRequirementDefinition> = {}
): RrRequirementDefinition {
  return {
    requirementCode: code,
    label: code,
    evidenceKind: "photo",
    mandatory: true,
    condition: ALWAYS,
    minCount: 1,
    blockingScopes: ["invoice"],
    sortOrder: 10,
    ...overrides,
  };
}

function policy(overrides: Partial<RrRequirementPolicy> = {}): RrRequirementPolicy {
  return {
    policyKey: "test_policy",
    counterpartyId: null,
    serviceCode: null,
    version: 1,
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    requirements: [requirement("scene_photo")],
    ...overrides,
  };
}

function evaluate(
  requirements: RrRequirementDefinition[],
  options: {
    evidenceCounts?: Record<string, number>;
    waivers?: RrWaiverRecord[];
    facts?: Record<string, unknown>;
    scope?: RrBlockingScope;
  } = {}
) {
  return evaluateCompliance({
    requirements,
    evidenceCounts: options.evidenceCounts ?? {},
    waivers: options.waivers ?? [],
    facts: options.facts ?? {},
    scope: options.scope ?? "invoice",
    evaluatedAt: AT,
    policyKey: "test_policy",
    policyVersion: 1,
  });
}

const WAIVER: RrWaiverRecord = {
  requirementCode: "scene_photo",
  reasonCode: "vehicle_inaccessible",
  reasonDetail: "Vehicle recovered by SAPS before arrival.",
  waivedBy: "controller@alpha.test",
  approvedAt: AT,
};

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe("Phase 3 — declarative conditions", () => {
  it("treats a missing condition as always applicable", () => {
    assert.equal(evaluateCondition(null, {}), true);
    assert.equal(evaluateCondition(undefined, {}), true);
    assert.equal(evaluateCondition(ALWAYS, {}), true);
  });

  it("compares fields by operator", () => {
    const facts = { casualty: true, thirdPartyCount: 2, destinationType: "storage_yard" };
    assert.equal(evaluateCondition({ field: "casualty", op: "eq", value: true }, facts), true);
    assert.equal(evaluateCondition({ field: "casualty", op: "neq", value: true }, facts), false);
    assert.equal(evaluateCondition({ field: "thirdPartyCount", op: "gt", value: 1 }, facts), true);
    assert.equal(evaluateCondition({ field: "thirdPartyCount", op: "lt", value: 1 }, facts), false);
    assert.equal(
      evaluateCondition({ field: "destinationType", op: "in", value: ["storage_yard"] }, facts),
      true
    );
    assert.equal(evaluateCondition({ field: "policeReference", op: "absent" }, facts), true);
    assert.equal(evaluateCondition({ field: "destinationType", op: "present" }, facts), true);
  });

  it("treats an empty string as absent, because a blank form field is not a value", () => {
    assert.equal(evaluateCondition({ field: "policeReference", op: "present" }, { policeReference: "" }), false);
    assert.equal(evaluateCondition({ field: "policeReference", op: "absent" }, { policeReference: "" }), true);
  });

  it("composes with all / any / not", () => {
    const facts = { casualty: true, drivable: false };
    assert.equal(
      evaluateCondition(
        {
          all: [
            { field: "casualty", op: "eq", value: true },
            { field: "drivable", op: "eq", value: false },
          ],
        },
        facts
      ),
      true
    );
    assert.equal(
      evaluateCondition({ any: [{ field: "casualty", op: "eq", value: false }, { field: "drivable", op: "eq", value: false }] }, facts),
      true
    );
    assert.equal(evaluateCondition({ not: { field: "casualty", op: "eq", value: true } }, facts), false);
  });

  it("evaluates an unknown operator as NOT applicable, so a malformed policy under-demands rather than blocking every job", () => {
    const condition = { field: "casualty", op: "sql_injection" } as never;
    assert.equal(evaluateCondition(condition, { casualty: true }), false);
  });
});

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

describe("Phase 3 — policy resolution", () => {
  const tenantDefault = policy({ policyKey: "tenant_default" });
  const tenantService = policy({ policyKey: "tenant_tow", serviceCode: "tow_in" });
  const counterpartyAll = policy({ policyKey: "cp_all", counterpartyId: "cp-1" });
  const counterpartyService = policy({
    policyKey: "cp_tow",
    counterpartyId: "cp-1",
    serviceCode: "tow_in",
  });

  const all = [tenantDefault, tenantService, counterpartyAll, counterpartyService];

  it("prefers counterparty + service over every less specific policy", () => {
    const resolved = resolveRequirementPolicy(all, {
      counterpartyId: "cp-1",
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(resolved.policy?.policyKey, "cp_tow");
  });

  it("falls back through counterparty, then service, then tenant default", () => {
    assert.equal(
      resolveRequirementPolicy([tenantDefault, tenantService, counterpartyAll], {
        counterpartyId: "cp-1",
        serviceCode: "tow_in",
        at: AT,
      }).policy?.policyKey,
      "cp_all"
    );
    assert.equal(
      resolveRequirementPolicy([tenantDefault, tenantService], {
        counterpartyId: "cp-1",
        serviceCode: "tow_in",
        at: AT,
      }).policy?.policyKey,
      "tenant_tow"
    );
    assert.equal(
      resolveRequirementPolicy([tenantDefault], {
        counterpartyId: "cp-1",
        serviceCode: "tow_in",
        at: AT,
      }).policy?.policyKey,
      "tenant_default"
    );
  });

  it("never returns another counterparty's policy", () => {
    const resolved = resolveRequirementPolicy([counterpartyService], {
      counterpartyId: "cp-2",
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(resolved.policy, null);
  });

  it("ignores inactive policies", () => {
    const resolved = resolveRequirementPolicy([policy({ active: false })], {
      counterpartyId: null,
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(resolved.policy, null);
  });

  it("respects effective dates in both directions", () => {
    const future = policy({ policyKey: "future", effectiveFrom: "2026-06-01T00:00:00.000Z" });
    const past = policy({ policyKey: "past", effectiveTo: "2026-01-01T00:00:00.000Z" });
    const current = policy({
      policyKey: "current",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-12-31T00:00:00.000Z",
    });

    assert.equal(
      resolveRequirementPolicy([future, past, current], {
        counterpartyId: null,
        serviceCode: "tow_in",
        at: AT,
      }).policy?.policyKey,
      "current"
    );
  });

  it("prefers the highest version when specificity ties", () => {
    const v1 = policy({ policyKey: "same", version: 1 });
    const v2 = policy({ policyKey: "same", version: 2 });
    assert.equal(
      resolveRequirementPolicy([v1, v2], { counterpartyId: null, serviceCode: "tow_in", at: AT })
        .policy?.version,
      2
    );
  });

  it("resolves deterministically when specificity AND version tie", () => {
    const alpha = policy({ policyKey: "alpha" });
    const zulu = policy({ policyKey: "zulu" });
    const forwards = resolveRequirementPolicy([alpha, zulu], {
      counterpartyId: null,
      serviceCode: "tow_in",
      at: AT,
    });
    const backwards = resolveRequirementPolicy([zulu, alpha], {
      counterpartyId: null,
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(forwards.policy?.policyKey, backwards.policy?.policyKey);
  });

  it("explains which policy it chose", () => {
    assert.match(
      resolveRequirementPolicy(all, { counterpartyId: "cp-1", serviceCode: "tow_in", at: AT })
        .reason,
      /Counterparty policy/
    );
    assert.match(
      resolveRequirementPolicy([tenantDefault], {
        counterpartyId: null,
        serviceCode: "tow_in",
        at: AT,
      }).reason,
      /Tenant default/
    );
  });
});

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

describe("Phase 3 — requirement applicability", () => {
  it("drops requirements whose condition does not hold", () => {
    const requirements = [
      requirement("always_needed"),
      requirement("casualty_report", {
        condition: { field: "casualty", op: "eq", value: true },
      }),
    ];

    assert.deepEqual(
      applicableRequirements(requirements, { casualty: false }).map((r) => r.requirementCode),
      ["always_needed"]
    );
    assert.deepEqual(
      applicableRequirements(requirements, { casualty: true }).map((r) => r.requirementCode),
      ["always_needed", "casualty_report"]
    );
  });

  it("orders by sortOrder, then code, so the driver's checklist is stable", () => {
    const requirements = [
      requirement("zulu", { sortOrder: 10 }),
      requirement("alpha", { sortOrder: 10 }),
      requirement("first", { sortOrder: 1 }),
    ];
    assert.deepEqual(
      applicableRequirements(requirements, {}).map((r) => r.requirementCode),
      ["first", "alpha", "zulu"]
    );
  });
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

describe("Phase 3 — compliance evaluation", () => {
  it("is compliant when everything mandatory has been captured", () => {
    const result = evaluate([requirement("scene_photo")], { evidenceCounts: { scene_photo: 1 } });
    assert.equal(result.status, "compliant");
    assert.equal(result.evidenceComplete, true);
    assert.deepEqual(result.blocking, []);
    assert.equal(result.completenessPercent, 100);
  });

  it("is non_compliant, and evidence_complete false, when a blocking requirement is missing", () => {
    const result = evaluate([requirement("scene_photo")]);
    assert.equal(result.status, "non_compliant");
    assert.equal(result.evidenceComplete, false);
    assert.deepEqual(result.blocking, ["scene_photo"]);
  });

  it("counts minCount properly: a partial capture does not satisfy", () => {
    const twoPhotos = requirement("damage_photos", { minCount: 4 });
    const partial = evaluate([twoPhotos], { evidenceCounts: { damage_photos: 3 } });
    assert.equal(partial.evidenceComplete, false);
    assert.equal(partial.results[0].capturedCount, 3);

    const complete = evaluate([twoPhotos], { evidenceCounts: { damage_photos: 4 } });
    assert.equal(complete.evidenceComplete, true);
  });

  it("is incomplete — not blocked — when the missing requirement blocks a DIFFERENT scope", () => {
    const releaseOnly = requirement("release_form", { blockingScopes: ["release"] });
    const result = evaluate([releaseOnly], { scope: "invoice" });
    assert.equal(result.status, "incomplete");
    assert.equal(result.evidenceComplete, true);
    assert.deepEqual(result.missing, ["release_form"]);
    assert.deepEqual(result.blocking, []);
  });

  it("does not block on a non-mandatory requirement", () => {
    const optional = requirement("nice_to_have", { mandatory: false });
    const result = evaluate([optional]);
    assert.equal(result.evidenceComplete, true);
    assert.deepEqual(result.blocking, []);
  });

  it("ignores requirements that do not apply to this job", () => {
    const conditional = requirement("casualty_report", {
      condition: { field: "casualty", op: "eq", value: true },
    });
    const result = evaluate([conditional], { facts: { casualty: false } });
    assert.equal(result.status, "compliant");
    assert.equal(result.applicableCount, 0);
    assert.equal(result.results[0].applicable, false);
  });
});

// ---------------------------------------------------------------------------
// Waivers — the rule that matters most
// ---------------------------------------------------------------------------

describe("Phase 3 — waivers are never silent", () => {
  it("unblocks the job but reports the waiver in the verdict", () => {
    const result = evaluate([requirement("scene_photo")], { waivers: [WAIVER] });

    assert.equal(result.status, "waived_compliant");
    assert.equal(result.evidenceComplete, true);
    assert.deepEqual(result.waived, ["scene_photo"]);
    assert.deepEqual(result.blocking, []);
    // The verdict is NOT "compliant". A reader can always tell the difference between
    // evidence that exists and evidence that was excused.
    assert.notEqual(result.status, "compliant");
  });

  it("carries the reason, the authoriser and the approval time onto the result", () => {
    const result = evaluate([requirement("scene_photo")], { waivers: [WAIVER] });
    const entry = result.results[0];
    assert.equal(entry.waived, true);
    assert.equal(entry.waiver?.reasonCode, "vehicle_inaccessible");
    assert.equal(entry.waiver?.waivedBy, "controller@alpha.test");
    assert.equal(entry.waiver?.approvedAt, AT);
  });

  it("prefers real evidence over a waiver when both exist", () => {
    const result = evaluate([requirement("scene_photo")], {
      evidenceCounts: { scene_photo: 1 },
      waivers: [WAIVER],
    });
    assert.equal(result.status, "compliant");
    assert.deepEqual(result.waived, []);
    assert.equal(result.results[0].waived, false);
  });

  it("a waiver for a requirement that is not on the job changes nothing", () => {
    const result = evaluate([requirement("other_photo")], {
      waivers: [{ ...WAIVER, requirementCode: "scene_photo" }],
    });
    assert.equal(result.status, "non_compliant");
    assert.deepEqual(result.blocking, ["other_photo"]);
  });

  it("waiving every blocking requirement never produces a plain 'compliant' verdict", () => {
    const result = evaluate([requirement("a"), requirement("b")], {
      waivers: [
        { ...WAIVER, requirementCode: "a" },
        { ...WAIVER, requirementCode: "b" },
      ],
    });
    assert.equal(result.status, "waived_compliant");
    assert.equal(result.waived.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Phase 3 — the engine is deterministic", () => {
  const requirements = [
    requirement("scene_photo"),
    requirement("damage_photos", { minCount: 4, sortOrder: 20 }),
    requirement("casualty_report", {
      condition: { field: "casualty", op: "eq", value: true },
      sortOrder: 30,
    }),
  ];

  it("produces byte-identical verdicts for identical inputs", () => {
    const input = {
      evidenceCounts: { scene_photo: 1, damage_photos: 2 },
      waivers: [WAIVER],
      facts: { casualty: true },
    };
    const first = evaluate(requirements, input);
    const second = evaluate(requirements, input);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("does not depend on the order requirements arrive in", () => {
    const forwards = evaluate(requirements, { facts: { casualty: true } });
    const backwards = evaluate([...requirements].reverse(), { facts: { casualty: true } });
    assert.deepEqual(forwards.blocking, backwards.blocking);
    assert.equal(forwards.status, backwards.status);
    assert.equal(forwards.completenessPercent, backwards.completenessPercent);
  });

  it("stamps the engine version, so an old verdict can be re-read against the rules that produced it", () => {
    const result = evaluate(requirements);
    assert.equal(result.engineVersion, RR_COMPLIANCE_ENGINE_VERSION);
    assert.equal(result.evaluatedAt, AT);
    assert.equal(result.policyKey, "test_policy");
    assert.equal(result.policyVersion, 1);
  });

  it("reads no clock of its own", () => {
    const source = evaluateCompliance.toString();
    assert.equal(/Date\.now\(\)/.test(source), false);
    assert.equal(/new Date\(\s*\)/.test(source), false);
  });

  it("keeps evidence_complete exactly equal to 'nothing is blocking'", () => {
    const cases = [
      evaluate([requirement("a")]),
      evaluate([requirement("a")], { evidenceCounts: { a: 1 } }),
      evaluate([requirement("a")], { waivers: [{ ...WAIVER, requirementCode: "a" }] }),
      evaluate([requirement("a", { blockingScopes: ["release"] })]),
      evaluate([requirement("a", { mandatory: false })]),
    ];
    for (const result of cases) {
      assert.equal(result.evidenceComplete, result.blocking.length === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("Phase 3 — policy validation", () => {
  it("rejects an unknown evidence kind", () => {
    assert.throws(
      () => validateRequirementDefinition(requirement("x", { evidenceKind: "telepathy" as never })),
      /evidence kind/i
    );
  });

  it("rejects an unknown blocking scope", () => {
    assert.throws(
      () => validateRequirementDefinition(requirement("x", { blockingScopes: ["vibes" as never] })),
      /scope/i
    );
  });

  it("rejects a duplicate requirement code inside one policy", () => {
    assert.throws(
      () => validatePolicy(policy({ requirements: [requirement("dup"), requirement("dup")] })),
      /duplicate/i
    );
  });

  it("rejects a policy that ends before it begins", () => {
    assert.throws(
      () =>
        validatePolicy(
          policy({
            effectiveFrom: "2026-06-01T00:00:00.000Z",
            effectiveTo: "2026-01-01T00:00:00.000Z",
          })
        ),
      /ends before/i
    );
  });

  it("accepts a well-formed policy", () => {
    assert.doesNotThrow(() => validatePolicy(policy()));
  });
});

// ---------------------------------------------------------------------------
// Shipped defaults
// ---------------------------------------------------------------------------

describe("Phase 3 — the seeded default catalogue", () => {
  it("passes its own validator", () => {
    assert.doesNotThrow(() => validateDefaultPolicies());
  });

  it("covers all eight services", () => {
    const services = [
      "accident_recovery",
      "tow_in",
      "jump_start",
      "roadside_assistance",
      "bystand",
      "heavy_recovery",
      "vehicle_movement",
      "storage",
    ];
    for (const service of services) {
      const found = defaultPolicyForService(service);
      assert.ok(found, `no default policy for ${service}`);
      assert.ok(found.requirements.length > 0, `${service} policy has no requirements`);
    }
    assert.equal(RR_DEFAULT_REQUIREMENT_POLICIES.length, services.length);
  });

  it("uses only recognised evidence kinds and scopes", () => {
    for (const shipped of RR_DEFAULT_REQUIREMENT_POLICIES) {
      for (const entry of shipped.requirements) {
        assert.ok(
          (RR_EVIDENCE_KINDS as readonly string[]).includes(entry.evidenceKind),
          `${shipped.policyKey}/${entry.requirementCode} uses ${entry.evidenceKind}`
        );
        for (const scope of entry.blockingScopes) {
          assert.ok((RR_BLOCKING_SCOPES as readonly string[]).includes(scope));
        }
      }
    }
  });

  it("hardcodes no insurer name in any policy key", () => {
    const insurers = ["santam", "outsurance", "discovery", "aa_", "hollard", "momentum"];
    for (const shipped of RR_DEFAULT_REQUIREMENT_POLICIES) {
      for (const insurer of insurers) {
        assert.equal(
          shipped.policyKey.includes(insurer),
          false,
          `${shipped.policyKey} names a specific insurer; requirements must be tenant data`
        );
      }
      // Every shipped default is a TENANT default, never bound to a counterparty.
      assert.equal(shipped.counterpartyId, null);
    }
  });

  it("emits one seed row per policy, carrying every requirement", () => {
    const rows = policySeedRows();
    assert.equal(rows.length, RR_DEFAULT_REQUIREMENT_POLICIES.length);

    const totalRequirements = rows.reduce(
      (total, row) => total + (row.requirements as unknown[]).length,
      0
    );
    const expected = RR_DEFAULT_REQUIREMENT_POLICIES.reduce(
      (total, shipped) => total + shipped.requirements.length,
      0
    );
    assert.equal(totalRequirements, expected);

    // Seed rows are what sql/073 writes, so they must be in database naming.
    for (const row of rows) {
      for (const entry of row.requirements as Record<string, unknown>[]) {
        assert.ok("requirement_code" in entry);
        assert.ok("evidence_kind" in entry);
        assert.ok("blocking_scopes" in entry);
        assert.ok(Array.isArray(entry.blocking_scopes));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// BYSTAND separation
// ---------------------------------------------------------------------------

describe("Phase 3 — BYSTAND stays a distinct service", () => {
  const bystand = defaultPolicyForService("bystand");

  it("passes the separation assertion", () => {
    assert.doesNotThrow(() => assertBystandRequirementSeparation());
  });

  it("requires nothing about towing, destinations, loading, custody or delivery", () => {
    assert.ok(bystand);
    const forbidden = [
      "destination",
      "delivery",
      "handover",
      "custody",
      "loading",
      "securing",
      "unload",
      "release",
      "tow",
      "storage",
    ];
    for (const entry of bystand.requirements) {
      for (const word of forbidden) {
        assert.equal(
          entry.requirementCode.includes(word),
          false,
          `BYSTAND requires "${entry.requirementCode}", which is a recovery concern`
        );
      }
      assert.notEqual(entry.evidenceKind, "handover");
    }
  });

  it("requires what BYSTAND actually is: arrival, presence, observation and stand-down", () => {
    assert.ok(bystand);
    const codes = bystand.requirements.map((entry) => entry.requirementCode);
    for (const expected of [
      "gps_arrival",
      "bystand_periodic_presence",
      "bystand_observation_report",
      "bystand_stand_down_record",
    ]) {
      assert.ok(codes.includes(expected), `BYSTAND is missing "${expected}"`);
    }
  });

  it("bills standing presence more than once — a single photo is not an attendance", () => {
    assert.ok(bystand);
    const presence = bystand.requirements.find(
      (entry) => entry.requirementCode === "bystand_periodic_presence"
    );
    assert.ok(presence);
    assert.ok(presence.minCount >= 2, "periodic presence must require more than one capture");
  });

  it("a BYSTAND job with its own evidence is compliant without any recovery evidence", () => {
    assert.ok(bystand);
    const counts: Record<string, number> = {};
    for (const entry of bystand.requirements) counts[entry.requirementCode] = entry.minCount;

    const result = evaluateCompliance({
      requirements: bystand.requirements,
      evidenceCounts: counts,
      waivers: [],
      facts: { serviceCode: "bystand", converted: false },
      scope: "invoice",
      evaluatedAt: AT,
      policyKey: bystand.policyKey,
      policyVersion: bystand.version,
    });

    assert.equal(result.evidenceComplete, true);
    assert.equal(result.status, "compliant");
  });

  it("differs materially from the recovery policies rather than being a copy", () => {
    assert.ok(bystand);
    const recovery = defaultPolicyForService("accident_recovery");
    assert.ok(recovery);
    const bystandCodes = new Set(bystand.requirements.map((entry) => entry.requirementCode));
    const recoveryCodes = new Set(recovery.requirements.map((entry) => entry.requirementCode));
    const shared = [...bystandCodes].filter((code) => recoveryCodes.has(code));
    assert.ok(
      shared.length < bystandCodes.size,
      "BYSTAND requirements are a subset of recovery requirements; the services are not distinct"
    );
  });
});

// ---------------------------------------------------------------------------
// Exception and waiver vocabularies
// ---------------------------------------------------------------------------

describe("Phase 3 — exception and waiver vocabularies", () => {
  it("declares the sixteen exception codes", () => {
    assert.equal(RR_EXCEPTION_CODES.length, 16);
    assert.equal(new Set(RR_EXCEPTION_CODES).size, 16);
  });

  it("declares waiver reason codes, all distinct", () => {
    assert.ok(RR_WAIVER_REASON_CODES.length > 0);
    assert.equal(new Set(RR_WAIVER_REASON_CODES).size, RR_WAIVER_REASON_CODES.length);
  });
});
