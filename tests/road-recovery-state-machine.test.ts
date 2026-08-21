/**
 * Road & Recovery state machine (Phase 0).
 *
 * The state machine is pure, so these tests exercise the real production graph directly
 * with no fakes, no database and no clock. Three things are being protected:
 *
 *   1. the graph is structurally sound (no orphan states, no dead ends, no bad mappings)
 *   2. the two-level status model holds — every workflow state maps down to one of the
 *      six EXISTING field_jobs.status values, so payroll intelligence, the AI Copilot
 *      and the Digital Twin keep working unchanged
 *   3. BYSTAND is a service in its own right and cannot decay into a tow subtype
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyTransition,
  assertBystandStateMachineIndependence,
  assertNoTowSubtypeInWorkflows,
  availableTransitions,
  canTransition,
  getWorkflowDefinition,
  initialStateFor,
  isBillableStandingState,
  isTerminalState,
  nextStates,
  physicalStatusFor,
  reachableStates,
  replayPath,
  RR_PHYSICAL_STATUSES,
  RR_WORKFLOW_DEFINITIONS,
  terminalStates,
  validateAllWorkflowDefinitions,
  validateWorkflowDefinition,
  workflowStates,
} from "@/lib/road-recovery/state-machine";
import {
  RR_SERVICE_CATALOGUE,
  RR_SERVICE_CODES,
  RR_WORKFLOW_KEYS,
  assertBystandIndependence,
  assertNoTowSubtypeConcept,
  findServiceType,
  requireServiceType,
  serviceTypesForWorkflow,
  validateServiceCatalogue,
} from "@/lib/road-recovery/service-types";

const AT = "2026-08-18T06:00:00.000Z";

/** Context in which every declared guard is satisfied. */
const ALL_GUARDS = {
  authorisation_valid: true,
  authorisation_not_required: true,
  evidence_complete: true,
  release_authorised: true,
  disposal_authorised: true,
} as const;

describe("service catalogue", () => {
  it("validates structurally", () => {
    validateServiceCatalogue();
  });

  it("contains exactly the eight Phase 0 service types", () => {
    assert.equal(RR_SERVICE_CATALOGUE.length, 8);
    assert.deepEqual(
      RR_SERVICE_CATALOGUE.map((entry) => entry.serviceCode).sort(),
      [...RR_SERVICE_CODES].sort()
    );
  });

  it("points every service type at a declared workflow", () => {
    for (const entry of RR_SERVICE_CATALOGUE) {
      assert.ok(
        getWorkflowDefinition(entry.workflowKey),
        `${entry.serviceCode} references missing workflow ${entry.workflowKey}`
      );
    }
  });

  it("shares the towing workflow between accident recovery and tow-in only", () => {
    assert.deepEqual(
      serviceTypesForWorkflow("tow_recovery").map((entry) => entry.serviceCode),
      ["accident_recovery", "tow_in"]
    );
  });

  it("throws for an unknown service code and returns null for a soft lookup", () => {
    assert.equal(findServiceType("flatbed_special"), null);
    assert.throws(() => requireServiceType("flatbed_special"), /Unknown Road & Recovery service code/);
  });

  it("rejects a catalogue that reintroduces a tow subtype", () => {
    const contaminated = [
      ...RR_SERVICE_CATALOGUE,
      { ...RR_SERVICE_CATALOGUE[0], serviceCode: "bystand_tow_subtype" },
    ] as never;
    assert.throws(() => assertNoTowSubtypeConcept(contaminated), /Tow-subtype invariant/);
  });
});

