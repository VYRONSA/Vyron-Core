"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  RefreshCcw,
  Save,
  Sparkles,
  Store,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
  opening_time?: string | null;
  closing_time?: string | null;
};

type EmployeeRow = {
  id: string;
  company_id?: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
  employment_type: string | null;
};

type RosterShiftRow = {
  id: string;
  company_id?: string | null;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  role: string | null;
  status: string;
  employee_id: string;
  store_id: string;
};

type RosterGenerationRun = {
  id: string;
  company_id: string | null;
  store_id: string | null;
  week_start: string;
  week_end: string;
  generation_mode: string;
  status: string;
  notes: string | null;
  created_at: string;
};

type DraftShift = {
  temp_id: string;
  employee_id: string;
  store_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role: string;
  source: "manual" | "pattern";
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-ZA", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return value;
  }
}

function formatDateLong(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function formatTimeFromIso(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(value).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    if (value.length >= 5) return value.slice(0, 5);
    return value;
  }
}

function timeOnlyFromIso(value: string | null | undefined) {
  if (!value) return "08:00";

  try {
    return new Date(value).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    if (value.length >= 5) return value.slice(0, 5);
    return "08:00";
  }
}

function toShiftDateTime(date: string, time: string) {
  return `${date}T${time}:00+02:00`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function mondayOfWeek(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function safeHours(startTime: string, endTime: string) {
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  const start = startH + startM / 60;
  const end = endH + endM / 60;

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end >= start) return end - start;
  return 24 - start + end;
}

function formatHours(value: number) {
  return `${value.toFixed(1)}h`;
}

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function StatusPill({ value }: { value: string }) {
  const className =
    value === "scheduled" || value === "published"
      ? "bg-blue-100 text-cyan-700"
      : value === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : value === "cancelled"
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${className}`}>
      {formatText(value)}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-[2rem] border p-5 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(37,99,235,0.20)] ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.22em] opacity-70">
            {title}
          </div>
          <div className="mt-3 text-4xl font-black">{value}</div>
          <div className="mt-2 text-sm font-semibold opacity-80">{subtitle}</div>
        </div>
        <div className="rounded-2xl bg-white/70 p-3">{icon}</div>
      </div>
    </div>
  );
}

export default function RosterIntelligencePanel() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [rosterShifts, setRosterShifts] = useState<RosterShiftRow[]>([]);
  const [historyShifts, setHistoryShifts] = useState<RosterShiftRow[]>([]);
  const [generationRuns, setGenerationRuns] = useState<RosterGenerationRun[]>([]);

  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [weekStart, setWeekStart] = useState(mondayOfWeek(todayIsoDate()));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [manualDate, setManualDate] = useState(mondayOfWeek(todayIsoDate()));
  const [manualStart, setManualStart] = useState("08:00");
  const [manualEnd, setManualEnd] = useState("17:00");
  const [manualRole, setManualRole] = useState("Counter Assistant");
  const [draftShifts, setDraftShifts] = useState<DraftShift[]>([]);

  const [editingShift, setEditingShift] = useState<RosterShiftRow | null>(null);
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editStoreId, setEditStoreId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("08:00");
  const [editEnd, setEditEnd] = useState("17:00");
  const [editRole, setEditRole] = useState("");
  const [editStatus, setEditStatus] = useState("scheduled");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const weekEnd = weekDates[6];

  const storeMap = useMemo(() => {
    const map = new Map<string, StoreRow>();
    stores.forEach((store) => map.set(store.id, store));
    return map;
  }, [stores]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active !== false),
    [employees]
  );

  const storeEmployees = useMemo(() => {
    if (!selectedStoreId) return activeEmployees;
    return activeEmployees.filter((employee) => employee.default_store_id === selectedStoreId);
  }, [activeEmployees, selectedStoreId]);

  const visibleEmployees = useMemo(() => {
    const employeeIdsWithShifts = new Set(
      rosterShifts
        .filter((shift) => !selectedStoreId || shift.store_id === selectedStoreId)
        .map((shift) => shift.employee_id)
    );

    const employeeIdsWithDrafts = new Set(
      draftShifts
        .filter((shift) => !selectedStoreId || shift.store_id === selectedStoreId)
        .map((shift) => shift.employee_id)
    );

    return activeEmployees.filter((employee) => {
      if (selectedStoreId && employee.default_store_id !== selectedStoreId && !employeeIdsWithShifts.has(employee.id) && !employeeIdsWithDrafts.has(employee.id)) {
        return false;
      }

      return true;
    });
  }, [activeEmployees, selectedStoreId, rosterShifts, draftShifts]);

  const weeklyShiftCount = useMemo(() => rosterShifts.length + draftShifts.length, [rosterShifts, draftShifts]);

  const weeklyHours = useMemo(() => {
    const savedHours = rosterShifts.reduce((sum, shift) => {
      return sum + safeHours(timeOnlyFromIso(shift.planned_start), timeOnlyFromIso(shift.planned_end));
    }, 0);

    const draftHours = draftShifts.reduce((sum, shift) => {
      return sum + safeHours(shift.start_time, shift.end_time);
    }, 0);

    return savedHours + draftHours;
  }, [rosterShifts, draftShifts]);

  const selectedStore = selectedStoreId ? storeMap.get(selectedStoreId) || null : null;

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    loadRosterData();
  }, [selectedStoreId, weekStart]);

  useEffect(() => {
    setManualDate(weekStart);
  }, [weekStart]);

  useEffect(() => {
    if (!editingShift) return;

    setEditEmployeeId(editingShift.employee_id);
    setEditStoreId(editingShift.store_id);
    setEditDate(dateKey(editingShift.shift_date));
    setEditStart(timeOnlyFromIso(editingShift.planned_start));
    setEditEnd(timeOnlyFromIso(editingShift.planned_end));
    setEditRole(editingShift.role || "");
    setEditStatus(editingShift.status || "scheduled");
  }, [editingShift]);

  async function loadBaseData() {
    setLoading(true);
    setError(null);

    const [storeResult, employeeResult, generationResult] = await Promise.all([
      supabase
        .from("stores")
        .select("id,name,city,region,status,opening_time,closing_time")
        .eq("status", "active")
        .order("name", { ascending: true }),
      supabase
        .from("employees")
        .select("id,company_id,employee_number,first_name,last_name,job_title,default_store_id,active,employment_type")
        .order("first_name", { ascending: true }),
      supabase
        .from("roster_generation_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    if (storeResult.error) {
      setError(storeResult.error.message);
      setLoading(false);
      return;
    }

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (generationResult.error) {
      setError(generationResult.error.message);
      setLoading(false);
      return;
    }

    const loadedStores = (storeResult.data || []) as StoreRow[];
    const loadedEmployees = (employeeResult.data || []) as EmployeeRow[];

    setStores(loadedStores);
    setEmployees(loadedEmployees);
    setGenerationRuns((generationResult.data || []) as RosterGenerationRun[]);

    if (!selectedStoreId && loadedStores.length > 0) {
      setSelectedStoreId(loadedStores[0].id);
    }

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  async function loadRosterData() {
    setError(null);

    const historyStart = addDays(weekStart, -35);
    const historyEnd = addDays(weekStart, -1);

    let currentQuery = supabase
      .from("roster_shifts")
      .select("*")
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      .order("shift_date", { ascending: true });

    let historyQuery = supabase
      .from("roster_shifts")
      .select("*")
      .gte("shift_date", historyStart)
      .lte("shift_date", historyEnd)
      .order("shift_date", { ascending: true });

    if (selectedStoreId) {
      currentQuery = currentQuery.eq("store_id", selectedStoreId);
      historyQuery = historyQuery.eq("store_id", selectedStoreId);
    }

    const [currentResult, historyResult] = await Promise.all([currentQuery, historyQuery]);

    if (currentResult.error) {
      setError(currentResult.error.message);
      return;
    }

    if (historyResult.error) {
      setError(historyResult.error.message);
      return;
    }

    setRosterShifts((currentResult.data || []) as RosterShiftRow[]);
    setHistoryShifts((historyResult.data || []) as RosterShiftRow[]);
    setDraftShifts([]);
  }

  function previousWeek() {
    setWeekStart(addDays(weekStart, -7));
  }

  function nextWeek() {
    setWeekStart(addDays(weekStart, 7));
  }

  function storeName(storeId: string | null | undefined) {
    if (!storeId) return "No store";
    return storeMap.get(storeId)?.name || "Unknown store";
  }

  function employeeCompanyId(employeeId: string) {
    return employeeMap.get(employeeId)?.company_id || null;
  }

  function savedShiftsFor(employeeId: string, shiftDate: string) {
    return rosterShifts.filter(
      (shift) =>
        shift.employee_id === employeeId &&
        dateKey(shift.shift_date) === shiftDate &&
        (!selectedStoreId || shift.store_id === selectedStoreId)
    );
  }

  function draftShiftsFor(employeeId: string, shiftDate: string) {
    return draftShifts.filter(
      (shift) =>
        shift.employee_id === employeeId &&
        shift.shift_date === shiftDate &&
        (!selectedStoreId || shift.store_id === selectedStoreId)
    );
  }

  function weekdayIndex(dateIso: string) {
    const day = new Date(`${dateIso}T12:00:00`).getDay();
    return day === 0 ? 6 : day - 1;
  }

  function addManualDraftShift() {
    setError(null);
    setMessage(null);

    if (!selectedEmployeeId) {
      setError("Select an employee first.");
      return;
    }

    if (!selectedStoreId) {
      setError("Select a store first.");
      return;
    }

    if (!manualDate || manualDate < weekStart || manualDate > weekEnd) {
      setError("Manual shift date must fall inside the selected Monday to Sunday week.");
      return;
    }

    if (!manualStart || !manualEnd) {
      setError("Start and end times are required.");
      return;
    }

    const employee = employeeMap.get(selectedEmployeeId);

    setDraftShifts((current) => [
      ...current,
      {
        temp_id: crypto.randomUUID(),
        employee_id: selectedEmployeeId,
        store_id: selectedStoreId,
        shift_date: manualDate,
        start_time: manualStart,
        end_time: manualEnd,
        role: manualRole.trim() || employee?.job_title || "Shift",
        source: "manual",
      },
    ]);

    setMessage("Manual draft shift added. Save draft shifts when ready.");
  }

  function generatePatternDraft() {
    setGenerating(true);
    setError(null);
    setMessage(null);

    if (!selectedStoreId) {
      setError("Select a store before generating a roster.");
      setGenerating(false);
      return;
    }

    const candidates = storeEmployees.length > 0 ? storeEmployees : activeEmployees;

    if (candidates.length === 0) {
      setError("No active employees available for this roster.");
      setGenerating(false);
      return;
    }

    const generated: DraftShift[] = [];

    candidates.forEach((employee) => {
      weekDates.forEach((date) => {
        const existingSaved = savedShiftsFor(employee.id, date);
        const existingDraft = draftShiftsFor(employee.id, date);

        if (existingSaved.length > 0 || existingDraft.length > 0) return;

        const targetWeekday = weekdayIndex(date);

        const matchingHistory = historyShifts.filter((shift) => {
          return (
            shift.employee_id === employee.id &&
            shift.store_id === selectedStoreId &&
            weekdayIndex(dateKey(shift.shift_date)) === targetWeekday &&
            shift.status !== "cancelled"
          );
        });

        if (matchingHistory.length === 0) return;

        const mostRecent = matchingHistory[matchingHistory.length - 1];

        generated.push({
          temp_id: crypto.randomUUID(),
          employee_id: employee.id,
          store_id: selectedStoreId,
          shift_date: date,
          start_time: timeOnlyFromIso(mostRecent.planned_start),
          end_time: timeOnlyFromIso(mostRecent.planned_end),
          role: mostRecent.role || employee.job_title || "Shift",
          source: "pattern",
        });
      });
    });

    if (generated.length === 0) {
      const store = storeMap.get(selectedStoreId);
      const fallbackStart = store?.opening_time?.slice(0, 5) || "08:00";
      const fallbackEnd = store?.closing_time?.slice(0, 5) || "17:00";

      candidates.slice(0, Math.min(candidates.length, 8)).forEach((employee, employeeIndex) => {
        weekDates.forEach((date, dateIndex) => {
          if ((employeeIndex + dateIndex) % 3 === 0) return;

          generated.push({
            temp_id: crypto.randomUUID(),
            employee_id: employee.id,
            store_id: selectedStoreId,
            shift_date: date,
            start_time: fallbackStart,
            end_time: fallbackEnd,
            role: employee.job_title || "Shift",
            source: "pattern",
          });
        });
      });
    }

    setDraftShifts((current) => [...current, ...generated]);
    setMessage(
      generated.length > 0
        ? `${generated.length} draft shift(s) generated from historical roster patterns.`
        : "No pattern could be generated from history."
    );
    setGenerating(false);
  }

  async function saveDraftShifts() {
    setSaving(true);
    setError(null);
    setMessage(null);

    if (draftShifts.length === 0) {
      setError("No draft shifts to save.");
      setSaving(false);
      return;
    }

    const inserts = draftShifts.map((shift) => ({
      company_id: employeeCompanyId(shift.employee_id),
      employee_id: shift.employee_id,
      store_id: shift.store_id,
      shift_date: shift.shift_date,
      planned_start: toShiftDateTime(shift.shift_date, shift.start_time),
      planned_end: toShiftDateTime(shift.shift_date, shift.end_time),
      role: shift.role || null,
      status: "scheduled",
    }));

    const { error: insertError } = await supabase.from("roster_shifts").insert(inserts);

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    const { error: runError } = await supabase.from("roster_generation_runs").insert({
      company_id: inserts[0]?.company_id || null,
      store_id: selectedStoreId || null,
      week_start: weekStart,
      week_end: weekEnd,
      generation_mode: "pattern_based",
      status: "draft_saved",
      notes: `${draftShifts.length} shifts saved from Roster Intelligence.`,
    });

    if (runError) {
      setError(runError.message);
      setSaving(false);
      return;
    }

    setMessage(`${draftShifts.length} roster shift(s) saved successfully.`);
    setDraftShifts([]);
    await loadRosterData();
    await loadBaseData();
    setSaving(false);
  }

  async function updateSavedShift() {
    if (!editingShift) return;

    if (!editEmployeeId || !editStoreId || !editDate || !editStart || !editEnd) {
      setError("Employee, store, date, start time and end time are required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("roster_shifts")
      .update({
        employee_id: editEmployeeId,
        store_id: editStoreId,
        shift_date: editDate,
        planned_start: toShiftDateTime(editDate, editStart),
        planned_end: toShiftDateTime(editDate, editEnd),
        role: editRole.trim() || null,
        status: editStatus,
      })
      .eq("id", editingShift.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage("Roster shift updated successfully.");
    setEditingShift(null);
    await loadRosterData();
    setSaving(false);
  }

  async function cancelSavedShift(shift: RosterShiftRow) {
    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("roster_shifts")
      .update({ status: "cancelled" })
      .eq("id", shift.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage("Saved shift cancelled.");
    await loadRosterData();
    setSaving(false);
  }

  function removeDraftShift(tempId: string) {
    setDraftShifts((current) => current.filter((shift) => shift.temp_id !== tempId));
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/95 p-7 text-[#06101f] shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/30 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-[-120px] left-1/3 h-72 w-72 rounded-full bg-blue-400/20 blur-[90px]" />
        <div className="relative z-10">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-700">
              Roster Intelligence
            </div>
            <h2 className="mt-3 text-4xl font-bold">Weekly Shift Builder</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Build Monday to Sunday rosters per store, generate draft shifts from historical
              patterns, then manually adjust before payroll and clocking use the schedule.
            </p>
          </div>

          <button
            onClick={() => {
              loadBaseData();
              loadRosterData();
            }}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Week"
          value={`${formatDate(weekStart).slice(0, 6)}`}
          subtitle={`To ${formatDateLong(weekEnd)}`}
          tone="border-slate-200 bg-white text-slate-950"
          icon={<CalendarDays className="h-6 w-6 text-slate-700" />}
        />
        <StatCard
          title="Employees"
          value={String(visibleEmployees.length)}
          subtitle="Visible for this roster"
          tone="border-cyan-200 bg-cyan-50 text-cyan-900"
          icon={<Users className="h-6 w-6 text-cyan-700" />}
        />
        <StatCard
          title="Shifts"
          value={String(weeklyShiftCount)}
          subtitle="Saved + draft"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<Clock3 className="h-6 w-6 text-emerald-700" />}
        />
        <StatCard
          title="Hours"
          value={formatHours(weeklyHours)}
          subtitle="Estimated roster hours"
          tone="border-amber-200 bg-amber-50 text-amber-900"
          icon={<Sparkles className="h-6 w-6 text-amber-700" />}
        />
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

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_auto_auto]">
          <label className="text-sm font-bold text-slate-800">
            Store
            <select
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
            >
              <option value="">All stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold text-slate-800">
            Week Start Monday
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(mondayOfWeek(event.target.value))}
              className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
            />
          </label>

          <button
            onClick={previousWeek}
            className="mt-7 rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700"
          >
            Previous Week
          </button>

          <button
            onClick={nextWeek}
            className="mt-7 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-[#06101f]"
          >
            Next Week
          </button>
        </div>

        {selectedStore && (
          <div className="mt-5 rounded-2xl bg-cyan-50 p-4 text-sm font-semibold text-cyan-900">
            <Store className="mr-2 inline h-4 w-4" />
            Building roster for {selectedStore.name}. Opening:{" "}
            {selectedStore.opening_time?.slice(0, 5) || "Not set"} · Closing:{" "}
            {selectedStore.closing_time?.slice(0, 5) || "Not set"}
          </div>
        )}
      </section>

      <section className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-8">
          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
              Auto Generate
            </div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">
              Pattern-Based Draft
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Uses previous roster patterns for this store and employee group. If no history
              exists, it creates a basic starter roster from store hours.
            </p>

            <button
              onClick={generatePatternDraft}
              disabled={generating || !selectedStoreId}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 disabled:bg-slate-300"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generating..." : "Generate Draft Roster"}
            </button>

            <button
              onClick={saveDraftShifts}
              disabled={saving || draftShifts.length === 0}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-[#06101f] disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : `Save ${draftShifts.length} Draft Shift(s)`}
            </button>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
              Manual Add
            </div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">
              Add One Draft Shift
            </h3>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-bold text-slate-800">
                Employee
                <select
                  value={selectedEmployeeId}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  <option value="">Select employee</option>
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeName(employee)} · {storeName(employee.default_store_id)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-bold text-slate-800">
                Shift Date
                <select
                  value={manualDate}
                  onChange={(event) => setManualDate(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  {weekDates.map((date, index) => (
                    <option key={date} value={date}>
                      {weekdays[index]} · {formatDate(date)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-bold text-slate-800">
                  Start
                  <input
                    type="time"
                    value={manualStart}
                    onChange={(event) => setManualStart(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                  />
                </label>

                <label className="text-sm font-bold text-slate-800">
                  End
                  <input
                    type="time"
                    value={manualEnd}
                    onChange={(event) => setManualEnd(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                  />
                </label>
              </div>

              <label className="text-sm font-bold text-slate-800">
                Role
                <input
                  value={manualRole}
                  onChange={(event) => setManualRole(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                  placeholder="Counter Assistant"
                />
              </label>

              <button
                onClick={addManualDraftShift}
                className="rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-[#06101f]"
              >
                Add Draft Shift
              </button>
            </div>
          </section>
        </div>

        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
            Monday to Sunday Grid
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Weekly Roster
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Saved shifts show as scheduled. Draft shifts can still be removed before saving.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 rounded-l-2xl bg-slate-950 p-3 text-left text-xs font-black uppercase tracking-[0.18em] text-[#06101f]">
                    Employee
                  </th>
                  {weekDates.map((date, index) => (
                    <th
                      key={date}
                      className="bg-slate-950 p-3 text-left text-xs font-black uppercase tracking-[0.18em] text-[#06101f] last:rounded-r-2xl"
                    >
                      {weekdays[index]}
                      <div className="mt-1 text-[10px] font-semibold normal-case tracking-normal text-slate-600">
                        {formatDate(date)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visibleEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-sm font-semibold text-slate-500">
                      No employees visible for this store/week.
                    </td>
                  </tr>
                ) : (
                  visibleEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-white p-3 align-top">
                        <div className="font-black text-slate-950">
                          {employeeName(employee)}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {employee.employee_number || "No code"} · {storeName(employee.default_store_id)}
                        </div>
                      </td>

                      {weekDates.map((date) => {
                        const saved = savedShiftsFor(employee.id, date);
                        const draft = draftShiftsFor(employee.id, date);

                        return (
                          <td key={date} className="border-b border-slate-100 p-3 align-top">
                            <div className="space-y-2">
                              {saved.map((shift) => (
                                <div
                                  key={shift.id}
                                  className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="font-black text-blue-950">
                                        {formatTimeFromIso(shift.planned_start)} – {formatTimeFromIso(shift.planned_end)}
                                      </div>
                                      <div className="mt-1 text-xs font-semibold text-cyan-700">
                                        {shift.role || employee.job_title || "Shift"}
                                      </div>
                                    </div>

                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => setEditingShift(shift)}
                                        className="rounded-xl bg-white p-2 text-cyan-600"
                                        title="Edit saved shift"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                      </button>

                                      <button
                                        onClick={() => cancelSavedShift(shift)}
                                        className="rounded-xl bg-white p-2 text-rose-600"
                                        title="Cancel saved shift"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-2">
                                    <StatusPill value={shift.status} />
                                  </div>
                                </div>
                              ))}

                              {draft.map((shift) => (
                                <div
                                  key={shift.temp_id}
                                  className="rounded-2xl border border-amber-100 bg-amber-50 p-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="font-black text-amber-950">
                                        {shift.start_time} – {shift.end_time}
                                      </div>
                                      <div className="mt-1 text-xs font-semibold text-amber-700">
                                        Draft · {shift.role}
                                      </div>
                                    </div>

                                    <button
                                      onClick={() => removeDraftShift(shift.temp_id)}
                                      className="rounded-xl bg-white p-2 text-rose-600"
                                      title="Remove draft shift"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {saved.length === 0 && draft.length === 0 && (
                                <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-3 text-xs font-semibold text-slate-400">
                                  Off
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
          Generation History
        </div>
        <h3 className="mt-2 text-2xl font-bold text-slate-950">
          Latest Roster Runs
        </h3>

        <div className="mt-5 space-y-3">
          {generationRuns.length === 0 ? (
            <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
              No roster generation runs yet.
            </div>
          ) : (
            generationRuns.map((run) => (
              <article key={run.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">
                      {storeName(run.store_id)}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDateLong(run.week_start)} → {formatDateLong(run.week_end)} ·{" "}
                      {formatText(run.generation_mode)}
                    </div>
                  </div>

                  <StatusPill value={run.status} />
                </div>

                {run.notes && (
                  <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm text-sm font-semibold text-slate-700">
                    {run.notes}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      {editingShift && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[34px] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                  Edit Saved Shift
                </div>
                <h3 className="mt-2 text-3xl font-black text-slate-950">
                  Update Roster Shift
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Change the employee, store, date, times, role or status for this saved shift.
                </p>
              </div>

              <button
                onClick={() => setEditingShift(null)}
                className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Employee
                <select
                  value={editEmployeeId}
                  onChange={(event) => setEditEmployeeId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  <option value="">Select employee</option>
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeName(employee)} · {employee.employee_number || "No code"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-bold text-slate-800">
                Store
                <select
                  value={editStoreId}
                  onChange={(event) => setEditStoreId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  <option value="">Select store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-bold text-slate-800">
                Shift Date
                <input
                  type="date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="text-sm font-bold text-slate-800">
                Status
                <select
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="published">Published</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <label className="text-sm font-bold text-slate-800">
                Start Time
                <input
                  type="time"
                  value={editStart}
                  onChange={(event) => setEditStart(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="text-sm font-bold text-slate-800">
                End Time
                <input
                  type="time"
                  value={editEnd}
                  onChange={(event) => setEditEnd(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="text-sm font-bold text-slate-800 md:col-span-2">
                Role / Position for Shift
                <input
                  value={editRole}
                  onChange={(event) => setEditRole(event.target.value)}
                  placeholder="Counter Assistant"
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <button
                onClick={() => setEditingShift(null)}
                className="rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
              >
                Cancel
              </button>

              <button
                onClick={updateSavedShift}
                disabled={saving}
                className="rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 disabled:bg-slate-300"
              >
                {saving ? "Saving..." : "Save Shift Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
