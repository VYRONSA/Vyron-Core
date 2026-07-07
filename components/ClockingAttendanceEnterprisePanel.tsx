"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  MapPin,
  RefreshCcw,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";
import {
  haversineDistanceMeters,
  validateMobileGpsRadius,
} from "@/lib/mobile-workforce-gps";
import {
  enqueueOfflineAction,
  flushOfflineQueue,
  getOfflineQueueStatus,
} from "@/lib/mobile-workforce-offline";

type ClockEventRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  store_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  latitude: number | null;
  longitude: number | null;
  clock_note?: string | null;
};

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  default_store_id: string | null;
  active: boolean;
};

type StoreRow = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
};

type ShiftRow = {
  id: string;
  employee_id: string;
  planned_start: string | null;
  planned_end: string | null;
  shift_date: string | null;
};

type TimeExceptionRow = {
  id: string;
  employee_id: string;
  exception_type: string;
  severity: string;
  status: string;
  description: string | null;
  created_at: string;
};

type GeofenceRow = {
  id: string;
  store_id: string | null;
  geofence_name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  status: string;
};

type AttendanceCorrectionRow = {
  id: string;
  employee_id: string;
  clock_event_id: string | null;
  correction_type: string;
  requested_event_time: string | null;
  requested_store_id: string | null;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  original_record: Record<string, unknown>;
  created_at: string;
};

type AttendanceReviewNoteRow = {
  id: string;
  note_scope: string;
  note_date: string;
  note_body: string;
  created_by: string | null;
  created_at: string;
};

type DeviceEventRow = {
  id: string;
  provider: string;
  ingestion_status: string;
  ingested_at: string;
};

type AttendanceSummary = {
  totalEmployees: number;
  clockedInNow: number;
  missingClockOut: number;
  absentToday: number;
  lateToday: number;
  overtimeToday: number;
  earlyDepartures: number;
  compliancePercent: number;
};

