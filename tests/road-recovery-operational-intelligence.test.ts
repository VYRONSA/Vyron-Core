import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOperationalFindings,
  RR_OPERATIONAL_DEFAULTS,
  type RrOperationalInput,
} from "@/lib/road-recovery/intelligence/operational";

/**
 * Structural intelligence, tested as behaviour.
 *
 * These findings exist because the threshold engine says nothing until somebody
 * configures an SLA, and a control room still needs to be told that a job is
 * unassigned or that evidence is blocking billing. Every assertion below is
 * about what a controller would be told, not about the shape of an object.
 */

const NOW = "2026-08-25T12:00:00.000Z";
const minutesAgo = (n: number) => new Date(Date.parse(NOW) - n * 60_000).toISOString();
const hoursAgo = (n: number) => minutesAgo(n * 60);

function input(overrides: Partial<RrOperationalInput> = {}): RrOperationalInput {
  return {
    asOfIso: NOW,
    jobs: [],
    events: [],
    assignments: [],
    outstandingEvidence: [],
    unverifiedArrivals: [],
    ...overrides,
  };
}

function job(overrides: Partial<RrOperationalInput["jobs"][number]> = {}) {
  return {
    serviceJobId: "job-1",
    workflowKey: "tow_recovery",
    workflowVersion: 1,
    serviceCode: "accident_recovery",
    counterpartyId: null,
    createdAt: minutesAgo(30),
    serviceState: "dispatch_pending",
    ...overrides,
  };
}

function assignment(overrides: Partial<RrOperationalInput["assignments"][number]> = {}) {
  return {
    id: "a1",
    serviceJobId: "job-1",
    employeeId: "quinn",
    fieldVehicleId: null,
    assignmentStatus: "offered" as const,
    sequenceNumber: 1,
    offeredAt: minutesAgo(30),
    respondedAt: null,
    declineReason: null,
    ...overrides,
  };
}

const find = (findings: ReturnType<typeof buildOperationalFindings>, key: string) =>
  findings.find((f) => f.key === key);

describe("operational intelligence — every finding answers what, why and what to do", () => {
  it("produces nothing at all when the operation is healthy", () => {
    const findings = buildOperationalFindings(input({ jobs: [job({ serviceState: "completed" })] }));
    assert.deepEqual(findings, [], "a quiet operation must not manufacture work");
  });

  it("every finding it does produce is actionable", () => {
    const findings = buildOperationalFindings(
      input({
        jobs: [job()],
        assignments: [assignment({ assignmentStatus: "declined", declineReason: "Too heavy." }),
                      assignment({ id: "a2", employeeId: "riley", assignmentStatus: "declined", declineReason: "Too heavy." })],
        outstandingEvidence: [
          { serviceJobId: "job-1", jobRef: "RR-1", serviceState: "on_scene", outstandingLabels: ["Photograph of the VIN"] },
        ],
        unverifiedArrivals: [
          { serviceJobId: "job-1", reason: "no_gps_signal" },
          { serviceJobId: "job-2", reason: "no_gps_signal" },
        ],
      })
    );
    assert.ok(findings.length >= 3, "expected several findings from a troubled operation");
    for (const f of findings) {
      assert.ok(f.symptom.length > 10, `${f.key} has no WHAT`);
      assert.ok(f.recommendation.length > 10, `${f.key} has no WHAT TO DO`);
      assert.ok(f.alternative.length > 10, `${f.key} offers no alternative`);
      assert.ok(f.expectedOutcome.length > 10, `${f.key} promises no outcome`);
      assert.ok(f.consequenceIfIgnored.length > 10, `${f.key} has no consequence`);
      assert.ok(f.evidence.length > 0, `${f.key} cites no evidence`);
      assert.ok(f.affectedCount > 0, `${f.key} affects nothing`);
      // Never a fabricated rand figure.
      assert.ok(f.financialImpactZAR === null || f.financialImpactZAR > 0);
    }
  });

  it("never leaks implementation vocabulary into an operator's card", () => {
    const findings = buildOperationalFindings(
      input({
        jobs: [job()],
        outstandingEvidence: [
          { serviceJobId: "job-1", jobRef: "RR-1", serviceState: "on_scene", outstandingLabels: ["VIN"] },
        ],
      })
    );
    const forbidden = /operationId|receipt|idempot|sha256|IndexedDB|service worker|409|uuid|null|undefined/i;
    for (const f of findings) {
      const text = `${f.symptom} ${f.rootCause ?? ""} ${f.recommendation} ${f.alternative} ${f.expectedOutcome} ${f.consequenceIfIgnored} ${f.evidence.join(" ")}`;
      assert.doesNotMatch(text, forbidden, `${f.key} leaked implementation detail`);
    }
  });
});

