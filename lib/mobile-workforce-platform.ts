/**
 * VYRON CORE Batch 12 — Mobile Workforce Platform data layer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError, shouldSuppressWorkspaceLoadError } from "@/lib/company-access";
import {
  captureBrowserGps,
  fetchFieldOperationsSnapshot,
  type FieldEventType,
  type FieldJob,
  type FieldJobEvent,
} from "@/lib/field-operations";

export const MOBILE_WORKFLOW_STEPS: FieldEventType[] = [
  "Start Day",
  "Start Travel",
  "Arrive Site",
  "Start Job",
  "Pause Job",
  "Resume Job",
  "Complete Job",
  "Leave Site",
  "End Day",
];

export type MobileEvidenceType =
  | "clock_in"
  | "clock_out"
  | "arrive_site"
  | "complete_job"
  | "incident"
  | "other";

export type MobileWorkforceTask = {
  id: string;
  companyId: string;
  assignedToEmployeeId: string;
  assignedByEmail: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
};

export type MobileWorkforceNotification = {
  id: string;
  companyId: string;
  employeeId: string | null;
  notificationType: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

export type MobileWorkforceEvidence = {
  id: string;
  evidenceType: string;
  photoUrl: string | null;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  jobId: string | null;
};

export type MobileWorkforceHub = {
  tablesAvailable: boolean;
  currentShift: {
    status: string;
    startedAt: string | null;
    shiftDate: string;
  } | null;
  assignedJobs: FieldJob[];
  todayTimeline: FieldJobEvent[];
  clockStatus: "clocked_in" | "clocked_out" | "unknown";
  lastClockEvent: string | null;
  leaveBalanceDays: number | null;
  tasks: MobileWorkforceTask[];
  notifications: MobileWorkforceNotification[];
  evidence: MobileWorkforceEvidence[];
  error: string | null;
};

const MOBILE_TABLES = [
  "mobile_workforce_evidence",
  "mobile_workforce_tasks",
  "mobile_workforce_notifications",
  "mobile_workforce_incidents",
] as const;

function isMobileMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    MOBILE_TABLES.some((t) => isSupabaseMissingTableError(error, t)) ||
    shouldSuppressWorkspaceLoadError(error)
  );
}

function rowToTask(row: Record<string, unknown>): MobileWorkforceTask {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    assignedToEmployeeId: String(row.assigned_to_employee_id),
    assignedByEmail: row.assigned_by_email ? String(row.assigned_by_email) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    priority: String(row.priority || "normal"),
    status: String(row.status || "pending"),
    dueAt: row.due_at ? String(row.due_at) : null,
    createdAt: String(row.created_at),
  };
}

function rowToNotification(row: Record<string, unknown>): MobileWorkforceNotification {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    notificationType: String(row.notification_type),
    title: String(row.title),
    body: row.body ? String(row.body) : null,
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  };
}

function rowToEvidence(row: Record<string, unknown>): MobileWorkforceEvidence {
  return {
    id: String(row.id),
    evidenceType: String(row.evidence_type),
    photoUrl: row.photo_url ? String(row.photo_url) : null,
    capturedAt: String(row.captured_at || row.created_at),
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    jobId: row.job_id ? String(row.job_id) : null,
  };
}

export function workflowProgressIndex(eventType: FieldEventType | null): number {
  if (!eventType) return -1;
  return MOBILE_WORKFLOW_STEPS.indexOf(eventType);
}

export function nextWorkflowStep(lastEvent: FieldEventType | null): FieldEventType | null {
  const idx = workflowProgressIndex(lastEvent);
  if (idx < 0) return "Start Day";
  if (idx >= MOBILE_WORKFLOW_STEPS.length - 1) return null;
  return MOBILE_WORKFLOW_STEPS[idx + 1];
}

export async function loadMobileWorkforceHub(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<MobileWorkforceHub> {
  const empty: MobileWorkforceHub = {
    tablesAvailable: false,
    currentShift: null,
    assignedJobs: [],
    todayTimeline: [],
    clockStatus: "unknown",
    lastClockEvent: null,
    leaveBalanceDays: null,
    tasks: [],
    notifications: [],
    evidence: [],
    error: null,
  };

  if (!companyId || !employeeId) {
    return { ...empty, error: "Company and employee required." };
  }

  const today = new Date().toISOString().slice(0, 10);
  const fieldSnapshot = await fetchFieldOperationsSnapshot(supabase, companyId);

  const [
    clockRes,
    shiftRes,
    leaveRes,
    tasksRes,
    notificationsRes,
    evidenceRes,
  ] = await Promise.all([
    supabase
      .from("clock_events")
      .select("event_type,event_time")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("event_time", { ascending: false })
      .limit(1),
    supabase
      .from("field_daily_shifts")
      .select("status,started_at,shift_date")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .eq("shift_date", today)
      .maybeSingle(),
    supabase
      .from("leave_balances_live")
      .select("days_due_live")
      .eq("employee_id", employeeId)
      .eq("leave_type", "annual_leave")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("mobile_workforce_tasks")
      .select("*")
      .eq("company_id", companyId)
      .eq("assigned_to_employee_id", employeeId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("mobile_workforce_notifications")
      .select("*")
      .eq("company_id", companyId)
      .or(`employee_id.is.null,employee_id.eq.${employeeId}`)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("mobile_workforce_evidence")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("captured_at", { ascending: false })
      .limit(20),
  ]);

  const tablesAvailable = !isMobileMissingTable(tasksRes.error);

  const assignments = fieldSnapshot.assignments.filter(
    (a) => a.employeeId === employeeId && a.status === "assigned"
  );
  const assignedJobIds = new Set(assignments.map((a) => a.jobId));
  const assignedJobs = fieldSnapshot.jobs.filter(
    (job) =>
      assignedJobIds.has(job.id) &&
      job.status !== "Completed" &&
      job.status !== "Cancelled"
  );

  const todayTimeline = fieldSnapshot.events
    .filter((e) => e.employeeId === employeeId && e.recordedAt.startsWith(today))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  let clockStatus: MobileWorkforceHub["clockStatus"] = "unknown";
  let lastClockEvent: string | null = null;
  if (!clockRes.error && clockRes.data?.[0]) {
    const row = clockRes.data[0] as { event_type: string; event_time: string };
    lastClockEvent = row.event_time;
    clockStatus = row.event_type === "clock_in" ? "clocked_in" : "clocked_out";
  }

  let currentShift: MobileWorkforceHub["currentShift"] = null;
  if (!shiftRes.error && shiftRes.data) {
    const s = shiftRes.data as { status: string; started_at: string | null; shift_date: string };
    currentShift = {
      status: s.status,
      startedAt: s.started_at,
      shiftDate: s.shift_date,
    };
  }

  let leaveBalanceDays: number | null = null;
  if (!leaveRes.error && leaveRes.data) {
    leaveBalanceDays = Number((leaveRes.data as { days_due_live: number }).days_due_live);
  }

  return {
    tablesAvailable,
    currentShift,
    assignedJobs,
    todayTimeline,
    clockStatus,
    lastClockEvent,
    leaveBalanceDays,
    tasks: tasksRes.error ? [] : (tasksRes.data || []).map((r) => rowToTask(r as Record<string, unknown>)),
    notifications: notificationsRes.error
      ? []
      : (notificationsRes.data || []).map((r) => rowToNotification(r as Record<string, unknown>)),
    evidence: evidenceRes.error
      ? []
      : (evidenceRes.data || []).map((r) => rowToEvidence(r as Record<string, unknown>)),
    error: fieldSnapshot.error,
  };
}

export async function saveMobilePhotoEvidence(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    evidenceType: MobileEvidenceType;
    jobId?: string | null;
    photoUrl: string;
    latitude?: number | null;
    longitude?: number | null;
    gpsAccuracy?: number | null;
    notes?: string | null;
  }
): Promise<{ ok: boolean; error: string | null; id: string | null }> {
  return flushOfflineEvidence(supabase, input);
}

export async function flushOfflineEvidence(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    evidenceType: MobileEvidenceType;
    jobId?: string | null;
    photoUrl: string | null;
    latitude?: number | null;
    longitude?: number | null;
    gpsAccuracy?: number | null;
    notes?: string | null;
  }
): Promise<{ ok: boolean; error: string | null; id: string | null }> {
  const { data, error } = await supabase
    .from("mobile_workforce_evidence")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      job_id: input.jobId || null,
      evidence_type: input.evidenceType,
      photo_url: input.photoUrl,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      gps_accuracy: input.gpsAccuracy ?? null,
      notes: input.notes || null,
      captured_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (isMobileMissingTable(error)) {
      return { ok: false, error: null, id: null };
    }
    return { ok: false, error: error.message, id: null };
  }

  return { ok: true, error: null, id: data?.id ? String(data.id) : null };
}

export async function createMobileTask(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    assignedToEmployeeId: string;
    assignedByEmail: string;
    title: string;
    description?: string;
    priority?: string;
    dueAt?: string | null;
  }
): Promise<{ task: MobileWorkforceTask | null; error: string | null }> {
  const { data, error } = await supabase
    .from("mobile_workforce_tasks")
    .insert({
      company_id: input.companyId,
      assigned_to_employee_id: input.assignedToEmployeeId,
      assigned_by_email: input.assignedByEmail,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority || "normal",
      status: "pending",
      due_at: input.dueAt || null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    if (isMobileMissingTable(error)) return { task: null, error: null };
    return { task: null, error: error.message };
  }

  const task = rowToTask(data as Record<string, unknown>);

  await supabase.from("mobile_workforce_notifications").insert({
    company_id: input.companyId,
    employee_id: input.assignedToEmployeeId,
    notification_type: "urgent_task",
    title: `New task: ${input.title}`,
    body: input.description || "You have a new mobile task.",
    metadata: { taskId: task.id },
  });

  return { task, error: null };
}

export async function respondToMobileTask(
  supabase: SupabaseClient,
  taskId: string,
  action: "accept" | "reject" | "complete"
): Promise<{ ok: boolean; error: string | null }> {
  const statusMap = {
    accept: "accepted",
    reject: "rejected",
    complete: "completed",
  } as const;

  const { error } = await supabase
    .from("mobile_workforce_tasks")
    .update({ status: statusMap[action], updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) {
    if (isMobileMissingTable(error)) return { ok: false, error: null };
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function markMobileNotificationRead(
  supabase: SupabaseClient,
  notificationId: string
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase
    .from("mobile_workforce_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    if (isMobileMissingTable(error)) return { ok: false, error: null };
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function submitMobileIncident(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    title: string;
    description: string;
    photoUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<{ ok: boolean; error: string | null; incidentId: string | null }> {
  const { data, error } = await supabase
    .from("mobile_workforce_incidents")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      title: input.title.trim(),
      description: input.description.trim(),
      photo_url: input.photoUrl || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      manager_notified: true,
    })
    .select("id")
    .single();

  if (error) {
    if (isMobileMissingTable(error)) {
      return { ok: false, error: null, incidentId: null };
    }
    return { ok: false, error: error.message, incidentId: null };
  }

  await supabase.from("mobile_workforce_notifications").insert({
    company_id: input.companyId,
    employee_id: null,
    notification_type: "incident_alert",
    title: `Incident: ${input.title}`,
    body: input.description.slice(0, 200),
    metadata: { incidentId: data?.id, employeeId: input.employeeId },
  });

  return {
    ok: true,
    error: null,
    incidentId: data?.id ? String(data.id) : null,
  };
}

export async function fetchEmployeeMobileDocuments(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<
  {
    id: string;
    title: string;
    category: string;
    status: string;
    createdAt: string;
  }[]
> {
  const [hrDocs, empDocs, warnings] = await Promise.all([
    supabase
      .from("hr_documents")
      .select("id,title,document_type,status,created_at")
      .eq("company_id", companyId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("employee_documents")
      .select("id,document_name,document_type,status,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("hr_warnings")
      .select("id,warning_type,status,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const docs: {
    id: string;
    title: string;
    category: string;
    status: string;
    createdAt: string;
  }[] = [];

  for (const row of hrDocs.data || []) {
    const r = row as Record<string, unknown>;
    docs.push({
      id: String(r.id),
      title: String(r.title || "HR Document"),
      category: "Policy",
      status: String(r.status || "active"),
      createdAt: String(r.created_at),
    });
  }

  for (const row of empDocs.data || []) {
    const r = row as Record<string, unknown>;
    docs.push({
      id: String(r.id),
      title: String(r.document_name || "Employee Document"),
      category: String(r.document_type || "Contract"),
      status: String(r.status || "active"),
      createdAt: String(r.created_at),
    });
  }

  for (const row of warnings.data || []) {
    const r = row as Record<string, unknown>;
    docs.push({
      id: String(r.id),
      title: `Warning: ${String(r.warning_type || "HR")}`,
      category: "Warning",
      status: String(r.status || "active"),
      createdAt: String(r.created_at),
    });
  }

  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function capturePhotoFromFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export { captureBrowserGps };
