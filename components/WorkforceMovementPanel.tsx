"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  RefreshCcw,
  Save,
  Store,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type EmployeeRow = {
  id: string;
  company_id?: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
};

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
};

type EmployeeMovementRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  movement_type: string;
  from_store_id: string | null;
  to_store_id: string | null;
  effective_date: string;
  end_date: string | null;
  instruction_text: string | null;
  status: string;
  applied_at: string | null;
  created_at: string;
};

type EmployeeStatusHistoryRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  previous_status: string | null;
  new_status: string;
  effective_date: string;
  reason: string | null;
  instruction_text: string | null;
  created_at: string;
};

function employeeName(employee: EmployeeRow | undefined | null) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-ZA", {
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

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function StatusPill({ value }: { value: string }) {
  const className =
    value === "applied" || value === "active"
      ? "bg-emerald-100 text-emerald-700"
      : value === "scheduled"
      ? "bg-blue-100 text-cyan-700"
      : value === "cancelled" || value === "terminated"
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-bold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
      />
    </label>
  );
}

export default function WorkforceMovementPanel() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [movements, setMovements] = useState<EmployeeMovementRow[]>([]);
  const [statusHistory, setStatusHistory] = useState<EmployeeStatusHistoryRow[]>([]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [movementType, setMovementType] = useState<"transfer" | "temporary_assignment" | "termination" | "suspension" | "return_to_work">("transfer");
  const [toStoreId, setToStoreId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState("");
  const [instructionText, setInstructionText] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

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

  const scheduledMovements = useMemo(
    () => movements.filter((movement) => movement.status === "scheduled"),
    [movements]
  );

  const appliedMovements = useMemo(
    () => movements.filter((movement) => movement.status === "applied"),
    [movements]
  );

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active !== false),
    [employees]
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;

    const currentStore = storeName(selectedEmployee.default_store_id);
    const movementDescription =
      movementType === "transfer"
        ? `${employeeName(selectedEmployee)} must move from ${currentStore} to ${storeName(toStoreId)} from ${formatDate(effectiveDate)}.`
        : movementType === "temporary_assignment"
        ? `${employeeName(selectedEmployee)} must temporarily work at ${storeName(toStoreId)} from ${formatDate(effectiveDate)}${endDate ? ` until ${formatDate(endDate)}` : ""}.`
        : movementType === "termination"
        ? `${employeeName(selectedEmployee)} has left the company on ${formatDate(effectiveDate)}. Remove this employee from future rosters.`
        : movementType === "suspension"
        ? `${employeeName(selectedEmployee)} is suspended from ${formatDate(effectiveDate)}${endDate ? ` until ${formatDate(endDate)}` : ""}. Remove this employee from rosters during this period.`
        : `${employeeName(selectedEmployee)} returns to work from ${formatDate(effectiveDate)}.`;

    setInstructionText(movementDescription);
  }, [selectedEmployeeId, movementType, toStoreId, effectiveDate, endDate]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [employeeResult, storeResult, movementResult, statusResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,company_id,employee_number,first_name,last_name,job_title,default_store_id,active")
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name,city,region,status")
        .order("name", { ascending: true }),
      supabase
        .from("employee_movements")
        .select("*")
        .order("effective_date", { ascending: false })
        .limit(100),
      supabase
        .from("employee_status_history")
        .select("*")
        .order("effective_date", { ascending: false })
        .limit(100),
    ]);

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (storeResult.error) {
      setError(storeResult.error.message);
      setLoading(false);
      return;
    }

    if (movementResult.error) {
      setError(movementResult.error.message);
      setLoading(false);
      return;
    }

    if (statusResult.error) {
      setError(statusResult.error.message);
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeeResult.data || []) as EmployeeRow[];

    setEmployees(loadedEmployees);
    setStores((storeResult.data || []) as StoreRow[]);
    setMovements((movementResult.data || []) as EmployeeMovementRow[]);
    setStatusHistory((statusResult.data || []) as EmployeeStatusHistoryRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  function storeName(storeId: string | null | undefined) {
    if (!storeId) return "No store";
    return storeMap.get(storeId)?.name || "Unknown store";
  }

  function companyIdForSelectedEmployee() {
    return selectedEmployee?.company_id || null;
  }

  async function saveMovement() {
    if (!selectedEmployee) {
      setError("Select an employee first.");
      return;
    }

    if (!effectiveDate) {
      setError("Effective date is required.");
      return;
    }

    if ((movementType === "transfer" || movementType === "temporary_assignment") && !toStoreId) {
      setError("Target store is required for this movement.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const fromStoreId = selectedEmployee.default_store_id || null;

    const { error: insertError } = await supabase.from("employee_movements").insert({
      company_id: companyIdForSelectedEmployee(),
      employee_id: selectedEmployee.id,
      movement_type: movementType,
      from_store_id: fromStoreId,
      to_store_id:
        movementType === "transfer" || movementType === "temporary_assignment"
          ? toStoreId
          : null,
      effective_date: effectiveDate,
      end_date:
        movementType === "temporary_assignment" || movementType === "suspension"
          ? endDate || null
          : null,
      instruction_text: instructionText.trim() || null,
      status: "scheduled",
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    if (movementType === "termination" || movementType === "suspension" || movementType === "return_to_work") {
      const newStatus =
        movementType === "termination"
          ? "terminated"
          : movementType === "suspension"
          ? "suspended"
          : "active";

      const { error: statusError } = await supabase.from("employee_status_history").insert({
        company_id: companyIdForSelectedEmployee(),
        employee_id: selectedEmployee.id,
        previous_status: selectedEmployee.active === false ? "inactive" : "active",
        new_status: newStatus,
        effective_date: effectiveDate,
        reason: reason.trim() || null,
        instruction_text: instructionText.trim() || null,
      });

      if (statusError) {
        setError(statusError.message);
        setSaving(false);
        return;
      }
    }

    setMessage("Movement instruction saved. You can apply it now or keep it scheduled.");
    setSaving(false);
    await loadData();
  }

  async function applyMovement(movement: EmployeeMovementRow) {
    setApplyingId(movement.id);
    setError(null);
    setMessage(null);

    try {
      if (movement.movement_type === "transfer" && movement.to_store_id) {
        const { error: employeeUpdateError } = await supabase
          .from("employees")
          .update({
            default_store_id: movement.to_store_id,
          })
          .eq("id", movement.employee_id);

        if (employeeUpdateError) throw new Error(employeeUpdateError.message);

        const { error: rosterUpdateError } = await supabase
          .from("roster_shifts")
          .update({
            store_id: movement.to_store_id,
          })
          .eq("employee_id", movement.employee_id)
          .gte("shift_date", movement.effective_date);

        if (rosterUpdateError) throw new Error(rosterUpdateError.message);
      }

      if (movement.movement_type === "termination") {
        const { error: employeeUpdateError } = await supabase
          .from("employees")
          .update({
            active: false,
          })
          .eq("id", movement.employee_id);

        if (employeeUpdateError) throw new Error(employeeUpdateError.message);

        const { error: rosterUpdateError } = await supabase
          .from("roster_shifts")
          .update({
            status: "cancelled",
          })
          .eq("employee_id", movement.employee_id)
          .gte("shift_date", movement.effective_date);

        if (rosterUpdateError) throw new Error(rosterUpdateError.message);
      }

      if (movement.movement_type === "suspension") {
        let query = supabase
          .from("roster_shifts")
          .update({
            status: "cancelled",
          })
          .eq("employee_id", movement.employee_id)
          .gte("shift_date", movement.effective_date);

        if (movement.end_date) {
          query = query.lte("shift_date", movement.end_date);
        }

        const { error: rosterUpdateError } = await query;

        if (rosterUpdateError) throw new Error(rosterUpdateError.message);
      }

      if (movement.movement_type === "return_to_work") {
        const { error: employeeUpdateError } = await supabase
          .from("employees")
          .update({
            active: true,
          })
          .eq("id", movement.employee_id);

        if (employeeUpdateError) throw new Error(employeeUpdateError.message);
      }

      if (movement.movement_type === "temporary_assignment" && movement.to_store_id) {
        const { error: rosterUpdateError } = await supabase
          .from("roster_shifts")
          .update({
            store_id: movement.to_store_id,
          })
          .eq("employee_id", movement.employee_id)
          .gte("shift_date", movement.effective_date)
          .lte("shift_date", movement.end_date || movement.effective_date);

        if (rosterUpdateError) throw new Error(rosterUpdateError.message);
      }

      const { error: movementUpdateError } = await supabase
        .from("employee_movements")
        .update({
          status: "applied",
          applied_at: new Date().toISOString(),
        })
        .eq("id", movement.id);

      if (movementUpdateError) throw new Error(movementUpdateError.message);

      setMessage("Movement applied successfully. Future rosters were updated where applicable.");
      await loadData();
    } catch (applyError: any) {
      setError(applyError?.message || "Could not apply movement.");
    }

    setApplyingId(null);
  }

  async function cancelMovement(movement: EmployeeMovementRow) {
    setApplyingId(movement.id);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("employee_movements")
      .update({
        status: "cancelled",
      })
      .eq("id", movement.id);

    if (updateError) {
      setError(updateError.message);
      setApplyingId(null);
      return;
    }

    setMessage("Movement cancelled.");
    await loadData();
    setApplyingId(null);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/95 p-7 text-[#06101f] shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/30 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-[-120px] left-1/3 h-72 w-72 rounded-full bg-blue-400/20 blur-[90px]" />
        <div className="relative z-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-700">
              Workforce Movement Engine
            </div>
            <h2 className="mt-3 text-4xl font-bold">Transfers, Terminations & Future Rules</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Capture instructions like “Piet moves to Waterstone from 9 May” or “Piet left on
              7 May” and apply the change safely to employee records and future rosters.
            </p>
          </div>

          <button
            onClick={loadData}
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
          title="Employees"
          value={String(employees.length)}
          subtitle="Loaded records"
          tone="border-slate-200 bg-white text-slate-950"
          icon={<Users className="h-6 w-6 text-slate-700" />}
        />
        <StatCard
          title="Active"
          value={String(activeEmployees.length)}
          subtitle="Can be rostered"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-700" />}
        />
        <StatCard
          title="Scheduled"
          value={String(scheduledMovements.length)}
          subtitle="Future movement rules"
          tone="border-cyan-200 bg-cyan-50 text-cyan-900"
          icon={<CalendarDays className="h-6 w-6 text-cyan-700" />}
        />
        <StatCard
          title="Applied"
          value={String(appliedMovements.length)}
          subtitle="Already actioned"
          tone="border-amber-200 bg-amber-50 text-amber-900"
          icon={<ArrowRightLeft className="h-6 w-6 text-amber-700" />}
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

      <section className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
            New Instruction
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Create Workforce Movement
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Save the movement first, then apply it when you are ready. Applying updates future rosters.
          </p>

          <div className="mt-6 grid gap-4">
            <label className="text-sm font-bold text-slate-800">
              Employee
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employeeName(employee)} · {employee.employee_number || "No code"}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-bold text-slate-800">
              Movement Type
              <select
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as any)}
                className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
              >
                <option value="transfer">Permanent Transfer</option>
                <option value="temporary_assignment">Temporary Assignment</option>
                <option value="termination">Termination / Employee Left</option>
                <option value="suspension">Suspension</option>
                <option value="return_to_work">Return To Work</option>
              </select>
            </label>

            {(movementType === "transfer" || movementType === "temporary_assignment") && (
              <label className="text-sm font-bold text-slate-800">
                Target Store
                <select
                  value={toStoreId}
                  onChange={(event) => setToStoreId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                >
                  <option value="">Select target store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Effective Date"
                value={effectiveDate}
                onChange={setEffectiveDate}
                type="date"
              />

              {(movementType === "temporary_assignment" || movementType === "suspension") && (
                <Field
                  label="End Date"
                  value={endDate}
                  onChange={setEndDate}
                  type="date"
                />
              )}
            </div>

            {(movementType === "termination" ||
              movementType === "suspension" ||
              movementType === "return_to_work") && (
              <Field
                label="Reason"
                value={reason}
                onChange={setReason}
                placeholder="Resigned, dismissed, suspended pending hearing..."
              />
            )}

            <label className="text-sm font-bold text-slate-800">
              Instruction Text
              <textarea
                value={instructionText}
                onChange={(event) => setInstructionText(event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                placeholder="Example: Piet must move from Constantia to Waterstone from 9 May 2026."
              />
            </label>

            {selectedEmployee && (
              <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <UserRound className="h-5 w-5 text-cyan-600" />
                  <div>
                    <div className="font-black text-slate-950">
                      {employeeName(selectedEmployee)}
                    </div>
                    <div className="text-xs font-semibold text-slate-500">
                      Current store: {storeName(selectedEmployee.default_store_id)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={saveMovement}
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Movement Instruction"}
            </button>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
            Movement Queue
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Scheduled & Applied Rules
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Apply scheduled movements to update employee records and future roster shifts.
          </p>

          <div className="mt-6 space-y-3">
            {loading ? (
              <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
                Loading movement rules...
              </div>
            ) : movements.length === 0 ? (
              <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
                No movement instructions captured yet.
              </div>
            ) : (
              movements.map((movement) => {
                const employee = employeeMap.get(movement.employee_id);

                return (
                  <article
                    key={movement.id}
                    className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-lg font-black text-slate-950">
                          {employeeName(employee)}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {formatText(movement.movement_type)} · Effective{" "}
                          {formatDate(movement.effective_date)}
                        </div>
                      </div>

                      <StatusPill value={movement.status} />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <Info label="From" value={storeName(movement.from_store_id)} />
                      <Info label="To" value={storeName(movement.to_store_id)} />
                      <Info label="Applied" value={formatDateTime(movement.applied_at)} />
                    </div>

                    {movement.instruction_text && (
                      <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm text-sm font-semibold leading-6 text-slate-700">
                        {movement.instruction_text}
                      </div>
                    )}

                    {movement.status === "scheduled" && (
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        <button
                          onClick={() => applyMovement(movement)}
                          disabled={applyingId === movement.id}
                          className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-[#06101f] disabled:bg-slate-300"
                        >
                          {applyingId === movement.id ? "Applying..." : "Apply Movement"}
                        </button>

                        <button
                          onClick={() => cancelMovement(movement)}
                          disabled={applyingId === movement.id}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-[#06101f] disabled:bg-slate-300"
                        >
                          <XCircle className="h-4 w-4" />
                          Cancel
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Store className="h-6 w-6 text-cyan-600" />
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
              Status History
            </div>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">
              Employee Status Timeline
            </h3>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {statusHistory.length === 0 ? (
            <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
              No status history records found yet.
            </div>
          ) : (
            statusHistory.slice(0, 20).map((item) => (
              <article
                key={item.id}
                className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">
                      {employeeName(employeeMap.get(item.employee_id))}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatText(item.previous_status)} → {formatText(item.new_status)} ·{" "}
                      {formatDate(item.effective_date)}
                    </div>
                  </div>

                  <StatusPill value={item.new_status} />
                </div>

                {(item.reason || item.instruction_text) && (
                  <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm text-sm font-semibold leading-6 text-slate-700">
                    {item.reason || item.instruction_text}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}
