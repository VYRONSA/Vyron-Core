import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyOutcome,
  backoffDelayMs,
  classifyNetworkError,
  classifyResponse,
  driverStatusFor,
  isDue,
  RR_OUTBOX_MAX_ATTEMPTS,
  RR_SENDING_STALE_AFTER_MS,
  type RrOutboxItem,
} from "@/lib/road-recovery/outbox-policy";

/**
 * The outbox's rules, tested where they live.
 *
 * These decide whether a driver's work is retried, abandoned or silently
 * duplicated, so they are tested as behaviour rather than shape.
 */

function item(overrides: Partial<RrOutboxItem> = {}): RrOutboxItem {
  return {
    operationId: "11111111-2222-4333-8444-555555555555",
    operationType: "transition",
    route: "/api/road-recovery/jobs/j1/transition",
    payload: { companyId: "c1", toState: "completed" },
    serviceJobId: "j1",
    label: "Completed",
    createdAt: 1_000,
    state: "QUEUED",
    attempts: 0,
    lastError: null,
    failureKind: null,
    nextAttemptAt: null,
    sendingSince: null,
    offlineSafe: true,
    ...overrides,
  };
}

describe("outbox — response classification", () => {
  it("treats 200 as succeeded", () => {
    assert.deepEqual(classifyResponse({ status: 200 }), { kind: "succeeded", replayed: false });
  });

  it("treats a REPLAY as success, not an error", () => {
    const out = classifyResponse({ status: 200, operationHeader: "replayed" });
    assert.equal(out.kind, "succeeded");
    assert.equal(out.kind === "succeeded" ? out.replayed : null, true);
  });

  it("marks OPERATION_CONFLICT as failed and never retries it", () => {
    const out = classifyResponse({ status: 409, body: { ok: false, code: "OPERATION_CONFLICT", error: "x" } });
    assert.equal(out.kind, "failed");
    assert.equal(out.kind === "failed" ? out.failureKind : null, "conflict");
  });

  it("retries a 409 that is merely still in progress", () => {
    const out = classifyResponse({ status: 409, body: { ok: false, code: "OPERATION_IN_PROGRESS" } });
    assert.equal(out.kind, "retry");
  });

  it("retries transient failures", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      assert.equal(classifyResponse({ status }).kind, "retry", `status ${status} should retry`);
    }
  });

  it("does not retry a refused request", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(classifyResponse({ status }).kind, "failed", `status ${status} should not retry`);
    }
  });

  it("distinguishes an expired session from a bad request", () => {
    const unauth = classifyResponse({ status: 401 });
    assert.equal(unauth.kind === "failed" ? unauth.failureKind : null, "unauthorised");
    const bad = classifyResponse({ status: 400 });
    assert.equal(bad.kind === "failed" ? bad.failureKind : null, "rejected");
  });

  it("always retries a request that never reached the server", () => {
    assert.equal(classifyNetworkError("Failed to fetch").kind, "retry");
  });
});

describe("outbox — retry strategy", () => {
  it("grows the delay with each attempt", () => {
    const fixed = () => 1;
    const delays = [1, 2, 3, 4].map((n) => backoffDelayMs(n, fixed));
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] > delays[i - 1], `attempt ${i + 1} did not back off further`);
    }
  });

  it("is bounded, so a long outage does not schedule retries hours away", () => {
    assert.ok(backoffDelayMs(50, () => 1) <= 5 * 60_000);
  });

  it("applies jitter, so reconnecting devices do not retry in lockstep", () => {
    assert.notEqual(backoffDelayMs(5, () => 0), backoffDelayMs(5, () => 1));
  });

  it("never schedules an instant retry", () => {
    assert.ok(backoffDelayMs(1, () => 0) >= 2_000);
  });

  it("gives up after a bounded number of attempts", () => {
    const nearly = item({ attempts: RR_OUTBOX_MAX_ATTEMPTS - 1, state: "RETRY" });
    const out = applyOutcome(nearly, { kind: "retry", reason: "offline" }, 5_000);
    assert.equal(out.state, "FAILED");
    assert.equal(out.failureKind, "exhausted");
  });
});

