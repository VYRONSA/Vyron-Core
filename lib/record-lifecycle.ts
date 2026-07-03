/**
 * Soft lifecycle for tenant records — Active / Archived / Deleted (no hard delete).
 */

export const RECORD_LIFECYCLE_STATUSES = ["active", "archived", "deleted"] as const;

export type RecordLifecycleStatus = (typeof RECORD_LIFECYCLE_STATUSES)[number];

export function isDeletedRecordStatus(status: string | null | undefined): boolean {
  return (status || "").toLowerCase() === "deleted";
}

export function isArchivedRecordStatus(status: string | null | undefined): boolean {
  return (status || "").toLowerCase() === "archived";
}

export function lifecycleStatusLabel(status: string | null | undefined): string {
  const normalized = (status || "active").toLowerCase();
  if (normalized === "deleted") return "Deleted";
  if (normalized === "archived") return "Archived";
  return "Active";
}

/** PostgREST filter helper — exclude soft-deleted rows when column exists. */
export function notDeletedLifecycleFilter(column = "record_status"): string {
  return `${column}.neq.deleted`;
}
