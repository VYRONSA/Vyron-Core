/**
 * The outbox's decisions, with no IndexedDB and no fetch in sight.
 *
 * Everything that decides WHETHER to retry, WHEN to retry, and what the driver
 * is told lives here as pure functions. The storage layer in outbox.ts does the
 * I/O and asks these questions; that split is what lets the rules be tested
 * exhaustively in node rather than only in a browser.
 *
 * The distinction that matters most: a REPLAY IS A SUCCESS. When the server says
 * it already ran this operation, the work is done — that is the whole point of
 * the receipt. Treating it as an error would make the driver redo something that
 * already happened.
 */

/** Queue lifecycle. QUEUED -> SENDING -> SUCCEEDED | RETRY | FAILED. */
export type RrOutboxState = "QUEUED" | "SENDING" | "SUCCEEDED" | "RETRY" | "FAILED";

/** Why an operation ended up FAILED — chooses the driver's recovery action. */
export type RrOutboxFailureKind =
  | "conflict"
  | "rejected"
  | "unauthorised"
  | "not_found"
  | "exhausted"
  /** Attempted offline, but deferring it would falsify the operational record. */
  | "connection_required";

export type RrOutboxItem = {
  /** Generated ONCE at enqueue. Never regenerated — this is the receipt key. */
  operationId: string;
  /** Server-side operation kind, matching sql/095's CHECK. */
  operationType: string;
  /** Route to POST to, and the body to send. */
  route: string;
  payload: Record<string, unknown>;
  /** For grouping and for the job screen's own status line. */
  serviceJobId: string | null;
  /** Human label the driver sees ("Arrived", "Completed"). */
  label: string;
  createdAt: number;
  state: RrOutboxState;
  attempts: number;
  lastError: string | null;
  failureKind: RrOutboxFailureKind | null;
  /** Epoch ms. Null when the item is not waiting. */
  nextAttemptAt: number | null;
  /**
   * When this attempt was started, or null when nothing is in flight.
   *
   * Exists because SENDING is the one state a process can DIE inside. The page
   * is reloaded, the app is killed, the tab is closed — and the item is left
   * marked as sending with nobody sending it. Without this timestamp such an
   * item is unreachable: isDue() would never return true for it again and the
   * driver's work would sit on the device forever, looking like it was on its
   * way.
   */
  sendingSince: number | null;
  /**
   * Whether this operation may be executed LATER than the driver performed it.
   *
   * Almost nothing may. Every operational timestamp in this system is stamped
   * with SERVER time at the moment the request is processed — see
   * job-service.ts (`occurredAt = new Date()`, `respondedAt = new Date()`) and
   * bystand-service.ts ("always stamped with SERVER time"). Draining a queued
   * arrival or a queued BYSTAND clock action forty minutes late would record an
   * arrival that never happened at that time and bill forty minutes of standing
   * that nobody stood.
   *
   * So only operations with no timing meaning are offline-safe: the BYSTAND
   * observation report, and evidence (whose photograph is the evidence, and
   * whose capture time travels in its own metadata).
   */
  offlineSafe: boolean;
};

/* ── Retry policy ─────────────────────────────────────────────────────────── */

export const RR_OUTBOX_MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * How long an in-flight attempt is honoured before it is presumed dead.
 *
 * Long enough that a slow request on a bad connection is never stolen from
 * itself; short enough that a driver who force-closed the app mid-send is not
 * left waiting. Mirrors RR_RECEIPT_STALE_AFTER_MS on the server, and is safe
 * for the same reason: re-attempting carries the ORIGINAL operationId, so the
 * receipt (or the incident's own primary key) answers "already ran" rather than
 * running it twice.
 */
export const RR_SENDING_STALE_AFTER_MS = 60_000;

/**
 * Bounded exponential backoff with jitter.
 *
 * The jitter is not decoration. A recovery crew coming back into signal
 * reconnects every queued device at once; without jitter every phone retries on
 * the same schedule and the server sees a thundering herd on each boundary.
 * Full jitter (random across the whole window) spreads them properly.
 *
 * `random` is injectable so the tests are deterministic.
 */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  // Never below the base delay: an instant retry helps nobody.
  return Math.round(BASE_DELAY_MS + random() * Math.max(0, exponential - BASE_DELAY_MS));
}

/* ── Response classification ──────────────────────────────────────────────── */

export type RrAttemptOutcome =
  | { kind: "succeeded"; replayed: boolean }
  | { kind: "retry"; reason: string }
  | { kind: "failed"; failureKind: RrOutboxFailureKind; reason: string };

