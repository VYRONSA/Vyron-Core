/**
 * Shared company resolution for kiosk routes (/clock, /leave, etc.).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyAccess, shouldSuppressWorkspaceLoadMessage } from "@/lib/company-access";

export async function resolveKioskCompanyId(
  supabase: SupabaseClient,
  companyParam: string | null | undefined
): Promise<{ companyId: string; error: string | null }> {
  const fromQuery = companyParam?.trim() || "";
  if (fromQuery) return { companyId: fromQuery, error: null };

  const { access, error: accessError } = await getCompanyAccess(supabase);
  if (access?.company_id) return { companyId: access.company_id, error: null };

  if (accessError && !shouldSuppressWorkspaceLoadMessage(accessError)) {
    return { companyId: "", error: formatClientSafeError(accessError) };
  }

  return {
    companyId: "",
    error:
      "This kiosk is not linked to a company. Use the link from your administrator (includes ?company=…) or sign in as a tenant user.",
  };
}

/** Map raw Supabase / schema errors to user-friendly copy. */
export function formatClientSafeError(message: string | null | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  if (shouldSuppressWorkspaceLoadMessage(message)) {
    return "This workspace is still being set up. Please try again shortly or contact VYRON support.";
  }
  const lower = message.toLowerCase();
  if (lower.includes("jwt") || lower.includes("session")) {
    return "Your session has expired. Please sign in again.";
  }
  if (lower.includes("permission denied") || lower.includes("row-level security")) {
    return "You do not have permission to perform this action.";
  }
  if (lower.includes("duplicate key") || lower.includes("unique constraint")) {
    return "This record already exists. Refresh the page and try again.";
  }
  return message;
}