describe("outbox — state transitions", () => {
  it("marks a success SUCCEEDED and clears the error", () => {
    const out = applyOutcome(item({ lastError: "earlier failure" }), { kind: "succeeded", replayed: false }, 1);
    assert.equal(out.state, "SUCCEEDED");
    assert.equal(out.lastError, null);
  });

  it("marks a REPLAY succeeded exactly like a first execution", () => {
    const replayed = applyOutcome(item(), { kind: "succeeded", replayed: true }, 1);
    assert.equal(replayed.state, "SUCCEEDED");
  });

  it("schedules a future attempt on retry", () => {
    const out = applyOutcome(item(), { kind: "retry", reason: "no signal" }, 10_000);
    assert.equal(out.state, "RETRY");
    assert.ok((out.nextAttemptAt ?? 0) > 10_000, "no backoff window was set");
  });

  it("keeps the SAME operationId through every transition", () => {
    let current = item();
    for (const outcome of [
      { kind: "retry", reason: "a" } as const,
      { kind: "retry", reason: "b" } as const,
      { kind: "succeeded", replayed: true } as const,
    ]) {
      current = applyOutcome(current, outcome, 1_000);
      assert.equal(current.operationId, "11111111-2222-4333-8444-555555555555");
    }
  });

  it("only sends items that are due", () => {
    assert.equal(isDue(item({ state: "QUEUED" }), 1_000), true);
    assert.equal(isDue(item({ state: "RETRY", nextAttemptAt: 500 }), 1_000), true);
    assert.equal(isDue(item({ state: "RETRY", nextAttemptAt: 5_000 }), 1_000), false);
    assert.equal(isDue(item({ state: "SENDING" }), 1_000), false);
    assert.equal(isDue(item({ state: "SUCCEEDED" }), 1_000), false);
    assert.equal(isDue(item({ state: "FAILED" }), 1_000), false);
  });
});

describe("outbox — what the driver is told", () => {
  const wording = (i: RrOutboxItem, online: boolean) => driverStatusFor(i, online);

  it("offline: says the work is safe and will send itself", () => {
    const status = wording(item({ state: "QUEUED" }), false);
    assert.equal(status.title, "Waiting for connection");
    assert.match(status.detail || "", /safely saved/i);
    assert.match(status.detail || "", /automatically/i);
    assert.equal(status.action, null, "offline should ask nothing of the driver");
  });

  it("success: Completed / Saved", () => {
    const status = wording(item({ state: "SUCCEEDED" }), true);
    assert.equal(status.title, "Completed");
    assert.equal(status.detail, "Saved.");
  });

  it("conflict: one clear recovery action", () => {
    const status = wording(item({ state: "FAILED", failureKind: "conflict" }), true);
    assert.equal(status.title, "This update needs attention");
    assert.equal(status.action, "refresh_job");
    assert.ok(status.actionLabel);
  });

  it("expired session gets a sign-in action, not a retry", () => {
    const status = wording(item({ state: "FAILED", failureKind: "unauthorised" }), true);
    assert.equal(status.action, "sign_in");
  });

  it("NEVER exposes protocol internals to the driver", () => {
    const forbidden = /operation ?id|receipt|idempot|hash|sha256|indexeddb|service worker|409|uuid/i;
    const states: RrOutboxItem[] = [
      item({ state: "QUEUED" }),
      item({ state: "SENDING" }),
      item({ state: "RETRY" }),
      item({ state: "SUCCEEDED" }),
      item({ state: "FAILED", failureKind: "conflict" }),
      item({ state: "FAILED", failureKind: "unauthorised" }),
      item({ state: "FAILED", failureKind: "not_found" }),
      item({ state: "FAILED", failureKind: "rejected" }),
      item({ state: "FAILED", failureKind: "exhausted" }),
    ];
    for (const state of states) {
      for (const online of [true, false]) {
        const status = wording(state, online);
        const text = `${status.title} ${status.detail ?? ""} ${status.actionLabel ?? ""}`;
        assert.doesNotMatch(text, forbidden, `leaked internals for ${state.state}/${state.failureKind}: ${text}`);
      }
    }
  });

  it("every FAILED state offers exactly one action", () => {
    for (const kind of ["conflict", "unauthorised", "not_found", "rejected", "exhausted"] as const) {
      const status = wording(item({ state: "FAILED", failureKind: kind }), true);
      assert.ok(status.action, `no recovery action for ${kind}`);
      assert.ok(status.actionLabel, `no action label for ${kind}`);
    }
  });
});

