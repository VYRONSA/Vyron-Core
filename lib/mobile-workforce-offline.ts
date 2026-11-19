/**
 * Offline queue for mobile workforce actions — localStorage + auto-sync when online.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordFieldJobEvent, type FieldEventType } from "@/lib/field-operations";
import { flushOfflineEvidence, type MobileEvidenceType } from "@/lib/mobile-workforce-platform";
import { newClockAttemptId, recordClockEvent } from "@/lib/clocking-client";

export const MOBILE_OFFLINE_QUEUE_KEY = "vyron_mobile_offline_queue";
export const MOBILE_LAST_SYNC_KEY = "vyron_mobile_last_sync";
/** Items the server refused for good (e.g. out of order, too old). Kept for a manager —
 * never silently discarded. */
export const MOBILE_OFFLINE_REJECTED_KEY = "vyron_mobile_offline_rejected";

export type RejectedOfflineItem = OfflineQueueItem & { rejectedAt: string; reason: string };

export type OfflineActionType =
  | "clock_in"
  | "clock_out"
  | "field_event"
  | "photo_evidence"
  | "incident_report";

export type OfflineQueueItem = {
  id: string;
  type: OfflineActionType;
  companyId: string;
  employeeId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
};

export type OfflineQueueStatus = {
  pending: number;
  lastSync: string | null;
  online: boolean;
};

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function readQueue(): OfflineQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineQueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineQueueItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

export function readRejectedOfflineItems(): RejectedOfflineItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MOBILE_OFFLINE_REJECTED_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as RejectedOfflineItem[]) : [];
  } catch {
    return [];
  }
}

function appendRejected(items: RejectedOfflineItem[]): void {
  if (typeof window === "undefined" || !items.length) return;
  window.localStorage.setItem(
    MOBILE_OFFLINE_REJECTED_KEY,
    JSON.stringify([...readRejectedOfflineItems(), ...items])
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(MOBILE_LAST_SYNC_KEY);
}

function writeLastSyncTime(iso: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_LAST_SYNC_KEY, iso);
}

export function getOfflineQueueStatus(): OfflineQueueStatus {
  const queue = readQueue();
  return {
    pending: queue.length,
    lastSync: readLastSyncTime(),
    online: isBrowserOnline(),
  };
}

export function enqueueOfflineAction(
  item: Omit<OfflineQueueItem, "id" | "createdAt" | "attempts">
): OfflineQueueItem {
  const queue = readQueue();
  const entry: OfflineQueueItem = {
    ...item,
    // A UUID: for clockings it is also the server-side attempt id, so a retried sync can
    // never record the same clocking twice.
    id: newClockAttemptId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  queue.push(entry);
  writeQueue(queue);
  return entry;
}

export async function flushOfflineQueue(
  supabase: SupabaseClient
): Promise<{ synced: number; failed: number; errors: string[] }> {
  if (!isBrowserOnline()) {
    return { synced: 0, failed: 0, errors: ["Device offline."] };
  }

  const queue = readQueue();
  if (!queue.length) {
    return { synced: 0, failed: 0, errors: [] };
  }

  const remaining: OfflineQueueItem[] = [];
  const rejected: RejectedOfflineItem[] = [];
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of queue) {
    try {
      const outcome = await processOfflineItem(supabase, item);
      if (outcome === true) {
        synced += 1;
      } else if (outcome && typeof outcome === "object") {
        failed += 1;
        errors.push(outcome.rejected);
        rejected.push({ ...item, rejectedAt: new Date().toISOString(), reason: outcome.rejected });
      } else {
        failed += 1;
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : "Sync failed");
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }

  appendRejected(rejected);
  // Clockings are never dropped: they stay queued until they sync or are rejected by the
  // server (then kept in the rejected list). Other item types keep the old 5-attempt limit.
  const exhausted = remaining.filter(
    (item) => item.type !== "clock_in" && item.type !== "clock_out" && item.attempts >= 5
  );
  appendRejected(
    exhausted.map((item) => ({ ...item, rejectedAt: new Date().toISOString(), reason: "Gave up after 5 attempts" }))
  );
  writeQueue(remaining.filter((item) => !exhausted.includes(item)));
  if (synced > 0) {
    writeLastSyncTime(new Date().toISOString());
  }

  return { synced, failed, errors };
}

/** true = synced; false = retry later; { rejected } = refused for good. */
async function processOfflineItem(
  supabase: SupabaseClient,
  item: OfflineQueueItem
): Promise<boolean | { rejected: string }> {
  const payload = item.payload;

  if (item.type === "field_event") {
    const result = await recordFieldJobEvent(supabase, {
      companyId: item.companyId,
      employeeId: item.employeeId,
      eventType: payload.eventType as FieldEventType,
      jobId: (payload.jobId as string) || null,
      gps: {
        latitude: (payload.latitude as number) ?? null,
        longitude: (payload.longitude as number) ?? null,
        accuracy: (payload.accuracy as number) ?? null,
      },
      photoUrl: (payload.photoUrl as string) || null,
      notes: (payload.notes as string) || null,
      deviceInfo: (payload.deviceInfo as string) || null,
    });
    return !result.error;
  }

  if (item.type === "photo_evidence") {
    const result = await flushOfflineEvidence(supabase, {
      companyId: item.companyId,
      employeeId: item.employeeId,
      evidenceType: payload.evidenceType as MobileEvidenceType,
      jobId: (payload.jobId as string) || null,
      photoUrl: (payload.photoUrl as string) || null,
      latitude: (payload.latitude as number) ?? null,
      longitude: (payload.longitude as number) ?? null,
      gpsAccuracy: (payload.gpsAccuracy as number) ?? null,
      notes: (payload.notes as string) || null,
    });
    return result.ok;
  }

  if (item.type === "clock_in" || item.type === "clock_out") {
    // Items queued before attempt ids existed get one once, persisted with the item.
    const attemptId = UUID_PATTERN.test(item.id)
      ? item.id
      : String(payload.clientEventId || (payload.clientEventId = newClockAttemptId()));
    const latitude = payload.latitude as number | null | undefined;
    const longitude = payload.longitude as number | null | undefined;
    const result = await recordClockEvent(supabase, {
      employeeId: item.employeeId,
      attemptId,
      action: item.type,
      source: "offline",
      storeId: (payload.storeId as string) || null,
      position:
        typeof latitude === "number" && typeof longitude === "number"
          ? { latitude, longitude, accuracy: Number(payload.gpsAccuracy ?? 0) }
          : null,
      clientTime: (payload.eventTime as string) || item.createdAt,
      note: (payload.notes as string) || null,
    });
    if (result.ok) return true;
    if (result.code === "network") return false;
    return { rejected: result.message };
  }

  if (item.type === "incident_report") {
    const { error } = await supabase.from("mobile_workforce_incidents").insert({
      company_id: item.companyId,
      employee_id: item.employeeId,
      title: payload.title,
      description: payload.description,
      photo_url: payload.photoUrl ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      manager_notified: true,
    });
    return !error;
  }

  return false;
}
