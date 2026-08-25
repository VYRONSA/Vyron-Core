import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyOutcome,
  classifyNetworkError,
  driverStatusFor,
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
