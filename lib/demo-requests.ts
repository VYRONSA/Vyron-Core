/**
 * Master operator demo request inbox — localStorage cache + Supabase persistence.
 */

import { isSupabaseMissingTableError, withPostgrestSchemaRetry } from "@/lib/company-access";
import { getDeveloperWorkspaceId } from "@/lib/developer-workspace";
import { isVyronDemoPeriodExpired } from "@/lib/vyron-demo-tier";
import { readPublicSupabaseEnv } from "@/lib/public-env";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const VYRON_DEMO_REQUESTS_STORAGE_KEY = "vyron-master-demo-requests";
export const VYRON_DEMO_REQUESTS_INITIALIZED_KEY = "vyron-master-demo-requests-initialized";
export const VYRON_DEMO_REQUESTS_DELETED_IDS_KEY = "vyron-master-demo-requests-deleted-ids";
export const VYRON_MASTER_INBOX_CHANGED_EVENT = "vyron-master-inbox-changed";

export type DemoRequestRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  status: "New" | "Contacted";
  /** ISO timestamp — used for 30-day cleanup (same window as tenant demo expiry). */
  submittedAt: string;
};

export const DEMO_REQUESTS_SEED: DemoRequestRow[] = [
  {
    id: "demo-req-1",
    name: "Thabo Mokoena",
    email: "thabo@retailco.za",
    phone: "+27 82 555 1201",
    company: "RetailCo SA",
    status: "New",
    submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-req-2",
    name: "Lerato Naidoo",
    email: "lerato@freshfoods.co.za",
    phone: "+27 83 441 8890",
    company: "FreshFoods Group",
    status: "Contacted",
    submittedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-req-3",
    name: "James van Wyk",
    email: "james@logistix.io",
    phone: "+27 71 902 3344",
    company: "Logistix Workforce",
    status: "New",
    submittedAt: new Date(Date.now() - 38 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export function normalizeDemoRequestRow(row: DemoRequestRow): DemoRequestRow {
  const fallbackSubmittedAt =
    row.status === "Contacted"
      ? new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();
  return {
    ...row,
    submittedAt: row.submittedAt || fallbackSubmittedAt,
  };
}

/** Master cleanup: contacted follow-ups or inbound leads older than the 30-day demo window. */
export function isDeletableDemoRequest(row: DemoRequestRow): boolean {
  if (row.status === "Contacted") return true;
  return isVyronDemoPeriodExpired(row.submittedAt);
}

export function formatDemoRequestSubmittedAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function notifyMasterInboxChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VYRON_MASTER_INBOX_CHANGED_EVENT));
}

export function writeDemoRequestsToStorage(rows: DemoRequestRow[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VYRON_DEMO_REQUESTS_STORAGE_KEY, JSON.stringify(rows));
  window.localStorage.setItem(VYRON_DEMO_REQUESTS_INITIALIZED_KEY, "1");
  notifyMasterInboxChanged();
}

export function readDemoRequestsFromStorage(): DemoRequestRow[] {
  if (typeof window === "undefined") {
    return DEMO_REQUESTS_SEED.map(normalizeDemoRequestRow);
  }

  try {
    const raw = window.localStorage.getItem(VYRON_DEMO_REQUESTS_STORAGE_KEY);
    const initialized =
      window.localStorage.getItem(VYRON_DEMO_REQUESTS_INITIALIZED_KEY) === "1";

    if (!raw) {
      if (!initialized && readDeletedDemoRequestIds().size === 0) {
        const seed = DEMO_REQUESTS_SEED.map(normalizeDemoRequestRow);
        writeDemoRequestsToStorage(seed);
        return seed;
      }
      return [];
    }

    const parsed = JSON.parse(raw) as DemoRequestRow[];
    if (!Array.isArray(parsed)) {
      if (initialized || readDeletedDemoRequestIds().size > 0) {
        return [];
      }
      return DEMO_REQUESTS_SEED.map(normalizeDemoRequestRow);
    }

    return filterDeletedDemoRequests(parsed.map(normalizeDemoRequestRow));
  } catch {
    const initialized =
      window.localStorage.getItem(VYRON_DEMO_REQUESTS_INITIALIZED_KEY) === "1";
    return initialized ? [] : DEMO_REQUESTS_SEED.map(normalizeDemoRequestRow);
  }
}

export function countNewDemoRequests(): number {
  return readDemoRequestsFromStorage().filter((row) => row.status === "New").length;
}

function readDeletedDemoRequestIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VYRON_DEMO_REQUESTS_DELETED_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function addDeletedDemoRequestIds(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  const next = readDeletedDemoRequestIds();
  for (const id of ids) {
    next.add(id);
  }
  window.localStorage.setItem(VYRON_DEMO_REQUESTS_DELETED_IDS_KEY, JSON.stringify([...next]));
}

function filterDeletedDemoRequests(rows: DemoRequestRow[]): DemoRequestRow[] {
  const deleted = readDeletedDemoRequestIds();
  if (deleted.size === 0) return rows;
  return rows.filter((row) => !deleted.has(row.id));
}

function getDemoRequestsSupabaseClient() {
  if (typeof window === "undefined") return null;
  const { url, anonKey } = readPublicSupabaseEnv();
  if (!url || !anonKey) return null;
  try {
    return getSupabaseBrowserClient();
  } catch {
    return null;
  }
}

function demoRequestToRow(row: DemoRequestRow, developerWorkspaceId: string) {
  return {
    id: row.id,
    developer_workspace_id: developerWorkspaceId,
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    company: row.company,
    status: row.status,
    submitted_at: row.submittedAt,
    updated_at: new Date().toISOString(),
  };
}

