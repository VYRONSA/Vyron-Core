import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicSupabaseEnv } from "./public-env";

let browserClient: SupabaseClient | undefined;

/**
 * Browser Supabase client (lazy; no placeholder URL at build time).
 *
 * Uses @supabase/ssr's createBrowserClient so the session is stored in the SAME
 * cookies the server reads (`sb-<ref>-auth-token`), not in localStorage. That is what
 * makes one session store possible: signing in on the client is immediately visible to
 * middleware, Server Components, Route Handlers and Server Actions, with no
 * synchronisation step and no second copy of the token.
 *
 * Previously this used createClient() with persistSession, which kept the session in
 * localStorage where the server could not see it — hence the old hand-maintained
 * `vyron_access_token` cookie. That cookie, and the code that wrote it, are gone.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const { url, anonKey } = readPublicSupabaseEnv();
  if (!url || !anonKey) {
    console.warn(
      "⚠️ Supabase environment variables are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy."
    );
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them in Vercel → Project Settings → Environment Variables (Production) and redeploy."
    );
  }

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}

/** @deprecated Prefer getSupabaseBrowserClient(); kept for existing imports. */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseBrowserClient();
    const value = Reflect.get(client as object, prop, client);
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