/** What the server said, reduced to the only three things the queue cares about. */
export function classifyResponse(input: {
  status: number;
  /** Value of the x-rr-operation header, if present. */
  operationHeader?: string | null;
  /** Parsed body, when there was one. */
  body?: { ok?: boolean; error?: string; code?: string } | null;
}): RrAttemptOutcome {
  const { status, body } = input;
  const header = (input.operationHeader || "").toLowerCase();

  if (status >= 200 && status < 300) {
    // `replayed` means the server had already run this operation. Done is done.
    return { kind: "succeeded", replayed: header === "replayed" };
  }

  if (status === 409) {
    // Two very different 409s share the status code.
    if (body?.code === "OPERATION_CONFLICT") {
      return {
        kind: "failed",
        failureKind: "conflict",
        reason: body.error || "This update conflicts with one already sent.",
      };
    }
    // OPERATION_IN_PROGRESS, or a workflow conflict — transient, keep trying.
    return { kind: "retry", reason: body?.error || "The server is still processing this." };
  }

  if (status === 408 || status === 429 || status >= 500) {
    return { kind: "retry", reason: body?.error || `Server unavailable (${status}).` };
  }

  if (status === 401) {
    return { kind: "failed", failureKind: "unauthorised", reason: "Your session has expired." };
  }
  if (status === 403) {
    return { kind: "failed", failureKind: "unauthorised", reason: body?.error || "Not permitted." };
  }
  if (status === 404) {
    return { kind: "failed", failureKind: "not_found", reason: body?.error || "This job could not be found." };
  }

  // 400, 422 and anything else in the 4xx range: the request itself is wrong,
  // and sending it again will produce the same answer.
  return {
    kind: "failed",
    failureKind: "rejected",
    reason: body?.error || `Request refused (${status}).`,
  };
}

/**
 * A fetch that never reached the server.
 *
 * Worth retrying only if executing it later is still truthful. For anything
 * else this is a terminal "you need a connection", never a deferred mutation —
 * the driver is told now rather than discovering later that their job time is
 * wrong.
 */
export function classifyNetworkError(message: string, offlineSafe = true): RrAttemptOutcome {
  if (offlineSafe) return { kind: "retry", reason: message || "No connection." };
  return {
    kind: "failed",
    failureKind: "connection_required",
    reason: "This action needs a live connection to keep your job time and status accurate.",
  };
}

/* ── State transitions ────────────────────────────────────────────────────── */

/**
 * Applies an outcome to an item, returning the item's next state.
 *
 * Pure: takes the current item and the outcome, hands back a new item. The
 * caller persists it. Attempt exhaustion is decided here so the storage layer
 * has no policy in it at all.
 */
export function applyOutcome(
  item: RrOutboxItem,
  outcome: RrAttemptOutcome,
  now: number,
  random: () => number = Math.random
): RrOutboxItem {
  const attempts = item.attempts + 1;

  if (outcome.kind === "succeeded") {
    return { ...item, state: "SUCCEEDED", attempts, lastError: null, failureKind: null, nextAttemptAt: null, sendingSince: null };
  }

  if (outcome.kind === "failed") {
    return {
      ...item,
      state: "FAILED",
      attempts,
      lastError: outcome.reason,
      failureKind: outcome.failureKind,
      nextAttemptAt: null,
      sendingSince: null,
    };
  }

  // retry — unless we have run out of patience.
  if (attempts >= RR_OUTBOX_MAX_ATTEMPTS) {
    return {
      ...item,
      state: "FAILED",
      attempts,
      lastError: outcome.reason,
      failureKind: "exhausted",
      nextAttemptAt: null,
      sendingSince: null,
    };
  }

  return {
    ...item,
    state: "RETRY",
    attempts,
    lastError: outcome.reason,
    failureKind: null,
    nextAttemptAt: now + backoffDelayMs(attempts, random),
    sendingSince: null,
  };
}

/** Items eligible to be sent right now. */
/**
 * Whether regaining connectivity should make this item due immediately.
 *
 * Exponential backoff protects a server that is struggling. Having no signal
 * produces the same symptom for a completely different reason: every attempt
 * fails, the delay doubles, and a driver who spent twenty minutes in a dead
 * zone can surface with their next attempt still minutes away. Nothing was ever
 * wrong with the server, so that wait buys nothing — and for a safety report it
 * is exactly the wait the offline queue exists to prevent.
 *
 * A connectivity transition is therefore treated as evidence that the reason
 * for waiting has gone. Only items actually sitting out a delay are affected;
 * `attempts` is left untouched so the failure cap and its accounting survive.
 */
