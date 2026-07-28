/**
 * Server-side Supabase clients (@supabase/ssr).
 *
 * There is exactly ONE session store in the application: the Supabase auth cookies
 * (`sb-<ref>-auth-token`, chunked when large). Server Components, Route Handlers,
 * Server Actions and middleware all read and write that same store, so no layer can
 * hold a different opinion about who is signed in.
 *
 * This replaces the previous `vyron_access_token` cookie, which was a second copy of
 * the access token written by client JavaScript and kept in step by hand.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicSupabaseEnv } from "./public-env";

export function getSupabaseSsrEnv(): { url: string; anonKey: string } {
  const { url, anonKey } = readPublicSupabaseEnv();
  return { url: url || "", anonKey: anonKey || "" };
}

/**
 * Supabase client bound to the request's cookies.
 *
 * Safe in both Server Components and Route Handlers. In a Server Component the cookie
 * store is read-only, so a token refresh cannot be persisted from there — that write
 * is swallowed, because middleware already refreshed the session for this request
 * (see lib/supabase-middleware.ts). Route Handlers and Server Actions can write, so
 * refreshes there persist normally.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = getSupabaseSsrEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Read-only cookie store (Server Component render). Middleware owns the
          // refresh, so dropping the write here is correct rather than an error.
        }
      },
    },
  });
}

/**
 * The signed-in user, verified against Supabase.
 *
 * Always prefer this over reading a session locally: getUser() revalidates the token
 * with the auth server, whereas a decoded cookie is only as trustworthy as its
 * signature. This is the single source of truth for "who is this?" on the server.
 */
export async function getServerUser(): Promise<{
  supabase: SupabaseClient;
  user: { id: string; email: string | null; app_metadata?: Record<string, unknown> } | null;
}> {
  const supabase = await createSupabaseServerClient();
  const { url, anonKey } = getSupabaseSsrEnv();
  if (!url || !anonKey) return { supabase, user: null };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };

  return {
    supabase,
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      app_metadata: data.user.app_metadata as Record<string, unknown> | undefined,
    },
  };
}
