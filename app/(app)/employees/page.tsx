"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCcw,
  Save,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
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
  email: string | null;
  phone: string | null;
  employment_type: string | null;
  pin_code?: string | null;
  kiosk_access_enabled?: boolean | null;
};

function employeeName(employee: EmployeeRow) {
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
        active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
      />
    </label>
  );
}

export default function EmployeesPage() {
  const [companyId, setCompanyId] = useState("");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [defaultStoreId, setDefaultStoreId] = useState("");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [kioskEnabled, setKioskEnabled] = useState(true);
  const [activeStatus, setActiveStatus] = useState(true);

  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = employees.find((item) => item.id === selectedEmployeeId) || null;

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return employees;

    return employees.filter((employee) => {
      const text = [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.job_title || "",
        employee.email || "",
        employee.phone || "",
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(term);
    });
  }, [employees, search]);

  const activeCount = useMemo(
    () => employees.filter((employee) => employee.active !== false).length,
    [employees]
  );

  const inactiveCount = useMemo(
    () => employees.filter((employee) => employee.active === false).length,
    [employees]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        setLoading(false);
        return;
      }

      setCompanyId(access.company_id);
      await loadData(access.company_id);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;

    setEmployeeNumber(selectedEmployee.employee_number || "");
    setFirstName(selectedEmployee.first_name || "");
    setLastName(selectedEmployee.last_name || "");
    setJobTitle(selectedEmployee.job_title || "");
    setDefaultStoreId(selectedEmployee.default_store_id || "");
    setEmploymentType(selectedEmployee.employment_type || "permanent");
    setPhone(selectedEmployee.phone || "");
    setEmail(selectedEmployee.email || "");
    setPinCode(selectedEmployee.pin_code || "");
    setKioskEnabled(selectedEmployee.kiosk_access_enabled !== false);
    setActiveStatus(selectedEmployee.active !== false);
    setMessage(null);
    setError(null);
  }, [selectedEmployee]);

  async function loadData(activeCompanyId: string) {
    setLoading(true);
    setError(null);

    const [employeesResult, storesResult] = await Promise.all([
      supabase
        .from("employees")
        .select(
          "id,company_id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,employment_type,pin_code,kiosk_access_enabled"
        )
        .eq("company_id", activeCompanyId)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name,city,region,status")
        .eq("company_id", activeCompanyId)
        .order("name", { ascending: true }),
    ]);

    if (employeesResult.error) {
      setError(employeesResult.error.message);
      setLoading(false);
      return;
    }

    if (storesResult.error) {
      setError(storesResult.error.message);
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeesResult.data || []) as EmployeeRow[];

    setEmployees(loadedEmployees);
    setStores((storesResult.data || []) as StoreRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  function generatePin() {
    setPinCode(String(Math.floor(1000 + Math.random() * 9000)));
  }

  async function saveEmployee() {
    if (!selectedEmployee) {
      setError("Select an employee first.");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }

    if (pinCode.trim() && !/^\d{4}$/.test(pinCode.trim())) {
      setError("PIN must be exactly 4 numbers.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("employees")
      .update({
        employee_number: employeeNumber.trim() || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        job_title: jobTitle.trim() || null,
        default_store_id: defaultStoreId || null,
        employment_type: employmentType || "permanent",
        phone: phone.trim() || null,
        email: email.trim() || null,
        pin_code: pinCode.trim() || null,
        kiosk_access_enabled: kioskEnabled,
        active: activeStatus,
      })
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage("Employee updated successfully.");
    setSaving(false);
    if (companyId) await loadData(companyId);
  }

  function storeName(id: string | null) {
    if (!id) return "No default store";
    return stores.find((store) => store.id === id)?.name || "Unknown store";
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
                VYRON CORE
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">
                Employee Manager
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Open, edit, save, activate/deactivate employees and manage kiosk PINs.
              </p>
            </div>

            <button
              onClick={() => companyId && loadData(companyId)}
              className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-xl"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </header>

        <section className="mt-6 grid gap-5 md:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <Users className="h-7 w-7 text-blue-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Total employees
            </div>
            <div className="mt-2 text-4xl font-black">{employees.length}</div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Active
            </div>
            <div className="mt-2 text-4xl font-black">{activeCount}</div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <AlertTriangle className="h-7 w-7 text-rose-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Inactive
            </div>
            <div className="mt-2 text-4xl font-black">{inactiveCount}</div>
          </div>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Employees</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Click an employee to edit.
                </p>
              </div>
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees..."
              className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
            />

            <div className="mt-5 space-y-3">
              {loading ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                  Loading employees...
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                  No employees found.
                </div>
              ) : (
                filteredEmployees.map((employee) => {
                  const selected = employee.id === selectedEmployeeId;

                  return (
                    <button
                      key={employee.id}
                      onClick={() => setSelectedEmployeeId(employee.id)}
                      className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                        selected
                          ? "border-blue-400 bg-blue-50 shadow-lg"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-lg font-bold text-slate-950">
                            {employeeName(employee)}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {employee.employee_number || "No employee number"} ·{" "}
                            {employee.job_title || "No job title"}
                          </div>
                        </div>
                        <StatusPill active={employee.active !== false} />
                      </div>

                      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                        <div className="rounded-2xl bg-white p-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Store
                          </div>
                          <div className="mt-1 font-bold">
                            {storeName(employee.default_store_id)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Contact
                          </div>
                          <div className="mt-1 font-bold">
                            {employee.phone || employee.email || "Not loaded"}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            {!selectedEmployee ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                <UserRound className="h-14 w-14 text-slate-300" />
                <h2 className="mt-4 text-2xl font-bold">Select an employee</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Choose an employee on the left to open the editable profile.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                      Employee Profile
                    </div>
                    <h2 className="mt-2 text-3xl font-bold text-slate-950">
                      {employeeName(selectedEmployee)}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Edit and save this employee record.
                    </p>
                  </div>

                  <ShieldCheck className="h-9 w-9 text-blue-600" />
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <Field
                    label="Employee number"
                    value={employeeNumber}
                    onChange={setEmployeeNumber}
                    placeholder="EMP001"
                  />
                  <Field
                    label="Job title"
                    value={jobTitle}
                    onChange={setJobTitle}
                    placeholder="Counter Assistant"
                  />
                  <Field
                    label="First name"
                    value={firstName}
                    onChange={setFirstName}
                    placeholder="First name"
                  />
                  <Field
                    label="Last name"
                    value={lastName}
                    onChange={setLastName}
                    placeholder="Last name"
                  />
                  <Field
                    label="Phone"
                    value={phone}
                    onChange={setPhone}
                    placeholder="082..."
                  />
                  <Field
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@email.com"
                    type="email"
                  />
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-bold text-slate-800">
                    Default store
                    <select
                      value={defaultStoreId}
                      onChange={(event) => setDefaultStoreId(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                    >
                      <option value="">No default store</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm font-bold text-slate-800">
                    Employment type
                    <select
                      value={employmentType}
                      onChange={(event) => setEmploymentType(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                    >
                      <option value="permanent">Permanent</option>
                      <option value="temporary">Temporary</option>
                      <option value="part_time">Part-time</option>
                      <option value="casual">Casual</option>
                      <option value="contractor">Contractor</option>
                    </select>
                  </label>
                </div>

                <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    Employee PIN / Kiosk Access
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                    <input
                      value={pinCode}
                      onChange={(event) =>
                        setPinCode(event.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="4-digit PIN"
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
                    />

                    <button
                      onClick={generatePin}
                      className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"
                    >
                      Auto Generate PIN
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => setKioskEnabled((value) => !value)}
                      className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${
                        kioskEnabled ? "bg-emerald-600" : "bg-rose-600"
                      }`}
                    >
                      Kiosk Access: {kioskEnabled ? "Enabled" : "Disabled"}
                    </button>

                    <button
                      onClick={() => setActiveStatus((value) => !value)}
                      className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${
                        activeStatus ? "bg-emerald-600" : "bg-rose-600"
                      }`}
                    >
                      Employee Status: {activeStatus ? "Active" : "Inactive"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                    {message}
                  </div>
                )}

                <button
                  onClick={saveEmployee}
                  disabled={saving}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Employee Changes"}
                </button>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
