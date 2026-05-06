"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  active: boolean;
  pin_code: string | null;
  kiosk_access_enabled: boolean | null;
  default_store_id: string | null;
};

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
};

type ClockEventRow = {
  id: string;
  employee_id: string;
  store_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  created_at?: string;
};

function fullName(employee: EmployeeRow | null) {
  if (!employee) return "";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(value).toLocaleString("en-ZA", {
      weekday: "short",
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

function currentTimeLabel() {
  return new Date().toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function currentDateLabel() {
  return new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function ClockPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [employeeCode, setEmployeeCode] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [latestEvents, setLatestEvents] = useState<ClockEventRow[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [nowLabel, setNowLabel] = useState(currentTimeLabel());

  const [loading, setLoading] = useState(true);
  const [checkingPin, setCheckingPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(() => {
    const code = employeeCode.trim().toLowerCase();

    if (!code) return null;

    return (
      employees.find(
        (item) => (item.employee_number || "").trim().toLowerCase() === code
      ) || null
    );
  }, [employees, employeeCode]);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) || null,
    [stores, selectedStoreId]
  );

  const lastEvent = latestEvents[0] || null;
  const isCurrentlyClockedIn = lastEvent?.event_type === "clock_in";

  useEffect(() => {
    loadBaseData();

    const timer = window.setInterval(() => {
      setNowLabel(currentTimeLabel());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setAuthenticated(false);
    setEmployee(null);
    setLatestEvents([]);
    setSuccessMessage(null);
    setError(null);

    if (!employeeCode.trim()) {
      setLookupMessage(null);
      return;
    }

    if (!selectedEmployee) {
      setLookupMessage("No employee found for this code.");
      return;
    }

    setLookupMessage(`${fullName(selectedEmployee)} found. Enter PIN to continue.`);
  }, [employeeCode, selectedEmployee]);

  async function loadBaseData() {
    setLoading(true);
    setError(null);

    const [employeeResult, storeResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name,active,pin_code,kiosk_access_enabled,default_store_id")
        .eq("active", true)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name,city,region,status")
        .eq("status", "active")
        .order("name", { ascending: true }),
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

    setEmployees((employeeResult.data || []) as EmployeeRow[]);
    setStores((storeResult.data || []) as StoreRow[]);
    setLoading(false);
  }

  async function loadClockEventsForEmployee(targetEmployee: EmployeeRow) {
    const { data, error: clockError } = await supabase
      .from("clock_events")
      .select("*")
      .eq("employee_id", targetEmployee.id)
      .order("event_time", { ascending: false })
      .limit(10);

    if (clockError) {
      setError(clockError.message);
      return;
    }

    setLatestEvents((data || []) as ClockEventRow[]);
  }

  async function verifyEmployeePin() {
    setCheckingPin(true);
    setError(null);
    setSuccessMessage(null);

    if (!employeeCode.trim()) {
      setError("Employee code is required.");
      setCheckingPin(false);
      return;
    }

    if (!selectedEmployee) {
      setError("Employee code was not found. Please check the code and try again.");
      setCheckingPin(false);
      return;
    }

    if (selectedEmployee.kiosk_access_enabled === false) {
      setError("Kiosk access is disabled for this employee.");
      setCheckingPin(false);
      return;
    }

    if (!pinCode.trim()) {
      setError("PIN code is required.");
      setCheckingPin(false);
      return;
    }

    if (!selectedEmployee.pin_code) {
      setError("This employee does not have a PIN set up yet. A manager must create one first.");
      setCheckingPin(false);
      return;
    }

    if (pinCode.trim() !== selectedEmployee.pin_code) {
      setError("Incorrect PIN code.");
      setCheckingPin(false);
      return;
    }

    setEmployee(selectedEmployee);
    setAuthenticated(true);
    setSelectedStoreId(selectedEmployee.default_store_id || "");
    setLookupMessage("PIN verified. You can clock in or clock out.");
    await loadClockEventsForEmployee(selectedEmployee);
    setCheckingPin(false);
  }

  async function saveClockEvent(eventType: "clock_in" | "clock_out") {
    if (!employee) {
      setError("Please verify employee code and PIN first.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    const eventTime = new Date().toISOString();

    const { data: insertedEvent, error: insertError } = await supabase
      .from("clock_events")
      .insert({
        employee_id: employee.id,
        store_id: selectedStoreId || employee.default_store_id || null,
        roster_shift_id: null,
        event_type: eventType,
        event_time: eventTime,
        source: "web",
        latitude: null,
        longitude: null,
      })
      .select("*")
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSuccessMessage(
      eventType === "clock_in"
        ? "Clock-in recorded successfully."
        : "Clock-out recorded successfully."
    );

    if (insertedEvent) {
      setLatestEvents((current) => [insertedEvent as ClockEventRow, ...current].slice(0, 10));
    } else {
      await loadClockEventsForEmployee(employee);
    }

    setSaving(false);
  }

  function clearScreen() {
    setEmployeeCode("");
    setPinCode("");
    setEmployee(null);
    setSelectedStoreId("");
    setLatestEvents([]);
    setAuthenticated(false);
    setLookupMessage(null);
    setSuccessMessage(null);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-6xl">
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="flex items-center gap-4">
            <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-lg shadow-blue-500/30">
              <div className="absolute left-[13px] top-[10px] h-8 w-3 rotate-[-28deg] rounded-sm bg-white" />
              <div className="absolute right-[13px] top-[10px] h-8 w-3 rotate-[28deg] rounded-sm bg-slate-950/80" />
            </div>

            <div>
              <div className="text-2xl font-black tracking-[0.34em] text-white">
                VYRON
              </div>
              <div className="mt-[-2px] text-xs font-semibold tracking-[0.55em] text-cyan-300">
                CORE
              </div>
            </div>
          </div>

          <div className="mt-8 text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
            Employee Clocking Kiosk
          </div>

          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
            Staff Clocking
          </h1>

          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            Employees clock in and out using employee code and PIN. This page is separate
            from leave applications and records real clock events into VYRON CORE.
          </p>
        </header>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-6">
            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Secure Clocking
              </div>

              <h2 className="mt-2 text-3xl font-bold text-slate-950">
                Verify Employee
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Enter employee code and PIN. Nothing is pre-filled for privacy.
              </p>

              {loading && (
                <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
                  Loading employees and stores...
                </div>
              )}

              <label className="mt-6 block text-sm font-bold text-slate-800">
                Employee Code
                <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Search className="h-5 w-5 text-slate-400" />
                  <input
                    value={employeeCode}
                    onChange={(event) => {
                      setEmployeeCode(event.target.value.toUpperCase());
                      setPinCode("");
                    }}
                    autoComplete="off"
                    className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none"
                    placeholder="Enter employee code"
                  />
                </div>
              </label>

              <label className="mt-4 block text-sm font-bold text-slate-800">
                PIN Code
                <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <LockKeyhole className="h-5 w-5 text-slate-400" />
                  <input
                    type="password"
                    value={pinCode}
                    onChange={(event) => {
                      setPinCode(event.target.value.replace(/\D/g, "").slice(0, 4));
                      setError(null);
                      setSuccessMessage(null);
                    }}
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={4}
                    className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none"
                    placeholder="Enter 4-digit PIN"
                  />
                </div>
              </label>

              {lookupMessage && (
                <div
                  className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${
                    selectedEmployee
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {selectedEmployee && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                  {lookupMessage}
                </div>
              )}

              {error && (
                <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  {successMessage}
                </div>
              )}

              <button
                onClick={verifyEmployeePin}
                disabled={checkingPin || loading}
                className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                {checkingPin ? "Checking..." : "Verify Employee"}
              </button>

              {authenticated && (
                <button
                  onClick={clearScreen}
                  className="mt-3 w-full rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
                >
                  Clear Screen
                </button>
              )}
            </div>

            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Live Time
              </div>

              <h2 className="mt-2 text-4xl font-black text-slate-950">
                {nowLabel}
              </h2>

              <p className="mt-2 text-sm font-semibold text-slate-500">
                {currentDateLabel()}
              </p>

              <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                Use this kiosk at store level. Manager-side corrections should be handled
                in the VYRON CORE admin app.
              </div>
            </div>
          </div>

          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                  Clocking Control
                </div>
                <h2 className="mt-2 text-3xl font-bold text-slate-950">
                  Clock In / Clock Out
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Once verified, employees can clock in or out. The latest event shows their
                  current clocking status.
                </p>
              </div>

              <Clock3 className="h-9 w-9 text-blue-600" />
            </div>

            {!authenticated || !employee ? (
              <div className="mt-6 flex min-h-[520px] flex-col items-center justify-center text-center">
                <Clock3 className="h-14 w-14 text-slate-300" />
                <h3 className="mt-4 text-2xl font-bold text-slate-950">
                  Verify employee first
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Enter employee code and PIN to unlock clocking controls.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-6 rounded-2xl bg-blue-50 p-4">
                  <div className="flex items-center gap-3">
                    <UserRound className="h-5 w-5 text-blue-700" />
                    <div>
                      <div className="font-bold text-blue-950">{fullName(employee)}</div>
                      <div className="text-xs font-semibold text-blue-700">
                        {employee.employee_number || employee.id}
                      </div>
                    </div>
                  </div>
                </div>

                <label className="mt-5 block text-sm font-bold text-slate-800">
                  Store / Location
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <MapPin className="h-5 w-5 text-slate-400" />
                    <select
                      value={selectedStoreId}
                      onChange={(event) => setSelectedStoreId(event.target.value)}
                      className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none"
                    >
                      <option value="">No store selected</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    Current Status
                  </div>

                  <div
                    className={`mt-3 rounded-2xl p-4 text-sm font-bold ${
                      isCurrentlyClockedIn
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {isCurrentlyClockedIn
                      ? "Currently clocked in"
                      : "Currently clocked out / no active clock-in found"}
                  </div>

                  {lastEvent && (
                    <div className="mt-3 text-sm font-semibold text-slate-600">
                      Last event: {lastEvent.event_type.replaceAll("_", " ")} ·{" "}
                      {formatDateTime(lastEvent.event_time)}
                    </div>
                  )}

                  {selectedStore && (
                    <div className="mt-3 text-sm font-semibold text-slate-600">
                      Store: {selectedStore.name}
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <button
                    onClick={() => saveClockEvent("clock_in")}
                    disabled={saving || isCurrentlyClockedIn}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-5 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    <LogIn className="h-5 w-5" />
                    Clock In
                  </button>

                  <button
                    onClick={() => saveClockEvent("clock_out")}
                    disabled={saving || !isCurrentlyClockedIn}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 py-5 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    <LogOut className="h-5 w-5" />
                    Clock Out
                  </button>
                </div>

                <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                        Latest Clock Events
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Last 10 events for this employee.
                      </div>
                    </div>

                    <button
                      onClick={() => loadClockEventsForEmployee(employee)}
                      className="rounded-2xl bg-white p-3 text-slate-700"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {latestEvents.length === 0 ? (
                      <div className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">
                        No clock events found yet.
                      </div>
                    ) : (
                      latestEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-2xl bg-white p-4 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-black text-slate-950">
                              {event.event_type.replaceAll("_", " ")}
                            </div>
                            <div className="text-xs font-semibold text-slate-500">
                              {event.source}
                            </div>
                          </div>
                          <div className="mt-2 text-xs font-semibold text-slate-500">
                            {formatDateTime(event.event_time)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