describe("outbox — the worst realistic case", () => {
  /**
   * Driver taps Complete, the request leaves the phone, the connection dies
   * before the response arrives, the driver refreshes, signal returns, the queue
   * retries with the ORIGINAL operationId, and the server says it already ran.
   */
  it("a request that landed but whose response was lost ends as Completed", () => {
    const queued = item({ state: "QUEUED", label: "Completed" });

    // Attempt 1: the response never arrives.
    const afterLoss = applyOutcome(queued, classifyNetworkError("Failed to fetch"), 1_000);
    assert.equal(afterLoss.state, "RETRY");
    assert.equal(afterLoss.operationId, queued.operationId, "the retry must reuse the id");

    // The page is refreshed; the item is read back from IndexedDB unchanged.
    const afterRefresh: RrOutboxItem = JSON.parse(JSON.stringify(afterLoss));
    assert.equal(afterRefresh.operationId, queued.operationId);

    // Attempt 2 reaches a server that already has the receipt.
    const replay = classifyResponse({ status: 200, operationHeader: "replayed" });
    const settled = applyOutcome(afterRefresh, replay, 60_000);

    assert.equal(settled.state, "SUCCEEDED");
    const status = driverStatusFor(settled, true);
    assert.equal(status.title, "Completed");
    assert.equal(status.detail, "Saved.");
  });
});

describe("outbox — a failed receipt is retried, not abandoned", () => {
  /**
   * The counterpart to the server-side fix. RECEIPT_UNAVAILABLE arrives as 503
   * precisely so the queue keeps trying; if it ever arrived as 409
   * OPERATION_CONFLICT the driver's work would be dropped on the floor.
   */
  it("retries a 503 RECEIPT_UNAVAILABLE", () => {
    const out = classifyResponse({
      status: 503,
      body: { ok: false, code: "RECEIPT_UNAVAILABLE", error: "We could not save your update just now." },
    });
    assert.equal(out.kind, "retry");
  });

  it("keeps OPERATION_CONFLICT terminal, so a real conflict is not retried forever", () => {
    const out = classifyResponse({ status: 409, body: { ok: false, code: "OPERATION_CONFLICT", error: "x" } });
    assert.equal(out.kind, "failed");
    assert.equal(out.kind === "failed" ? out.failureKind : null, "conflict");
  });

  it("tells the driver it is still being sent, in their words, while retrying", () => {
    const retrying = applyOutcome(item({ state: "QUEUED" }), { kind: "retry", reason: "server unavailable" }, 1_000);
    const online = driverStatusFor(retrying, true);
    assert.equal(online.tone, "sending");
    assert.match(online.detail || "", /saved|being sent/i);
    assert.equal(online.action, null, "a retry needs nothing from the driver");

    const offline = driverStatusFor(retrying, false);
    assert.match(offline.detail || "", /safely saved|automatically/i);
  });

  it("never shows the driver a database word, whatever the server said", () => {
    const forbidden = /rr_operation_receipts|constraint|foreign key|sqlstate|503|RECEIPT_UNAVAILABLE|postgres|relation/i;
    const states: RrOutboxItem[] = [
      applyOutcome(item(), { kind: "retry", reason: 'violates constraint "rr_operation_receipts_service_job_id_fkey"' }, 1),
      applyOutcome(item({ attempts: RR_OUTBOX_MAX_ATTEMPTS - 1 }), { kind: "retry", reason: "permission denied for table rr_operation_receipts" }, 1),
    ];
    for (const state of states) {
      for (const online of [true, false]) {
        const s = driverStatusFor(state, online);
        assert.doesNotMatch(`${s.title} ${s.detail ?? ""} ${s.actionLabel ?? ""}`, forbidden);
      }
    }
  });
});

