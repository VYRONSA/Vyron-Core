/**
 * Deterministic dispatch engine (Phase 1).
 *
 * The engine is pure, so these tests exercise the real production logic with no database
 * and no clock. What is being protected:
 *
 *   1. eligibility is decided by HARD GATES, never by a low score
 *   2. an expired blocks_dispatch certification makes a driver ineligible, full stop
 *   3. capability is matched, not assumed
 *   4. every candidate — eligible or not — carries its full reasoning
 *   5. identical input always produces identical output, including tie-breaks
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RR_DISPATCH_ENGINE_VERSION,
  distanceKmBetween,
  evaluateCapability,
  evaluateCertifications,
  evaluateDispatchCandidates,
  isCertificationValid,
  requirementForService,
  scoreCandidate,
  totalScore,
  type RrCandidateInput,
  type RrCertificationSnapshot,
  type RrDriverSnapshot,
  type RrTruckSnapshot,
} from "@/lib/road-recovery/dispatch";

const COMPANY = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_COMPANY = "bbbbbbbb-0000-4000-8000-000000000002";
const TODAY = "2026-08-18T06:00:00.000Z";

/** Cape Town CBD-ish scene. */
const SCENE = { latitude: -33.9249, longitude: 18.4241 };

function certification(
  type: string,
  overrides: Partial<RrCertificationSnapshot> = {}
): RrCertificationSnapshot {
  return {
    certificationType: type,
    status: "active",
    expiresAt: "2027-01-01",
    blocksDispatch: true,
    ...overrides,
  };
}

function driver(overrides: Partial<RrDriverSnapshot> = {}): RrDriverSnapshot {
  return {
    employeeId: "driver-1",
    companyId: COMPANY,
    displayName: "Thandi Nkosi",
    active: true,
    certifications: [certification("drivers_licence"), certification("prdp")],
    conflictingAssignmentId: null,
    ...overrides,
  };
}

function truck(overrides: Partial<RrTruckSnapshot> = {}): RrTruckSnapshot {
  return {
    towTruckProfileId: "truck-1",
    fieldVehicleId: "vehicle-1",
    companyId: COMPANY,
    registration: "CA 123-456",
    towClass: "flatbed",
    payloadCapacityKg: 3000,
    maxVehicleLengthM: 5.5,
    hasWinch: true,
    hasBoom: false,
    equipment: ["straps", "dollies"],
    availabilityStatus: "available",
    operationalStatus: "operational",
    // ~6.2km from the scene.
    latitude: -33.87,
    longitude: 18.45,
    ...overrides,
  };
}

function evaluate(candidates: RrCandidateInput[], serviceCode = "tow_in") {
  return evaluateDispatchCandidates({
    companyId: COMPANY,
    serviceJobId: "job-1",
    scene: SCENE,
    requirement: requirementForService(serviceCode),
    candidates,
    evaluatedAt: TODAY,
  });
}

describe("capability matching", () => {
  it("accepts a truck whose class is permitted", () => {
    const result = evaluateCapability(truck(), requirementForService("tow_in"));
    assert.equal(result.passed, true);
    assert.equal(result.towClassPermitted, true);
  });

  it("rejects a tow class the service does not permit", () => {
    const result = evaluateCapability(
      truck({ towClass: "light_duty" }),
      requirementForService("tow_in")
    );
    assert.equal(result.towClassPermitted, false);
    assert.equal(result.passed, false);
  });

  it("rejects a truck that cannot carry the casualty vehicle", () => {
    const result = evaluateCapability(truck({ payloadCapacityKg: 1200 }), {
      ...requirementForService("tow_in"),
      vehicleMassKg: 2500,
    });
    assert.equal(result.payloadOk, false);
    assert.equal(result.passed, false);
  });

  it("rejects a deck shorter than the casualty vehicle", () => {
    const result = evaluateCapability(truck({ maxVehicleLengthM: 4 }), {
      ...requirementForService("tow_in"),
      vehicleLengthM: 6,
    });
    assert.equal(result.lengthOk, false);
  });

  it("requires a winch when the service demands one", () => {
    const result = evaluateCapability(
      truck({ hasWinch: false }),
      requirementForService("accident_recovery")
    );
    assert.equal(result.winchOk, false);
    assert.equal(result.passed, false);
  });

  it("requires a boom for heavy recovery", () => {
    const result = evaluateCapability(
      truck({ towClass: "rotator", hasBoom: false }),
      requirementForService("heavy_recovery")
    );
    assert.equal(result.boomOk, false);
  });

  it("reports missing equipment by name", () => {
    const result = evaluateCapability(truck({ equipment: ["straps"] }), {
      ...requirementForService("tow_in"),
      requiredEquipment: ["dollies", "skates"],
    });
    assert.deepEqual(result.missingEquipment, ["dollies", "skates"]);
    assert.equal(result.passed, false);
  });

  it("treats an unknown capacity as unknown, not as insufficient", () => {
    const result = evaluateCapability(truck({ payloadCapacityKg: null }), {
      ...requirementForService("tow_in"),
      vehicleMassKg: 9000,
    });
    assert.equal(result.payloadOk, true);
  });

  it("fails a candidate with no truck at all", () => {
    assert.equal(evaluateCapability(null, requirementForService("tow_in")).passed, false);
  });
});

