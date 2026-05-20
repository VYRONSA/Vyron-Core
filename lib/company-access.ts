import { SupabaseClient } from "@supabase/supabase-js";

export type VyronCompanyAccess = {
  company_id: string;
  company_name: string;
  user_role: string;
  user_status: string;
  subscription_status: string;
  subscription_locked: boolean;
};

export type VyronCompanyAccessResult = {
  access: VyronCompanyAccess | null;
  error: string | null;
};

/** All workspaces the signed-in user may switch between. */
export type VyronAvailableCompaniesResult = {
  companies: VyronCompanyAccess[];
  error: string | null;
};

type CompanyUserJoinRow = {
  company_id: string;
  role?: string | null;
  status?: string | null;
  companies?: {
    id: string;
    name?: string | null;
    subscription_status?: string | null;
    status?: string | null;
  } | null;
};

export type SupabaseTableIssueKind =
  | "missing_or_cache"
  | "schema_not_exposed"
  | "permission_denied"
  | "other";

// Must match buildSidebarNavGroups in app/page.tsx (master supervisor nav uses VYRON_MASTER_OPERATOR_ROLE)
export const VYRON_MASTER_OPERATOR_ROLE = "Supervisor Tools";

export const VYRON_MASTER_OPERATOR_EMAIL = "info@vyronsoft.co.za";

const SQL_SETUP_FILES =
  "sql/000-run-all-companies.sql in the SQL editor (or sql/001 then sql/002)";

/** @deprecated Prefer getSupabaseCompaniesSetupHint(table) for table-specific guidance. */
export const SUPABASE_COMPANIES_SETUP_HINT =
  "Company tables are missing or not visible to the Supabase API (PostgREST PGRST205). " +
  `Run ${SQL_SETUP_FILES}, confirm Settings → API → Exposed schemas includes public, ` +
  "verify .env.local points at the same project, wait ~30s, then hard-refresh the app.";

/** PostgREST PGRST205 — table not in schema cache (missing DDL, stale cache, or schema not exposed). */
export function isSupabaseMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
  table?: string
): boolean {
  if (!error || error.code !== "PGRST205") return false;
  if (!table) return true;
  const message = (error.message || "").toLowerCase();
  const tableLower = table.toLowerCase();
  return (
    message.includes(tableLower) ||
    message.includes(`public.${tableLower}`)
  );
}

/** PostgREST PGRST202 — RPC function not in schema cache (002/000 not run, or stale cache). */
export function isSupabaseMissingRpcError(
  error: { code?: string; message?: string } | null | undefined,
  rpc?: string
): boolean {
  if (!error || error.code !== "PGRST202") return false;
  if (!rpc) return true;
  const message = (error.message || "").toLowerCase();
  const rpcLower = rpc.toLowerCase();
  return message.includes(rpcLower);
}

/** PostgREST PGRST106 — requested schema is not in Exposed schemas / Data API disabled. */
export function isSupabaseSchemaExposureError(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "PGRST106") return true;
  const blob = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    blob.includes("pg_pgrst_no_exposed_schemas") ||
    blob.includes("no schemas can be queried") ||
    blob.includes("not exposed to the api") ||
    blob.includes("not exposed to api") ||
    blob.includes("exposed schema") ||
    blob.includes("exposed schemas") ||
    (blob.includes("not exposed") && blob.includes("schema"))
  );
}

/** Postgres 42501 / JWT errors — table may exist and schema may be exposed. */
export function isSupabasePermissionDeniedError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code || "";
  if (
    code === "42501" ||
    code === "PGRST301" ||
    code === "PGRST302" ||
    code === "PGRST303"
  ) {
    return true;
  }
  const message = (error.message || "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("insufficient privilege") ||
    message.includes("row-level security")
  );
}

export function getSupabasePermissionDeniedHint(table?: string): string {
  const target = table ? ` on ${table}` : "";
  return (
    `Database permission denied${target} (RLS or grants — not a missing table). ` +
    `Re-run ${SQL_SETUP_FILES}, confirm you are signed in, then share the full error if it persists.`
  );
}

