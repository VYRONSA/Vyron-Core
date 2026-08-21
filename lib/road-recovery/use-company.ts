"use client";

/**
 * Resolves the signed-in user's company for Road & Recovery screens.
 *
 * Uses the EXISTING getCompanyAccess() so the tenant resolution is identical to every
 * other screen in VYRON CORE. The value is only ever used to parameterise API reads;
 * the server re-verifies it on every request via requireApiContext().
 */

import { useEffect, useState } from "react";
import { getCompanyAccess } from "@/lib/company-access";
import { normalizeRbacRole, type VyronRbacRole } from "@/lib/server/auth-routing";
import { supabase } from "@/lib/supabase";

export type RrCompanyState = {
  companyId: string;
  /** The caller's role in this workspace, normalised to the app-wide RBAC vocabulary. */
  role: VyronRbacRole | null;
  loading: boolean;
  error: string | null;
};

export function useRoadRecoveryCompany(): RrCompanyState {
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState<VyronRbacRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;
      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        setLoading(false);
        return;
      }
      setCompanyId(access.company_id);
      setRole(normalizeRbacRole(access.user_role));
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { companyId, role, loading, error };
}