function rowToDemoRequest(row: Record<string, unknown>): DemoRequestRow {
  return normalizeDemoRequestRow({
    id: String(row.id),
    name: String(row.name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    company: String(row.company || ""),
    status: row.status === "Contacted" ? "Contacted" : "New",
    submittedAt: row.submitted_at
      ? String(row.submitted_at)
      : row.submittedAt
        ? String(row.submittedAt)
        : new Date().toISOString(),
  });
}

export type DemoRequestsSupabaseResult = {
  rows: DemoRequestRow[] | null;
  tablesAvailable: boolean;
  error: string | null;
};

export async function fetchDemoRequestsFromSupabase(): Promise<DemoRequestsSupabaseResult> {
  const supabase = getDemoRequestsSupabaseClient();
  if (!supabase) {
    return { rows: null, tablesAvailable: false, error: null };
  }

  const developerWorkspaceId = await getDeveloperWorkspaceId();
  if (!developerWorkspaceId) {
    return { rows: null, tablesAvailable: false, error: null };
  }

  try {
    const { data, error } = await supabase
      .from("vyron_demo_requests")
      .select("*")
      .eq("developer_workspace_id", developerWorkspaceId)
      .order("submitted_at", { ascending: false });

    if (error) {
      if (isSupabaseMissingTableError(error, "vyron_demo_requests")) {
        return { rows: null, tablesAvailable: false, error: null };
      }
      return { rows: null, tablesAvailable: true, error: error.message };
    }

    const rows = filterDeletedDemoRequests(
      (data || []).map((row) => rowToDemoRequest(row as Record<string, unknown>))
    );
    return { rows, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      rows: null,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Fetch demo requests failed",
    };
  }
}

export async function upsertDemoRequestsToSupabase(
  rows: DemoRequestRow[]
): Promise<{ ok: boolean; tablesAvailable: boolean; error: string | null }> {
  const supabase = getDemoRequestsSupabaseClient();
  if (!supabase || rows.length === 0) {
    return { ok: false, tablesAvailable: false, error: null };
  }

  const developerWorkspaceId = await getDeveloperWorkspaceId();
  if (!developerWorkspaceId) {
    return { ok: false, tablesAvailable: false, error: null };
  }

  try {
    const payload = rows.map((row) => demoRequestToRow(row, developerWorkspaceId));
    const { error } = await withPostgrestSchemaRetry(async () =>
      supabase.from("vyron_demo_requests").upsert(payload, { onConflict: "id" })
    );

    if (error) {
      if (isSupabaseMissingTableError(error, "vyron_demo_requests")) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }

    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Upsert demo requests failed",
    };
  }
}

export async function deleteDemoRequestsFromSupabase(
  ids: string[]
): Promise<{ ok: boolean; tablesAvailable: boolean; error: string | null }> {
  const supabase = getDemoRequestsSupabaseClient();
  if (!supabase || ids.length === 0) {
    return { ok: true, tablesAvailable: false, error: null };
  }

  const developerWorkspaceId = await getDeveloperWorkspaceId();
  if (!developerWorkspaceId) {
    return { ok: false, tablesAvailable: false, error: null };
  }

  try {
    const { error } = await withPostgrestSchemaRetry(async () =>
      supabase
        .from("vyron_demo_requests")
        .delete()
        .eq("developer_workspace_id", developerWorkspaceId)
        .in("id", ids)
    );

    if (error) {
      if (isSupabaseMissingTableError(error, "vyron_demo_requests")) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }

    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Delete demo requests failed",
    };
  }
}

/**
 * Loads demo requests — Supabase when available, otherwise local cache.
 * Seeds local-only rows to Supabase on first connection; tombstones block deleted rows.
 */
export async function loadDemoRequestsWithSupabase(): Promise<DemoRequestRow[]> {
  const tombstones = readDeletedDemoRequestIds();
  const local = filterDeletedDemoRequests(readDemoRequestsFromStorage());
  const remoteResult = await fetchDemoRequestsFromSupabase();

  if (remoteResult.tablesAvailable && tombstones.size > 0) {
    await deleteDemoRequestsFromSupabase([...tombstones]);
  }

  if (!remoteResult.tablesAvailable || remoteResult.rows === null) {
    writeDemoRequestsToStorage(local);
    return local;
  }

  const merged =
    remoteResult.rows.length > 0
      ? filterDeletedDemoRequests(remoteResult.rows)
      : local;

  if (remoteResult.rows.length === 0 && local.length > 0) {
    await upsertDemoRequestsToSupabase(local);
  }

  writeDemoRequestsToStorage(merged);
  return merged;
}

export async function persistDemoRequestDeletes(ids: string[]): Promise<{
  nextRows: DemoRequestRow[];
  supabaseOk: boolean;
}> {
  if (ids.length === 0) {
    return { nextRows: readDemoRequestsFromStorage(), supabaseOk: true };
  }

  addDeletedDemoRequestIds(ids);

  const idSet = new Set(ids);
  const current = filterDeletedDemoRequests(readDemoRequestsFromStorage());
  const nextRows = current.filter((row) => !idSet.has(row.id));

  writeDemoRequestsToStorage(nextRows);

  const deleteResult = await deleteDemoRequestsFromSupabase(ids);
  return { nextRows, supabaseOk: deleteResult.ok || !deleteResult.tablesAvailable };
}

export async function persistDemoRequestStatus(
  id: string,
  status: DemoRequestRow["status"]
): Promise<DemoRequestRow[]> {
  const current = readDemoRequestsFromStorage();
  const nextRows = current.map((row) => (row.id === id ? { ...row, status } : row));
  writeDemoRequestsToStorage(nextRows);

  const updated = nextRows.find((row) => row.id === id);
  if (updated) {
    await upsertDemoRequestsToSupabase([updated]);
  }

  return nextRows;
}