/** Project ref from https://<ref>.supabase.co (for dashboard deep links). */
export function getSupabaseProjectRefFromUrl(url?: string): string | null {
  const source = (url || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const match = source.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

export function getSupabaseSchemaExposureDashboardSteps(
  projectRef?: string | null
): string[] {
  const ref = projectRef ?? getSupabaseProjectRefFromUrl();
  const settingsUrl = ref
    ? `https://supabase.com/dashboard/project/${ref}/settings/api`
    : "https://supabase.com/dashboard/project/_/settings/api";
  return [
    `Open ${settingsUrl} (Project Settings → API).`,
    "Under Data API / Exposed schemas, ensure public is in the comma-separated list (default includes public).",
    "If the list is empty or public is missing, add public, click Save, wait ~30 seconds.",
    "Hard-refresh this app. Company SQL cannot change this setting — dashboard only.",
  ];
}

const SCHEMA_EXPOSURE_HINT_PREFIX = "The public schema is not exposed";

export function isSchemaExposureUserMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.startsWith(SCHEMA_EXPOSURE_HINT_PREFIX);
}

/** Distinguish PGRST205 schema exposure vs missing table / stale cache vs RLS. */
export function classifySupabaseTableIssue(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
  table?: string
): SupabaseTableIssueKind {
  if (isSupabasePermissionDeniedError(error)) return "permission_denied";
  if (!isSupabaseMissingTableError(error, table)) return "other";
  if (isSupabaseSchemaExposureError(error)) return "schema_not_exposed";
  return "missing_or_cache";
}

export function getSupabaseCompaniesSetupHint(table?: string): string {
  const target = table ? ` (${table})` : "";
  return (
    `Supabase API cannot see company tables${target} (PostgREST PGRST205). ` +
    `Run ${SQL_SETUP_FILES}. In the dashboard: Table Editor → confirm public.companies and ` +
    `public.company_users exist; Settings → API → Exposed schemas must include public; ` +
    `match NEXT_PUBLIC_SUPABASE_URL in .env.local to that project. Wait ~30s after SQL, then hard-refresh.`
  );
}

export function getSupabaseCompaniesRpcSetupHint(rpc?: string): string {
  const target = rpc ? ` (${rpc})` : "";
  return (
    `Supabase API cannot see company RPC${target} (PostgREST PGRST202). ` +
    `Run sql/000-run-all-companies.sql, sql/002-fix-company-access-rpc.sql, or sql/004-provision-rpc-only.sql ` +
    "in the SQL editor (not 001 alone — that creates tables only). Scripts end with NOTIFY pgrst reload. " +
    "Wait ~30s, then hard-refresh. See sql/RUN_COMPANY_TABLES.md."
  );
}

export function getSupabaseSchemaExposureHint(): string {
  const ref = getSupabaseProjectRefFromUrl();
  const link = ref
    ? `https://supabase.com/dashboard/project/${ref}/settings/api`
    : "https://supabase.com/dashboard/project/_/settings/api";
  return (
    "The public schema is not exposed to the Supabase Data API (PostgREST). " +
    `Open ${link} → Exposed schemas, add public to the comma-separated list, Save, wait ~30s, hard-refresh. ` +
    "See sql/RUN_COMPANY_TABLES.md. This cannot be changed from app code."
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Brief retries help when NOTIFY pgrst reload has not propagated yet. */
export async function withPostgrestSchemaRetry<T>(
  operation: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  const delayMs = options?.delayMs ?? 1200;
  let lastResult: T | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResult = await operation();
    const err = (lastResult as { error?: { code?: string } | null })?.error;
    const retryable = err?.code === "PGRST205" || err?.code === "PGRST202";
    if (!err || !retryable || attempt === attempts - 1) {
      return lastResult;
    }
    await sleep(delayMs);
  }
  return lastResult as T;
}

export function getMasterOperatorCompanyAccess(): VyronCompanyAccess {
  return {
    company_id: "master-workspace",
    company_name: "VYRON CORE Workspace",
    user_role: VYRON_MASTER_OPERATOR_ROLE,
    user_status: "active",
    subscription_status: "active",
    subscription_locked: false,
  };
}

/** Session-only master workspace when no DB companies exist yet. */
export function getMasterOperatorAvailableCompanies(): VyronCompanyAccess[] {
  return [getMasterOperatorCompanyAccess()];
}

/** Non-deletable directory / workspace ids (session workspace + legacy demo seeds). */
export const PROTECTED_MASTER_OPERATOR_COMPANY_IDS: readonly string[] = [
  "master-workspace",
];

/** Legacy mock ids — kept out of Master Client Directory even if cached in localStorage. */
export const MASTER_CLIENT_DIRECTORY_EXCLUDED_IDS: readonly string[] = [
  "master-workspace",
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
];

const masterClientDirectoryExcludedIdSet = new Set(MASTER_CLIENT_DIRECTORY_EXCLUDED_IDS);

export function isExcludedFromMasterClientDirectory(id: string): boolean {
  return masterClientDirectoryExcludedIdSet.has((id || "").trim());
}

const COMPANY_ID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const protectedMasterOperatorCompanyIdSet = new Set(PROTECTED_MASTER_OPERATOR_COMPANY_IDS);

/** True when id is a real DB company row (valid UUID, not a mock workspace). */
export function isDeletableCompanyId(id: string): boolean {
  const normalized = (id || "").trim();
  if (!normalized || protectedMasterOperatorCompanyIdSet.has(normalized)) {
    return false;
  }
  return COMPANY_ID_UUID_REGEX.test(normalized);
}

export const MASTER_OPERATOR_DIRECTORY_PROTECTED_MESSAGE =
  "This workspace cannot be deleted from the directory (system workspace).";

export function normalizeVyronEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export function isVyronMasterOperator(
  userRole: string,
  userEmail?: string | null
): boolean {
  if (userRole === VYRON_MASTER_OPERATOR_ROLE) return true;
  return normalizeVyronEmail(userEmail) === VYRON_MASTER_OPERATOR_EMAIL;
}

/** Maps session email + DB role to the sidebar layout role string page.tsx expects. */
export function resolveVyronLayoutRole(
  email: string,
  roleFromAccess?: string | null
): string {
  if (normalizeVyronEmail(email) === VYRON_MASTER_OPERATOR_EMAIL) {
    return VYRON_MASTER_OPERATOR_ROLE;
  }
  return (roleFromAccess || "manager").trim();
}

function mapRpcRowToAccess(
  email: string,
  row: {
    company_id: string;
    company_name: string;
    user_role: string;
    user_status: string;
    subscription_status: string;
    subscription_locked: boolean;
  }
): VyronCompanyAccess {
  const subscriptionStatus = row.subscription_status || "active";
  return {
    company_id: row.company_id,
    company_name: row.company_name || "VYRON CORE Workspace",
    user_role: resolveVyronLayoutRole(email, row.user_role || "user"),
    user_status: row.user_status || "active",
    subscription_status: subscriptionStatus,
    subscription_locked:
      row.subscription_locked ??
      !["active", "trialing", "demo"].includes(subscriptionStatus.toLowerCase()),
  };
}

function mapCompanyUserJoinToAccess(
  email: string,
  row: CompanyUserJoinRow
): VyronCompanyAccess | null {
  const company = row.companies;
  const companyId = company?.id || row.company_id;
  if (!companyId) return null;

  const subscriptionStatus = company?.subscription_status || "active";
  return {
    company_id: companyId,
    company_name: company?.name || "VYRON CORE Workspace",
    user_role: resolveVyronLayoutRole(email, row.role || "user"),
    user_status: row.status || "active",
    subscription_status: subscriptionStatus,
    subscription_locked: !["active", "trialing", "demo"].includes(
      subscriptionStatus.toLowerCase()
    ),
  };
}

function dedupeCompaniesById(companies: VyronCompanyAccess[]): VyronCompanyAccess[] {
  const seen = new Set<string>();
  const result: VyronCompanyAccess[] = [];
  for (const company of companies) {
    if (seen.has(company.company_id)) continue;
    seen.add(company.company_id);
    result.push(company);
  }
  return result;
}

function formatTableAccessError(
  error: { code?: string; message?: string; details?: string; hint?: string },
  table: string
): string {
  const kind = classifySupabaseTableIssue(error, table);
  if (kind === "permission_denied") return getSupabasePermissionDeniedHint(table);
  if (kind === "schema_not_exposed") return getSupabaseSchemaExposureHint();
  if (kind === "missing_or_cache") return getSupabaseCompaniesSetupHint(table);
  return error.message || "Unknown company access error.";
}

async function getAvailableCompaniesViaRpc(
  supabase: SupabaseClient,
  email: string
): Promise<VyronAvailableCompaniesResult> {
  const { data, error } = await withPostgrestSchemaRetry(async () =>
    supabase.rpc("vyron_get_company_access")
  );

  if (error) {
    if (isSupabaseMissingRpcError(error, "vyron_get_company_access")) {
      return {
        companies: [],
        error: getSupabaseCompaniesRpcSetupHint("vyron_get_company_access"),
      };
    }
    if (isSupabaseMissingTableError(error)) {
      const kind = classifySupabaseTableIssue(error);
      if (kind === "schema_not_exposed") {
        return { companies: [], error: getSupabaseSchemaExposureHint() };
      }
      if (kind === "permission_denied") {
        return { companies: [], error: getSupabasePermissionDeniedHint() };
      }
      return { companies: [], error: getSupabaseCompaniesSetupHint() };
    }
    return { companies: [], error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id) {
    return {
      companies: [],
      error: `No active company mapping bound to account user ${email}.`,
    };
  }

  return {
    companies: [mapRpcRowToAccess(email, row as VyronCompanyAccess)],
    error: null,
  };
}

export type ProvisionAdminInviteResult = {
  email: string;
  ok: boolean;
  status?: "active" | "pending";
  error?: string;
};

export type ProvisionClientCompanyResult = {
  company: { id: string; name: string } | null;
  error: string | null;
  adminInvite?: ProvisionAdminInviteResult | null;
};

export type ProvisionClientCompanyOptions = {
  adminEmail?: string;
};

/**
 * True when the Data API can route to public.companies.
 * - No error (including 200 + []) → exposed and reachable.
 * - PGRST205 → not in PostgREST schema cache (missing DDL, stale cache, or schema not exposed).
 * - 42501 / JWT errors → table route exists; RLS/grants issue, not exposure.
 */
export async function isCompaniesTableReachableViaRest(
  supabase: SupabaseClient
): Promise<boolean> {
  const { error } = await withPostgrestSchemaRetry(async () =>
    supabase.from("companies").select("id").limit(1)
  );
  if (!error) return true;
  if (isSupabaseMissingTableError(error, "companies")) return false;
  return true;
}

async function insertCompanyViaRest(
  supabase: SupabaseClient,
  name: string
): Promise<ProvisionClientCompanyResult> {
  const insertResult = await withPostgrestSchemaRetry(async () =>
    supabase
      .from("companies")
      .insert({
        name,
        subscription_status: "active",
        subscription_tier: "Starter",
        monthly_fee: 499,
      })
      .select("id, name")
      .single()
  );

  if (!insertResult.error && insertResult.data?.id) {
    return {
      company: { id: insertResult.data.id, name: insertResult.data.name || name },
      error: null,
    };
  }

  const insertError = insertResult.error;
  if (!insertError) {
    return { company: null, error: "Insert did not return a company row." };
  }

  const insertKind = classifySupabaseTableIssue(insertError, "companies");
  if (insertKind === "schema_not_exposed") {
    return { company: null, error: getSupabaseSchemaExposureHint() };
  }
  if (insertKind === "permission_denied") {
    return { company: null, error: getSupabasePermissionDeniedHint("companies") };
  }
  if (insertKind === "missing_or_cache") {
    return { company: null, error: null };
  }

  return {
    company: null,
    error: insertError.code
      ? `[${insertError.code}] ${insertError.message}`
      : insertError.message,
  };
}

type RpcProvisionAttempt = {
  company: { id: string; name: string } | null;
  error: { code?: string; message?: string } | null;
};

async function provisionCompanyViaRpc(
  supabase: SupabaseClient,
  name: string
): Promise<RpcProvisionAttempt> {
  const { data: rpcData, error: rpcError } = await withPostgrestSchemaRetry(async () =>
    supabase.rpc("vyron_provision_company", {
      p_name: name,
      p_subscription_status: "active",
    })
  );

  if (rpcError) {
    return { company: null, error: rpcError };
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row?.id) {
    return { company: null, error: null };
  }

  return {
    company: { id: row.id, name: row.name || name },
    error: null,
  };
}

async function insertCompanyAdminViaRest(
  supabase: SupabaseClient,
  companyId: string,
  adminEmail: string
): Promise<ProvisionAdminInviteResult> {
  const email = normalizeVyronEmail(adminEmail);
  const { error } = await withPostgrestSchemaRetry(async () =>
    supabase.from("company_users").insert({
      company_id: companyId,
      user_email: email,
      role: "admin",
      status: "active",
    })
  );

  if (!error) {
    return { email, ok: true, status: "active" };
  }

  const kind = classifySupabaseTableIssue(error, "company_users");
  if (kind === "schema_not_exposed") {
    return { email, ok: false, error: getSupabaseSchemaExposureHint() };
  }
  if (kind === "missing_or_cache") {
    return { email, ok: false, error: getSupabaseCompaniesSetupHint("company_users") };
  }
  if (kind === "permission_denied") {
    return { email, ok: false, error: getSupabasePermissionDeniedHint("company_users") };
  }

  return {
    email,
    ok: false,
    error: error.code ? `[${error.code}] ${error.message}` : error.message,
  };
}

async function provisionSuccessResult(
  supabase: SupabaseClient,
  company: { id: string; name: string },
  adminEmail?: string
): Promise<ProvisionClientCompanyResult> {
  const trimmedAdmin = adminEmail?.trim();
  if (!trimmedAdmin) {
    return { company, error: null, adminInvite: null };
  }

  const adminInvite = await insertCompanyAdminViaRest(supabase, company.id, trimmedAdmin);
  return { company, error: null, adminInvite };
}

function formatOptionalRpcProvisionDetail(
  rpcError: { code?: string; message?: string }
): string {
  if (isSupabaseMissingRpcError(rpcError, "vyron_provision_company")) {
    return (
      "Optional RPC fallback (vyron_provision_company) is also unavailable (PGRST202) — " +
      "only if tables exist in Table Editor but REST still fails after exposing public and waiting ~30s; " +
      "run sql/004-provision-rpc-only.sql."
    );
  }
  return rpcError.code
    ? `[${rpcError.code}] ${rpcError.message}`
    : rpcError.message || "RPC provision failed.";
}

/** Provision a tenant company row (Client Setup). REST when the API can see companies; RPC only after REST PGRST205. */
export async function provisionClientCompany(
  supabase: SupabaseClient,
  legalName: string,
  options?: ProvisionClientCompanyOptions
): Promise<ProvisionClientCompanyResult> {
  const name = legalName.trim();
  const adminEmail = options?.adminEmail;
  if (!name) {
    return { company: null, error: "Company legal name is required." };
  }

  const tableReachable = await isCompaniesTableReachableViaRest(supabase);

  if (tableReachable) {
    const restResult = await insertCompanyViaRest(supabase, name);
    if (restResult.company?.id) {
      return provisionSuccessResult(supabase, restResult.company, adminEmail);
    }
    if (restResult.error) return restResult;
    return { company: null, error: getSupabaseCompaniesSetupHint("companies") };
  }

  const restAttempt = await insertCompanyViaRest(supabase, name);
  if (restAttempt.company?.id) {
    return provisionSuccessResult(supabase, restAttempt.company, adminEmail);
  }
  if (restAttempt.error) {
    return restAttempt;
  }

  const rpcAttempt = await provisionCompanyViaRpc(supabase, name);
  if (rpcAttempt.company?.id) {
    return provisionSuccessResult(supabase, rpcAttempt.company, adminEmail);
  }

  const primary = getSupabaseCompaniesSetupHint("companies");
  const rpcError = rpcAttempt.error;
  if (!rpcError) {
    return { company: null, error: primary };
  }

  return {
    company: null,
    error: `${primary} ${formatOptionalRpcProvisionDetail(rpcError)}`,
  };
}

type MasterCompanyRow = {
  id: string;
  name?: string | null;
  subscription_status?: string | null;
  status?: string | null;
};

function mapMasterCompanyRowToAccess(row: MasterCompanyRow): VyronCompanyAccess {
  const subscriptionStatus = row.subscription_status || "active";
  return {
    company_id: row.id,
    company_name: row.name || "Company workspace",
    user_role: VYRON_MASTER_OPERATOR_ROLE,
    user_status: "active",
    subscription_status: subscriptionStatus,
    subscription_locked: !["active", "trialing", "demo"].includes(
      subscriptionStatus.toLowerCase()
    ),
  };
}

/** All companies rows for master supervisor (global directory / company switch). */
export async function getMasterOperatorCompaniesFromDatabase(
  supabase: SupabaseClient
): Promise<VyronAvailableCompaniesResult> {
  const { data, error } = await withPostgrestSchemaRetry(async () =>
    supabase
      .from("companies")
      .select("id, name, subscription_status, status")
      .order("created_at", { ascending: false })
  );

  if (error) {
    const kind = classifySupabaseTableIssue(error, "companies");
    if (kind === "schema_not_exposed") {
      return { companies: [], error: getSupabaseSchemaExposureHint() };
    }
    if (kind === "permission_denied") {
      return { companies: [], error: getSupabasePermissionDeniedHint("companies") };
    }
    if (isSupabaseMissingTableError(error, "companies")) {
      return { companies: [], error: getSupabaseCompaniesSetupHint("companies") };
    }
    return { companies: [], error: formatTableAccessError(error, "companies") };
  }

  const rows = (data || []) as MasterCompanyRow[];
  return {
    companies: dedupeCompaniesById(rows.map(mapMasterCompanyRowToAccess)),
    error: null,
  };
}

/**
 * Lists every active company workspace for the signed-in user (email via company_users.user_email).
 * Master supervisor loads every company from public.companies (no user filter).
 */
export async function getAvailableCompanies(
  supabase: SupabaseClient
): Promise<VyronAvailableCompaniesResult> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user?.email) {
      return { companies: [], error: "No active user email session discovered." };
    }

    const email = normalizeVyronEmail(userData.user.email);

    if (isVyronMasterOperator("", email)) {
      const dbResult = await getMasterOperatorCompaniesFromDatabase(supabase);
      if (dbResult.companies.length > 0) {
        return dbResult;
      }
      return {
        companies: getMasterOperatorAvailableCompanies(),
        error: dbResult.error,
      };
    }

    const { data: companyUserRows, error: companyUserError } = await withPostgrestSchemaRetry(
      async () =>
        supabase
          .from("company_users")
          .select("*, companies(*)")
          .eq("status", "active")
          .eq("user_email", email)
    );

    if (companyUserError) {
      if (isSupabaseMissingTableError(companyUserError, "company_users")) {
        return getAvailableCompaniesViaRpc(supabase, email);
      }
      return {
        companies: [],
        error: formatTableAccessError(companyUserError, "company_users"),
      };
    }

    const rows = (companyUserRows || []) as CompanyUserJoinRow[];
    const mapped = rows
      .map((row) => mapCompanyUserJoinToAccess(email, row))
      .filter((row): row is VyronCompanyAccess => row !== null);

    if (mapped.length === 0) {
      const rpcResult = await getAvailableCompaniesViaRpc(supabase, email);
      if (rpcResult.companies.length > 0) return rpcResult;
      return {
        companies: [],
        error:
          rpcResult.error ||
          `No active company mapping bound to account user ${email}.`,
      };
    }

    return { companies: dedupeCompaniesById(mapped), error: null };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown company security context fault.";
    return { companies: [], error: message };
  }
}

/**
 * Backward-compatible primary workspace: first entry from getAvailableCompanies (stable dedupe order).
 * Prefer getAvailableCompanies when the UI needs company switching.
 */
export async function getCompanyAccess(
  supabase: SupabaseClient
): Promise<VyronCompanyAccessResult> {
  const { companies, error } = await getAvailableCompanies(supabase);
  if (error) return { access: null, error };
  if (!companies.length) {
    return {
      access: null,
      error: "No active company mapping found for this account.",
    };
  }
  return { access: companies[0], error: null };
}