describe("workflow definitions", () => {
  it("all validate structurally", () => {
    validateAllWorkflowDefinitions();
  });

  it("declares the six Phase 0 workflows", () => {
    assert.deepEqual(Object.keys(RR_WORKFLOW_DEFINITIONS).sort(), [...RR_WORKFLOW_KEYS].sort());
  });

  it("has no unreachable states in any workflow", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      const declared = new Set(workflowStates(key));
      const reachable = reachableStates(key);
      for (const name of declared) {
        assert.ok(reachable.has(name), `${key}: state "${name}" is unreachable`);
      }
    }
  });

  it("lets every non-terminal state reach a terminal state", () => {
    // validateWorkflowDefinition performs the escape analysis; assert it per workflow so
    // a failure names the offending workflow.
    for (const key of RR_WORKFLOW_KEYS) {
      validateWorkflowDefinition(RR_WORKFLOW_DEFINITIONS[key]);
      assert.ok(terminalStates(key).length > 0, `${key} has no terminal state`);
    }
  });

  it("rejects a definition whose initial state is undeclared", () => {
    assert.throws(
      () =>
        validateWorkflowDefinition({
          ...RR_WORKFLOW_DEFINITIONS.storage,
          initialState: "nowhere",
        }),
      /initial state "nowhere" is not declared/
    );
  });

  it("rejects a definition with an unknown physical status", () => {
    assert.throws(
      () =>
        validateWorkflowDefinition({
          ...RR_WORKFLOW_DEFINITIONS.storage,
          states: [
            ...RR_WORKFLOW_DEFINITIONS.storage.states.slice(1),
            { state: "storage_pending", kind: "active", physicalStatus: "Impounded" as never },
          ],
        }),
      /unknown physical status/
    );
  });
});

describe("two-level status model", () => {
  it("maps every workflow state to an existing field_jobs.status value", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      for (const name of workflowStates(key)) {
        const physical = physicalStatusFor(key, name);
        assert.ok(physical, `${key}/${name} has no physical status`);
        assert.ok(
          (RR_PHYSICAL_STATUSES as readonly string[]).includes(physical as string),
          `${key}/${name} maps to "${physical}", which is not a field_jobs.status value`
        );
      }
    }
  });

  it("exposes exactly the six existing physical statuses and no more", () => {
    // This is the guard against anyone "just adding" a status to field_jobs.
    assert.deepEqual(
      [...RR_PHYSICAL_STATUSES],
      ["Pending", "Dispatched", "Travelling", "On Site", "Completed", "Cancelled"]
    );
  });

  it("returns null rather than guessing for an unknown workflow or state", () => {
    assert.equal(physicalStatusFor("tow_recovery", "teleporting"), null);
    assert.equal(physicalStatusFor("hovercraft", "en_route"), null);
  });

  it("reports the physical status on both sides of a transition", () => {
    const result = applyTransition({
      workflowKey: "tow_recovery",
      fromState: "accepted",
      toState: "en_route",
      occurredAt: AT,
    });
    assert.ok(result.ok);
    assert.equal(result.event.physicalStatusBefore, "Dispatched");
    assert.equal(result.event.physicalStatusAfter, "Travelling");
    assert.equal(result.physicalStatus, "Travelling");
  });
});