describe("outbox — an attempt nobody is making any more", () => {
  /**
   * Found by the release gate, and it was a real defect rather than a flaky
   * test. SENDING is the one state a process can die inside: the page reloads,
   * the app is force-closed, the tab is killed. isDue() used to return false for
   * SENDING unconditionally, so such an item became unreachable — the driver's
   * work sat on the device forever, displayed as though it were on its way.
   */
  it("reclaims an attempt whose process died", () => {
    const abandoned = item({ state: "SENDING", sendingSince: 1_000 });
    assert.equal(isDue(abandoned, 1_000 + RR_SENDING_STALE_AFTER_MS), true);
  });

  it("does NOT steal an attempt that is still running", () => {
    const live = item({ state: "SENDING", sendingSince: 1_000 });
    assert.equal(isDue(live, 1_000 + RR_SENDING_STALE_AFTER_MS - 1), false);
  });

  it("treats a SENDING item with no start time as abandoned", () => {
    // Written by an older build that did not stamp the field. Reclaiming is the
    // safe reading: exactly-once is enforced by the server, not by this flag.
    assert.equal(isDue(item({ state: "SENDING", sendingSince: null }), 10_000_000), true);
  });

  it("clears the in-flight marker on every outcome", () => {
    const sending = item({ state: "SENDING", sendingSince: 1_000 });
    for (const outcome of [
      { kind: "succeeded", replayed: false } as const,
      { kind: "retry", reason: "no signal" } as const,
      { kind: "failed", failureKind: "conflict", reason: "x" } as const,
    ]) {
      assert.equal(applyOutcome(sending, outcome, 5_000).sendingSince, null, `${outcome.kind} left it marked in flight`);
    }
  });

  it("a reclaimed attempt reuses the SAME operation id, so the server can refuse a double run", () => {
    const abandoned = item({ state: "SENDING", sendingSince: 1_000 });
    const settled = applyOutcome(abandoned, { kind: "succeeded", replayed: true }, 90_000);
    assert.equal(settled.operationId, abandoned.operationId);
    assert.equal(settled.state, "SUCCEEDED");
  });
});

describe("outbox — reopening the app after it was killed", () => {
  /**
   * The staleness window exists for a process that is still alive somewhere. A
   * FRESH start is different: this process cannot be the one sending, so an
   * item marked in-flight is definitionally abandoned and should be picked up
   * at once rather than after a minute of the driver watching "Sending…".
   */
  it("an item left in flight is due again the moment it goes back to QUEUED", () => {
    const reclaimed: RrOutboxItem = { ...item({ state: "SENDING", sendingSince: 1_000 }), state: "QUEUED", sendingSince: null };
    assert.equal(isDue(reclaimed, 1_100), true, "a reclaimed item must be sent without waiting");
  });

  it("reclaiming does not consume an attempt or change the id", () => {
    const stranded = item({ state: "SENDING", sendingSince: 1_000, attempts: 2 });
    const reclaimed: RrOutboxItem = { ...stranded, state: "QUEUED", sendingSince: null };
    assert.equal(reclaimed.attempts, 2, "reclaiming is not a failed attempt");
    assert.equal(reclaimed.operationId, stranded.operationId, "the id must survive, or the server cannot recognise it");
  });
});
