/**
 * VYRON CORE Batch 15 — Client Portal & Customer Experience Platform.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { formatCurrency, loadProfitabilityDashboard } from "@/lib/client-profitability-intelligence";
import {
  fetchFieldOperationsSnapshot,
  formatFieldTimestamp,
  type FieldJob,
  type FieldJobEvent,
} from "@/lib/field-operations";
import { resolveSiteKey, resolveSiteLabel } from "@/lib/field-cost-intelligence";
import { formatDuration } from "@/lib/field-travel-intelligence";

export const CLIENT_PORTAL_VIEWS = [
  "hub",
  "jobs",
  "assets",
  "sites",
  "reports",
  "documents",
  "invoices",
  "requests",
  "satisfaction",
] as const;

export type ClientPortalView = (typeof CLIENT_PORTAL_VIEWS)[number];

export type ClientPortalUser = {
  id: string;
  companyId: string;
  clientId: string;
  email: string;
  contactName: string;
  phone: string | null;
  role: string;
  status: string;
};

export type ClientPortalJob = {
  id: string;
  jobRef: string;
  title: string;
  status: string;
  siteLabel: string;
  scheduledStart: string | null;
  technicianName: string | null;
  events: { eventType: string; recordedAt: string; photoUrl: string | null }[];
  photos: { url: string; capturedAt: string; evidenceType: string }[];
};

export type ClientPortalAsset = {
  id: string;
  assetName: string;
  assetNumber: string | null;
  siteLabel: string | null;
  status: string;
};

export type ClientPortalSite = {
  siteKey: string;
  siteLabel: string;
  jobsCount: number;
  lastVisit: string | null;
  activeJobs: number;
};

export type ClientPortalDocument = {
  id: string;
  title: string;
  documentType: string;
  fileUrl: string | null;
  uploadedAt: string;
  jobId: string | null;
};

export type ClientPortalInvoice = {
  id: string;
  jobRef: string;
  jobTitle: string;
  invoiceDate: string;
  revenue: number;
  status: string;
};

export type ClientPortalRequest = {
  id: string;
  requestType: string;
  subject: string;
  description: string | null;
  status: string;
  submittedAt: string;
};

export type ClientSatisfactionSummary = {
  averageRating: number;
  totalRatings: number;
  npsLabel: string;
  recentRatings: { rating: number; feedback: string | null; ratedAt: string; jobRef: string | null }[];
};

export type ClientPortalHub = {
  portalUser: ClientPortalUser | null;
  clientName: string;
  companyId: string;
  clientId: string;
  jobs: ClientPortalJob[];
  assets: ClientPortalAsset[];
  sites: ClientPortalSite[];
  documents: ClientPortalDocument[];
  invoices: ClientPortalInvoice[];
  requests: ClientPortalRequest[];
  satisfaction: ClientSatisfactionSummary;
  reportSummary: {
    jobsCompleted: number;
    revenue: number;
    marginPct: number;
    periodLabel: string;
  };
  tablesAvailable: boolean;
  error: string | null;
};

const PORTAL_TABLES = [
  "client_portal_users",
  "client_requests",
  "client_ratings",
  "client_assets",
  "client_documents",
  "client_portal_audit_log",
] as const;

function isPortalMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return PORTAL_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToPortalUser(row: Record<string, unknown>): ClientPortalUser {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    clientId: String(row.client_id),
    email: String(row.email),
    contactName: String(row.contact_name),
    phone: row.phone ? String(row.phone) : null,
    role: String(row.role || "viewer"),
    status: String(row.status || "active"),
  };
}

export async function resolveClientPortalUser(
  supabase: SupabaseClient,
  email: string
): Promise<{ user: ClientPortalUser | null; error: string | null }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { user: null, error: "Sign in to access the client portal." };

  const { data, error } = await supabase
    .from("client_portal_users")
    .select("*")
    .eq("email", normalized)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    if (isPortalMissingTableError(error)) return { user: null, error: null };
    return { user: null, error: error.message };
  }
  if (!data) return { user: null, error: null };
  return { user: rowToPortalUser(data as Record<string, unknown>), error: null };
}

export async function logClientPortalAudit(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    clientId: string;
    portalUserId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from("client_portal_audit_log").insert({
    company_id: input.companyId,
    client_id: input.clientId,
    portal_user_id: input.portalUserId || null,
    action: input.action,
    metadata: input.metadata || null,
  });
}

export function computeClientSatisfaction(
  ratings: { rating: number; feedback: string | null; rated_at: string; job_id?: string | null }[],
  jobRefs: Map<string, string>
): ClientSatisfactionSummary {
  if (ratings.length === 0) {
    return {
      averageRating: 0,
      totalRatings: 0,
      npsLabel: "No ratings yet",
      recentRatings: [],
    };
  }

  const total = ratings.reduce((s, r) => s + r.rating, 0);
  const average = Math.round((total / ratings.length) * 10) / 10;
  let npsLabel = "Needs Attention";
  if (average >= 4.5) npsLabel = "Excellent";
  else if (average >= 4) npsLabel = "Good";
  else if (average >= 3) npsLabel = "Fair";

  return {
    averageRating: average,
    totalRatings: ratings.length,
    npsLabel,
    recentRatings: ratings.slice(0, 10).map((r) => ({
      rating: r.rating,
      feedback: r.feedback,
      ratedAt: r.rated_at,
      jobRef: r.job_id ? jobRefs.get(String(r.job_id)) || null : null,
    })),
  };
}

function employeeLabel(
  employees: { id: string; first_name: string; last_name: string }[],
  id: string | null
): string | null {
  if (!id) return null;
  const row = employees.find((e) => e.id === id);
  if (!row) return null;
  return `${row.first_name} ${row.last_name}`.trim();
}

export async function loadClientPortalHub(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string,
  portalUser: ClientPortalUser | null,
  employees: { id: string; first_name: string; last_name: string }[] = []
): Promise<ClientPortalHub> {
  const empty: ClientPortalHub = {
    portalUser,
    clientName: "Client",
    companyId,
    clientId,
    jobs: [],
    assets: [],
    sites: [],
    documents: [],
    invoices: [],
    requests: [],
    satisfaction: computeClientSatisfaction([], new Map()),
    reportSummary: { jobsCompleted: 0, revenue: 0, marginPct: 0, periodLabel: "This month" },
    tablesAvailable: false,
    error: null,
  };

  if (!companyId || !clientId) return empty;

  const [
    clientRes,
    jobsRes,
    assetsRes,
    docsRes,
    requestsRes,
    ratingsRes,
    evidenceRes,
    revenueRes,
    profitabilityRes,
  ] = await Promise.all([
    supabase.from("client_billing_profiles").select("client_name").eq("id", clientId).maybeSingle(),
    supabase
      .from("field_jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("scheduled_start", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from("client_assets").select("*").eq("company_id", companyId).eq("client_id", clientId),
    supabase
      .from("client_documents")
      .select("*")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("client_requests")
      .select("*")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("submitted_at", { ascending: false })
      .limit(30),
    supabase
      .from("client_ratings")
      .select("*")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("rated_at", { ascending: false })
      .limit(50),
    supabase
      .from("mobile_workforce_evidence")
      .select("job_id, photo_url, evidence_type, captured_at")
      .eq("company_id", companyId)
      .not("photo_url", "is", null)
      .order("captured_at", { ascending: false })
      .limit(100),
    supabase.from("job_revenue").select("*").eq("company_id", companyId),
    supabase.from("job_profitability").select("*").eq("company_id", companyId),
  ]);

  if (clientRes.error && isPortalMissingTableError(clientRes.error)) {
    return empty;
  }

  const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
  const focusDate = new Date().toISOString().slice(0, 10);
  const profitability = await loadProfitabilityDashboard(supabase, companyId, focusDate);

  let jobs: FieldJob[] = (jobsRes.data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      jobRef: String(r.job_ref),
      title: String(r.title),
      description: r.description ? String(r.description) : null,
      status: r.status as FieldJob["status"],
      siteType: r.site_type as FieldJob["siteType"],
      storeId: r.store_id ? String(r.store_id) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      customerAddress: r.customer_address ? String(r.customer_address) : null,
      assetId: r.asset_id ? String(r.asset_id) : null,
      vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
      trailerId: r.trailer_id ? String(r.trailer_id) : null,
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      scheduledStart: r.scheduled_start ? String(r.scheduled_start) : null,
      scheduledEnd: r.scheduled_end ? String(r.scheduled_end) : null,
      priority: String(r.priority || "normal"),
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });

  if (jobs.length === 0 && clientRes.data) {
    const clientName = String((clientRes.data as { client_name: string }).client_name || "");
    jobs = snapshot.jobs.filter(
      (j) => j.customerName?.trim().toLowerCase() === clientName.trim().toLowerCase()
    );
  }

  const jobIds = new Set(jobs.map((j) => j.id));
  const jobRefs = new Map(jobs.map((j) => [j.id, j.jobRef]));

  const eventsByJob = new Map<string, FieldJobEvent[]>();
  snapshot.events.forEach((event) => {
    if (!event.jobId || !jobIds.has(event.jobId)) return;
    const list = eventsByJob.get(event.jobId) || [];
    list.push(event);
    eventsByJob.set(event.jobId, list);
  });

  const photosByJob = new Map<string, ClientPortalJob["photos"]>();
  (evidenceRes.data || []).forEach((row) => {
    const r = row as Record<string, unknown>;
    const jobId = r.job_id ? String(r.job_id) : null;
    if (!jobId || !jobIds.has(jobId) || !r.photo_url) return;
    const list = photosByJob.get(jobId) || [];
    list.push({
      url: String(r.photo_url),
      capturedAt: String(r.captured_at),
      evidenceType: String(r.evidence_type || "photo"),
    });
    photosByJob.set(jobId, list);
  });

  const portalJobs: ClientPortalJob[] = jobs.map((job) => {
    const assignment = snapshot.assignments.find(
      (a) => a.jobId === job.id && a.status === "assigned"
    );
    const events = (eventsByJob.get(job.id) || [])
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
      .map((e) => ({
        eventType: e.eventType,
        recordedAt: e.recordedAt,
        photoUrl: e.photoUrl,
      }));

    return {
      id: job.id,
      jobRef: job.jobRef,
      title: job.title,
      status: job.status,
      siteLabel: resolveSiteLabel(job),
      scheduledStart: job.scheduledStart,
      technicianName: employeeLabel(employees, assignment?.employeeId ?? null),
      events,
      photos: photosByJob.get(job.id) || [],
    };
  });

  const portalAssets: ClientPortalAsset[] = (assetsRes.data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      assetName: String(r.asset_name),
      assetNumber: r.asset_number ? String(r.asset_number) : null,
      siteLabel: r.site_label ? String(r.site_label) : null,
      status: String(r.status || "active"),
    };
  });

  const siteMap = new Map<string, ClientPortalSite>();
  for (const job of jobs) {
    const key = resolveSiteKey(job);
    const label = resolveSiteLabel(job);
    const existing = siteMap.get(key) || {
      siteKey: key,
      siteLabel: label,
      jobsCount: 0,
      lastVisit: null,
      activeJobs: 0,
    };
    existing.jobsCount += 1;
    if (job.status !== "Completed" && job.status !== "Cancelled") existing.activeJobs += 1;
    const lastEvent = eventsByJob.get(job.id)?.at(-1);
    const candidate = lastEvent?.recordedAt || job.scheduledStart;
    if (candidate && (!existing.lastVisit || candidate > existing.lastVisit)) {
      existing.lastVisit = candidate;
    }
    siteMap.set(key, existing);
  }

  const documents: ClientPortalDocument[] = (docsRes.data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      title: String(r.title),
      documentType: String(r.document_type || "report"),
      fileUrl: r.file_url ? String(r.file_url) : null,
      uploadedAt: String(r.uploaded_at),
      jobId: r.job_id ? String(r.job_id) : null,
    };
  });

  const invoices: ClientPortalInvoice[] = jobs.map((job) => {
    const revenueRow = (revenueRes.data || []).find(
      (row) => String((row as { job_id: string }).job_id) === job.id
    ) as Record<string, unknown> | undefined;
    const profitRow = (profitabilityRes.data || []).find(
      (row) => String((row as { job_id: string }).job_id) === job.id
    ) as Record<string, unknown> | undefined;
    const revenue =
      num(revenueRow?.computed_revenue) ??
      num(profitRow?.revenue) ??
      profitability.jobProfitability.find((p) => p.jobId === job.id)?.revenue ??
      0;

    return {
      id: job.id,
      jobRef: job.jobRef,
      jobTitle: job.title,
      invoiceDate: (revenueRow?.revenue_date as string)?.slice(0, 10) || job.scheduledStart?.slice(0, 10) || "—",
      revenue,
      status: job.status === "Completed" ? "issued" : "pending",
    };
  });

  const requests: ClientPortalRequest[] = (requestsRes.data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      requestType: String(r.request_type),
      subject: String(r.subject),
      description: r.description ? String(r.description) : null,
      status: String(r.status),
      submittedAt: String(r.submitted_at),
    };
  });

  const satisfaction = computeClientSatisfaction(
    (ratingsRes.data || []) as { rating: number; feedback: string | null; rated_at: string; job_id?: string | null }[],
    jobRefs
  );

  const clientProfit = profitability.clientProfitability.find((c) => c.clientId === clientId);

  if (portalUser) {
    await logClientPortalAudit(supabase, {
      companyId,
      clientId,
      portalUserId: portalUser.id,
      action: "portal_view",
      metadata: { view: "hub" },
    });
    await supabase
      .from("client_portal_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", portalUser.id);
  }

  return {
    portalUser,
    clientName: clientRes.data
      ? String((clientRes.data as { client_name: string }).client_name)
      : "Client",
    companyId,
    clientId,
    jobs: portalJobs,
    assets: portalAssets,
    sites: [...siteMap.values()],
    documents,
    invoices,
    requests,
    satisfaction,
    reportSummary: {
      jobsCompleted: clientProfit?.jobsCompleted ?? jobs.filter((j) => j.status === "Completed").length,
      revenue: clientProfit?.revenue ?? profitability.revenueThisMonth,
      marginPct: clientProfit?.marginPct ?? profitability.grossMarginPct,
      periodLabel: `${profitability.monthStart} → ${profitability.monthEnd}`,
    },
    tablesAvailable: true,
    error: snapshot.error,
  };
}

export async function submitClientRequest(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    clientId: string;
    portalUserId?: string | null;
    requestType?: string;
    subject: string;
    description?: string | null;
    jobId?: string | null;
    priority?: string;
  }
): Promise<{ request: ClientPortalRequest | null; error: string | null }> {
  const { data, error } = await supabase
    .from("client_requests")
    .insert({
      company_id: input.companyId,
      client_id: input.clientId,
      portal_user_id: input.portalUserId || null,
      job_id: input.jobId || null,
      request_type: input.requestType || "service",
      subject: input.subject.trim(),
      description: input.description?.trim() || null,
      priority: input.priority || "normal",
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { request: null, error: error?.message || "Failed to submit request." };

  await logClientPortalAudit(supabase, {
    companyId: input.companyId,
    clientId: input.clientId,
    portalUserId: input.portalUserId,
    action: "submit_request",
    metadata: { subject: input.subject },
  });

  const r = data as Record<string, unknown>;
  return {
    request: {
      id: String(r.id),
      requestType: String(r.request_type),
      subject: String(r.subject),
      description: r.description ? String(r.description) : null,
      status: String(r.status),
      submittedAt: String(r.submitted_at),
    },
    error: null,
  };
}

export async function submitClientRating(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    clientId: string;
    portalUserId?: string | null;
    jobId?: string | null;
    rating: number;
    feedback?: string | null;
  }
): Promise<{ error: string | null }> {
  if (input.rating < 1 || input.rating > 5) {
    return { error: "Rating must be between 1 and 5." };
  }

  const { error } = await supabase.from("client_ratings").insert({
    company_id: input.companyId,
    client_id: input.clientId,
    portal_user_id: input.portalUserId || null,
    job_id: input.jobId || null,
    rating: input.rating,
    feedback: input.feedback?.trim() || null,
  });

  if (error) return { error: error.message };

  await logClientPortalAudit(supabase, {
    companyId: input.companyId,
    clientId: input.clientId,
    portalUserId: input.portalUserId,
    action: "submit_rating",
    metadata: { rating: input.rating, jobId: input.jobId },
  });

  return { error: null };
}

export async function createClientPortalUser(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    clientId: string;
    email: string;
    contactName: string;
    phone?: string | null;
    role?: string;
  }
): Promise<{ user: ClientPortalUser | null; error: string | null }> {
  const { data, error } = await supabase
    .from("client_portal_users")
    .insert({
      company_id: input.companyId,
      client_id: input.clientId,
      email: input.email.trim().toLowerCase(),
      contact_name: input.contactName.trim(),
      phone: input.phone?.trim() || null,
      role: input.role || "viewer",
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { user: null, error: error?.message || "Failed to create portal user." };
  return { user: rowToPortalUser(data as Record<string, unknown>), error: null };
}

export async function fetchClientPortalClients(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ id: string; clientName: string }[]> {
  const { data } = await supabase
    .from("client_billing_profiles")
    .select("id, client_name")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("client_name");
  return (data || []).map((row) => ({
    id: String((row as { id: string }).id),
    clientName: String((row as { client_name: string }).client_name),
  }));
}

export function formatPortalTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return formatFieldTimestamp(iso);
}

export function visitTimelineSummary(events: ClientPortalJob["events"]): string {
  const travel = events.find((e) => e.eventType === "Start Travel");
  const arrive = events.find((e) => e.eventType === "Arrive Site");
  const leave = events.find((e) => e.eventType === "Leave Site");
  if (!travel && !arrive) return "No visit timestamps yet";
  const parts: string[] = [];
  if (travel) parts.push(`Travel ${formatFieldTimestamp(travel.recordedAt)}`);
  if (arrive) parts.push(`Arrived ${formatFieldTimestamp(arrive.recordedAt)}`);
  if (leave) parts.push(`Left ${formatFieldTimestamp(leave.recordedAt)}`);
  if (travel && arrive) {
    const secs = Math.max(
      0,
      Math.round((Date.parse(arrive.recordedAt) - Date.parse(travel.recordedAt)) / 1000)
    );
    parts.push(`On route ${formatDuration(secs)}`);
  }
  return parts.join(" · ");
}

export { formatCurrency };
