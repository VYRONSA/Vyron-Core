/**
 * Offline queue for mobile workforce actions — localStorage + auto-sync when online.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordFieldJobEvent, type FieldEventType } from "@/lib/field-operations";
import { flushOfflineEvidence, type MobileEvidenceType } from "@/lib/mobile-workforce-platform";

export const MOBILE_OFFLINE_QUEUE_KEY = "vyron_mobile_offline_queue";
export const MOBILE_LAST_SYNC_KEY = "vyron_mobile_last_sync";

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
    id: `off_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
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
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of queue) {
    try {
      const ok = await processOfflineItem(supabase, item);
      if (ok) {
        synced += 1;
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

  writeQueue(remaining.filter((item) => item.attempts < 5));
  if (synced > 0) {
    writeLastSyncTime(new Date().toISOString());
  }

  return { synced, failed, errors };
}

async function processOfflineItem(
  supabase: SupabaseClient,
  item: OfflineQueueItem
): Promise<boolean> {
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
    const { error } = await supabase.from("clock_events").insert({
      company_id: item.companyId,
      employee_id: item.employeeId,
      store_id: payload.storeId || null,
      event_type: item.type === "clock_in" ? "clock_in" : "clock_out",
      event_time: payload.eventTime || new Date().toISOString(),
      source: "mobile_offline",
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      gps_accuracy: payload.gpsAccuracy ?? null,
      photo_url: payload.photoUrl ?? null,
      clock_note: payload.notes ?? null,
    });
    return !error;
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
