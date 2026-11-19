import { NextResponse } from "next/server";
import { readPublicSupabaseEnv, validatePublicSupabaseEnv } from "@/lib/public-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 4000;

/**
 * Phase 1D Task 2 — production health check. Reports env-config validity plus a live,
 * unauthenticated reachability probe of Supabase's REST (database) and Storage APIs, so
 * "the URL looks right" and "the service actually responds" are distinguished. It does not
 * disclose which server-side secrets are configured, and never includes key values.
 */

type Reachability = { reachable: boolean; status: number | null; error: string | null };

async function probe(url: string, headers: Record<string, string>): Promise<Reachability> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, cache: "no-store" });
    // Any HTTP response (even 401/404) means the service is up and routing requests —
    // only a network-level failure (timeout, DNS, connection refused) means "unreachable".
    return { reachable: true, status: response.status, error: null };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: error instanceof Error ? error.message : "Request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const { url, anonKey } = readPublicSupabaseEnv();
  const supabaseProblems = validatePublicSupabaseEnv();
  const host = url
    ? (() => {
        try {
          return new URL(url).host;
        } catch {
          return "invalid-url";
        }
      })()
    : null;

  let database: Reachability = { reachable: false, status: null, error: "Supabase env not configured." };
  let storage: Reachability = { reachable: false, status: null, error: "Supabase env not configured." };

  if (url && anonKey && supabaseProblems.length === 0) {
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
    [database, storage] = await Promise.all([
      probe(`${url}/rest/v1/`, headers),
      probe(`${url}/storage/v1/bucket`, headers),
    ]);
  }

  const ok = supabaseProblems.length === 0 && database.reachable && storage.reachable;

  return NextResponse.json({
    ok,
    product: "VYRON CORE",
    timestamp: new Date().toISOString(),
    database,
    storage,
    env: {
      hasSupabaseUrl: Boolean(url),
      supabaseHost: host,
      supabaseConfigOk: supabaseProblems.length === 0,
      supabaseProblems,
      hasAnonKey: Boolean(anonKey),
      // Which server-side secrets are configured is deliberately not disclosed on this
      // public route (it only aids reconnaissance). Check them in the Vercel dashboard.
    },
    // Build identity, so the live version can be matched to source control.
    version: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_COMMIT || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    },
  });
}
