import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicSupabaseEnv } from "./public-env";

let browserClient: SupabaseClient | undefined;

/** Browser-safe Supabase client (lazy; no placeholder URL at build time). */
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

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
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
