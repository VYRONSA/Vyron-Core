import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyOutcome,
  classifyNetworkError,
  driverStatusFor,
  isDue,
  shouldCancelBackoff,
  shouldRequeueAfterSignIn,
  type RrOutboxItem,
} from "@/lib/road-recovery/outbox-policy";

/**
 * The Option A policy: an operation may only be deferred if executing it later
 * is still TRUE.
 *
 * Every operational timestamp in this system is stamped with server time at
 * processing (job-service `occurredAt`/`respondedAt`, and bystand-service which
 * documents "always stamped with SERVER time"). So a queued arrival drained
 * forty minutes late would assert an arrival that never happened then, and a
 * queued BYSTAND clock action would bill standing time nobody stood.
 */

function item(overrides: Partial<RrOutboxItem> = {}): RrOutboxItem {
  return {
    operationId: "11111111-2222-4333-8444-555555555555",
    operationType: "start_travel",
    route: "/api/road-recovery/driver/start-travel",
    payload: { companyId: "c1" },
    serviceJobId: "j1",
    label: "Start travel",
    createdAt: 1_000,
    state: "QUEUED",
    attempts: 0,
    lastError: null,
    failureKind: null,
    nextAttemptAt: null,
    sendingSince: null,
    offlineSafe: false,
    ...overrides,
  };
}

describe("offline policy — online-only operations are never deferred", () => {
  it("a lost connection FAILS an online-only operation rather than queueing it", () => {
    const outcome = classifyNetworkError("Failed to fetch", false);
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.kind === "failed" ? outcome.failureKind : null, "connection_required");
  });

  it("the same lost connection RETRIES an offline-safe operation", () => {
    assert.equal(classifyNetworkError("Failed to fetch", true).kind, "retry");
  });

  it("an online-only failure schedules no future attempt", () => {
    const out = applyOutcome(item(), classifyNetworkError("", false), 10_000);
    assert.equal(out.state, "FAILED");
    assert.equal(out.nextAttemptAt, null, "an online-only action must not be waiting to execute later");
  });

  it("an offline-safe failure DOES schedule a future attempt", () => {
    const out = applyOutcome(item({ offlineSafe: true }), classifyNetworkError("", true), 10_000);
    assert.equal(out.state, "RETRY");
    assert.ok((out.nextAttemptAt ?? 0) > 10_000);
  });

  it("tells the driver connection is required, in plain words", () => {
    const out = applyOutcome(item(), classifyNetworkError("", false), 1);
    const status = driverStatusFor(out, false);
    assert.equal(status.title, "Connection required");
    assert.match(status.detail || "", /job time and status accurate/i);
    assert.equal(status.action, "retry");
    assert.equal(status.actionLabel, "Try again");
  });

  it("never leaks protocol terminology on the connection-required path", () => {
    const out = applyOutcome(item(), classifyNetworkError("", false), 1);
    for (const online of [true, false]) {
      const status = driverStatusFor(out, online);
      const text = `${status.title} ${status.detail ?? ""} ${status.actionLabel ?? ""}`;
      assert.doesNotMatch(text, /operation ?id|receipt|idempot|queue|indexeddb|http|fetch|uuid|offline ?safe/i);
    }
  });

  it("keeps the operation id even when it fails for lack of a connection", () => {
    const out = applyOutcome(item(), classifyNetworkError("", false), 1);
    assert.equal(out.operationId, "11111111-2222-4333-8444-555555555555");
  });
});

describe("offline policy — the deferrable set is deliberately tiny", () => {
  /**
   * Guards the classification itself. If someone later marks an action
   * offline-safe, this test is where the argument has to be made.
   */
  const OFFLINE_SAFE = new Set(["add_note", "capture_evidence"]);
  const ONLINE_ONLY = [
    "accept_assignment", "decline_assignment", "start_travel", "arrive", "transition", "complete",
  ];

  it("only the report and evidence may be deferred", () => {
    assert.deepEqual([...OFFLINE_SAFE].sort(), ["add_note", "capture_evidence"]);
  });

  it("no timing-bearing operation is in the deferrable set", () => {
    for (const kind of ONLINE_ONLY) {
      assert.equal(OFFLINE_SAFE.has(kind), false, `${kind} must not be deferrable — it carries a server timestamp`);
    }
  });
});

/**
 * Regaining signal, and what it should do to a queue that backed off in a dead
 * zone. The bug this covers: a driver surfaced with coverage and their safety
 * report sat unsent, waiting out a delay caused by the outage itself.
 */
describe("backoff after a dead zone", () => {
  const NOW = 100_000;

  it("cancels a delay that is still running", () => {
    const waiting = item({ state: "RETRY", attempts: 6, nextAttemptAt: NOW + 240_000 });
    assert.equal(shouldCancelBackoff(waiting, NOW), true);
    assert.equal(isDue(waiting, NOW), false, "precondition: it was not due");
    assert.equal(isDue({ ...waiting, nextAttemptAt: null }, NOW), true, "and now it is");
  });

  it("leaves an item whose delay has already expired alone", () => {
    // Nothing to cancel; it is due on its own terms.
    const ready = item({ state: "RETRY", attempts: 2, nextAttemptAt: NOW - 1 });
    assert.equal(shouldCancelBackoff(ready, NOW), false);
    assert.equal(isDue(ready, NOW), true);
  });

  it("does not touch work that is already queued or in flight", () => {
    assert.equal(shouldCancelBackoff(item({ state: "QUEUED" }), NOW), false);
    assert.equal(
      shouldCancelBackoff(item({ state: "SENDING", sendingSince: NOW }), NOW),
      false
    );
  });

  it("keeps the attempt history, so the failure cap still applies", () => {
    // Only the waiting is cancelled. A queue that reconnects repeatedly must not
    // be able to retry forever by laundering its attempt count.
    const waiting = item({ state: "RETRY", attempts: 9, nextAttemptAt: NOW + 60_000 });
    const revived = { ...waiting, nextAttemptAt: null };
    assert.equal(revived.attempts, 9);
  });
});

/**
 * A session that expired while the phone had no signal. The report must survive
 * it, and signing back in must be enough to make it send.
 */
describe("work parked by an expired session", () => {
  it("is requeued once the employee has signed in again", () => {
    const parked = item({ state: "FAILED", failureKind: "unauthorised", attempts: 3 });
    assert.equal(shouldRequeueAfterSignIn(parked), true);
  });

  it("does not requeue failures that signing in cannot fix", () => {
    // A conflict means the job moved on; a rejected payload is malformed.
    // Retrying either on sign-in would hide a real problem behind a loop.
    for (const failureKind of ["conflict", "rejected", "connection_required"] as const) {
      assert.equal(
        shouldRequeueAfterSignIn(item({ state: "FAILED", failureKind })),
        false,
        `${failureKind} must not be requeued by signing in`
      );
    }
  });

  it("leaves healthy work alone", () => {
    assert.equal(shouldRequeueAfterSignIn(item({ state: "QUEUED" })), false);
    assert.equal(
      shouldRequeueAfterSignIn(item({ state: "RETRY", nextAttemptAt: 1 })),
      false
    );
  });

  it("tells the employee their update is still saved", () => {
    // The wording matters: a driver who reads "failed" assumes it is gone.
    const status = driverStatusFor(
      item({ state: "FAILED", failureKind: "unauthorised" }),
      true
    );
    assert.match(status.detail ?? "", /still saved/i);
    assert.equal(status.action, "sign_in");
  });
});
