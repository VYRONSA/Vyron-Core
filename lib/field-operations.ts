/**
 * VYRON CORE Phase 4A — Field Operations data layer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";

export const FIELD_JOB_STATUSES = [
  "Pending",
  "Dispatched",
  "Travelling",
  "On Site",
  "Completed",
  "Cancelled",
] as const;

export type FieldJobStatus = (typeof FIELD_JOB_STATUSES)[number];

export const FIELD_SITE_TYPES = [
  "fixed_site",
  "customer_address",
  "mobile_asset",
  "gps_location",
] as const;

export type FieldSiteType = (typeof FIELD_SITE_TYPES)[number];

export const FIELD_EVENT_TYPES = [
  "Start Day",
  "Start Travel",
  "Arrive Site",
  "Start Job",
  "Pause Job",
  "Resume Job",
  "Complete Job",
  "Leave Site",
  "End Day",
] as const;

export type FieldEventType = (typeof FIELD_EVENT_TYPES)[number];

export const FIELD_SITE_TYPE_LABELS: Record<FieldSiteType, string> = {
  fixed_site: "Fixed Site",
  customer_address: "Customer Address",
  mobile_asset: "Mobile Asset",
  gps_location: "GPS Location",
};

export type FieldJob = {
  id: string;
  companyId: string;
  jobRef: string;
  title: string;
  description: string | null;
  status: FieldJobStatus;
  siteType: FieldSiteType;
  storeId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  assetId: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  priority: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FieldJobAssignment = {
  id: string;
  companyId: string;
  jobId: string;
  employeeId: string;
  role: "primary" | "support";
  status: "assigned" | "released";
  assignedAt: string;
  releasedAt: string | null;
};

export type FieldJobEvent = {
  id: string;
  companyId: string;
  jobId: string | null;
  assignmentId: string | null;
  employeeId: string;
  eventType: FieldEventType;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  photoUrl: string | null;
  notes: string | null;
  deviceInfo: string | null;
};

export type FieldDailyShift = {
  id: string;
  companyId: string;
  employeeId: string;
  shiftDate: string;
  status: "not_started" | "active" | "completed";
  startedAt: string | null;
  endedAt: string | null;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  notes: string | null;
};

export type FieldAsset = {
  id: string;
  companyId: string;
  assetCode: string;
  assetNumber: string | null;
  name: string;
  assetType: string;
  serialNumber: string | null;
  status: string;
  currentLatitude: number | null;
  currentLongitude: number | null;
  assignedEmployeeId: string | null;
  assignedVehicleId: string | null;
  currentSite: string | null;
  notes: string | null;
};

export type FieldVehicle = {
  id: string;
  companyId: string;
  registration: string;
  makeModel: string;
  vehicleName: string | null;
  vehicleType: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelType: string | null;
  status: string;
  assignedEmployeeId: string | null;
  odometerKm: number | null;
  notes: string | null;
};

export type FieldOperationsSnapshot = {
  jobs: FieldJob[];
  assignments: FieldJobAssignment[];
  events: FieldJobEvent[];
  shifts: FieldDailyShift[];
  assets: FieldAsset[];
  vehicles: FieldVehicle[];
  tablesAvailable: boolean;
  error: string | null;
};

export type GpsCapture = {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};

export type RecordFieldEventInput = {
  companyId: string;
  employeeId: string;
  eventType: FieldEventType;
  jobId?: string | null;
  assignmentId?: string | null;
  gps?: GpsCapture;
  photoUrl?: string | null;
  notes?: string | null;
  deviceInfo?: string | null;
};

const FIELD_TABLES = [
  "field_jobs",
  "field_job_assignments",
  "field_job_events",
  "field_daily_shifts",
  "field_assets",
  "field_vehicles",
] as const;

function isFieldMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return FIELD_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToJob(row: Record<string, unknown>): FieldJob {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    jobRef: String(row.job_ref),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    status: row.status as FieldJobStatus,
    siteType: row.site_type as FieldSiteType,
    storeId: row.store_id ? String(row.store_id) : null,
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerAddress: row.customer_address ? String(row.customer_address) : null,
    assetId: row.asset_id ? String(row.asset_id) : null,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
    trailerId: row.trailer_id ? String(row.trailer_id) : null,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    scheduledStart: row.scheduled_start ? String(row.scheduled_start) : null,
    scheduledEnd: row.scheduled_end ? String(row.scheduled_end) : null,
    priority: String(row.priority || "normal"),
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToAssignment(row: Record<string, unknown>): FieldJobAssignment {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    jobId: String(row.job_id),
    employeeId: String(row.employee_id),
    role: (row.role === "support" ? "support" : "primary") as FieldJobAssignment["role"],
    status: row.status === "released" ? "released" : "assigned",
    assignedAt: String(row.assigned_at),
    releasedAt: row.released_at ? String(row.released_at) : null,
  };
}

function rowToEvent(row: Record<string, unknown>): FieldJobEvent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    jobId: row.job_id ? String(row.job_id) : null,
    assignmentId: row.assignment_id ? String(row.assignment_id) : null,
    employeeId: String(row.employee_id),
    eventType: row.event_type as FieldEventType,
    recordedAt: String(row.recorded_at),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    gpsAccuracy: num(row.gps_accuracy),
    photoUrl: row.photo_url ? String(row.photo_url) : null,
    notes: row.notes ? String(row.notes) : null,
    deviceInfo: row.device_info ? String(row.device_info) : null,
  };
}

function rowToShift(row: Record<string, unknown>): FieldDailyShift {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    employeeId: String(row.employee_id),
    shiftDate: String(row.shift_date).slice(0, 10),
    status:
      row.status === "active" || row.status === "completed"
        ? row.status
        : "not_started",
    startedAt: row.started_at ? String(row.started_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    startLatitude: num(row.start_latitude),
    startLongitude: num(row.start_longitude),
    endLatitude: num(row.end_latitude),
    endLongitude: num(row.end_longitude),
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToAsset(row: Record<string, unknown>): FieldAsset {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    assetCode: String(row.asset_code),
    assetNumber: row.asset_number ? String(row.asset_number) : String(row.asset_code || ""),
    name: String(row.name),
    assetType: String(row.asset_type || "equipment"),
    serialNumber: row.serial_number ? String(row.serial_number) : null,
    status: String(row.status || "available"),
    currentLatitude: num(row.current_latitude),
    currentLongitude: num(row.current_longitude),
    assignedEmployeeId: row.assigned_employee_id ? String(row.assigned_employee_id) : null,
    assignedVehicleId: row.assigned_vehicle_id ? String(row.assigned_vehicle_id) : null,
    currentSite: row.current_site ? String(row.current_site) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToVehicle(row: Record<string, unknown>): FieldVehicle {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    registration: String(row.registration),
    makeModel: String(row.make_model),
    vehicleName: row.vehicle_name ? String(row.vehicle_name) : null,
    vehicleType: row.vehicle_type ? String(row.vehicle_type) : null,
    vin: row.vin ? String(row.vin) : null,
    make: row.make ? String(row.make) : null,
    model: row.model ? String(row.model) : null,
    year: num(row.year),
    fuelType: row.fuel_type ? String(row.fuel_type) : null,
    status: String(row.status || "available"),
    assignedEmployeeId: row.assigned_employee_id ? String(row.assigned_employee_id) : null,
    odometerKm: num(row.odometer_km),
    notes: row.notes ? String(row.notes) : null,
  };
}

export function jobStatusClass(status: FieldJobStatus): string {
  if (status === "Completed") return "bg-emerald-100 text-emerald-800";
  if (status === "On Site") return "bg-cyan-100 text-cyan-900";
  if (status === "Travelling" || status === "Dispatched") return "bg-blue-100 text-blue-800";
  if (status === "Cancelled") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-900";
}

export function eventTypeClass(eventType: FieldEventType): string {
  if (eventType === "Complete Job" || eventType === "End Day") return "bg-emerald-100 text-emerald-800";
  if (eventType === "Pause Job") return "bg-amber-100 text-amber-900";
  if (eventType === "Start Travel" || eventType === "Arrive Site") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-800";
}

export function statusForEventType(eventType: FieldEventType): FieldJobStatus | null {
  switch (eventType) {
    case "Start Travel":
      return "Travelling";
    case "Arrive Site":
    case "Start Job":
    case "Pause Job":
    case "Resume Job":
      return "On Site";
    case "Complete Job":
      return "Completed";
    default:
      return null;
  }
}

export function generateFieldJobRef(existingRefs: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `FJ-${year}-`;
  const nums = existingRefs
    .filter((r) => r.startsWith(prefix))
    .map((r) => parseInt(r.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function fetchFieldOperationsSnapshot(
  supabase: SupabaseClient,
  companyId: string
): Promise<FieldOperationsSnapshot> {
  const empty: FieldOperationsSnapshot = {
    jobs: [],
    assignments: [],
    events: [],
    shifts: [],
    assets: [],
    vehicles: [],
    tablesAvailable: false,
    error: null,
  };

  if (!companyId) return empty;

  const [jobsRes, assignmentsRes, eventsRes, shiftsRes, assetsRes, vehiclesRes] =
    await Promise.all([
      supabase
        .from("field_jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("scheduled_start", { ascending: false, nullsFirst: false }),
      supabase.from("field_job_assignments").select("*").eq("company_id", companyId),
      supabase
        .from("field_job_events")
        .select("*")
        .eq("company_id", companyId)
        .order("recorded_at", { ascending: false })
        .limit(200),
      supabase
        .from("field_daily_shifts")
        .select("*")
        .eq("company_id", companyId)
        .order("shift_date", { ascending: false })
        .limit(60),
      supabase.from("field_assets").select("*").eq("company_id", companyId).order("name"),
      supabase.from("field_vehicles").select("*").eq("company_id", companyId).order("registration"),
    ]);

  const firstError =
    jobsRes.error ||
    assignmentsRes.error ||
    eventsRes.error ||
    shiftsRes.error ||
    assetsRes.error ||
    vehiclesRes.error;

  if (firstError) {
    if (isFieldMissingTableError(firstError)) {
      return empty;
    }
    return { ...empty, tablesAvailable: true, error: firstError.message };
  }

  const liveJobs = (jobsRes.data || []).filter((row) => {
    const status = (row as Record<string, unknown>).record_status;
    return status == null || String(status).toLowerCase() !== "deleted";
  });

  return {
    jobs: liveJobs.map((row) => rowToJob(row as Record<string, unknown>)),
    assignments: (assignmentsRes.data || []).map((row) =>
      rowToAssignment(row as Record<string, unknown>)
    ),
    events: (eventsRes.data || []).map((row) => rowToEvent(row as Record<string, unknown>)),
    shifts: (shiftsRes.data || []).map((row) => rowToShift(row as Record<string, unknown>)),
    assets: (assetsRes.data || []).map((row) => rowToAsset(row as Record<string, unknown>)),
    vehicles: (vehiclesRes.data || []).map((row) => rowToVehicle(row as Record<string, unknown>)),
    tablesAvailable: true,
    error: null,
  };
}

export type CreateFieldJobInput = {
  companyId: string;
  title: string;
  description?: string;
  siteType: FieldSiteType;
  storeId?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  assetId?: string | null;
  vehicleId?: string | null;
  trailerId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  priority?: string;
  notes?: string | null;
  employeeId?: string | null;
  existingJobRefs?: string[];
};

export async function createFieldJob(
  supabase: SupabaseClient,
  input: CreateFieldJobInput
): Promise<{ job: FieldJob | null; assignment: FieldJobAssignment | null; error: string | null }> {
  const jobRef = generateFieldJobRef(input.existingJobRefs || []);
  const now = new Date().toISOString();

  const { data: jobRow, error: jobError } = await supabase
    .from("field_jobs")
    .insert({
      company_id: input.companyId,
      job_ref: jobRef,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.employeeId ? "Dispatched" : "Pending",
      site_type: input.siteType,
      store_id: input.storeId || null,
      customer_name: input.customerName?.trim() || null,
      customer_address: input.customerAddress?.trim() || null,
      asset_id: input.assetId || null,
      vehicle_id: input.vehicleId || null,
      trailer_id: input.trailerId || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      scheduled_start: input.scheduledStart || null,
      scheduled_end: input.scheduledEnd || null,
      priority: input.priority || "normal",
      notes: input.notes?.trim() || null,
      updated_at: now,
    })
    .select("*")
    .single();

  if (jobError || !jobRow) {
    return { job: null, assignment: null, error: jobError?.message || "Failed to create job." };
  }

  const job = rowToJob(jobRow as Record<string, unknown>);

  if (!input.employeeId) {
    return { job, assignment: null, error: null };
  }

  const { data: assignmentRow, error: assignmentError } = await supabase
    .from("field_job_assignments")
    .insert({
      company_id: input.companyId,
      job_id: job.id,
      employee_id: input.employeeId,
      role: "primary",
      status: "assigned",
      updated_at: now,
    })
    .select("*")
    .single();

  if (assignmentError || !assignmentRow) {
    return {
      job,
      assignment: null,
      error: assignmentError?.message || "Job created but assignment failed.",
    };
  }

  return {
    job,
    assignment: rowToAssignment(assignmentRow as Record<string, unknown>),
    error: null,
  };
}

export async function updateFieldJobStatus(
  supabase: SupabaseClient,
  jobId: string,
  status: FieldJobStatus
): Promise<string | null> {
  const { error } = await supabase
    .from("field_jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  return error?.message || null;
}

export async function recordFieldJobEvent(
  supabase: SupabaseClient,
  input: RecordFieldEventInput
): Promise<{ event: FieldJobEvent | null; error: string | null }> {
  const { data, error } = await supabase
    .from("field_job_events")
    .insert({
      company_id: input.companyId,
      job_id: input.jobId ?? null,
      assignment_id: input.assignmentId ?? null,
      employee_id: input.employeeId,
      event_type: input.eventType,
      recorded_at: new Date().toISOString(),
      latitude: input.gps?.latitude ?? null,
      longitude: input.gps?.longitude ?? null,
      gps_accuracy: input.gps?.accuracy ?? null,
      photo_url: input.photoUrl ?? null,
      notes: input.notes?.trim() || null,
      device_info: input.deviceInfo ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { event: null, error: error?.message || "Failed to record event." };
  }

  const event = rowToEvent(data as Record<string, unknown>);

  if (input.jobId) {
    const nextStatus = statusForEventType(input.eventType);
    if (nextStatus) {
      await updateFieldJobStatus(supabase, input.jobId, nextStatus);
    }
  }

  if (input.eventType === "Start Day") {
    const shiftDate = new Date().toISOString().slice(0, 10);
    await supabase.from("field_daily_shifts").upsert(
      {
        company_id: input.companyId,
        employee_id: input.employeeId,
        shift_date: shiftDate,
        status: "active",
        started_at: event.recordedAt,
        start_latitude: input.gps?.latitude ?? null,
        start_longitude: input.gps?.longitude ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,employee_id,shift_date" }
    );
  }

  if (input.eventType === "End Day") {
    const shiftDate = new Date().toISOString().slice(0, 10);
    await supabase.from("field_daily_shifts").upsert(
      {
        company_id: input.companyId,
        employee_id: input.employeeId,
        shift_date: shiftDate,
        status: "completed",
        ended_at: event.recordedAt,
        end_latitude: input.gps?.latitude ?? null,
        end_longitude: input.gps?.longitude ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,employee_id,shift_date" }
    );
  }

  return { event, error: null };
}

export async function captureBrowserGps(): Promise<GpsCapture> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    return { latitude: null, longitude: null, accuracy: null };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => resolve({ latitude: null, longitude: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export function formatFieldTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function computeFieldOperationsMetrics(snapshot: FieldOperationsSnapshot) {
  const activeJobs = snapshot.jobs.filter(
    (job) => job.status !== "Completed" && job.status !== "Cancelled"
  );
  const onSite = snapshot.jobs.filter((job) => job.status === "On Site").length;
  const travelling = snapshot.jobs.filter((job) => job.status === "Travelling").length;
  const pending = snapshot.jobs.filter((job) => job.status === "Pending").length;
  const activeShifts = snapshot.shifts.filter((shift) => shift.status === "active").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = snapshot.events.filter((event) =>
    event.recordedAt.startsWith(today)
  ).length;

  return {
    totalJobs: snapshot.jobs.length,
    activeJobs: activeJobs.length,
    onSite,
    travelling,
    pending,
    activeShifts,
    todayEvents,
    assets: snapshot.assets.length,
    vehicles: snapshot.vehicles.length,
  };
}