describe("certification validity", () => {
  it("accepts a certification expiring in the future", () => {
    assert.equal(isCertificationValid(certification("prdp", { expiresAt: "2027-01-01" }), TODAY), true);
  });

  it("accepts a certification expiring today (inclusive)", () => {
    assert.equal(isCertificationValid(certification("prdp", { expiresAt: "2026-08-18" }), TODAY), true);
  });

  it("rejects a certification that expired yesterday", () => {
    assert.equal(isCertificationValid(certification("prdp", { expiresAt: "2026-08-17" }), TODAY), false);
  });

  it("accepts a certification with no expiry", () => {
    assert.equal(isCertificationValid(certification("prdp", { expiresAt: null }), TODAY), true);
  });

  it("rejects a suspended certification even when in date", () => {
    assert.equal(
      isCertificationValid(certification("prdp", { status: "suspended" }), TODAY),
      false
    );
  });

  it("reports required certifications the driver does not hold", () => {
    const result = evaluateCertifications(
      driver({ certifications: [certification("drivers_licence")] }),
      requirementForService("tow_in"),
      TODAY
    );
    assert.deepEqual(result.missing, ["prdp"]);
    assert.equal(result.passed, false);
  });

  it("reports an expired required certification separately from a missing one", () => {
    const result = evaluateCertifications(
      driver({
        certifications: [certification("drivers_licence"), certification("prdp", { expiresAt: "2020-01-01" })],
      }),
      requirementForService("tow_in"),
      TODAY
    );
    assert.deepEqual(result.expired, ["prdp"]);
    assert.deepEqual(result.missing, []);
  });

  it("grounds a driver whose blocks_dispatch certification expired even if this service did not ask for it", () => {
    const result = evaluateCertifications(
      driver({
        certifications: [
          certification("drivers_licence"),
          certification("prdp"),
          certification("medical_certificate", { expiresAt: "2020-01-01" }),
        ],
      }),
      requirementForService("tow_in"),
      TODAY
    );
    assert.equal(result.passed, false);
    assert.ok(result.expired.includes("medical_certificate"));
  });

  it("ignores a NON-blocking certification that expired", () => {
    const result = evaluateCertifications(
      driver({
        certifications: [
          certification("drivers_licence"),
          certification("prdp"),
          certification("first_aid", { expiresAt: "2020-01-01", blocksDispatch: false }),
        ],
      }),
      requirementForService("tow_in"),
      TODAY
    );
    assert.equal(result.passed, true);
  });
});

