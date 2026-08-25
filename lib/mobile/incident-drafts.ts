"use client";

/**
 * Incident drafts — on disk before anything else.
 *
 * THE RULE: an employee never loses what they have written.
 *
 * Somebody typing up an injury with cold hands, one bar of signal and a
 * supervisor shouting at them cannot be asked to start again because the app
 * was killed in the background. So the draft is persisted from the first field
 * they touch, not at submit — and it survives app termination, because it lives
 * in the same IndexedDB the outbox and evidence queue already use.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 *   It does not send anything. Submission hands the draft to the existing
 *   outbox, which owns retry, backoff and exactly-once. There is deliberately
 *   no second queue here — the outbox's operationId becomes the incident's
 *   primary key, so a retry cannot file a second incident (see
 *   lib/mobile/incidents.ts).
 *
 * THE STATES AN EMPLOYEE IS SHOWN
 *
 *   draft            still being written
 *   saved_on_device  complete, on disk, not yet sent
 *   submitting       the queue is trying
 *   submitted        the SERVER confirmed it
 *
 * "Submitted" is said only when the server has confirmed. That is the same rule
 * the evidence queue follows, and for the same reason: telling somebody their
 * injury report is filed when it is sitting in a queue is a lie that could cost
 * an investigation.
 */

import { enqueue, openRrDb } from "@/lib/road-recovery/outbox";
import { newOperationId } from "@/lib/operation-id";

const STORE = "incidentDrafts";

export type RrIncidentDraftState = "draft" | "saved_on_device" | "submitting" | "submitted" | "failed";