describe("transition rules", () => {
  it("permits a declared transition", () => {
    const check = canTransition("tow_recovery", "on_scene", "assessing");
    assert.equal(check.allowed, true);
  });

  it("refuses an undeclared transition", () => {
    const check = canTransition("tow_recovery", "logged", "closed");
    assert.equal(check.allowed, false);
    assert.equal(check.allowed === false && check.reason, "no_such_transition");
  });

  it("refuses an unknown workflow, from-state and to-state distinctly", () => {
    assert.equal(
      canTransition("hovercraft", "a", "b").allowed === false &&
        (canTransition("hovercraft", "a", "b") as { reason: string }).reason,
      "unknown_workflow"
    );
    const badFrom = canTransition("tow_recovery", "nowhere", "on_scene");
    assert.equal(badFrom.allowed === false && badFrom.reason, "unknown_from_state");
    const badTo = canTransition("tow_recovery", "on_scene", "nowhere");
    assert.equal(badTo.allowed === false && badTo.reason, "unknown_to_state");
  });

  it("refuses any transition out of a terminal state", () => {
    const check = canTransition("tow_recovery", "closed", "invoiced");
    assert.equal(check.allowed, false);
    assert.equal(check.allowed === false && check.reason, "terminal_state");
    assert.ok(isTerminalState("tow_recovery", "closed"));
  });

  it("fails guards closed when context is absent", () => {
    const check = canTransition("tow_recovery", "authorised", "dispatch_pending");
    assert.equal(check.allowed, false);
    assert.equal(check.allowed === false && check.reason, "guard_unsatisfied");
    assert.deepEqual(
      check.allowed === false ? check.unsatisfiedGuards : null,
      ["authorisation_valid"]
    );
  });

  it("allows the same transition once the guard is satisfied", () => {
    const check = canTransition("tow_recovery", "authorised", "dispatch_pending", {
      authorisation_valid: true,
    });
    assert.equal(check.allowed, true);
  });

  it("requires a reason where the graph demands one", () => {
    const without = canTransition("tow_recovery", "on_scene", "cancelled");
    assert.equal(without.allowed, false);
    assert.equal(without.allowed === false && without.reason, "reason_required");

    const with_ = canTransition(
      "tow_recovery",
      "on_scene",
      "cancelled",
      {},
      { reason: "Customer resolved privately" }
    );
    assert.equal(with_.allowed, true);
  });

  it("treats whitespace as no reason at all", () => {
    const check = canTransition("tow_recovery", "on_scene", "cancelled", {}, { reason: "   " });
    assert.equal(check.allowed, false);
    assert.equal(check.allowed === false && check.reason, "reason_required");
  });

  it("offers cancellation from every non-terminal state", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      for (const name of workflowStates(key)) {
        if (isTerminalState(key, name)) continue;
        if (name === "cancelled") continue;
        assert.ok(
          nextStates(key, name).includes("cancelled"),
          `${key}/${name} cannot be cancelled`
        );
      }
    }
  });

  it("never offers a transition out of a terminal state", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      for (const name of terminalStates(key)) {
        const check = canTransition(key, name, "cancelled", ALL_GUARDS, { reason: "x" });
        assert.equal(check.allowed, false, `${key}/${name} allowed an exit from a terminal state`);
      }
    }
  });

  it("does not let a wildcard cancel mask an explicitly declared edge", () => {
    // "declined -> cancelled" is declared as cancel_after_decline; the wildcard must not
    // overwrite it with the generic "cancel" code.
    const transition = availableTransitions("tow_recovery", "declined").find(
      (entry) => entry.to === "cancelled"
    );
    assert.equal(transition?.code, "cancel_after_decline");
  });

  it("applyTransition returns the failure rather than throwing", () => {
    const result = applyTransition({
      workflowKey: "tow_recovery",
      fromState: "logged",
      toState: "closed",
      occurredAt: AT,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.check.reason, "no_such_transition");
  });

  it("is pure — it reads no clock and carries the caller's timestamp through", () => {
    const result = applyTransition({
      workflowKey: "tow_recovery",
      fromState: "on_scene",
      toState: "assessing",
      occurredAt: AT,
      secondsInPreviousState: 412,
    });
    assert.ok(result.ok);
    assert.equal(result.event.occurredAt, AT);
    assert.equal(result.event.secondsInPreviousState, 412);
    assert.equal(result.event.transitionCode, "begin_assessment");
  });

  it("produces the same result for the same input every time", () => {
    const once = applyTransition({
      workflowKey: "bystand",
      fromState: "arrived_on_scene",
      toState: "standing_by",
      occurredAt: AT,
    });
    const twice = applyTransition({
      workflowKey: "bystand",
      fromState: "arrived_on_scene",
      toState: "standing_by",
      occurredAt: AT,
    });
    assert.deepEqual(once, twice);
  });
});