describe("eligibility gates", () => {
  it("passes a fully qualified driver with the right truck", () => {
    const result = evaluate([{ driver: driver(), truck: truck() }]);
    assert.equal(result.candidates[0].eligible, true);
    assert.deepEqual(result.candidates[0].eligibilityFailures, []);
    assert.equal(result.recommended?.employeeId, "driver-1");
  });

  it("REJECTS a driver with an expired certification — it is a gate, not a score", () => {
    const result = evaluate([
      {
        driver: driver({
          certifications: [certification("drivers_licence"), certification("prdp", { expiresAt: "2020-01-01" })],
        }),
        // Right next to the scene, so a scoring-based approach would have picked them.
        truck: truck({ latitude: SCENE.latitude, longitude: SCENE.longitude }),
      },
    ]);
    assert.equal(result.candidates[0].eligible, false);
    assert.equal(result.recommended, null);
    assert.ok(
      result.candidates[0].eligibilityFailures.some((f) => f.code === "certification_expired")
    );
  });

  it("rejects an unavailable truck", () => {
    const result = evaluate([{ driver: driver(), truck: truck({ availabilityStatus: "maintenance" }) }]);
    assert.equal(result.candidates[0].eligible, false);
    assert.ok(result.candidates[0].eligibilityFailures.some((f) => f.code === "truck_unavailable"));
  });

  it("rejects a grounded truck", () => {
    const result = evaluate([{ driver: driver(), truck: truck({ operationalStatus: "grounded" }) }]);
    assert.ok(
      result.candidates[0].eligibilityFailures.some((f) => f.code === "truck_not_operational")
    );
  });

  it("rejects an incapable truck", () => {
    const result = evaluate([{ driver: driver(), truck: truck({ towClass: "light_duty" }) }]);
    assert.ok(
      result.candidates[0].eligibilityFailures.some((f) => f.code === "tow_class_not_permitted")
    );
  });

  it("rejects an inactive driver", () => {
    const result = evaluate([{ driver: driver({ active: false }), truck: truck() }]);
    assert.ok(result.candidates[0].eligibilityFailures.some((f) => f.code === "driver_inactive"));
  });

  it("rejects a driver already committed to another job", () => {
    const result = evaluate([
      { driver: driver({ conflictingAssignmentId: "assignment-9" }), truck: truck() },
    ]);
    assert.ok(
      result.candidates[0].eligibilityFailures.some(
        (f) => f.code === "driver_has_conflicting_assignment"
      )
    );
    assert.equal(result.candidates[0].conflictingAssignmentId, "assignment-9");
  });

  it("rejects a driver with no truck", () => {
    const result = evaluate([{ driver: driver(), truck: null }]);
    assert.ok(result.candidates[0].eligibilityFailures.some((f) => f.code === "truck_unavailable"));
  });

  it("rejects a candidate from another tenant", () => {
    const result = evaluate([
      { driver: driver({ companyId: OTHER_COMPANY }), truck: truck({ companyId: OTHER_COMPANY }) },
    ]);
    assert.equal(result.candidates[0].eligible, false);
    assert.ok(result.candidates[0].eligibilityFailures.some((f) => f.code === "tenant_mismatch"));
  });

  it("rejects a candidate outside the dispatch radius", () => {
    const result = evaluateDispatchCandidates({
      companyId: COMPANY,
      serviceJobId: "job-1",
      scene: SCENE,
      requirement: { ...requirementForService("tow_in"), maxDispatchRadiusKm: 2 },
      candidates: [{ driver: driver(), truck: truck() }],
      evaluatedAt: TODAY,
    });
    assert.ok(
      result.candidates[0].eligibilityFailures.some((f) => f.code === "outside_operating_radius")
    );
  });

  it("never recommends an ineligible candidate, even as the only option", () => {
    const result = evaluate([{ driver: driver({ active: false }), truck: truck() }]);
    assert.equal(result.recommended, null);
    assert.equal(result.eligible.length, 0);
    assert.match(result.noCandidateReason || "", /No eligible candidate/);
  });

  it("explains the most common blocker when nothing is eligible", () => {
    const result = evaluate([
      { driver: driver({ employeeId: "d1", active: false }), truck: truck() },
      { driver: driver({ employeeId: "d2", active: false }), truck: truck() },
    ]);
    assert.match(result.noCandidateReason || "", /driver inactive \(2 of 2\)/);
  });
});

describe("scoring and ranking", () => {
  it("ranks a closer truck above a distant one", () => {
    const near = {
      driver: driver({ employeeId: "near" }),
      truck: truck({ towTruckProfileId: "t-near", latitude: -33.93, longitude: 18.43 }),
    };
    const far = {
      driver: driver({ employeeId: "far" }),
      truck: truck({ towTruckProfileId: "t-far", latitude: -34.4, longitude: 19.2 }),
    };
    const result = evaluate([far, near]);
    assert.equal(result.eligible[0].employeeId, "near");
    assert.equal(result.eligible[0].rank, 1);
    assert.equal(result.eligible[1].rank, 2);
  });

  it("prefers the lightest truck that can still do the job", () => {
    const flatbed = {
      driver: driver({ employeeId: "flatbed" }),
      truck: truck({ towTruckProfileId: "t1", towClass: "flatbed" }),
    };
    const rotator = {
      driver: driver({ employeeId: "rotator" }),
      truck: truck({ towTruckProfileId: "t2", towClass: "rotator", hasBoom: true }),
    };
    const result = evaluate([rotator, flatbed]);
    assert.equal(result.recommended?.employeeId, "flatbed");
  });

  it("breaks ties deterministically rather than by input order", () => {
    const a = { driver: driver({ employeeId: "aaa" }), truck: truck({ towTruckProfileId: "t1" }) };
    const b = { driver: driver({ employeeId: "bbb" }), truck: truck({ towTruckProfileId: "t2" }) };
    const forward = evaluate([a, b]);
    const reversed = evaluate([b, a]);
    assert.equal(forward.recommended?.employeeId, "aaa");
    assert.equal(reversed.recommended?.employeeId, "aaa");
  });

  it("produces identical output for identical input", () => {
    const candidates = [{ driver: driver(), truck: truck() }];
    assert.deepEqual(evaluate(candidates), evaluate(candidates));
  });

  it("gives an ineligible candidate a zero score", () => {
    const result = evaluate([{ driver: driver({ active: false }), truck: truck() }]);
    assert.equal(result.candidates[0].finalScore, 0);
    assert.equal(result.candidates[0].rank, null);
  });

  it("does not bury a truck with no GPS fix", () => {
    const components = scoreCandidate(
      { driver: driver(), truck: truck({ latitude: null, longitude: null }) },
      requirementForService("tow_in"),
      null
    );
    assert.ok(components.proximity > 0);
  });

  it("sums score components into the final score", () => {
    const components = scoreCandidate(
      { driver: driver(), truck: truck() },
      requirementForService("tow_in"),
      6.2
    );
    assert.equal(
      totalScore(components),
      Math.round(
        (components.proximity + components.availability + components.capabilityFit + components.workload) *
          1000
      ) / 1000
    );
  });
});

