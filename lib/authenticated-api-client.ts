import { supabase } from "@/lib/supabase";

/** Bearer token for authenticated API routes (RLS-scoped). */
export async function getAuthBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token?.trim() || null;
}

/** fetch() with Authorization header when a session exists. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getAuthBearerToken();
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