const LATE_GRACE_MINUTES = 10;
const EARLY_DEPARTURE_GRACE_MINUTES = 10;
const OVERTIME_GRACE_MINUTES = 20;

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function employeeName(employee: EmployeeRow | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function isClockIn(value: string | null | undefined) {
  const normalised = String(value || "").toLowerCase();
  return normalised === "clock_in" || normalised === "in";
}

function isClockOut(value: string | null | undefined) {
  const normalised = String(value || "").toLowerCase();
  return normalised === "clock_out" || normalised === "out";
}

function dateOnly(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function toMs(iso: string | null | undefined) {
  if (!iso) return NaN;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : NaN;
}

function startOfDayIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function endOfDayIso() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function withinLastDays(iso: string | null | undefined, days: number) {
  const ms = toMs(iso);
  if (!Number.isFinite(ms)) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms >= cutoff;
}

function computeSummary(params: {
  employees: EmployeeRow[];
  events: ClockEventRow[];
  shifts: ShiftRow[];
}) {
  const { employees, events, shifts } = params;
  const byEmployee = new Map<string, ClockEventRow[]>();

  for (const event of events) {
    if (!byEmployee.has(event.employee_id)) byEmployee.set(event.employee_id, []);
    byEmployee.get(event.employee_id)?.push(event);
  }

  const shiftByEmployee = new Map<string, ShiftRow>();
  for (const shift of shifts) {
    if (!shift.employee_id) continue;
    if (!shiftByEmployee.has(shift.employee_id)) {
      shiftByEmployee.set(shift.employee_id, shift);
    }
  }

  let clockedInNow = 0;
  let missingClockOut = 0;
  let absentToday = 0;
  let lateToday = 0;
  let overtimeToday = 0;
  let earlyDepartures = 0;

  for (const employee of employees) {
    const employeeEvents = (byEmployee.get(employee.id) || []).sort(
      (a, b) => toMs(a.event_time) - toMs(b.event_time)
    );

    const shift = shiftByEmployee.get(employee.id);

    if (employeeEvents.length === 0) {
      absentToday += 1;
      continue;
    }

    const lastEvent = employeeEvents[employeeEvents.length - 1];
    if (isClockIn(lastEvent.event_type)) {
      clockedInNow += 1;
      missingClockOut += 1;
    }

    const firstIn = employeeEvents.find((event) => isClockIn(event.event_type));
    const lastOut = [...employeeEvents].reverse().find((event) => isClockOut(event.event_type));

    const plannedStartMs = toMs(shift?.planned_start || null);
    const plannedEndMs = toMs(shift?.planned_end || null);

    if (firstIn && Number.isFinite(plannedStartMs)) {
      const lateMinutes = Math.max(0, Math.round((toMs(firstIn.event_time) - plannedStartMs) / 60000));
      if (lateMinutes > LATE_GRACE_MINUTES) {
        lateToday += 1;
      }
    }

    if (lastOut && Number.isFinite(plannedEndMs)) {
      const diffMinutes = Math.round((toMs(lastOut.event_time) - plannedEndMs) / 60000);
      if (diffMinutes < -EARLY_DEPARTURE_GRACE_MINUTES) {
        earlyDepartures += 1;
      }
      if (diffMinutes > OVERTIME_GRACE_MINUTES) {
        overtimeToday += 1;
      }
    }
  }

  const totalEmployees = employees.length;
  const compliantEmployees = Math.max(
    0,
    totalEmployees - lateToday - absentToday - missingClockOut
  );

  const compliancePercent =
    totalEmployees > 0 ? Math.round((compliantEmployees / totalEmployees) * 1000) / 10 : 0;

  return {
    totalEmployees,
    clockedInNow,
    missingClockOut,
    absentToday,
    lateToday,
    overtimeToday,
    earlyDepartures,
    compliancePercent,
  };
}

function Sparkline({ values }: { values: number[] }) {
  const width = 180;
  const height = 50;
  const safe = values.length ? values : [0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const span = Math.max(1, max - min);

  const points = safe
    .map((value, index) => {
      const x = (index / Math.max(1, safe.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        points={points}
        className="text-cyan-600"
      />
    </svg>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalised = value.toLowerCase();
  const tone =
    normalised === "approved" || normalised === "verified"
      ? "bg-emerald-100 text-emerald-700"
      : normalised === "pending" || normalised === "manager_review"
      ? "bg-amber-100 text-amber-700"
      : normalised === "rejected" || normalised === "outside_radius"
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${tone}`}>
      {formatText(value)}
    </span>
  );
}

function KpiCard({
  title,
  value,
  helper,
  tone,
  icon,
}: {
  title: string;
  value: string;
  helper: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-[28px] border p-5 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">{title}</div>
        {icon}
      </div>
      <div className="mt-3 text-4xl font-black">{value}</div>
      <div className="mt-2 text-sm font-semibold opacity-80">{helper}</div>
    </div>
  );
}

export default function ClockingAttendanceEnterprisePanel({
  companyId: companyIdProp,
}: {
  companyId?: string;
}) {
  const [companyId, setCompanyId] = useState(companyIdProp || "");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [events, setEvents] = useState<ClockEventRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [exceptions, setExceptions] = useState<TimeExceptionRow[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrectionRow[]>([]);
  const [reviewNotes, setReviewNotes] = useState<AttendanceReviewNoteRow[]>([]);
  const [geofences, setGeofences] = useState<GeofenceRow[]>([]);
  const [deviceEvents, setDeviceEvents] = useState<DeviceEventRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedClockEventId, setSelectedClockEventId] = useState("");
  const [requestedEventTime, setRequestedEventTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionType, setCorrectionType] = useState<"clock_in" | "clock_out">("clock_in");

  const [newGeofenceStoreId, setNewGeofenceStoreId] = useState("");
  const [newGeofenceName, setNewGeofenceName] = useState("");
  const [newGeofenceLatitude, setNewGeofenceLatitude] = useState("");
  const [newGeofenceLongitude, setNewGeofenceLongitude] = useState("");
  const [newGeofenceRadius, setNewGeofenceRadius] = useState("150");

  const [reviewScope, setReviewScope] = useState<"daily" | "weekly">("daily");
  const [reviewDate, setReviewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reviewNoteBody, setReviewNoteBody] = useState("");

  const [bulkTargetStatus, setBulkTargetStatus] = useState<"approved" | "rejected">("approved");

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const storeMap = useMemo(() => {
    const map = new Map<string, StoreRow>();
    stores.forEach((store) => map.set(store.id, store));
    return map;
  }, [stores]);

  const todaySummary = useMemo<AttendanceSummary>(() => {
    return computeSummary({
      employees,
      events,
      shifts,
    });
  }, [employees, events, shifts]);

  const timelineRows = useMemo(() => {
    return [...events]
      .sort((a, b) => toMs(b.event_time) - toMs(a.event_time))
      .slice(0, 60);
  }, [events]);

  const pendingCorrections = useMemo(
    () => corrections.filter((item) => item.status === "pending"),
    [corrections]
  );

  const recentExceptions = useMemo(
    () => exceptions.filter((item) => withinLastDays(item.created_at, 14)).slice(0, 40),
    [exceptions]
  );

  const analyticsSeries = useMemo(() => {
    const daily = new Map<string, { late: number; absent: number; overtime: number }>();

    const today = new Date();
    const days: string[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      days.push(key);
      daily.set(key, { late: 0, absent: 0, overtime: 0 });
    }

    const shiftsByEmployeeDay = new Map<string, ShiftRow>();
    for (const shift of shifts) {
      const key = `${shift.employee_id}_${dateOnly(shift.shift_date || shift.planned_start || "")}`;
      if (!shiftsByEmployeeDay.has(key)) shiftsByEmployeeDay.set(key, shift);
    }

    const eventsByEmployeeDay = new Map<string, ClockEventRow[]>();
    for (const event of events) {
      const key = `${event.employee_id}_${dateOnly(event.event_time)}`;
      if (!eventsByEmployeeDay.has(key)) eventsByEmployeeDay.set(key, []);
      eventsByEmployeeDay.get(key)?.push(event);
    }

    for (const day of days) {
      for (const employee of employees) {
        const employeeDayKey = `${employee.id}_${day}`;
        const employeeEvents = (eventsByEmployeeDay.get(employeeDayKey) || []).sort(
          (a, b) => toMs(a.event_time) - toMs(b.event_time)
        );

        const shift = shiftsByEmployeeDay.get(employeeDayKey);

        if (!employeeEvents.length) {
          daily.get(day)!.absent += 1;
          continue;
        }

        const firstIn = employeeEvents.find((event) => isClockIn(event.event_type));
        const lastOut = [...employeeEvents].reverse().find((event) => isClockOut(event.event_type));

        const startMs = toMs(shift?.planned_start || null);
        const endMs = toMs(shift?.planned_end || null);

        if (firstIn && Number.isFinite(startMs)) {
          const lateMinutes = Math.max(0, Math.round((toMs(firstIn.event_time) - startMs) / 60000));
          if (lateMinutes > LATE_GRACE_MINUTES) {
            daily.get(day)!.late += 1;
          }
        }

        if (lastOut && Number.isFinite(endMs)) {
          const overtimeMinutes = Math.round((toMs(lastOut.event_time) - endMs) / 60000);
          if (overtimeMinutes > OVERTIME_GRACE_MINUTES) {
            daily.get(day)!.overtime += 1;
          }
        }
      }
    }

    const late = days.map((day) => daily.get(day)?.late || 0);
    const absent = days.map((day) => daily.get(day)?.absent || 0);
    const overtime = days.map((day) => daily.get(day)?.overtime || 0);

    return { days, late, absent, overtime };
  }, [employees, events, shifts]);

  const offlineStatus = useMemo(() => getOfflineQueueStatus(), [events.length, corrections.length]);

  useEffect(() => {
    let cancelled = false;

    async function resolveCompany() {
      if (companyIdProp) {
        if (!cancelled) setCompanyId(companyIdProp);
        return;
      }

      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        return;
      }

      setCompanyId(access.company_id);
    }

    resolveCompany();

    return () => {
      cancelled = true;
    };
  }, [companyIdProp]);

  useEffect(() => {
    if (!companyId) return;
    void loadAll(companyId);
  }, [companyId]);

  async function loadAll(activeCompanyId: string) {
    setLoading(true);
    setError(null);

    const [
      employeesRes,
      storesRes,
      eventsRes,
      shiftsRes,
      exceptionsRes,
      correctionsRes,
      notesRes,
      geofencesRes,
      deviceEventsRes,
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name,default_store_id,active")
        .eq("company_id", activeCompanyId)
        .eq("active", true)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name,latitude,longitude")
        .eq("company_id", activeCompanyId)
        .order("name", { ascending: true }),
      supabase
        .from("clock_events")
        .select("id,company_id,employee_id,store_id,event_type,event_time,source,latitude,longitude,clock_note")
        .eq("company_id", activeCompanyId)
        .gte("event_time", startOfDayIso())
        .lte("event_time", endOfDayIso())
        .order("event_time", { ascending: false })
        .limit(1200),
      supabase
        .from("roster_shifts")
        .select("id,employee_id,planned_start,planned_end,shift_date")
        .eq("company_id", activeCompanyId)
        .or(`shift_date.eq.${new Date().toISOString().slice(0, 10)},planned_start.gte.${startOfDayIso()}`)
        .order("planned_start", { ascending: true })
        .limit(1200),
      supabase
        .from("time_exceptions")
        .select("id,employee_id,exception_type,severity,status,description,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("attendance_corrections")
        .select("id,employee_id,clock_event_id,correction_type,requested_event_time,requested_store_id,reason,status,reviewed_by,reviewed_at,review_notes,original_record,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("attendance_review_notes")
        .select("id,note_scope,note_date,note_body,created_by,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(150),
      supabase
        .from("attendance_geofences")
        .select("id,store_id,geofence_name,latitude,longitude,radius_meters,status")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("attendance_device_events")
        .select("id,provider,ingestion_status,ingested_at")
        .eq("company_id", activeCompanyId)
        .order("ingested_at", { ascending: false })
        .limit(150),
    ]);

    const firstError = [
      employeesRes.error,
      storesRes.error,
      eventsRes.error,
      shiftsRes.error,
      exceptionsRes.error,
      correctionsRes.error,
      notesRes.error,
      geofencesRes.error,
      deviceEventsRes.error,
    ].find(Boolean);

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setEmployees((employeesRes.data || []) as EmployeeRow[]);
    setStores((storesRes.data || []) as StoreRow[]);
    setEvents((eventsRes.data || []) as ClockEventRow[]);
    setShifts((shiftsRes.data || []) as ShiftRow[]);
    setExceptions((exceptionsRes.data || []) as TimeExceptionRow[]);
    setCorrections((correctionsRes.data || []) as AttendanceCorrectionRow[]);
    setReviewNotes((notesRes.data || []) as AttendanceReviewNoteRow[]);
    setGeofences((geofencesRes.data || []) as GeofenceRow[]);
    setDeviceEvents((deviceEventsRes.data || []) as DeviceEventRow[]);

    setLoading(false);
  }

  async function requestCorrection() {
    if (!companyId) return;

    setMessage(null);
    setError(null);

    if (!selectedEmployeeId || !selectedClockEventId || !correctionReason.trim() || !requestedEventTime) {
      setError("Select employee, event, requested time and reason before submitting correction.");
      return;
    }

    const linkedEvent = events.find((event) => event.id === selectedClockEventId);

    const { data: createdCorrection, error: createError } = await supabase
      .from("attendance_corrections")
      .insert({
        company_id: companyId,
        employee_id: selectedEmployeeId,
        clock_event_id: selectedClockEventId,
        correction_type: correctionType,
        requested_event_time: new Date(requestedEventTime).toISOString(),
        requested_store_id: linkedEvent?.store_id || null,
        reason: correctionReason.trim(),
        status: "pending",
        original_record: linkedEvent || {},
      })
      .select("id")
      .single();

    if (createError) {
      setError(createError.message);
      return;
    }

    await supabase.from("attendance_correction_audit").insert({
      company_id: companyId,
      correction_id: createdCorrection?.id,
      action: "requested",
      action_by: "ui",
      details: {
        employee_id: selectedEmployeeId,
        clock_event_id: selectedClockEventId,
        correction_type: correctionType,
      },
    });

    setMessage("Correction request submitted.");
    setCorrectionReason("");
    setRequestedEventTime("");
    await loadAll(companyId);
  }

  async function reviewCorrection(correctionId: string, status: "approved" | "rejected") {
    if (!companyId) return;

    setMessage(null);
    setError(null);

    const correction = corrections.find((item) => item.id === correctionId);
    if (!correction) return;

    const { error: updateError } = await supabase
      .from("attendance_corrections")
      .update({
        status,
        reviewed_by: "ui",
        reviewed_at: new Date().toISOString(),
        review_notes:
          status === "approved"
            ? "Approved by supervisor review workflow"
            : "Rejected by supervisor review workflow",
      })
      .eq("id", correctionId)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (status === "approved" && correction.clock_event_id && correction.requested_event_time) {
      const { error: clockUpdateError } = await supabase
        .from("clock_events")
        .update({
          event_time: correction.requested_event_time,
          clock_note: `Corrected via attendance workflow (${new Date().toISOString()})`,
        })
        .eq("id", correction.clock_event_id)
        .eq("company_id", companyId);

      if (clockUpdateError) {
        setError(clockUpdateError.message);
        return;
      }
    }

    await supabase.from("attendance_correction_audit").insert({
      company_id: companyId,
      correction_id: correctionId,
      action: status,
      action_by: "ui",
      details: {
        reviewed_at: new Date().toISOString(),
      },
    });

    setMessage(`Correction ${status}.`);
    await loadAll(companyId);
  }

  async function bulkReview(status: "approved" | "rejected") {
    if (!companyId) return;
    const pendingIds = pendingCorrections.map((item) => item.id);
    if (!pendingIds.length) {
      setError("No pending corrections to review.");
      return;
    }

    const { error: updateError } = await supabase
      .from("attendance_corrections")
      .update({
        status,
        reviewed_by: "ui-bulk",
        reviewed_at: new Date().toISOString(),
        review_notes: `Bulk ${status}`,
      })
      .in("id", pendingIds)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await supabase.from("attendance_correction_audit").insert(
      pendingIds.map((id) => ({
        company_id: companyId,
        correction_id: id,
        action: `bulk_${status}`,
        action_by: "ui-bulk",
        details: {
          reviewed_at: new Date().toISOString(),
        },
      }))
    );

    setMessage(`Bulk ${status} completed for ${pendingIds.length} request(s).`);
    await loadAll(companyId);
  }

  async function saveReviewNote() {
    if (!companyId) return;

    setMessage(null);
    setError(null);

    if (!reviewNoteBody.trim()) {
      setError("Enter review notes before saving.");
      return;
    }

    const { error: noteError } = await supabase.from("attendance_review_notes").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId || null,
      note_scope: reviewScope,
      note_date: reviewDate,
      note_body: reviewNoteBody.trim(),
      created_by: "ui",
    });

    if (noteError) {
      setError(noteError.message);
      return;
    }

    setReviewNoteBody("");
    setMessage("Supervisor review note saved.");
    await loadAll(companyId);
  }

  async function addGeofence() {
    if (!companyId) return;

    setMessage(null);
    setError(null);

    if (
      !newGeofenceStoreId ||
      !newGeofenceName.trim() ||
      !newGeofenceLatitude.trim() ||
      !newGeofenceLongitude.trim()
    ) {
      setError("Store, geofence name, latitude and longitude are required.");
      return;
    }

    const latitude = Number(newGeofenceLatitude);
    const longitude = Number(newGeofenceLongitude);
    const radius = Number(newGeofenceRadius || "150");

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius)) {
      setError("Latitude, longitude and radius must be valid numbers.");
      return;
    }

    const { error: insertError } = await supabase.from("attendance_geofences").insert({
      company_id: companyId,
      geofence_type: "store",
      store_id: newGeofenceStoreId,
      geofence_name: newGeofenceName.trim(),
      latitude,
      longitude,
      radius_meters: Math.max(20, Math.round(radius)),
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewGeofenceName("");
    setNewGeofenceLatitude("");
    setNewGeofenceLongitude("");
    setNewGeofenceRadius("150");
    setMessage("Geofence saved.");
    await loadAll(companyId);
  }

  async function runGpsAudit() {
    if (!companyId) return;

    setMessage(null);
    setError(null);

    const todayClockIns = events.filter((event) => isClockIn(event.event_type));

    if (!todayClockIns.length) {
      setError("No clock-ins available for GPS audit today.");
      return;
    }

    let audited = 0;

    for (const event of todayClockIns.slice(0, 60)) {
      const store = event.store_id ? storeMap.get(event.store_id) : null;
      if (
        !store ||
        store.latitude == null ||
        store.longitude == null ||
        event.latitude == null ||
        event.longitude == null
      ) {
        continue;
      }

      const selectedZone = geofences.find(
        (zone) => zone.store_id === event.store_id && zone.status === "active"
      );

      await validateMobileGpsRadius(supabase, {
        companyId,
        employeeId: event.employee_id,
        employeeLat: Number(event.latitude),
        employeeLng: Number(event.longitude),
        siteLat: Number(selectedZone?.latitude ?? store.latitude),
        siteLng: Number(selectedZone?.longitude ?? store.longitude),
        radiusMeters: Number(selectedZone?.radius_meters ?? 150),
        storeId: event.store_id,
        referenceType: "clock_event",
        createException: true,
      });

      audited += 1;
    }

    setMessage(`GPS audit completed for ${audited} clock-in event(s).`);
    await loadAll(companyId);
  }

  async function syncOfflineNow() {
    setSyncing(true);
    setError(null);
    setMessage(null);

    const result = await flushOfflineQueue(supabase);

    if (result.failed > 0) {
      setError(`Offline sync completed with ${result.failed} failed item(s).`);
    } else {
      setMessage(`Offline sync completed: ${result.synced} action(s) synced.`);
    }

    setSyncing(false);
  }

  async function queueSampleOfflineAction() {
    if (!companyId || !selectedEmployeeId) {
      setError("Select employee first to queue offline action.");
      return;
    }

    const employee = employeeMap.get(selectedEmployeeId);

    enqueueOfflineAction({
      type: "clock_in",
      companyId,
      employeeId: selectedEmployeeId,
      payload: {
        storeId: employee?.default_store_id || null,
        eventTime: new Date().toISOString(),
        notes: "Queued from enterprise attendance panel",
        latitude: null,
        longitude: null,
      },
    });

    setMessage("Offline queue test action added.");
  }

  async function ingestDeviceEvent() {
    if (!companyId) return;

    const payload = {
      provider: "device_connector",
      external_event_id: `dev-${Date.now()}`,
      raw_payload: {
        terminal: "demo-terminal-01",
        event: "clock_in",
        captured_at: new Date().toISOString(),
      },
      normalized_payload: {
        employee_id: selectedEmployeeId || null,
        event_type: "clock_in",
      },
      ingestion_status: "received",
    };

    const { error: insertError } = await supabase.from("attendance_device_events").insert({
      company_id: companyId,
      ...payload,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Device-ingestion event recorded.");
    await loadAll(companyId);
  }

  const todayStoreDistanceVariance = useMemo(() => {
    const values: number[] = [];

    for (const event of events) {
      if (!event.store_id || event.latitude == null || event.longitude == null) continue;
      const store = storeMap.get(event.store_id);
      if (!store || store.latitude == null || store.longitude == null) continue;

      const distance = haversineDistanceMeters(
        Number(event.latitude),
        Number(event.longitude),
        Number(store.latitude),
        Number(store.longitude)
      );
      values.push(Math.round(distance));
    }

    if (!values.length) return { avg: 0, max: 0 };

    const avg = Math.round(values.reduce((sum, item) => sum + item, 0) / values.length);
    const max = Math.max(...values);
    return { avg, max };
  }, [events, storeMap]);

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">VYRON ATTENDANCE</div>
            <h2 className="mt-3 text-4xl font-bold">Clocking & Attendance Excellence</h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
              Enterprise attendance controls layered on top of existing clocking: live dashboard,
              shift compliance, correction approvals, geofence zones, exception coverage,
              supervisor review, offline sync and device-ingestion readiness.
            </p>
          </div>

          <button
            onClick={() => companyId && loadAll(companyId)}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </section>
      )}

      {message && (
        <section className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {message}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard
          title="Employees"
          value={String(todaySummary.totalEmployees)}
          helper="Active workforce"
          tone="border-slate-200 bg-white text-slate-950"
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          title="Clocked In"
          value={String(todaySummary.clockedInNow)}
          helper="Live now"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <KpiCard
          title="Absent"
          value={String(todaySummary.absentToday)}
          helper="No events today"
          tone="border-rose-200 bg-rose-50 text-rose-900"
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          title="Late"
          value={String(todaySummary.lateToday)}
          helper={`Grace ${LATE_GRACE_MINUTES}m`}
          tone="border-amber-200 bg-amber-50 text-amber-900"
          icon={<Timer className="h-5 w-5" />}
        />
        <KpiCard
          title="Missing Out"
          value={String(todaySummary.missingClockOut)}
          helper="Still clocked in"
          tone="border-red-200 bg-red-50 text-red-900"
          icon={<Clock3 className="h-5 w-5" />}
        />
        <KpiCard
          title="Early Depart"
          value={String(todaySummary.earlyDepartures)}
          helper={`Before end > ${EARLY_DEPARTURE_GRACE_MINUTES}m`}
          tone="border-orange-200 bg-orange-50 text-orange-900"
          icon={<Timer className="h-5 w-5" />}
        />
        <KpiCard
          title="Overtime"
          value={String(todaySummary.overtimeToday)}
          helper={`After shift > ${OVERTIME_GRACE_MINUTES}m`}
          tone="border-violet-200 bg-violet-50 text-violet-900"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          title="Compliance"
          value={`${todaySummary.compliancePercent}%`}
          helper="Shift compliance"
          tone="border-cyan-200 bg-cyan-50 text-cyan-900"
          icon={<Gauge className="h-5 w-5" />}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Trend Analytics</div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">Attendance Variance (14 days)</h3>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Late Trend</div>
              <div className="mt-3 text-2xl font-black text-slate-950">
                {analyticsSeries.late[analyticsSeries.late.length - 1] || 0}
              </div>
              <Sparkline values={analyticsSeries.late} />
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Absence Trend</div>
              <div className="mt-3 text-2xl font-black text-slate-950">
                {analyticsSeries.absent[analyticsSeries.absent.length - 1] || 0}
              </div>
              <Sparkline values={analyticsSeries.absent} />
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Overtime Trend</div>
              <div className="mt-3 text-2xl font-black text-slate-950">
                {analyticsSeries.overtime[analyticsSeries.overtime.length - 1] || 0}
              </div>
              <Sparkline values={analyticsSeries.overtime} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-cyan-50 p-4 text-cyan-900">
              <div className="text-xs font-black uppercase tracking-[0.18em]">GPS Variance Avg</div>
              <div className="mt-2 text-2xl font-black">{todayStoreDistanceVariance.avg}m</div>
            </div>
            <div className="rounded-2xl bg-rose-50 p-4 text-rose-900">
              <div className="text-xs font-black uppercase tracking-[0.18em]">GPS Variance Max</div>
              <div className="mt-2 text-2xl font-black">{todayStoreDistanceVariance.max}m</div>
            </div>
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Mobile Resilience</div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">Offline & Device Ingestion</h3>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Offline Queue</div>
              <div className="mt-2 text-lg font-black text-slate-950">{offlineStatus.pending} pending</div>
              <div className="text-xs font-semibold text-slate-500">
                Last sync: {formatDateTime(offlineStatus.lastSync)}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Device Events</div>
              <div className="mt-2 text-lg font-black text-slate-950">{deviceEvents.length} received</div>
              <div className="text-xs font-semibold text-slate-500">
                Latest: {formatDateTime(deviceEvents[0]?.ingested_at || null)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <button
              onClick={syncOfflineNow}
              disabled={syncing}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-cyan-300"
            >
              {syncing ? "Syncing..." : "Run Offline Sync"}
            </button>
            <button
              onClick={queueSampleOfflineAction}
              className="rounded-2xl bg-cyan-100 px-4 py-3 text-sm font-black text-cyan-900"
            >
              Queue Test Offline Action
            </button>
            <button
              onClick={ingestDeviceEvent}
              className="rounded-2xl bg-indigo-100 px-4 py-3 text-sm font-black text-indigo-900"
            >
              Insert Device Ingestion Event
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Corrections</div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">Attendance Correction Workflow</h3>

          <div className="mt-5 grid gap-3">
            <label className="text-sm font-black text-slate-700">
              Employee
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employeeName(employee)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              Clock Event
              <select
                value={selectedClockEventId}
                onChange={(event) => setSelectedClockEventId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
              >
                <option value="">Select event</option>
                {events
                  .filter((event) => !selectedEmployeeId || event.employee_id === selectedEmployeeId)
                  .slice(0, 120)
                  .map((event) => (
                    <option key={event.id} value={event.id}>
                      {employeeName(employeeMap.get(event.employee_id))} · {formatText(event.event_type)} · {formatDateTime(event.event_time)}
                    </option>
                  ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-black text-slate-700">
                Correction Type
                <select
                  value={correctionType}
                  onChange={(event) => setCorrectionType(event.target.value as "clock_in" | "clock_out")}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                >
                  <option value="clock_in">Clock In</option>
                  <option value="clock_out">Clock Out</option>
                </select>
              </label>

              <label className="text-sm font-black text-slate-700">
                Requested Time
                <input
                  value={requestedEventTime}
                  onChange={(event) => setRequestedEventTime(event.target.value)}
                  type="datetime-local"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>
            </div>

            <label className="text-sm font-black text-slate-700">
              Reason
              <textarea
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
              />
            </label>

            <button
              onClick={requestCorrection}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-cyan-300"
            >
              Submit Correction Request
            </button>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-slate-900">Pending approvals: {pendingCorrections.length}</div>
              <div className="flex gap-2">
                <select
                  value={bulkTargetStatus}
                  onChange={(event) => setBulkTargetStatus(event.target.value as "approved" | "rejected")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black"
                >
                  <option value="approved">Approve all pending</option>
                  <option value="rejected">Reject all pending</option>
                </select>
                <button
                  onClick={() => bulkReview(bulkTargetStatus)}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-cyan-300"
                >
                  Run Bulk Action
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {pendingCorrections.slice(0, 20).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-black text-slate-900">
                      {employeeName(employeeMap.get(item.employee_id))} · {formatText(item.correction_type)}
                    </div>
                    <StatusPill value={item.status} />
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Requested: {formatDateTime(item.requested_event_time)}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{item.reason}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => reviewCorrection(item.id, "approved")}
                      className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reviewCorrection(item.id, "rejected")}
                      className="rounded-xl bg-rose-100 px-3 py-2 text-xs font-black text-rose-800"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Geofence & Review</div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">Multi-Zone Geofence + Supervisor Notes</h3>

          <div className="mt-5 grid gap-3">
            <label className="text-sm font-black text-slate-700">
              Store
              <select
                value={newGeofenceStoreId}
                onChange={(event) => setNewGeofenceStoreId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
              >
                <option value="">Select store</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-black text-slate-700">
                Geofence Name
                <input
                  value={newGeofenceName}
                  onChange={(event) => setNewGeofenceName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>

              <label className="text-sm font-black text-slate-700">
                Radius (m)
                <input
                  value={newGeofenceRadius}
                  onChange={(event) => setNewGeofenceRadius(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-black text-slate-700">
                Latitude
                <input
                  value={newGeofenceLatitude}
                  onChange={(event) => setNewGeofenceLatitude(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>

              <label className="text-sm font-black text-slate-700">
                Longitude
                <input
                  value={newGeofenceLongitude}
                  onChange={(event) => setNewGeofenceLongitude(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <button
                onClick={addGeofence}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-cyan-300"
              >
                Add Geofence Zone
              </button>
              <button
                onClick={runGpsAudit}
                className="rounded-2xl bg-cyan-100 px-4 py-3 text-sm font-black text-cyan-900"
              >
                Run Geofence Audit
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-900">Active zones: {geofences.length}</div>
            <div className="mt-2 space-y-2">
              {geofences.slice(0, 20).map((zone) => (
                <div key={zone.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-black text-slate-900">
                      <MapPin className="mr-1 inline h-4 w-4" />
                      {zone.geofence_name}
                    </div>
                    <StatusPill value={zone.status} />
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {storeMap.get(zone.store_id || "")?.name || "No store"} · {zone.radius_meters}m
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-900">Supervisor Daily / Weekly Review</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-black text-slate-700">
                Scope
                <select
                  value={reviewScope}
                  onChange={(event) => setReviewScope(event.target.value as "daily" | "weekly")}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>

              <label className="text-sm font-black text-slate-700">
                Date
                <input
                  value={reviewDate}
                  onChange={(event) => setReviewDate(event.target.value)}
                  type="date"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
                />
              </label>
            </div>

            <label className="mt-3 block text-sm font-black text-slate-700">
              Review Note
              <textarea
                value={reviewNoteBody}
                onChange={(event) => setReviewNoteBody(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold"
              />
            </label>

            <button
              onClick={saveReviewNote}
              className="mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-cyan-300"
            >
              Save Supervisor Note
            </button>

            <div className="mt-3 space-y-2">
              {reviewNotes.slice(0, 10).map((note) => (
                <div key={note.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill value={note.note_scope} />
                    <div className="text-xs font-semibold text-slate-500">{formatDate(note.note_date)}</div>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-600">{note.note_body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Timeline & Exceptions</div>
        <h3 className="mt-2 text-2xl font-bold text-slate-950">Richer Attendance Timeline</h3>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            {loading ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                Loading timeline...
              </div>
            ) : timelineRows.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                No attendance timeline entries for today.
              </div>
            ) : (
              timelineRows.map((event) => {
                const emp = employeeMap.get(event.employee_id);
                const store = event.store_id ? storeMap.get(event.store_id) : null;
                const hasGps = event.latitude != null && event.longitude != null;
                const sourceTone =
                  event.source === "mobile_offline"
                    ? "bg-amber-100 text-amber-800"
                    : event.source === "kiosk"
                    ? "bg-cyan-100 text-cyan-800"
                    : "bg-slate-100 text-slate-700";

                return (
                  <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-950">
                          {employeeName(emp)} · {formatText(event.event_type)}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {formatDateTime(event.event_time)} · {store?.name || "No store"}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${sourceTone}`}>
                          {formatText(event.source)}
                        </span>
                        <StatusPill value={hasGps ? "gps_ok" : "gps_missing"} />
                      </div>
                    </div>

                    {event.clock_note && (
                      <div className="mt-2 text-xs font-semibold text-slate-600">{event.clock_note}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">Recent Exceptions ({recentExceptions.length})</div>
              <div className="mt-3 space-y-2">
                {recentExceptions.slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-black text-slate-900">{formatText(item.exception_type)}</div>
                      <StatusPill value={item.status} />
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {employeeName(employeeMap.get(item.employee_id))}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {item.description || "No description"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">Device Ingestion Feed</div>
              <div className="mt-3 space-y-2">
                {deviceEvents.slice(0, 10).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-slate-900">{formatText(item.provider)}</div>
                      <StatusPill value={item.ingestion_status} />
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDateTime(item.ingested_at)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
