"use client";

/**
 * Whether to OFFER the Company Master entry in the navigation.
 *
 * A display gate and nothing else, in the same spirit as useHasModule(): the
 * authority to read or edit a company's identity is decided by the sql/098
 * functions on every call, so hiding this link never becomes the thing that
 * keeps somebody out, and showing it never lets anybody in.
 *
 * The question asked is the narrowest one that is true: does this user appear
 * in vyron_company_directory_ids() - the shared company directory - for at
 * least one company? That is deliberately NOT a CORE role check. A Company
 * Master administrator may hold no company_users membership at all (that is
 * the case sql/098 exists for), and gating the link on CORE membership would
 * hide the screen from precisely the person it was built for.
 *
 * The platform operator is OR'd in by the caller, matching how the sql/098
 * functions treat that branch: it lives with the callers, not inside the
 * directory function.
 */

import { useEffect, useState } from "react";
import { listVisibleCompanyIds } from "@/lib/company-master";

export type CompanyMasterVisibility = {
  /** At least one company's identity is visible to this user. */
  visible: boolean;
  loading: boolean;
};

export function useCompanyMasterVisible(): CompanyMasterVisibility {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ids = await listVisibleCompanyIds();
        if (!cancelled) setVisible(ids.length > 0);
      } catch {
        /* A failed lookup hides the link rather than showing one that leads to
           an empty screen. Nothing is lost: /settings/company remains
           reachable directly, and answers for itself. */
        if (!cancelled) setVisible(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { visible, loading };
}
