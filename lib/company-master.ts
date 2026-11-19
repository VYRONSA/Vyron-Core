/**
 * VYRON Company Master — the client's only route to shared company identity.
 *
 * WHY THERE IS NO `.from("companies")` IN THIS FILE
 *   `public.companies` is the shared VYRON company master, consumed by CORE,
 *   HR, SAFETY and every future module. Its RLS is a single SELECT-only policy
 *   keyed on `company_users`, and the table-level GRANT to `authenticated`
 *   already permits UPDATE — so only the absence of a write policy holds the
 *   line. Reading or writing it directly from here would either fail (for a
 *   user with no CORE membership) or, worse, invite someone to "fix" that by
 *   adding an UPDATE policy, which cannot express a field whitelist and would
 *   open every column at once.
 *
 *   Everything therefore goes through the sql/098 functions. They are
 *   SECURITY DEFINER, they resolve the caller from auth.uid(), and they
 *   re-check authority on every call.
 *
 * WHY AUTHORITY IS NEVER INFERRED HERE
 *   Being a Safety owner, an HR user or a payroll user confers no Company
 *   Master authority. It comes from `vyron_company_admin_ids()` - a CORE
 *   company_users owner/admin/platform_admin, or an explicit grant in
 *   `vyron_company_master_admins` - or from the platform operator. The server
 *   decides; `canEdit` below is a rendering hint, never a permission.
 */

import { getSupabaseBrowserClient } from "./supabase";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Exactly what vyron_get_company() returns. No billing or subscription field. */
export type CompanyMaster = {
  id: string;
  name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  vat_number: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  contact_person: string | null;
  physical_address: string | null;
  postal_address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  country: string | null;
  timezone: string | null;
  logo_bucket: string | null;
  logo_path: string | null;
  updated_at: string | null;
  /** Rendering hints. The RPCs remain the security authority. */
  can_edit: boolean;
  can_manage_admins: boolean;
};

/**
 * How one candidate reads in a selector.
 *
 * Name and address together where both exist: a name alone is ambiguous
 * between two colleagues, and an address alone is hard to recognise. A person
 * with neither falls back to the uuid rather than to an empty label, because
 * an unlabelled option is one nobody can choose deliberately.
 *
 * It lives here rather than in the panel so it can be tested as what it is - a
 * pure function of the row - without rendering anything.
 */
export function candidateLabel(c: CompanyMasterCandidate): string {
  if (c.display_name && c.email) return `${c.display_name} — ${c.email}`;
  return c.display_name ?? c.email ?? c.auth_user_id;
}

/**
 * Somebody who may be OFFERED the grant.
 *
 * A candidate is a person already associated with this one company - through
 * CORE membership, through VYRON SAFETY, or by already holding the grant.
 * That association is not a permission and confers nothing; it is only what
 * makes it possible to show a name instead of asking for a UUID.
 */
export type CompanyMasterCandidate = {
  auth_user_id: string;
  email: string | null;
  display_name: string | null;
  /** Where the association comes from: "core", "safety", "company_master". */
  sources: string[];
  /** Already an active Company Master administrator of this company. */
  is_admin: boolean;
};

export type CompanyMasterAdmin = {
  id: string;
  company_id: string;
  auth_user_id: string;
  status: "active" | "revoked" | string;
  granted_by: string | null;
  granted_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
};

/**
 * The result of a write.
 *
 * `rejected` is surfaced rather than swallowed: if the client sends a field the
 * server refuses, the person is told, instead of being shown a success that did
 * not happen.
 */
export type UpdateResult =
  | { ok: true; fields: string[]; rejected: string[] }
  | { ok: false; reason: string; rejected: string[] }
  | { ok: false; reason: "error"; message: string; rejected: [] };

/* ------------------------------------------------------------------ */
/* The editable field set                                              */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the whitelist inside vyron_update_company().
 *
 * Duplicated deliberately, and only in this direction: the form is built from
 * this list so a platform-controlled column cannot appear as an input. The
 * database remains the authority - anything not on its own list is returned as
 * `rejected` regardless of what is sent.
 */
export const EDITABLE_COMPANY_FIELDS = [
  "name", "trading_name", "registration_number", "vat_number", "industry",
  "email", "phone", "website", "contact_person",
  "physical_address", "postal_address", "address_line1", "address_line2",
  "address_city", "address_region", "address_postal_code",
  "country", "timezone", "logo_bucket", "logo_path",
] as const;

