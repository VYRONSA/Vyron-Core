"use client";

/**
 * The signed-in user's EFFECTIVE module entitlement, for client-side navigation gating.
 *
 * This introduces no second entitlement rule and reads no entitlement column itself.
 * `public.companies` has RLS enabled with no policy for `authenticated`, so a browser
 * read of `enabled_modules` silently returns nothing — the answer has to come from the
 * server. GET /api/tenant/modules verifies the caller's membership and then resolves
 * the entitlement with `effectiveUserModules()`, the same resolver the user management
 * layer uses, so a subscription downgrade narrows the navigation on the next load with
 * no migration and no second place to keep in step.
 *
 * This is a DISPLAY gate only, exactly like isPlatformOperatorSessionUser(). The
 * authoritative checks stay server-side in middleware.ts (route access) and
 * requireApiContext() (every Road & Recovery request), so hiding a link never becomes
 * the thing that keeps a user out.
 */

import { useEffect, useState } from "react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

export type TenantModulesState = {
  modules: string[];
  loading: boolean;
};

export function useTenantModules(): TenantModulesState {
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // The company comes from the SAME resolver every other screen uses. The server
        // then re-verifies it before answering, so a tampered value gains nothing.
        const { access } = await getCompanyAccess(supabase);
        if (cancelled) return;
        if (!access?.company_id) {
          setModules([]);
          setLoading(false);
          return;
        }

        const response = await fetch(
          `/api/tenant/modules?companyId=${encodeURIComponent(access.company_id)}`,
          { credentials: "include" }
        );
        if (cancelled) return;

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; modules?: unknown }
          | null;

        setModules(
          response.ok && Array.isArray(payload?.modules) ? (payload.modules as string[]) : []
        );
      } catch {
        // A failed read must not hide the whole application. Falling back to "no extra
        // modules" keeps the core navigation intact and leaves the server as the only
        // thing that can actually grant access.
        if (!cancelled) setModules([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { modules, loading };
}

/** True once the company's subscription and this user's grant both include `code`. */
export function useHasModule(code: string): { enabled: boolean; loading: boolean } {
  const { modules, loading } = useTenantModules();
  return { enabled: modules.includes(code), loading };
}