describe("operational intelligence — dispatch", () => {
  it("reports a job nobody has been assigned to", () => {
    const findings = buildOperationalFindings(input({ jobs: [job({ createdAt: minutesAgo(40) })] }));
    const f = find(findings, "operational_unassigned_jobs");
    assert.ok(f, "an unassigned job must be reported");
    assert.match(f!.symptom, /nobody assigned/i);
    assert.match(f!.symptom, /40 minutes/);
    assert.equal(f!.severity, "high");
  });

  it("escalates when it has been waiting over an hour", () => {
    const findings = buildOperationalFindings(input({ jobs: [job({ createdAt: hoursAgo(2) })] }));
    assert.equal(find(findings, "operational_unassigned_jobs")!.severity, "critical");
  });

  it("stays quiet while the job is still fresh", () => {
    const fresh = RR_OPERATIONAL_DEFAULTS.unassignedMinutes - 1;
    const findings = buildOperationalFindings(input({ jobs: [job({ createdAt: minutesAgo(fresh) })] }));
    assert.equal(find(findings, "operational_unassigned_jobs"), undefined);
  });

  it("does not call a job unassigned when somebody is already holding the offer", () => {
    const findings = buildOperationalFindings(
      input({ jobs: [job({ createdAt: hoursAgo(2) })], assignments: [assignment({ assignmentStatus: "accepted" })] })
    );
    assert.equal(find(findings, "operational_unassigned_jobs"), undefined);
  });

  it("reports an offer nobody has answered", () => {
    const findings = buildOperationalFindings(
      input({ jobs: [job({ serviceState: "assigned" })], assignments: [assignment({ offeredAt: minutesAgo(45) })] })
    );
    const f = find(findings, "operational_awaiting_acceptance");
    assert.ok(f);
    assert.match(f!.recommendation, /call the driver/i);
    assert.equal(f!.severity, "high");
  });

  it("reports a job several drivers have refused, and why", () => {
    const findings = buildOperationalFindings(
      input({
        jobs: [job()],
        assignments: [
          assignment({ assignmentStatus: "declined", declineReason: "Vehicle too heavy for this truck." }),
          assignment({ id: "a2", employeeId: "riley", assignmentStatus: "declined", declineReason: "Vehicle too heavy for this truck." }),
        ],
      })
    );
    const f = find(findings, "operational_repeated_declines");
    assert.ok(f);
    assert.match(f!.evidence.join(" "), /too heavy/i);
    assert.match(f!.recommendation, /service code|equipment|truck class/i);
  });

  it("one refusal is not yet a pattern", () => {
    const findings = buildOperationalFindings(
      input({ jobs: [job()], assignments: [assignment({ assignmentStatus: "declined", declineReason: "Busy." })] })
    );
    assert.equal(find(findings, "operational_repeated_declines"), undefined);
  });
});