export type EditableCompanyField = (typeof EDITABLE_COMPANY_FIELDS)[number];

/** Fields the platform controls. Never rendered as an input, never sent. */
export const PLATFORM_CONTROLLED_FIELDS = [
  "enabled_modules", "plan", "subscription_status", "subscription_tier",
  "employee_limit", "monthly_fee", "trial_ends_at", "locked_reason",
  "demo_started_at", "status", "billing_email",
] as const;

export const COMPANY_BRANDING_BUCKET = "company-branding";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getCompanyMaster(companyId: string): Promise<CompanyMaster> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_get_company", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Company not found, or not yours to view.");
  return row as CompanyMaster;
}

/** Companies whose identity this user may see, across every VYRON module. */
export async function listVisibleCompanyIds(): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  // Never call this as the anonymous role: anon has no EXECUTE on it, and on the Supabase
  // Postgres 17.6.1.111 image a permission-denied function call by anon was observed to
  // crash the database server (UMORA readiness remediation). No session = no companies.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];
  const { data, error } = await supabase.rpc("vyron_company_directory_ids");
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

/**
 * Companies this user may EDIT.
 *
 * Note what this does NOT include: the platform operator. That branch lives in
 * the callers, so a company appearing here is evidence of a CORE administrator
 * role or an explicit Company Master grant, and nothing else.
 */
export async function listAdministrableCompanyIds(): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  // See listVisibleCompanyIds: no anonymous RPC calls.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];
  const { data, error } = await supabase.rpc("vyron_company_admin_ids");
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

/**
 * The selectable administrators for one company.
 *
 * `available` distinguishes the two ways this can come back empty, because
 * they call for opposite responses in the UI:
 *
 *   available: true,  candidates: []   the company genuinely has nobody to offer
 *   available: false                   sql/099 is not applied in this database
 *
 * Collapsing them would leave an administrator staring at an empty list with no
 * idea whether the company is empty or the deployment is incomplete - and would
 * hide the fact that the pre-099 UUID entry is still the only way to grant.
 */
export async function listCompanyMasterCandidates(
  companyId: string,
): Promise<{ available: boolean; candidates: CompanyMasterCandidate[] }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_list_company_master_candidates", {
    p_company_id: companyId,
  });
  if (error) {
    if (isMissingFunction(error)) return { available: false, candidates: [] };
    throw new Error(error.message);
  }
  return { available: true, candidates: (data ?? []) as CompanyMasterCandidate[] };
}

/**
 * PostgREST's answer when a function is not in the schema cache.
 *
 * Checked by code first and by message only as a fallback: the wording is not a
 * contract, but PGRST202 is. This must never swallow a permission error - a
 * refusal has to keep surfacing as a refusal.
 */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST202") return true;
  return /could not find the function/i.test(error.message ?? "");
}

export async function listCompanyMasterAdmins(
  companyId: string,
): Promise<CompanyMasterAdmin[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_list_company_master_admins", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyMasterAdmin[];
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Sends only whitelisted keys, and reports honestly.
 *
 * A field the server refuses comes back in `rejected`. The caller must show
 * that rather than treating the call as a clean success.
 */
export async function updateCompanyMaster(
  companyId: string,
  patch: Partial<Record<EditableCompanyField, string | null>>,
): Promise<UpdateResult> {
  const clean: Record<string, string | null> = {};
  for (const key of EDITABLE_COMPANY_FIELDS) {
    if (key in patch) clean[key] = patch[key] ?? null;
  }
  if (Object.keys(clean).length === 0) {
    return { ok: false, reason: "no_changes", rejected: [] };
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_update_company", {
    p_company_id: companyId,
    p_patch: clean,
  });
  if (error) return { ok: false, reason: "error", message: error.message, rejected: [] };

  const result = data as { ok?: boolean; reason?: string; fields?: string[]; rejected?: string[] };
  if (result?.ok) {
    return { ok: true, fields: result.fields ?? [], rejected: result.rejected ?? [] };
  }
  return { ok: false, reason: result?.reason ?? "refused", rejected: result?.rejected ?? [] };
}

