/**
 * Middleware-side Supabase session handling (@supabase/ssr).
 *
 * Middleware is the only place that runs on every request before rendering, which
 * makes it the right owner of token rotation: it calls getUser(), and if Supabase
 * issues a refreshed token the updated auth cookies are written onto the response.
 * Server Components can then read a fresh session without being able to write one.
 *
 * This is what replaced the old client-side refresh sync. No JavaScript in the browser
 * has to notice a rotation or copy a token anywhere.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicSupabaseEnv } from "./public-env";

export type MiddlewareSession = {
  supabase: SupabaseClient;
  user: { id: string; email: string | null; app_metadata?: Record<string, unknown> } | null;
  /** Carries any refreshed auth cookies — must be returned, or copied onto a redirect. */
  response: NextResponse;
  configured: boolean;
};

export async function createMiddlewareSupabase(request: NextRequest): Promise<MiddlewareSession> {
  const { url, anonKey } = readPublicSupabaseEnv();

  let response = NextResponse.next({ request });

  if (!url || !anonKey) {
    return { supabase: null as unknown as SupabaseClient, user: null, response, configured: false };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Update the request too, so anything reading cookies later in this same
        // request sees the refreshed token rather than the one it arrived with.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  const user =
    error || !data.user
      ? null
      : {
          id: data.user.id,
          email: data.user.email ?? null,
          app_metadata: data.user.app_metadata as Record<string, unknown> | undefined,
        };

  return { supabase, user, response, configured: true };
}

/**
 * Copies auth cookies from the session response onto another response (a redirect).
 *
 * Without this a request that both refreshes the token and redirects would discard the
 * refreshed cookies, and the very next request would present the stale token — an
 * infinite redirect loop in the worst case.
 */
export function withSessionCookies(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}