describe("operational intelligence — stuck work", () => {
  it("reports a live job that has stopped moving", () => {
    const findings = buildOperationalFindings(
      input({
        jobs: [job({ serviceState: "on_scene", createdAt: hoursAgo(9) })],
        events: [
          { serviceJobId: "job-1", workflowKey: "tow_recovery", workflowVersion: 1, fromState: "en_route", toState: "on_scene", occurredAt: hoursAgo(8), secondsInPreviousState: 600 },
        ],
        assignments: [assignment({ assignmentStatus: "accepted" })],
      })
    );
    const f = find(findings, "operational_stuck_jobs");
    assert.ok(f);
    assert.match(f!.symptom, /not moved/i);
    assert.match(f!.consequenceIfIgnored, /unbilled|billing/i);
  });

  it("does not call a finished job stuck", () => {
    const findings = buildOperationalFindings(
      input({ jobs: [job({ serviceState: "closed", createdAt: hoursAgo(48) })] })
    );
    assert.equal(find(findings, "operational_stuck_jobs"), undefined);
  });
});

describe("operational intelligence — evidence and GPS", () => {
  it("reports evidence that is blocking billing, naming the job", () => {
    const findings = buildOperationalFindings(
      input({
        outstandingEvidence: [
          { serviceJobId: "job-1", jobRef: "RR-260825-0001", serviceState: "completed", outstandingLabels: ["Photograph of the VIN", "Scene photographs"] },
        ],
      })
    );
    const f = find(findings, "operational_evidence_blocking_billing");
    assert.ok(f);
    assert.match(f!.evidence.join(" "), /RR-260825-0001/);
    assert.match(f!.evidence.join(" "), /VIN/);
  });

  it("spots the SAME item missing across jobs and blames the process, not the person", () => {
    const findings = buildOperationalFindings(
      input({
        outstandingEvidence: [
          { serviceJobId: "j1", jobRef: "RR-1", serviceState: "completed", outstandingLabels: ["Photograph of the VIN"] },
          { serviceJobId: "j2", jobRef: "RR-2", serviceState: "completed", outstandingLabels: ["Photograph of the VIN"] },
          { serviceJobId: "j3", jobRef: "RR-3", serviceState: "completed", outstandingLabels: ["Photograph of the VIN"] },
        ],
      })
    );
    const f = find(findings, "operational_evidence_blocking_billing")!;
    assert.match(f.rootCause!, /same item is missing on 3 jobs/i);
    assert.ok(f.rootCauseConfidence! >= 75, "a repeated pattern should raise confidence");
    assert.match(f.recommendation, /brief drivers/i);
  });

  it("reports repeated GPS exceptions and identifies the dominant reason", () => {
    const findings = buildOperationalFindings(
      input({
        unverifiedArrivals: [
          { serviceJobId: "j1", reason: "Arrival recorded without location. Reason: no_gps_signal" },
          { serviceJobId: "j2", reason: "Arrival recorded without location. Reason: no_gps_signal" },
          { serviceJobId: "j3", reason: "Arrival recorded without location. Reason: device_fault" },
        ],
      })
    );
    const f = find(findings, "operational_gps_exceptions")!;
    assert.match(f.rootCause!, /no gps signal/i);
    assert.match(f.consequenceIfIgnored, /dispute|billing/i);
    // The stored prefix must be stripped, not shown to an operator.
    assert.doesNotMatch(f.evidence.join(" "), /Arrival recorded without location/);
  });

  it("a single GPS exception is not yet a pattern", () => {
    const findings = buildOperationalFindings(
      input({ unverifiedArrivals: [{ serviceJobId: "j1", reason: "no_gps_signal" }] })
    );
    assert.equal(find(findings, "operational_gps_exceptions"), undefined);
  });
});

describe("operational intelligence — ordering", () => {
  it("puts the most urgent card first", () => {
    const findings = buildOperationalFindings(
      input({
        jobs: [job({ createdAt: hoursAgo(3) })],
        unverifiedArrivals: [
          { serviceJobId: "j1", reason: "no_gps_signal" },
          { serviceJobId: "j2", reason: "no_gps_signal" },
        ],
      })
    );
    assert.equal(findings[0].severity, "critical");
    assert.ok(findings.length >= 2);
    assert.equal(findings[findings.length - 1].severity, "medium");
  });
});
