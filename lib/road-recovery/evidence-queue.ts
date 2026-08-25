"use client";

/**
 * Offline-safe evidence capture.
 *
 * THE RULE: a photograph is never described as uploaded because it was saved.
 *
 * Two independent things have to happen before evidence is real, and they can
 * fail separately:
 *
 *   1. the BYTES reach the private `rr-evidence` bucket
 *   2. the ROW reaches mobile_workforce_evidence and its requirement links
 *
 * The driver is told exactly which of those has happened. "Saved on device"
 * means we hold the blob. "Uploaded and verified" is said only after the server
 * has confirmed step 2, because only then is the evidence attached to the job
 * and counted by the compliance engine.
 *
 * WHY THIS NEEDS NO SCHEMA CHANGE
 *
 *   Duplicate ROWS      prevented by the Gate B receipt: a retry carrying the
 *                       original operationId replays instead of re-inserting.
 *   Duplicate LINKS     prevented by the existing UNIQUE
 *                       (company_id, evidence_id, requirement_id) on
 *                       rr_evidence_links.
 *   Duplicate OBJECTS   prevented by deriving the storage path from the
 *                       operationId, so every retry targets the same path.
 *
 * One consequence of the storage policy shapes the retry logic. The `rr-evidence`
 * UPDATE and DELETE policies are platform-operator only, so a driver cannot
 * overwrite or remove an object. A retry after a successful-but-unacknowledged
 * upload therefore gets "already exists" — and that is treated as SUCCESS, not
 * an error. It is safe to do so: the path contains a client-generated v4 uuid
 * under the company's own prefix, so an object there can only be this device's
 * earlier attempt.
 */

/**
 * The outbox owns the database, including this module's blob store.
 *
 * Deliberately NOT a second `indexedDB.open` with its own version number: two
 * modules opening one database at different versions makes whichever opens
 * second throw VersionError, which is exactly how a queue dies silently.
 */
import { enqueue, openRrDb as openDb } from "@/lib/road-recovery/outbox";

const BLOB_STORE = "evidenceBlobs";

/** Where the driver's evidence has actually got to. */
export type RrEvidenceState =
  | "captured"
  | "saved_on_device"
  | "uploading"
  | "uploaded"
  | "linked"
  | "failed";

export type RrEvidenceRecord = {
  /** The SAME id used for the receipt when the row is filed. */
  operationId: string;
  serviceJobId: string;
  companyId: string;
  evidenceType: string;
  requirementCodes: string[];
  capturedAt: number;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  /** Deterministic: {companyId}/{serviceJobId}/{operationId}.{ext} */
  storagePath: string;
  contentType: string;
  byteSize: number;
  /**
   * Where the ROW is filed once the bytes are up.
   *
   * Defaults to the Road & Recovery job route. An incident supplies its own,
   * because mobile_workforce_evidence.service_job_id is foreign-keyed to
   * rr_service_jobs and an incident is not a job — so one queue serves both by
   * being told where to post rather than by being duplicated.
   */
  uploadRoute: string;
  state: RrEvidenceState;
  attempts: number;
  lastError: string | null;
};

function browser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

type StoredBlob = { operationId: string; blob: Blob; record: RrEvidenceRecord };