export type RrIncidentDraft = {
  /** Generated once, at first save. Becomes the incident's primary key. */
  incidentId: string;
  companyId: string;
  category: string | null;
  severity: string | null;
  title: string;
  description: string;
  peopleInvolved: string;
  immediateDanger: boolean;
  emergencyRequired: boolean;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  /** The employee's assertion of when it happened. */
  occurredAt: string | null;
  /** operationIds of photographs captured against this incident. */
  photoOperationIds: string[];
  state: RrIncidentDraftState;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

function browser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openRrDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function allDrafts(): Promise<RrIncidentDraft[]> {
  if (!browser()) return [];
  const rows = await tx<RrIncidentDraft[]>("readonly", (store) => store.getAll() as IDBRequest<RrIncidentDraft[]>);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDraft(incidentId: string): Promise<RrIncidentDraft | undefined> {
  if (!browser()) return undefined;
  return tx<RrIncidentDraft | undefined>("readonly", (store) =>
    store.get(incidentId) as IDBRequest<RrIncidentDraft | undefined>
  );
}

async function put(draft: RrIncidentDraft): Promise<void> {
  await tx("readwrite", (store) => store.put(draft) as IDBRequest<IDBValidKey>);
}

/** Starts a draft. The id is minted here and never regenerated. */
export function newDraft(companyId: string): RrIncidentDraft {
  const now = Date.now();
  return {
    incidentId: newOperationId(),
    companyId,
    category: null,
    severity: null,
    title: "",
    description: "",
    peopleInvolved: "",
    immediateDanger: false,
    emergencyRequired: false,
    latitude: null,
    longitude: null,
    gpsAccuracy: null,
    occurredAt: null,
    photoOperationIds: [],
    state: "draft",
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
}

/** Persists whatever has been typed so far. Called on every meaningful change. */
export async function saveDraft(draft: RrIncidentDraft): Promise<RrIncidentDraft> {
  const next = { ...draft, updatedAt: Date.now() };
  if (browser()) await put(next);
  return next;
}

export async function discardDraft(incidentId: string): Promise<void> {
  if (!browser()) return;
  await tx("readwrite", (store) => store.delete(incidentId) as unknown as IDBRequest<undefined>);
}

/** Attaches a captured photograph to the draft. */
export async function attachPhoto(incidentId: string, photoOperationId: string): Promise<RrIncidentDraft | null> {
  const draft = await getDraft(incidentId);
  if (!draft) return null;
  if (draft.photoOperationIds.includes(photoOperationId)) return draft;
  return saveDraft({ ...draft, photoOperationIds: [...draft.photoOperationIds, photoOperationId] });
}

/** Removes a photograph before submission. */
export async function detachPhoto(incidentId: string, photoOperationId: string): Promise<RrIncidentDraft | null> {
  const draft = await getDraft(incidentId);
  if (!draft) return null;
  return saveDraft({
    ...draft,
    photoOperationIds: draft.photoOperationIds.filter((id) => id !== photoOperationId),
  });
}

/** What is still missing before this can be submitted, in the employee's words. */
export function missingFromDraft(draft: RrIncidentDraft): string[] {
  const missing: string[] = [];
  if (!draft.category) missing.push("What kind of incident it was");
  if (!draft.severity) missing.push("How serious it was");
  if (!draft.description.trim()) missing.push("What happened");
  return missing;
}

export function canSubmit(draft: RrIncidentDraft): boolean {
  return missingFromDraft(draft).length === 0;
}

/**
 * Hands the finished draft to the outbox.
 *
 * `offlineSafe: true` is correct here and is NOT the loophole it looks like.
 * The Road & Recovery rule is that an operation may not be deferred if doing so
 * would falsify a server-stamped operational time — an arrival recorded forty
 * minutes late claims the driver arrived forty minutes late. An incident carries
 * its own occurred_at, asserted by the employee, so filing it later records
 * exactly when it happened. The queue can hold it safely for as long as it must.
 */
export async function submitDraft(draft: RrIncidentDraft): Promise<RrIncidentDraft> {
  const ready: RrIncidentDraft = {
    ...draft,
    state: "submitting",
    // If the employee never said when, the moment they finished writing it up is
    // the closest honest answer — and it is still theirs, not the server's.
    occurredAt: draft.occurredAt ?? new Date(draft.createdAt).toISOString(),
    updatedAt: Date.now(),
  };
  if (browser()) await put(ready);

  await enqueue({
    // The queue's id IS the incident's primary key, so a retry cannot file twice.
    operationId: ready.incidentId,
    operationType: "report_incident",
    route: "/api/mobile/incidents",
    label: "Incident report",
    offlineSafe: true,
    payload: {
      companyId: ready.companyId,
      category: ready.category,
      severity: ready.severity,
      title: ready.title,
      description: ready.description,
      peopleInvolved: ready.peopleInvolved,
      immediateDanger: ready.immediateDanger,
      emergencyRequired: ready.emergencyRequired,
      latitude: ready.latitude,
      longitude: ready.longitude,
      accuracy: ready.gpsAccuracy,
      occurredAt: ready.occurredAt,
      metadata: { photoCount: ready.photoOperationIds.length },
    },
  });

  return ready;
}

/** Called when the outbox reports the server accepted it. */
export async function markSubmitted(incidentId: string): Promise<void> {
  const draft = await getDraft(incidentId);
  if (!draft) return;
  await put({ ...draft, state: "submitted", lastError: null, updatedAt: Date.now() });
}

/**
 * The employee-facing status. Never claims the server has it until it does.
 */
/**
 * How many reports are genuinely on their way, and how many are not.
 *
 * These must be counted separately because only one of them is true without
 * the employee doing anything else. A report in `submitting` or
 * `saved_on_device` has been handed to the outbox and will drain by itself.
 * A `draft` has not — it is an unfinished report that nobody has pressed send
 * on, and it will sit on the device forever.
 *
 * Collapsing the two into a single "waiting to send … they will send themselves
 * when you have signal" is the worst possible error for this app to make: it
 * tells somebody who walked away from a half-written incident report that it is
 * already handled. A driver has to be able to trust that sentence completely,
 * so it may only ever be shown for work the queue actually owns.
 */
export function draftSendState(drafts: RrIncidentDraft[]): {
  queued: number;
  unfinished: number;
  needsAttention: number;
} {
  let queued = 0;
  let unfinished = 0;
  let needsAttention = 0;
  for (const draft of drafts) {
    if (draft.state === "submitting" || draft.state === "saved_on_device") queued += 1;
    else if (draft.state === "draft") unfinished += 1;
    else if (draft.state === "failed") needsAttention += 1;
  }
  return { queued, unfinished, needsAttention };
}

export function draftStatusText(
  draft: RrIncidentDraft,
  online: boolean
): { title: string; detail: string } {
  switch (draft.state) {
    case "draft":
      return { title: "Draft", detail: "Saved on this device. Not sent yet." };
    case "saved_on_device":
      return online
        ? { title: "Saved on device", detail: "Ready to send." }
        : { title: "Saved on device", detail: "Waiting for connection. It will send automatically." };
    case "submitting":
      return online
        ? { title: "Sending…", detail: "Saved on this device until the control room confirms it." }
        : { title: "Waiting for connection", detail: "Your report is safely saved and will be sent automatically." };
    case "submitted":
      return { title: "Submitted", detail: "The control room has your report." };
    case "failed":
      return { title: "This report needs attention", detail: "Still saved on this device. It will be tried again." };
  }
}