describe("explainability", () => {
  it("retains every required field on each candidate", () => {
    const result = evaluate([{ driver: driver(), truck: truck() }]);
    const candidate = result.candidates[0];

    assert.equal(typeof candidate.eligible, "boolean");
    assert.ok(Array.isArray(candidate.eligibilityFailures));
    assert.equal(typeof candidate.distanceKm, "number");
    assert.ok(candidate.capabilityResult);
    assert.ok(candidate.certificationResult);
    assert.equal(candidate.availabilityStatus, "available");
    assert.equal(candidate.conflictingAssignmentId, null);
    assert.ok(candidate.scoreComponents);
    assert.equal(typeof candidate.finalScore, "number");
    assert.equal(candidate.rank, 1);
    assert.equal(candidate.recommended, true);
    assert.equal(typeof candidate.recommendationReason, "string");
  });

  it("writes a human-readable recommendation reason", () => {
    const result = evaluate([{ driver: driver(), truck: truck() }]);
    const reason = result.recommended?.recommendationReason || "";
    assert.match(reason, /km away/);
    assert.match(reason, /available/);
    assert.match(reason, /qualified/);
    assert.match(reason, /correct truck capability/);
    assert.match(reason, /no conflicting assignment/);
  });

  it("retains reasoning for INELIGIBLE candidates too", () => {
    const result = evaluate([
      {
        driver: driver({
          certifications: [certification("drivers_licence"), certification("prdp", { expiresAt: "2020-01-01" })],
        }),
        truck: truck(),
      },
    ]);
    const candidate = result.candidates[0];
    assert.equal(candidate.eligible, false);
    assert.ok(candidate.eligibilityFailures.length > 0);
    assert.ok(candidate.eligibilityFailures[0].detail.length > 0);
    // Distance and capability are still computed, so a controller can see the whole picture.
    assert.equal(typeof candidate.distanceKm, "number");
    assert.equal(candidate.capabilityResult.passed, true);
  });

  it("stamps the engine version on the evaluation", () => {
    assert.equal(evaluate([]).engineVersion, RR_DISPATCH_ENGINE_VERSION);
  });
});

describe("distance", () => {
  it("computes a plausible distance from the scene", () => {
    const km = distanceKmBetween(SCENE, truck());
    assert.ok(km !== null && km > 5 && km < 8, `unexpected distance: ${km}`);
  });

  it("returns null when either end is unknown", () => {
    assert.equal(distanceKmBetween({ latitude: null, longitude: null }, truck()), null);
    assert.equal(distanceKmBetween(SCENE, truck({ latitude: null })), null);
    assert.equal(distanceKmBetween(SCENE, null), null);
  });
});

describe("service requirements", () => {
  it("requires a PrDP for a tow-in", () => {
    assert.deepEqual(requirementForService("tow_in").requiredCertifications, [
      "drivers_licence",
      "prdp",
    ]);
  });

  it("requires winch and boom for heavy recovery", () => {
    const requirement = requirementForService("heavy_recovery");
    assert.equal(requirement.requiresWinch, true);
    assert.equal(requirement.requiresBoom, true);
  });

  it("does not restrict tow class for roadside assistance", () => {
    assert.deepEqual(requirementForService("roadside_assistance").permittedTowClasses, []);
  });

  it("falls back safely for an unknown service code", () => {
    const requirement = requirementForService("something_new");
    assert.deepEqual(requirement.requiredCertifications, ["drivers_licence"]);
    assert.deepEqual(requirement.permittedTowClasses, []);
  });

  it("accepts per-job overrides", () => {
    const requirement = requirementForService("tow_in", { vehicleMassKg: 2200, maxDispatchRadiusKm: 40 });
    assert.equal(requirement.vehicleMassKg, 2200);
    assert.equal(requirement.maxDispatchRadiusKm, 40);
  });
});

