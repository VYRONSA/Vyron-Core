/**
 * VYRON platform workspace — singleton registry row (real UUID, no string placeholders).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError, withPostgrestSchemaRetry } from "@/lib/company-access";
import { readPublicSupabaseEnv } from "@/lib/public-env";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY = "vyron_dev_developer_workspace_id";
/** Stable lookup key in vyron_developer_workspaces.workspace_key */
export const VYRON_PLATFORM_WORKSPACE_KEY = "vyron-platform";
/** @deprecated Use VYRON_PLATFORM_WORKSPACE_KEY */
export const VYRON_DEV_MASTER_WORKSPACE_KEY = VYRON_PLATFORM_WORKSPACE_KEY;

/** Legacy string placeholders that must never be sent to UUID columns. */
export const VYRON_LEGACY_FAKE_WORKSPACE_IDS = [
  "master-workspace",
  "master_workspace",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryCache: string | null = null;
let ensureInFlight: Promise<string | null> | null = null;

export function isVyronDevUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_RE.test(value.trim());
}

export function isLegacyFakeWorkspaceId(id: string | null | undefined): boolean {
  const normalized = (id || "").trim().toLowerCase();
  if (!normalized) return true;
  if (
    VYRON_LEGACY_FAKE_WORKSPACE_IDS.includes(
      normalized as (typeof VYRON_LEGACY_FAKE_WORKSPACE_IDS)[number]
    )
  ) {
    return true;
  }
  if (normalized.startsWith("ws-") && !isVyronDevUuid(normalized)) return true;
  return false;
}

function purgeInvalidDeveloperWorkspaceCache(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY);
    if (stored && !isVyronDevUuid(stored)) {
      window.localStorage.removeItem(VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY);
      memoryCache = null;
    }
  } catch {
    /* ignore */
  }
}

export function readCachedDeveloperWorkspaceId(): string | null {
  purgeInvalidDeveloperWorkspaceCache();
  if (memoryCache && isVyronDevUuid(memoryCache)) return memoryCache;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY);
    if (stored && isVyronDevUuid(stored)) {
      memoryCache = stored;
      return stored;
    }
    if (stored) {
      window.localStorage.removeItem(VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function cacheDeveloperWorkspaceId(id: string): void {
  if (!isVyronDevUuid(id)) return;
  memoryCache = id;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VYRON_DEV_DEVELOPER_WORKSPACE_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
}

function resolveSupabaseClient(client?: SupabaseClient | null): SupabaseClient | null {
  if (client) return client;
  if (typeof window === "undefined") return null;
  const { url, anonKey } = readPublicSupabaseEnv();
  if (!url || !anonKey) return null;
  try {
    return getSupabaseBrowserClient();
  } catch {
    return null;
  }
}

const LEGACY_PLATFORM_WORKSPACE_KEY = "vyron-dev-master";

/**
 * Returns the VYRON platform workspace UUID. Creates the row and caches locally when missing.
 */
export async function getPlatformWorkspaceId(
  supabaseClient?: SupabaseClient | null
): Promise<string | null> {
  purgeInvalidDeveloperWorkspaceCache();
  const cached = readCachedDeveloperWorkspaceId();
  if (cached) return cached;

  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    try {
      const supabase = resolveSupabaseClient(supabaseClient);
      if (!supabase) return null;

      for (const workspaceKey of [VYRON_PLATFORM_WORKSPACE_KEY, LEGACY_PLATFORM_WORKSPACE_KEY]) {
        const { data: existing, error: selectError } = await withPostgrestSchemaRetry(async () =>
          supabase
            .from("vyron_developer_workspaces")
            .select("id")
            .eq("workspace_key", workspaceKey)
            .maybeSingle()
        );

        if (selectError) {
          if (!isSupabaseMissingTableError(selectError, "vyron_developer_workspaces")) {
            console.warn("getPlatformWorkspaceId:", selectError.message);
          }
          return null;
        }

        if (existing?.id && isVyronDevUuid(String(existing.id))) {
          const id = String(existing.id);
          cacheDeveloperWorkspaceId(id);
          return id;
        }
      }

      const { data: created, error: insertError } = await withPostgrestSchemaRetry(async () =>
        supabase
          .from("vyron_developer_workspaces")
          .insert({
            workspace_key: VYRON_PLATFORM_WORKSPACE_KEY,
            workspace_name: "VYRON Platform Workspace",
          })
          .select("id")
          .single()
      );

      if (insertError || !created?.id) {
        if (
          insertError &&
          !isSupabaseMissingTableError(insertError, "vyron_developer_workspaces")
        ) {
          console.warn("getPlatformWorkspaceId create:", insertError.message);
        }
        return null;
      }

      const id = String(created.id);
      cacheDeveloperWorkspaceId(id);
      return id;
    } finally {
      ensureInFlight = null;
    }
  })();

  return ensureInFlight;
}

/** @deprecated Use getPlatformWorkspaceId */
export async function getDeveloperWorkspaceId(
  supabaseClient?: SupabaseClient | null
): Promise<string | null> {
  return getPlatformWorkspaceId(supabaseClient);
}

export function isProtectedDeveloperWorkspaceId(id: string | null | undefined): boolean {
  const normalized = (id || "").trim();
  if (!normalized) return false;
  const cached = readCachedDeveloperWorkspaceId();
  return Boolean(cached && cached === normalized);
}