export async function grantCompanyMasterAdmin(
  companyId: string,
  authUserId: string,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_grant_company_master_admin", {
    p_company_id: companyId,
    p_auth_user_id: authUserId,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/**
 * Grants to whoever holds one exact email address.
 *
 * The route for a person who holds a VYRON account but is not yet associated
 * with this company, so does not appear as a candidate. The server resolves the
 * address and then calls the same grant function the selector uses; nothing
 * about the authority model differs between the two paths.
 *
 * `no_account` is reported rather than smoothed over. Telling somebody a grant
 * succeeded when the address matched nobody is the one outcome worse than
 * telling them it failed.
 */
export async function grantCompanyMasterAdminByEmail(
  companyId: string,
  email: string,
): Promise<{ ok: boolean; authUserId?: string; reason?: string; message?: string }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_grant_company_master_admin_by_email", {
    p_company_id: companyId,
    p_email: email.trim(),
  });
  if (error) {
    if (isMissingFunction(error)) return { ok: false, reason: "unavailable" };
    return { ok: false, message: error.message };
  }
  const result = data as { ok?: boolean; reason?: string; auth_user_id?: string } | null;
  if (result?.ok) return { ok: true, authUserId: result.auth_user_id };
  return { ok: false, reason: result?.reason ?? "refused" };
}

export async function revokeCompanyMasterAdmin(
  companyId: string,
  authUserId: string,
): Promise<{ ok: boolean; changed?: boolean; message?: string }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("vyron_revoke_company_master_admin", {
    p_company_id: companyId,
    p_auth_user_id: authUserId,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, changed: data === true };
}

/* ------------------------------------------------------------------ */
/* Branding                                                            */
/* ------------------------------------------------------------------ */

/**
 * A signed URL for the company logo.
 *
 * Never a public URL, and never persisted: a stored URL outlives the access
 * check that produced it. `logo_path` is the authoritative reference and the
 * link is minted per view.
 */
export async function companyLogoUrl(
  company: Pick<CompanyMaster, "logo_bucket" | "logo_path">,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!company.logo_bucket || !company.logo_path) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.storage
    .from(company.logo_bucket)
    .createSignedUrl(company.logo_path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Uploads a logo, then points the record at it.
 *
 * The path is always `<company_id>/logo.<ext>` because the storage policies key
 * on the first path segment, and vyron_update_company() refuses a logo_path
 * that does not begin with the company's own id.
 *
 * If the object uploads but the record update fails, the object is removed
 * again: a stored file nothing refers to is worse than no file.
 */
export async function uploadCompanyLogo(
  companyId: string,
  file: File,
): Promise<{ ok: boolean; path?: string; message?: string }> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${companyId}/logo.${ext || "png"}`;
  const supabase = getSupabaseBrowserClient();

  const up = await supabase.storage
    .from(COMPANY_BRANDING_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) return { ok: false, message: up.error.message };

  const linked = await updateCompanyMaster(companyId, {
    logo_bucket: COMPANY_BRANDING_BUCKET,
    logo_path: path,
  });
  if (!linked.ok) {
    await supabase.storage.from(COMPANY_BRANDING_BUCKET).remove([path]).catch(() => undefined);
    return {
      ok: false,
      message: "message" in linked ? linked.message : `The logo could not be linked (${linked.reason}).`,
    };
  }
  return { ok: true, path };
}

/* ------------------------------------------------------------------ */
/* Validation - a courtesy, not the authority                          */
/* ------------------------------------------------------------------ */

/**
 * Mirrors vyron_update_company()'s validation so a person is told before a
 * round trip. The database re-validates everything and has the final say;
 * these rules exist to save a failed save, not to replace one.
 */
export function validateCompanyField(
  field: EditableCompanyField,
  value: string,
  country?: string | null,
): string | null {
  const v = value.trim();

  if (field === "name") {
    if (!v) return "Legal company name is required.";
    if (v.length > 200) return "Legal company name is too long (200 characters maximum).";
  }
  if (!v) return null;   // every other field may be cleared

  if (field === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    return "Enter a valid email address.";
  }
  if (field === "website" && !/^https?:\/\/\S+$/i.test(v)) {
    return "The website must begin with http:// or https://";
  }
  if (field === "vat_number") {
    /* Country-aware. VYRON is intended to operate in more than one country, so
       only a South African company is held to the SARS format. */
    const za = ["SOUTH AFRICA", "ZA", "RSA"].includes((country ?? "").trim().toUpperCase());
    if (za && !/^4\d{9}$/.test(v.replace(/\s/g, ""))) {
      return "A South African VAT number is 10 digits beginning with 4.";
    }
    if (!za && v.length > 32) return "VAT number is too long (32 characters maximum).";
  }
  return null;
}