describe("tow recovery happy path", () => {
  it("runs a tow-in from draft to closed", () => {
    const result = replayPath(
      "tow_recovery",
      [
        "logged",
        "authorisation_pending",
        "authorised",
        "dispatch_pending",
        "assigned",
        "accepted",
        "en_route",
        "on_scene",
        "assessing",
        "loading",
        "secured",
        "departing_scene",
        "in_transit",
        "arrived_destination",
        "offloading",
        "handover_pending",
        "handed_over",
        "paperwork_complete",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
    assert.equal(result.ok && result.finalState, "closed");
  });

  it("can route a recovered vehicle into storage instead of a third-party handover", () => {
    assert.ok(nextStates("tow_recovery", "arrived_destination").includes("storage_in"));
    assert.ok(nextStates("tow_recovery", "storage_in").includes("handed_over"));
  });

  it("cannot invoice before evidence is complete", () => {
    const check = canTransition("tow_recovery", "evidence_complete", "invoice_ready", {});
    assert.equal(check.allowed, false);
    assert.deepEqual(
      check.allowed === false ? check.unsatisfiedGuards : null,
      ["evidence_complete"]
    );
  });
});

describe("heavy recovery", () => {
  it("requires an approved recovery plan before rigging", () => {
    assert.ok(!nextStates("heavy_recovery", "scene_assessment").includes("rigging"));
    const check = canTransition(
      "heavy_recovery",
      "recovery_plan_pending",
      "recovery_plan_approved",
      {}
    );
    assert.equal(check.allowed, false, "the recovery plan must be authorised");
  });

  it("runs the full heavy recovery path including scene clearance", () => {
    const result = replayPath(
      "heavy_recovery",
      [
        "logged",
        "authorisation_pending",
        "authorised",
        "dispatch_pending",
        "assigned",
        "accepted",
        "en_route",
        "on_scene",
        "scene_assessment",
        "recovery_plan_pending",
        "recovery_plan_approved",
        "rigging",
        "recovery_in_progress",
        "uprighted",
        "load_secured",
        "scene_cleared",
        "in_transit",
        "arrived_destination",
        "offloading",
        "handover_pending",
        "handed_over",
        "paperwork_complete",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
  });

  it("can pause for additional resources and resume", () => {
    assert.ok(
      nextStates("heavy_recovery", "recovery_plan_approved").includes(
        "additional_resources_requested"
      )
    );
    assert.ok(
      nextStates("heavy_recovery", "additional_resources_requested").includes(
        "recovery_plan_approved"
      )
    );
  });
});

describe("roadside assistance", () => {
  it("resolves on scene with no custody or transit states", () => {
    const states = new Set(workflowStates("roadside_assist"));
    for (const towOnly of ["loading", "secured", "in_transit", "storage_in", "handed_over"]) {
      assert.ok(!states.has(towOnly), `roadside_assist must not declare "${towOnly}"`);
    }
    const result = replayPath(
      "roadside_assist",
      [
        "logged",
        "dispatch_pending",
        "assigned",
        "accepted",
        "en_route",
        "on_scene",
        "diagnosing",
        "service_in_progress",
        "resolved_on_scene",
        "customer_signed_off",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
  });

  it("escalates an unresolved job by spawning a separate linked job", () => {
    const result = applyTransition({
      workflowKey: "roadside_assist",
      fromState: "unresolved",
      toState: "escalated_to_tow",
      occurredAt: AT,
      reason: "Engine will not turn over; recovery required",
    });
    assert.ok(result.ok);
    assert.equal(result.event.spawnsLinkedJob, true);
  });

  it("still bills and closes its own callout after escalating", () => {
    assert.ok(nextStates("roadside_assist", "escalated_to_tow").includes("evidence_complete"));
  });
});

// ---------------------------------------------------------------------------
// BYSTAND — the invariants that keep it a service in its own right
// ---------------------------------------------------------------------------

describe("BYSTAND independence", () => {
  it("passes the catalogue invariant", () => {
    assertBystandIndependence();
  });

  it("passes the state machine invariant", () => {
    assertBystandStateMachineIndependence();
  });

  it("has no tow-subtype concept anywhere in the vertical", () => {
    assertNoTowSubtypeConcept();
    assertNoTowSubtypeInWorkflows();
  });

  it("owns its own service type", () => {
    const bystand = requireServiceType("bystand");
    assert.equal(bystand.serviceCode, "bystand");
    assert.equal(bystand.name, "BYSTAND");
  });

  it("owns its own workflow key exclusively", () => {
    const bystand = requireServiceType("bystand");
    assert.equal(bystand.workflowKey, "bystand");
    assert.deepEqual(
      serviceTypesForWorkflow("bystand").map((entry) => entry.serviceCode),
      ["bystand"]
    );
  });

  it("is not a tow: it declares no destination, custody or storage", () => {
    const bystand = requireServiceType("bystand");
    assert.equal(bystand.requiresDestination, false);
    assert.equal(bystand.requiresCustody, false);
    assert.equal(bystand.requiresStorage, false);
  });

  it("declares no towing or custody states", () => {
    const states = new Set(workflowStates("bystand"));
    const towOnly = [
      "loading",
      "secured",
      "departing_scene",
      "in_transit",
      "arrived_destination",
      "offloading",
      "storage_in",
      "handover_pending",
      "handed_over",
      "assessing",
      "rigging",
      "scene_cleared",
    ];
    for (const forbidden of towOnly) {
      assert.ok(!states.has(forbidden), `bystand must not declare towing state "${forbidden}"`);
    }
  });

  it("bills standing time, not distance", () => {
    const bystand = requireServiceType("bystand");
    assert.equal(bystand.billingBasis, "per_hour_standing");
    assert.equal(bystand.billsStandingTime, true);
  });

  it("starts its billable clock on scene, not at dispatch", () => {
    assert.equal(isBillableStandingState("bystand", "assigned"), false);
    assert.equal(isBillableStandingState("bystand", "accepted"), false);
    assert.equal(isBillableStandingState("bystand", "en_route"), false);
    assert.equal(isBillableStandingState("bystand", "arrived_on_scene"), false);
    assert.equal(isBillableStandingState("bystand", "standing_by"), true);

    const started = applyTransition({
      workflowKey: "bystand",
      fromState: "arrived_on_scene",
      toState: "standing_by",
      occurredAt: AT,
    });
    assert.ok(started.ok);
    assert.equal(started.event.entersBillableStandingClock, true);
    assert.equal(started.event.leavesBillableStandingClock, false);
  });

  it("pauses and resumes the standing clock for an authority handover", () => {
    const paused = applyTransition({
      workflowKey: "bystand",
      fromState: "standing_by",
      toState: "scene_handover_to_authority",
      occurredAt: AT,
      reason: "Scene under SAPS control",
      secondsInPreviousState: 3600,
    });
    assert.ok(paused.ok);
    assert.equal(paused.event.leavesBillableStandingClock, true);
    assert.equal(paused.event.secondsInPreviousState, 3600);

    const resumed = applyTransition({
      workflowKey: "bystand",
      fromState: "scene_handover_to_authority",
      toState: "standing_by",
      occurredAt: AT,
    });
    assert.ok(resumed.ok);
    assert.equal(resumed.event.entersBillableStandingClock, true);
  });

  it("is the only workflow with a billable standing clock", () => {
    for (const key of RR_WORKFLOW_KEYS) {
      const standing = RR_WORKFLOW_DEFINITIONS[key].states.filter(
        (entry) => entry.billableStandingClock === true
      );
      assert.equal(
        standing.length,
        key === "bystand" ? 1 : 0,
        `${key} declares an unexpected billable standing clock`
      );
    }
  });

  it("runs a complete bystand job independently of any tow", () => {
    const result = replayPath(
      "bystand",
      [
        "logged",
        "bystand_requested",
        "authorisation_pending",
        "authorised",
        "assigned",
        "accepted",
        "en_route",
        "arrived_on_scene",
        "standing_by",
        "stand_down_requested",
        "stood_down",
        "departed_scene",
        "report_submitted",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
    assert.equal(result.ok && result.finalState, "closed");
  });

  it("spawns a SEPARATE linked recovery job rather than becoming a tow", () => {
    const converted = applyTransition({
      workflowKey: "bystand",
      fromState: "standing_by",
      toState: "converted_to_recovery",
      occurredAt: AT,
      reason: "Vehicle cannot be driven away; recovery required",
    });
    assert.ok(converted.ok);
    assert.equal(converted.event.spawnsLinkedJob, true);
    // The job is still a bystand job: its workflow key never changes.
    assert.equal(converted.event.workflowKey, "bystand");
    // And it still has no towing state available to it.
    assert.ok(!nextStates("bystand", "converted_to_recovery").includes("in_transit"));
  });

  it("bills and closes its own standing time after conversion", () => {
    const result = replayPath(
      "bystand",
      [
        "logged",
        "bystand_requested",
        "authorisation_pending",
        "authorised",
        "assigned",
        "accepted",
        "en_route",
        "arrived_on_scene",
        "standing_by",
        "converted_to_recovery",
        "stand_down_requested",
        "stood_down",
        "departed_scene",
        "report_submitted",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
    const conversion = result.ok
      ? result.events.find((event) => event.transitionCode === "convert_to_recovery")
      : null;
    assert.ok(conversion, "the conversion event must be recorded on the bystand job");
    assert.equal(conversion?.spawnsLinkedJob, true);
  });

  it("cannot be dispatched without a valid authorisation", () => {
    const check = canTransition("bystand", "authorised", "assigned", {});
    assert.equal(check.allowed, false);
    assert.deepEqual(
      check.allowed === false ? check.unsatisfiedGuards : null,
      ["authorisation_valid"]
    );
  });

  it("reports its own KPI set", () => {
    assert.equal(requireServiceType("bystand").kpiSetKey, "bystand");
    for (const entry of RR_SERVICE_CATALOGUE) {
      if (entry.serviceCode === "bystand") continue;
      assert.notEqual(entry.kpiSetKey, "bystand", `${entry.serviceCode} must not use bystand KPIs`);
    }
  });

  it("is independently testable — its graph resolves with no towing workflow loaded", () => {
    // Nothing about the bystand graph consults tow_recovery or heavy_recovery.
    const definition = getWorkflowDefinition("bystand");
    assert.ok(definition);
    const serialised = JSON.stringify(definition);
    assert.ok(!/tow_recovery|heavy_recovery/.test(serialised));
    assert.equal(initialStateFor("bystand"), "draft");
  });
});

describe("vehicle movement", () => {
  it("inspects the vehicle before and after the move", () => {
    const result = replayPath(
      "vehicle_movement",
      [
        "logged",
        "collection_scheduled",
        "assigned",
        "accepted",
        "en_route_collection",
        "at_collection",
        "pre_move_inspection",
        "collected",
        "in_transit",
        "at_delivery",
        "post_move_inspection",
        "delivered",
        "handover_signed",
        "evidence_complete",
        "invoice_ready",
        "invoiced",
        "closed",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
  });

  it("cannot collect a vehicle before the pre-move inspection", () => {
    assert.ok(!nextStates("vehicle_movement", "at_collection").includes("collected"));
  });
});

describe("storage", () => {
  it("releases only on authorisation", () => {
    const check = canTransition(
      "storage",
      "release_authorisation_pending",
      "release_authorised",
      {}
    );
    assert.equal(check.allowed, false);
    assert.deepEqual(check.allowed === false ? check.unsatisfiedGuards : null, ["release_authorised"]);
  });

  it("runs check-in to release", () => {
    const result = replayPath(
      "storage",
      [
        "checked_in",
        "stored",
        "release_requested",
        "release_authorisation_pending",
        "release_authorised",
        "checked_out",
        "released",
      ],
      ALL_GUARDS
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.check.message}`);
    assert.equal(result.ok && result.finalState, "released");
  });

  it("disposes an unclaimed vehicle only with disposal authorisation", () => {
    const check = canTransition("storage", "disposal_notice_issued", "disposal_authorised", {});
    assert.equal(check.allowed, false);
    const authorised = canTransition("storage", "disposal_notice_issued", "disposal_authorised", {
      disposal_authorised: true,
    });
    assert.equal(authorised.allowed, true);
  });

  it("starts in storage_pending, not draft", () => {
    assert.equal(initialStateFor("storage"), "storage_pending");
  });
});
