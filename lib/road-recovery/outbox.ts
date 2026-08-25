"use client";

/**
 * The Road & Recovery offline outbox.
 *
 * ONE place that touches IndexedDB. Screens call `enqueue()` and subscribe;
 * nothing else in the application opens a database, so there is a single answer
 * to "what is queued and what state is it in".
 *
 * THE CONTRACT WITH THE SERVER
 *
 *   operationId is generated ONCE, at enqueue, and is written to IndexedDB
 *   before any network attempt. Every retry sends that same id. That id is the
 *   key of rr_operation_receipts (sql/095), which is what makes the server able
 *   to say "already ran" instead of running it twice.
 *
 *   Generating the id at SEND time instead would defeat the entire mechanism:
 *   each retry would look like a new operation and the receipt would never match.
 *
 * The queue is written first and sent second, always. A driver who taps Complete
 * and immediately loses signal — or closes the browser — has their work on disk
 * before the request is even attempted.
 */

import {
  applyOutcome,
  classifyNetworkError,
  classifyResponse,
  driverStatusFor,
  isDue,
  shouldCancelBackoff,
  shouldRequeueAfterSignIn,
  type RrDriverStatus,
  type RrOutboxItem,
} from "@/lib/road-recovery/outbox-policy";
import { newOperationId } from "@/lib/operation-id";

const DB_NAME = "vyron-rr-outbox";
/**
 * ONE version for ONE database.
 *
 * The evidence queue keeps its blobs in the same database so there is a single
 * store to reason about, which means the schema must be owned in one place: two
 * modules opening the same name at different versions makes whichever opens
 * second throw VersionError, and silently kills the queue.
 */
const DB_VERSION = 3;
const STORE = "operations";
const BLOB_STORE = "evidenceBlobs";
const INCIDENT_DRAFT_STORE = "incidentDrafts";

/** Guards against two tabs (or a tab and the SW-triggered drain) sending the same item. */
const inFlight = new Set<string>();

type Listener = (items: RrOutboxItem[]) => void;
const listeners = new Set<Listener>();