/**
 * Whether signing in again should put this item back in the queue.
 *
 * An expired session parks work rather than discarding it, which is right — but
 * it then waits for the driver to find each parked card and press its Sign in
 * button. They have already done the thing that was being asked of them, so
 * making the queue drain only after a scavenger hunt turns "your update is
 * still saved" into work that quietly never sends.
 *
 * Only authentication failures qualify. A conflict or a rejected payload is not
 * fixed by signing in, and requeueing those would hide a real problem behind a
 * retry loop.
 */
export function shouldRequeueAfterSignIn(item: RrOutboxItem): boolean {
  return item.state === "FAILED" && item.failureKind === "unauthorised";
}

export function shouldCancelBackoff(item: RrOutboxItem, now: number): boolean {
  return item.state === "RETRY" && (item.nextAttemptAt ?? 0) > now;
}

export function isDue(item: RrOutboxItem, now: number): boolean {
  if (item.state === "QUEUED") return true;
  if (item.state === "RETRY") return (item.nextAttemptAt ?? 0) <= now;
  /**
   * An attempt nobody is making any more.
   *
   * The process that marked this SENDING is gone — killed, reloaded, or
   * crashed — so the item is reclaimed rather than abandoned. Exactly-once
   * still holds: the retry carries the same operationId, and the server has the
   * final say on whether it already ran.
   */
  if (item.state === "SENDING") {
    return now - (item.sendingSince ?? 0) >= RR_SENDING_STALE_AFTER_MS;
  }
  return false;
}

/* ── What the driver is told ──────────────────────────────────────────────── */

export type RrDriverStatus = {
  /** Short headline. */
  title: string;
  /** One supporting sentence, or null when the headline says everything. */
  detail: string | null;
  tone: "pending" | "sending" | "done" | "attention";
  /** The single recovery action, when one is needed. */
  action: "retry" | "reload" | "sign_in" | "refresh_job" | null;
  actionLabel: string | null;
};

/**
 * The driver-facing wording.
 *
 * Deliberately free of operation ids, hashes, receipts, retry counts and the
 * word "conflict". A person standing beside a wrecked vehicle needs to know one
 * thing: is my work safe, and is there anything for me to do.
 */
export function driverStatusFor(item: RrOutboxItem, online: boolean): RrDriverStatus {
  switch (item.state) {
    case "SENDING":
      return { title: "Sending…", detail: null, tone: "sending", action: null, actionLabel: null };

    case "SUCCEEDED":
      return { title: "Completed", detail: "Saved.", tone: "done", action: null, actionLabel: null };

    case "QUEUED":
    case "RETRY":
      return online
        ? {
            title: "Sending…",
            detail: "Your update is saved and is being sent.",
            tone: "sending",
            action: null,
            actionLabel: null,
          }
        : {
            title: "Waiting for connection",
            detail: "Your update is safely saved and will be sent automatically.",
            tone: "pending",
            action: null,
            actionLabel: null,
          };

    case "FAILED": {
      // One clear recovery action, chosen by why it failed.
      if (item.failureKind === "connection_required") {
        return {
          title: "Connection required",
          detail: "This action needs a live connection to keep your job time and status accurate.",
          tone: "attention",
          action: "retry",
          actionLabel: "Try again",
        };
      }
      if (item.failureKind === "unauthorised") {
        return {
          title: "This update needs attention",
          detail: "Please sign in again — your update is still saved.",
          tone: "attention",
          action: "sign_in",
          actionLabel: "Sign in",
        };
      }
      if (item.failureKind === "conflict") {
        return {
          title: "This update needs attention",
          detail: "This job has already moved on. Refresh it to see where it is now.",
          tone: "attention",
          action: "refresh_job",
          actionLabel: "Refresh job",
        };
      }
      if (item.failureKind === "not_found") {
        return {
          title: "This update needs attention",
          detail: "This job is no longer available to you. Refresh your job list.",
          tone: "attention",
          action: "reload",
          actionLabel: "Refresh jobs",
        };
      }
      // rejected / exhausted — trying again is the sensible move.
      return {
        title: "This update needs attention",
        detail: "We could not send this update. Your work is still saved on this device.",
        tone: "attention",
        action: "retry",
        actionLabel: "Try again",
      };
    }
  }
}
