import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveDriverNextAction,
  RR_DRIVER_STATUS_TONE_CLASS,
  type RrDriverJobContext,
} from "@/lib/road-recovery/driver-next-action";

/**
 * The driver's next action is the whole point of the mobile screen, so it is tested as a
 * decision rather than eyeballed in the UI. The cases below are the ones that would send a
 * driver down the wrong path if they regressed.
 */

function ctx(overrides: Partial<RrDriverJobContext>): RrDriverJobContext {
  return { assignmentStatus: "accepted", serviceState: "accepted", ...overrides };
}

describe("driver next action — offer", () => {
  it("puts accept first while an offer is unanswered, whatever the job state says", () => {
    const result = resolveDriverNextAction(
      ctx({ assignmentStatus: "offered", serviceState: "en_route" })
    );
    assert.equal(result.primary?.kind, "accept");
    assert.equal(result.statusTone, "offered");
    assert.ok(result.secondary.some((action) => action.kind === "decline"));
  });

  it("never offers decline as the primary action", () => {
    const result = resolveDriverNextAction(ctx({ assignmentStatus: "offered" }));
    assert.notEqual(result.primary?.kind, "decline");
  });
});

describe("driver next action — travel and arrival", () => {
  it("asks an accepted driver to start travel", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "accepted" }));
    assert.equal(result.primary?.kind, "start_travel");
    assert.equal(result.statusTone, "active");
  });

  it("asks a travelling driver to confirm arrival", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "en_route" }));
    assert.equal(result.primary?.kind, "arrive");
    assert.equal(result.statusLabel, "En route");
  });

  it("asks for evidence once on scene on a recovery job", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "on_scene" }));
    assert.equal(result.primary?.kind, "capture_evidence");
    assert.equal(result.statusTone, "onsite");
  });
});

describe("driver next action — BYSTAND clock", () => {
  const bystand = (overrides: Partial<RrDriverJobContext>) =>
    resolveDriverNextAction(ctx({ workflowKey: "bystand", ...overrides }));

  it("starts the standing clock when on scene", () => {
    assert.equal(bystand({ serviceState: "on_scene" }).primary?.kind, "begin_standing");
  });

  it("offers pause while the clock is running", () => {
    const result = bystand({ serviceState: "standing", standingNow: true });
    assert.equal(result.primary?.kind, "pause_standing");
    assert.equal(result.statusLabel, "Standing");
  });

  it("offers resume when the clock is paused", () => {
    const result = bystand({
      serviceState: "scene_handover_to_authority",
      standingNow: false,
      pausedStates: ["scene_handover_to_authority"],
    });
    assert.equal(result.primary?.kind, "resume_standing");
  });

  it("keeps stand-down available but never primary", () => {
    const result = bystand({ serviceState: "standing", standingNow: true });
    assert.notEqual(result.primary?.kind, "stand_down");
    assert.ok(result.secondary.some((action) => action.kind === "stand_down"));
  });
});

describe("driver next action — terminal and unknown states", () => {
  it("offers nothing to do on a completed job", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "completed" }));
    assert.equal(result.primary, null);
    assert.equal(result.statusTone, "done");
  });

  it("distinguishes a cancelled job from a completed one", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "cancelled" }));
    assert.equal(result.statusLabel, "Cancelled");
    assert.equal(result.primary, null);
  });

  it("invents no transition for an unrecognised state", () => {
    const result = resolveDriverNextAction(ctx({ serviceState: "awaiting_third_party_release" }));
    assert.equal(result.primary, null);
    assert.match(result.guidance, /control room/i);
  });

  it("routes the storage leg to handover evidence", () => {
    assert.equal(
      resolveDriverNextAction(ctx({ serviceState: "storage_pending" })).primary?.kind,
      "capture_evidence"
    );
  });
});

describe("driver next action — contract", () => {
  it("always returns guidance and a status label", () => {
    const states = [
      "assigned", "accepted", "en_route", "on_scene", "recovery_in_progress",
      "tow_recovery", "storage_in", "completed", "closed", "cancelled", "who_knows",
    ];
    for (const serviceState of states) {
      const result = resolveDriverNextAction(ctx({ serviceState }));
      assert.ok(result.guidance.length > 10, `no guidance for ${serviceState}`);
      assert.ok(result.statusLabel.length > 0, `no status label for ${serviceState}`);
      assert.ok(RR_DRIVER_STATUS_TONE_CLASS[result.statusTone], `no tone for ${serviceState}`);
    }
  });

  it("never repeats the primary action inside the secondary list", () => {
    const states = ["offered-x", "accepted", "en_route", "on_scene", "recovery_in_progress"];
    for (const serviceState of states) {
      const result = resolveDriverNextAction(ctx({ serviceState }));
      if (!result.primary) continue;
      assert.ok(
        !result.secondary.some((action) => action.kind === result.primary?.kind),
        `duplicate action for ${serviceState}`
      );
    }
  });
});

describe("BYSTAND — the billable clock must be reachable", () => {
  /**
   * The BYSTAND workflow arrives at `arrived_on_scene`; only the recovery
   * workflow uses `on_scene`. Matching the wrong name leaves the driver on a
   * screen with no primary action and the standing clock never starts — which
   * is the entire commercial purpose of a standby attendance.
   */
  it("offers Start standing at the state BYSTAND actually arrives in", () => {
    const next = resolveDriverNextAction({
      assignmentStatus: "accepted",
      serviceState: "arrived_on_scene",
      workflowKey: "bystand",
    });
    assert.equal(next.primary?.kind, "begin_standing");
  });

  /**
   * `submit_report` is legal only from `departed_scene`. Offering it anywhere
   * else puts a button on the screen that the server refuses.
   */
  it("offers the report only once the driver has left the scene", () => {
    const departed = resolveDriverNextAction({
      assignmentStatus: "accepted",
      serviceState: "departed_scene",
      workflowKey: "bystand",
    });
    assert.equal(departed.primary?.kind, "submit_report");

    for (const state of ["arrived_on_scene", "standing_by", "stood_down"]) {
      const other = resolveDriverNextAction({
        assignmentStatus: "accepted",
        serviceState: state,
        workflowKey: "bystand",
        standingNow: state === "standing_by",
      });
      const offered = [other.primary, ...other.secondary].filter(Boolean).map((a) => a!.kind);
      assert.ok(!offered.includes("submit_report"), `${state} should not offer a report the server refuses`);
    }
  });
});
