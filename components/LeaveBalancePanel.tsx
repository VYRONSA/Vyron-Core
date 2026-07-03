"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  RefreshCcw,
  Save,
  Search,
} from "lucide-react";
import { normalizeLeaveBalanceRow } from "@/lib/leave-balance-adapter";
import { supabase } from "../lib/supabase";

type LeaveBalanceLive = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  cycle_start: string;
  cycle_end: string;

  opening_balance_days: number;
  cycle_leave_entitlement_days: number;
  monthly_accrual_days: number;
  completed_months: number;
  days_accrued_live: number;

  days_taken: number;
  pending_days: number;
  adjustment_days: number;
  carry_forward_days: number;
  days_due_live: number;

  accrual_frequency: string;
  accrual_start_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const leaveTypeLabels: Record<string, string> = {
  annual_leave: "Annual leave",
  sick_leave: "Sick leave",
  family_responsibility_leave: "Family responsibility",
  unpaid_leave: "Unpaid leave",
  study_leave: "Study leave",
  other: "Other",
};

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

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDays(value: number | string | null | undefined) {
  return numberValue(value).toFixed(2);
}

function balanceTone(value: number) {
  if (value < 0) return "border-rose-200 bg-rose-50 text-rose-800";
  if (value <= 2) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatText(value: string) {
  return value.replaceAll("_", " ");
}

export default function LeaveBalancePanel({
  companyId,
  onUpdated,
}: {
  companyId?: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [balances, setBalances] = useState<LeaveBalanceLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedBalanceId, setSelectedBalanceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBalance = balances.find((item) => item.id === selectedBalanceId) || null;

  const filteredBalances = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return balances;

    return balances.filter((balance) => {
      const text = [
        balance.employee_id,
        balance.employee_name,
        balance.leave_type,
        leaveTypeLabels[balance.leave_type] || "",
        balance.status,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(term);
    });
  }, [balances, search]);

  const lowBalanceCount = useMemo(
    () =>
      balances.filter(
        (balance) => balance.status === "active" && Number(balance.days_due_live || 0) <= 2
      ).length,
    [balances]
  );

  const negativeBalanceCount = useMemo(
    () =>
      balances.filter(
        (balance) => balance.status === "active" && Number(balance.days_due_live || 0) < 0
      ).length,
    [balances]
  );

  const totalDaysDueAnnual = useMemo(
    () =>
      balances
        .filter((balance) => balance.leave_type === "annual_leave" && balance.status === "active")
        .reduce((sum, balance) => sum + Number(balance.days_due_live || 0), 0),
    [balances]
  );

  async function fetchBalances() {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("leave_balances_live")
      .select("*")
      .order("employee_name", { ascending: true })
      .order("leave_type", { ascending: true });
    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const loaded = (data || []).map((row) => {
      const normalized = normalizeLeaveBalanceRow(row as Record<string, unknown>);
      return {
        ...normalized,
        cycle_leave_entitlement_days: normalized.cycle_leave_entitlement_days || normalized.days_accrued_live,
        monthly_accrual_days: 0,
        completed_months: 0,
        accrual_frequency: "monthly",
        accrual_start_date: normalized.cycle_start,
        notes: null,
        created_at: String((row as Record<string, unknown>).created_at || ""),
        updated_at: String((row as Record<string, unknown>).updated_at || ""),
      } as LeaveBalanceLive;
    });
    setBalances(loaded);

    if (!selectedBalanceId && loaded.length > 0) {
      setSelectedBalanceId(loaded[0].id);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (companyId) void fetchBalances();
  }, [companyId]);

  function updateBalanceField(
    id: string,
    field: keyof LeaveBalanceLive,
    value: string | number
  ) {
    setBalances((current) =>
      current.map((balance) =>
        balance.id === id
          ? {
              ...balance,
              [field]: value,
            }
          : balance
      )
    );
  }

  async function saveBalance(balance: LeaveBalanceLive) {
    setSavingId(balance.id);
    setError(null);

    const { error: updateError } = await supabase
      .from("leave_balances")
      .update({
        opening_balance: numberValue(balance.opening_balance_days),
        accrued: numberValue(balance.days_accrued_live || balance.cycle_leave_entitlement_days),
        taken: numberValue(balance.days_taken),
        updated_at: new Date().toISOString(),
      })
      .eq("id", balance.id);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    await fetchBalances();

    if (onUpdated) {
      await onUpdated();
    }

    setSavingId(null);
  }

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
          Leave Control
        </div>
        <h2 className="mt-3 text-3xl font-bold">Leave Balances Setup</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          Manage opening balances, monthly accrual, days taken and days due.
          Days Due calculates automatically from the live Supabase view.
        </p>

        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Low balance warnings
            </div>
            <div className="mt-2 text-4xl font-black text-amber-300">
              {lowBalanceCount}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Negative balances</div>
              <div className="mt-2 text-2xl font-black text-rose-300">
                {negativeBalanceCount}
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Annual days due</div>
              <div className="mt-2 text-2xl font-black text-emerald-300">
                {formatDays(totalDaysDueAnnual)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-slate-300">
          Formula: Opening Balance + Carry Forward + Days Accrued + Adjustments −
          Days Taken − Pending Days = Days Due.
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              VYRON CORE
            </div>
            <h2 className="mt-2 text-3xl font-bold text-slate-950">
              Employee Leave Balances
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Search staff and maintain their cycle entitlement and balance fields.
            </p>
          </div>

          <button
            onClick={fetchBalances}
            className="flex w-fit items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by employee name, code or leave type..."
            className="w-full bg-transparent text-sm font-semibold outline-none"
          />
        </div>

        {error && (
          <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
            Loading leave balances...
          </div>
        ) : filteredBalances.length === 0 ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
            <div className="mt-3 text-lg font-bold text-slate-950">
              No leave balances found
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Run the Leave Balance V2 SQL setup to create current balance rows.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              {filteredBalances.map((balance) => (
                <button
                  key={balance.id}
                  onClick={() => setSelectedBalanceId(balance.id)}
                  className={`w-full rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    selectedBalanceId === balance.id
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-950">
                        {balance.employee_name || "Unknown employee"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {balance.employee_id} ·{" "}
                        {leaveTypeLabels[balance.leave_type] || formatText(balance.leave_type)}
                      </div>
                    </div>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-black ${balanceTone(
                        Number(balance.days_due_live || 0)
                      )}`}
                    >
                      Due: {formatDays(balance.days_due_live)}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-2">
                    <div>Accrued: {formatDays(balance.days_accrued_live)}</div>
                    <div>Taken: {formatDays(balance.days_taken)}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              {!selectedBalance ? (
                <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                  <CalendarDays className="h-12 w-12 text-slate-300" />
                  <div className="mt-3 text-lg font-bold text-slate-950">
                    Select a balance
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Choose an employee balance on the left to edit it.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-2xl font-black text-slate-950">
                        {selectedBalance.employee_name}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {selectedBalance.employee_id} ·{" "}
                        {leaveTypeLabels[selectedBalance.leave_type] ||
                          formatText(selectedBalance.leave_type)}
                      </p>
                    </div>

                    <span
                      className={`rounded-2xl border px-4 py-3 text-sm font-black ${balanceTone(
                        Number(selectedBalance.days_due_live || 0)
                      )}`}
                    >
                      Days Due: {formatDays(selectedBalance.days_due_live)}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-bold text-slate-800">
                      Opening Balance
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.opening_balance_days}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "opening_balance_days",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Cycle Leave Entitlement
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.cycle_leave_entitlement_days}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "cycle_leave_entitlement_days",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                        Monthly Accrual
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {formatDays(selectedBalance.monthly_accrual_days)}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                        Days Accrued
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-950">
                        {formatDays(selectedBalance.days_accrued_live)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {selectedBalance.completed_months} completed months
                      </div>
                    </div>

                    <label className="text-sm font-bold text-slate-800">
                      Days Taken
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.days_taken}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "days_taken",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Pending Days
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.pending_days}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "pending_days",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Carry Forward Days
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.carry_forward_days}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "carry_forward_days",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Adjustments
                      <input
                        type="number"
                        step="0.25"
                        value={selectedBalance.adjustment_days}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "adjustment_days",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Accrual Frequency
                      <select
                        value={selectedBalance.accrual_frequency}
                        onChange={(event) =>
                          updateBalanceField(
                            selectedBalance.id,
                            "accrual_frequency",
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="manual">Manual</option>
                        <option value="none">None</option>
                      </select>
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Status
                      <select
                        value={selectedBalance.status}
                        onChange={(event) =>
                          updateBalanceField(selectedBalance.id, "status", event.target.value)
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      >
                        <option value="active">Active</option>
                        <option value="closed">Closed</option>
                        <option value="archived">Archived</option>
                      </select>
                    </label>
                  </div>

                  <label className="mt-4 block text-sm font-bold text-slate-800">
                    Notes
                    <textarea
                      value={selectedBalance.notes || ""}
                      onChange={(event) =>
                        updateBalanceField(selectedBalance.id, "notes", event.target.value)
                      }
                      rows={4}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"
                      placeholder="Optional leave balance notes..."
                    />
                  </label>

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                      Days Due Calculation
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">
                      Opening + Carry Forward + Days Accrued + Adjustments − Days Taken − Pending
                    </div>
                    <div className="mt-3 text-4xl font-black text-slate-950">
                      {formatDays(selectedBalance.days_due_live)} days
                    </div>
                  </div>

                  <button
                    onClick={() => saveBalance(selectedBalance)}
                    disabled={savingId === selectedBalance.id}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {savingId === selectedBalance.id ? "Saving..." : "Save Leave Balance"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
