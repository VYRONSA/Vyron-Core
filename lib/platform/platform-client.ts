import { supabase } from "@/lib/supabase";

export type PlatformApiResult<T> =
  | { ok: true; data: T }
  /** `code` is the machine-readable failure reason from the API. "elevation_required"
   * means Platform Mode has expired or was never entered — callers should send the
   * operator back through the supervisor verification screen rather than showing a
   * generic error. */
  | { ok: false; message: string; code?: string; status?: number };

/** Bearer-authenticated fetch against app/api/platform/* — mirrors the pattern used by
 * other client dashboards (see components/PayrollHardeningCentre.tsx). */
export async function platformFetch<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<PlatformApiResult<T>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, message: "Sign in required." };

  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        message: payload?.message || `Request failed (${response.status}).`,
        code: typeof payload?.code === "string" ? payload.code : undefined,
        status: response.status,
      };
    }

    return { ok: true, data: payload as T };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown network error.";
    return { ok: false, message };
  }
}
