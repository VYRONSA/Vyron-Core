"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
  company_id?: string | null;
};

type StoreRow = {
  id: string;
  name: string;
};

type SortKey =
  | "employee_number"
  | "first_name"
  | "last_name"
  | "email"
  | "job_title"
  | "active";

function toLabel(employee: EmployeeRow) {
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

export default function AdvancedEmployeeGlobalSearch() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [store, setStore] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "archived" | "terminated">("all");
  const [supervisor, setSupervisor] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("first_name");
  const [sortAscending, setSortAscending] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    const { access, error: accessError } = await getCompanyAccess(supabase);
    if (accessError || !access?.company_id) {
      setError(accessError || "No company access.");
      setLoading(false);
      return;
    }

    const [employeeResult, storeResult] = await Promise.all([
      supabase
        .from("employees")
        .select(
          "id,employee_number,first_name,last_name,email,phone,job_title,default_store_id,active,company_id"
        )
        .eq("company_id", access.company_id)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name")
        .eq("company_id", access.company_id)
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

  const storeMap = useMemo(() => {
    const map = new Map<string, string>();
    stores.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [stores]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const employeeNoQ = employeeNumber.trim().toLowerCase();
    const emailQ = email.trim().toLowerCase();
    const departmentQ = department.trim().toLowerCase();
    const storeQ = store.trim().toLowerCase();
    const positionQ = position.trim().toLowerCase();
    const supervisorQ = supervisor.trim().toLowerCase();

    return employees.filter((employee) => {
      const displayStore = storeMap.get(employee.default_store_id || "") || "";
      const text = [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.email || "",
        employee.job_title || "",
        displayStore,
      ]
        .join(" ")
        .toLowerCase();

      if (q && !text.includes(q)) return false;
      if (employeeNoQ && !String(employee.employee_number || "").toLowerCase().includes(employeeNoQ)) {
        return false;
      }
      if (emailQ && !String(employee.email || "").toLowerCase().includes(emailQ)) return false;
      if (positionQ && !String(employee.job_title || "").toLowerCase().includes(positionQ)) return false;
      if (storeQ && !displayStore.toLowerCase().includes(storeQ)) return false;
      if (departmentQ && !text.includes(departmentQ)) return false;
      if (supervisorQ && !text.includes(supervisorQ)) return false;

      if (status === "active" && employee.active === false) return false;
      if ((status === "archived" || status === "terminated") && employee.active !== false) return false;

      return true;
    });
  }, [
    employees,
    query,
    employeeNumber,
    email,
    department,
    store,
    position,
    status,
    supervisor,
    storeMap,
  ]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const left =
        sortKey === "active"
          ? String(a.active)
          : String((a as Record<string, unknown>)[sortKey] || "").toLowerCase();
      const right =
        sortKey === "active"
          ? String(b.active)
          : String((b as Record<string, unknown>)[sortKey] || "").toLowerCase();

      if (left < right) return sortAscending ? -1 : 1;
      if (left > right) return sortAscending ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortAscending]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page]);

  function clearFilters() {
    setQuery("");
    setEmployeeNumber("");
    setEmail("");
    setDepartment("");
    setStore("");
    setPosition("");
    setStatus("all");
    setSupervisor("");
    setPage(1);
  }

  return (
    <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Employee Search</div>
      <h2 className="mt-2 text-3xl font-black text-slate-950">Advanced Employee Finder</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Search by employee number, name, surname, email, department, store, position, status and supervisor with sorting and pagination.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="relative md:col-span-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search by employee number, name, surname, email, ID number, store, position..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm font-semibold outline-none focus:border-blue-500"
          />
        </label>

        <input
          value={employeeNumber}
          onChange={(event) => {
            setEmployeeNumber(event.target.value);
            setPage(1);
          }}
          placeholder="Employee number"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <input
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setPage(1);
          }}
          placeholder="Email"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <input
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setPage(1);
          }}
          placeholder="Department"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <input
          value={store}
          onChange={(event) => {
            setStore(event.target.value);
            setPage(1);
          }}
          placeholder="Store"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <input
          value={position}
          onChange={(event) => {
            setPosition(event.target.value);
            setPage(1);
          }}
          placeholder="Position"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <input
          value={supervisor}
          onChange={(event) => {
            setSupervisor(event.target.value);
            setPage(1);
          }}
          placeholder="Supervisor"
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />

        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as any);
            setPage(1);
          }}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="terminated">Terminated</option>
        </select>

        <button
          onClick={clearFilters}
          className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700"
        >
          Clear Filters
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="text-sm font-bold text-slate-700">Sort by</label>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
        >
          <option value="first_name">First name</option>
          <option value="last_name">Last name</option>
          <option value="employee_number">Employee number</option>
          <option value="email">Email</option>
          <option value="job_title">Position</option>
          <option value="active">Status</option>
        </select>
        <button
          onClick={() => setSortAscending((value) => !value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700"
        >
          {sortAscending ? "Ascending" : "Descending"}
        </button>
      </div>

      {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full bg-white text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Employee #</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-8 text-center font-semibold text-slate-500" colSpan={6}>
                  Loading employees...
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center font-semibold text-slate-500" colSpan={6}>
                  No employee matches.
                </td>
              </tr>
            ) : (
              paged.map((employee) => (
                <tr key={employee.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-bold text-slate-700">{employee.employee_number || "-"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{toLabel(employee)}</td>
                  <td className="px-4 py-3 text-slate-700">{employee.email || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{employee.job_title || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{storeMap.get(employee.default_store_id || "") || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                        employee.active !== false
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {employee.active !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-600">
          Showing {paged.length} of {sorted.length} results
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-24 text-center text-sm font-black text-slate-700">
            Page {page} / {totalPages}
          </div>
          <button
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