describe("a driver who declined THIS job", () => {
  /**
   * Found in production QA: a driver who declined a job was still offered back
   * as a fresh candidate for that same job. Wastes the one thing a control room
   * lacks at a scene — time — and makes the board look broken.
   *
   * The exclusion is job-scoped by construction: it reads this job's declined
   * assignments, never a flag on the driver.
   */
  const quinn = { driver: driver({ employeeId: "quinn" }), truck: truck() };
  const riley = { driver: driver({ employeeId: "riley" }), truck: truck() };

  function evaluateWithDeclines(
    candidates: RrCandidateInput[],
    declined: { employeeId: string; reason: string | null; declinedAt: string | null }[],
    includeDeclined = false
  ) {
    return evaluateDispatchCandidates({
      companyId: COMPANY,
      serviceJobId: "job-1",
      scene: SCENE,
      requirement: requirementForService("tow_in"),
      candidates,
      evaluatedAt: TODAY,
      declined,
      includeDeclined,
    });
  }

  it("is excluded from that job, while another driver stays eligible", () => {
    const result = evaluateWithDeclines(
      [quinn, riley],
      [{ employeeId: "quinn", reason: "Vehicle too heavy for this truck.", declinedAt: TODAY }]
    );
    const q = result.candidates.find((c) => c.employeeId === "quinn")!;
    const r = result.candidates.find((c) => c.employeeId === "riley")!;

    assert.equal(q.eligible, false, "the decliner must not be offered this job again");
    assert.ok(q.eligibilityFailures.some((f) => f.code === "previously_declined"));
    assert.equal(r.eligible, true, "another driver must remain available");
    assert.equal(result.recommended?.employeeId, "riley");
  });

  it("shows the controller WHY they declined", () => {
    const result = evaluateWithDeclines(
      [quinn, riley],
      [{ employeeId: "quinn", reason: "Vehicle too heavy for this truck.", declinedAt: TODAY }]
    );
    const q = result.candidates.find((c) => c.employeeId === "quinn")!;
    assert.equal(q.previouslyDeclined, true);
    assert.equal(q.declineReason, "Vehicle too heavy for this truck.");
    assert.match(
      q.eligibilityFailures.find((f) => f.code === "previously_declined")!.detail,
      /too heavy/
    );
  });

  it("is NOT a blacklist — the same driver stays eligible for a different job", () => {
    // No decline recorded against this job, though they declined another.
    const result = evaluateWithDeclines([quinn, riley], []);
    const q = result.candidates.find((c) => c.employeeId === "quinn")!;
    assert.equal(q.eligible, true);
    assert.equal(q.previouslyDeclined, false);
    assert.equal(q.declineReason, null);
  });

  it("a controller can deliberately re-include them, refusal still visible", () => {
    const result = evaluateWithDeclines(
      [quinn, riley],
      [{ employeeId: "quinn", reason: "Too heavy.", declinedAt: TODAY }],
      true
    );
    const q = result.candidates.find((c) => c.employeeId === "quinn")!;
    assert.equal(q.eligible, true, "the override must make them selectable again");
    assert.equal(q.previouslyDeclined, true, "but the refusal must not be forgotten");
    assert.equal(q.declineReason, "Too heavy.");
  });

  it("a re-included decliner never outranks a driver who did not refuse", () => {
    const result = evaluateWithDeclines(
      [quinn, riley],
      [{ employeeId: "quinn", reason: "Too heavy.", declinedAt: TODAY }],
      true
    );
    assert.equal(result.recommended?.employeeId, "riley");
    const rankOf = (id: string) => result.eligible.find((c) => c.employeeId === id)!.rank;
    assert.ok(rankOf("riley")! < rankOf("quinn")!, "the decliner must rank below");
  });

  it("when everyone declined, the board says so rather than recommending nobody silently", () => {
    const result = evaluateWithDeclines(
      [quinn, riley],
      [
        { employeeId: "quinn", reason: "Too heavy.", declinedAt: TODAY },
        { employeeId: "riley", reason: "Off shift.", declinedAt: TODAY },
      ]
    );
    assert.equal(result.recommended, null);
    assert.ok(result.noCandidateReason, "the controller must be told why nobody is available");
  });
});