async function blobTx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(BLOB_STORE, mode);
    const request = run(transaction.objectStore(BLOB_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function allEvidence(): Promise<RrEvidenceRecord[]> {
  if (!browser()) return [];
  const rows = await blobTx<StoredBlob[]>("readonly", (s) => s.getAll() as IDBRequest<StoredBlob[]>);
  return rows.map((row) => row.record).sort((a, b) => a.capturedAt - b.capturedAt);
}

async function putBlob(entry: StoredBlob): Promise<void> {
  await blobTx("readwrite", (s) => s.put(entry) as IDBRequest<IDBValidKey>);
}

async function getBlob(operationId: string): Promise<StoredBlob | undefined> {
  return blobTx<StoredBlob | undefined>("readonly", (s) => s.get(operationId) as IDBRequest<StoredBlob | undefined>);
}

async function patch(operationId: string, changes: Partial<RrEvidenceRecord>): Promise<void> {
  const entry = await getBlob(operationId);
  if (!entry) return;
  await putBlob({ ...entry, record: { ...entry.record, ...changes } });
}

/** Frees the bytes once the server holds the evidence; the record stays. */
async function dropBlobKeepRecord(operationId: string): Promise<void> {
  const entry = await getBlob(operationId);
  if (!entry) return;
  await putBlob({ ...entry, blob: new Blob([]), record: { ...entry.record, state: "linked" } });
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("pdf")) return "pdf";
  return "jpg";
}

export type CaptureInput = {
  blob: Blob;
  companyId: string;
  serviceJobId: string;
  evidenceType: string;
  requirementCodes?: string[];
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
  /** Overrides where the evidence ROW is filed. */
  uploadRoute?: string;
  /** Overrides the storage folder. Must still begin with the company id. */
  storagePrefix?: string;
};

/**
 * Saves the capture to the device. Does NOT claim it is uploaded.
 *
 * The blob is written to IndexedDB before anything is attempted, so a driver who
 * photographs a vehicle and immediately loses signal — or closes the browser —
 * still has the image.
 */
export async function captureEvidence(input: CaptureInput): Promise<RrEvidenceRecord> {
  const operationId = crypto.randomUUID();
  const contentType = input.blob.type || "image/jpeg";
  const record: RrEvidenceRecord = {
    operationId,
    serviceJobId: input.serviceJobId,
    companyId: input.companyId,
    evidenceType: input.evidenceType,
    requirementCodes: input.requirementCodes ?? [],
    capturedAt: Date.now(),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracy: input.accuracy ?? null,
    actorEmail: input.actorEmail ?? null,
    metadata: input.metadata ?? {},
    // Deterministic, so every retry writes to the same object. The prefix always
    // starts with the company id, which is what the storage policy (sql/072)
    // authorises a caller to write beneath.
    storagePath: `${input.storagePrefix ?? `${input.companyId}/${input.serviceJobId}`}/${operationId}.${extensionFor(contentType)}`,
    contentType,
    byteSize: input.blob.size,
    uploadRoute:
      input.uploadRoute ?? `/api/road-recovery/jobs/${input.serviceJobId}/evidence`,
    state: "saved_on_device",
    attempts: 0,
    lastError: null,
  };

  if (!browser()) return record;
  await putBlob({ operationId, blob: input.blob, record });
  return record;
}

/**
 * Uploads one capture's bytes, then queues the row through the outbox.
 *
 * `uploadBlob` is injected so this is testable without a storage client, and so
 * the caller decides which Supabase client does the upload.
 */
export async function uploadEvidence(
  operationId: string,
  uploadBlob: (path: string, blob: Blob, contentType: string) => Promise<{ ok: true } | { ok: false; error: string; alreadyExists?: boolean }>
): Promise<RrEvidenceRecord | null> {
  const entry = await getBlob(operationId);
  if (!entry) return null;
  const { record, blob } = entry;
  if (record.state === "linked" || record.state === "uploaded") return record;

  await patch(operationId, { state: "uploading", attempts: record.attempts + 1 });

  const uploaded = await uploadBlob(record.storagePath, blob, record.contentType);

  // "Already exists" is this device's own earlier attempt at a path containing an
  // unguessable uuid. Treat it as done rather than failing a completed upload.
  if (!uploaded.ok && !uploaded.alreadyExists) {
    await patch(operationId, { state: "failed", lastError: uploaded.error });
    return (await getBlob(operationId))?.record ?? null;
  }

  await patch(operationId, { state: "uploaded", lastError: null });

  /**
   * Only now is the row queued — and it carries the SAME operationId as the
   * upload, so the receipt covers the pair. "Uploaded and verified" is reported
   * when this succeeds, never before.
   */
  await enqueue({
    // The id the bytes were stored under, so ONE receipt covers upload + row.
    operationId: record.operationId,
    operationType: "capture_evidence",
    route: record.uploadRoute,
    label: "Evidence",
    serviceJobId: record.serviceJobId,
    // A photograph means the same thing whenever it is filed; its capture time
    // travels in the metadata below rather than being inferred from arrival.
    offlineSafe: true,
    payload: {
      companyId: record.companyId,
      storagePath: record.storagePath,
      evidenceType: record.evidenceType,
      requirementCodes: record.requirementCodes,
      latitude: record.latitude,
      longitude: record.longitude,
      accuracy: record.accuracy,
      capturedByRole: "driver",
      metadata: { ...record.metadata, capturedAt: new Date(record.capturedAt).toISOString() },
    },
  });

  return (await getBlob(operationId))?.record ?? null;
}

/** Called when the outbox reports the row was accepted. */
export async function markLinked(operationId: string): Promise<void> {
  await dropBlobKeepRecord(operationId);
}

/**
 * Retries every capture whose bytes are still only on the device.
 *
 * This is what turns "saved on device" into "uploaded and verified" once signal
 * returns. It is safe to call repeatedly and at any time: `uploadEvidence`
 * returns early for anything already uploaded or linked, and a retry of a
 * completed upload lands on the same deterministic path and is treated as done.
 */
export async function drainEvidence(
  uploadBlob: (path: string, blob: Blob, contentType: string) => Promise<{ ok: true } | { ok: false; error: string; alreadyExists?: boolean }>
): Promise<void> {
  if (!browser()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const pending = (await allEvidence()).filter(
    (record) => record.state === "saved_on_device" || record.state === "uploading" || record.state === "failed"
  );
  for (const record of pending) {
    await uploadEvidence(record.operationId, uploadBlob);
  }
}

/** Driver-facing wording. Never claims verification that has not happened. */
export function evidenceStatusText(record: RrEvidenceRecord, online: boolean): { title: string; detail: string } {
  switch (record.state) {
    case "captured":
    case "saved_on_device":
      return online
        ? { title: "Saved on device", detail: "Uploading now." }
        : { title: "Saved on device", detail: "Waiting for connection. Your evidence will upload automatically." };
    case "uploading":
      return { title: "Uploading…", detail: "Saved on device." };
    case "uploaded":
      return { title: "Uploading…", detail: "Attaching to the job." };
    case "linked":
      return { title: "Uploaded and verified", detail: "Attached to this job." };
    case "failed":
      return { title: "This evidence needs attention", detail: "Still saved on device. Try again when you have signal." };
  }
}