function browser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/** Opens the one Road & Recovery database, creating every store it owns. */
export function openRrDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "operationId" });
        store.createIndex("state", "state", { unique: false });
        store.createIndex("serviceJobId", "serviceJobId", { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        const store = db.createObjectStore(BLOB_STORE, { keyPath: "operationId" });
        store.createIndex("serviceJobId", "record.serviceJobId", { unique: false });
        store.createIndex("state", "record.state", { unique: false });
      }
      /**
       * Incident drafts. An employee half-way through writing up an injury must
       * not lose it because the app was killed, so the draft is on disk from the
       * first keystroke — long before anything is submitted.
       */
      if (!db.objectStoreNames.contains(INCIDENT_DRAFT_STORE)) {
        const store = db.createObjectStore(INCIDENT_DRAFT_STORE, { keyPath: "incidentId" });
        store.createIndex("state", "state", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const openDb = openRrDb;

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function allItems(): Promise<RrOutboxItem[]> {
  if (!browser()) return [];
  const rows = await tx<RrOutboxItem[]>("readonly", (store) => store.getAll() as IDBRequest<RrOutboxItem[]>);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

async function put(item: RrOutboxItem): Promise<void> {
  await tx("readwrite", (store) => store.put(item) as IDBRequest<IDBValidKey>);
  void notify();
}

export async function removeItem(operationId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(operationId) as unknown as IDBRequest<undefined>);
  void notify();
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const items = await allItems();
  listeners.forEach((listener) => listener(items));
}

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void allItems().then((items) => listener(items));
  return () => listeners.delete(listener);
}

export type EnqueueInput = {
  operationType: string;
  route: string;
  payload: Record<string, unknown>;
  serviceJobId?: string | null;
  label: string;
  /**
   * An id generated EARLIER by a caller that already committed to it.
   *
   * Evidence is the only such caller: its storage path is derived from the id at
   * capture time, so the row must be filed under that same id for one receipt to
   * cover both halves. Everything else omits this and gets a fresh id here.
   */
  operationId?: string;
  /**
   * May this operation execute LATER than the driver performed it?
   *
   * Defaults to FALSE. Deferring almost anything falsifies a server-stamped
   * timestamp, so an action must opt IN to being deferrable rather than opt out.
   */
  offlineSafe?: boolean;
};

/**
 * Puts an operation on the queue and tries to send it.
 *
 * The write to IndexedDB completes BEFORE the first attempt, so the operation
 * survives a crash, a refresh or a closed browser between tap and response.
 */
export async function enqueue(input: EnqueueInput): Promise<RrOutboxItem> {
  const item: RrOutboxItem = {
    // Once, and never regenerated — either here, or by the caller that already
    // built something else (an evidence storage path) out of it.
    operationId: input.operationId ?? newOperationId(),
    operationType: input.operationType,
    route: input.route,
    payload: input.payload,
    serviceJobId: input.serviceJobId ?? null,
    label: input.label,
    createdAt: Date.now(),
    state: "QUEUED",
    attempts: 0,
    lastError: null,
    failureKind: null,
    nextAttemptAt: null,
    sendingSince: null,
    offlineSafe: input.offlineSafe === true,
  };

  if (!browser()) return item;

  await put(item);

  if (!item.offlineSafe && typeof navigator !== "undefined" && navigator.onLine === false) {
    const failed = applyOutcome(item, classifyNetworkError("", false), Date.now());
    await put(failed);
    return failed;
  }

  void processQueue();
  return item;
}

/** One attempt for one item. Returns the item's new state. */
async function attempt(item: RrOutboxItem): Promise<RrOutboxItem> {
  // The operationId travels in the body, alongside the payload the route expects.
  const body = JSON.stringify({ ...item.payload, operationId: item.operationId });

  let outcome;
  try {
    const response = await fetch(item.route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // Never let a queued mutation be served from a cache.
      cache: "no-store",
    });
    const parsed = await response.json().catch(() => null);
    outcome = classifyResponse({
      status: response.status,
      operationHeader: response.headers.get("x-rr-operation"),
      body: parsed,
    });
  } catch (error: unknown) {
    outcome = classifyNetworkError(
      error instanceof Error ? error.message : "No connection.",
      item.offlineSafe
    );
  }

  const next = applyOutcome(item, outcome, Date.now());
  await put(next);
  return next;
}

let draining = false;

/**
 * Sends everything that is due.
 *
 * Serialised: `draining` stops two concurrent callers (a reconnect event and the
 * service worker, say) from processing the same queue at once, and `inFlight`
 * stops the same operation being sent twice even if that guard is bypassed.
 */
export async function processQueue(): Promise<void> {
  if (!browser() || draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  draining = true;
  try {
    const now = Date.now();
    const due = (await allItems()).filter((item) => isDue(item, now) && !inFlight.has(item.operationId));

    for (const item of due) {
      inFlight.add(item.operationId);
      try {
        await put({ ...item, state: "SENDING", sendingSince: Date.now() });
        await attempt(item);
      } finally {
        inFlight.delete(item.operationId);
      }
    }
  } finally {
    draining = false;
    void notify();
  }
}

/**
 * Manual retry for an item the driver was asked to attend to.
 *
 * Keeps the SAME operationId — this is a retry of the same operation, not a new
 * one, so the server can still recognise it if the original did land.
 */
export async function retryItem(operationId: string): Promise<void> {
  const items = await allItems();
  const item = items.find((row) => row.operationId === operationId);
  if (!item) return;
  await put({ ...item, state: "QUEUED", attempts: 0, lastError: null, failureKind: null, nextAttemptAt: null });
  void processQueue();
}

/** Clear operations that completed, so the queue does not grow forever. */
export async function pruneSucceeded(olderThanMs = 60_000): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  const items = await allItems();
  await Promise.all(
    items
      .filter((item) => item.state === "SUCCEEDED" && item.createdAt < cutoff)
      .map((item) => removeItem(item.operationId))
  );
}

/* ── Wiring ───────────────────────────────────────────────────────────────── */

let started = false;

/**
 * Starts the drivers of the queue: reconnect, tab focus, a slow timer for
 * backoff windows, and messages from the service worker.
 *
 * Idempotent, so a component may call it on every mount.
 */
/**
 * Anything left SENDING when the app starts was abandoned.
 *
 * This process has just begun, so it cannot be the one sending. An item marked
 * in-flight therefore belongs to a page that was reloaded, an app that was
 * force-closed, or a tab that was killed — and waiting out the staleness window
 * would leave a driver watching "Sending…" for a minute after they reopened the
 * app.
 *
 * Reclaiming immediately is safe because it is the whole point of the
 * protocol: the retry carries the ORIGINAL operationId, so the server replays
 * its receipt instead of running the work twice.
 */
async function reclaimAbandonedAttempts(): Promise<void> {
  const stranded = (await allItems()).filter((item) => item.state === "SENDING");
  for (const item of stranded) {
    await put({ ...item, state: "QUEUED", sendingSince: null });
  }
}

/**
 * Cancel backoff that was accrued while the device had no signal.
 *
 * Exponential backoff exists to stop a client hammering a server that is
 * struggling. Losing signal is a different failure with the same symptom: every
 * attempt fails, the delay doubles, and by the time a driver reaches somewhere
 * with coverage their next attempt can be minutes away. Nothing about the
 * server was ever wrong, so making them wait out that delay serves no one — and
 * for a safety report, minutes is the whole point of the feature.
 *
 * A connectivity transition is therefore treated as evidence that the reason
 * for waiting has gone: the scheduled delay is dropped so the item is due at
 * once. `attempts` is deliberately left alone, so the failure cap and its
 * accounting still apply — only the waiting is cancelled, not the history.
 */
async function cancelBackoffAfterReconnect(): Promise<void> {
  const now = Date.now();
  const waiting = (await allItems()).filter((item) => shouldCancelBackoff(item, now));
  for (const item of waiting) {
    await put({ ...item, nextAttemptAt: null });
  }
}

/**
 * Put work parked by an expired session back in the queue.
 *
 * The app shell this runs inside is server-gated, so reaching it at all means
 * the employee holds a valid session right now. Anything parked as
 * "unauthorised" was parked against a session that has since been replaced, so
 * the reason it failed is gone and it deserves another attempt.
 *
 * `attempts` is reset because the previous failures were all the same expired
 * credential rather than a struggling server, and keeping them would push a
 * freshly authorised item straight into a long backoff.
 */
async function requeueAfterSignIn(): Promise<void> {
  const parked = (await allItems()).filter(shouldRequeueAfterSignIn);
  for (const item of parked) {
    await put({
      ...item,
      state: "QUEUED",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      failureKind: null,
      sendingSince: null,
    });
  }
}

export function startOutbox(): void {
  if (!browser() || started) return;
  started = true;

  void reclaimAbandonedAttempts()
    .then(() => requeueAfterSignIn())
    .then(() => processQueue());

  // The moment signal returns. This is what removes the manual "Sync" button.
  window.addEventListener("online", () => {
    void cancelBackoffAfterReconnect().then(() => processQueue());
  });
  // Coming back to the tab is the other common moment connectivity has returned
  // without an 'online' event having fired.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // Reopening the app after a trip through a dead zone is the same signal as
    // an 'online' event, and on Android it is often the only one that fires.
    if (navigator.onLine) void cancelBackoffAfterReconnect().then(() => processQueue());
    else void processQueue();
  });
  // Backoff windows expire on their own schedule; nothing else would wake them.
  setInterval(() => void processQueue(), 15_000);

  navigator.serviceWorker?.addEventListener?.("message", (event: MessageEvent) => {
    if (event.data?.type === "rr-outbox-drain") void processQueue();
  });

  void processQueue();
}

/** Driver-facing status for one item. Re-exported so screens import one module. */
export function statusFor(item: RrOutboxItem, online: boolean): RrDriverStatus {
  return driverStatusFor(item, online);
}

export type { RrOutboxItem, RrDriverStatus };
