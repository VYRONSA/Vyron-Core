"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

/**
 * Live figures only: the current pay period's generated payroll hours, priced at each
 * employee's own hourly rate. No demo amounts and no default rate — an employee without a
 * rate on file adds no rand value, and missing clock-outs are counted, not priced.
 */
type LeakageItem = { title: string; value: string; detail: string };

type PayrollRow = {
  employee_id: string;
  late_minutes: number | null;
  early_departure_minutes: number | null;
  overtime_hours: number | null;
  missing_clock_events: number | null;
  status: string | null;
};

const zar = (value: number) => `R${Math.round(value).toLocaleString("en-ZA")}`;

function currentPeriod() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

const EMPTY_DETAIL = "Generate this period's hours in Payroll Prep to measure it.";

function useLiveLeakage() {
  const [items, setItems] = useState<LeakageItem[]>([
    { title: "Late arrivals", value: "—", detail: EMPTY_DETAIL },
    { title: "Early departures", value: "—", detail: EMPTY_DETAIL },
    { title: "Missing clock events", value: "—", detail: EMPTY_DETAIL },
    { title: "Unapproved overtime", value: "—", detail: EMPTY_DETAIL },
  ]);
  const [exposure, setExposure] = useState("—");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { access } = await getCompanyAccess(supabase);
      const companyId = access?.company_id;
      if (!companyId) return;
      const period = currentPeriod();
      const [hoursRes, employeesRes] = await Promise.all([
        supabase
          .from("payroll_hours")
          .select("employee_id,late_minutes,early_departure_minutes,overtime_hours,missing_clock_events,status")
          .eq("company_id", companyId)
          .eq("period_start", period.start)
          .eq("period_end", period.end),
        supabase.from("employees").select("id,hourly_rate").eq("company_id", companyId),
      ]);
      if (cancelled || hoursRes.error || employeesRes.error) return;
      const rows = (hoursRes.data || []) as PayrollRow[];
      if (!rows.length) return;
      const rate = new Map(
        ((employeesRes.data || []) as { id: string; hourly_rate: number | null }[]).map((e) => [e.id, Number(e.hourly_rate || 0)])
      );
      const priced = (minutes: number, employeeId: string) => (minutes / 60) * (rate.get(employeeId) || 0);
      let late = 0, lateStaff = 0, early = 0, earlyStaff = 0, overtime = 0, overtimeStaff = 0, missing = 0;
      for (const row of rows) {
        if (Number(row.late_minutes || 0) > 0) { lateStaff += 1; late += priced(Number(row.late_minutes), row.employee_id); }
        if (Number(row.early_departure_minutes || 0) > 0) { earlyStaff += 1; early += priced(Number(row.early_departure_minutes), row.employee_id); }
        if (Number(row.overtime_hours || 0) > 0 && row.status !== "approved" && row.status !== "exported") {
          overtimeStaff += 1;
          overtime += priced(Number(row.overtime_hours) * 60, row.employee_id);
        }
        missing += Number(row.missing_clock_events || 0);
      }
      if (cancelled) return;
      setItems([
        { title: "Late arrivals", value: zar(late), detail: `${lateStaff} employee(s) with late minutes this period` },
        { title: "Early departures", value: zar(early), detail: `${earlyStaff} employee(s) left before the rostered end` },
        { title: "Missing clock events", value: String(missing), detail: "Payroll cannot be trusted until cleared (counted, not priced)" },
        { title: "Unapproved overtime", value: zar(overtime), detail: `${overtimeStaff} employee(s) with overtime not yet approved` },
      ]);
      setExposure(zar(late + early + overtime));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { items, exposure };
}

export default function LabourLeakageEngine() {
  const { items: leakageItems, exposure } = useLiveLeakage();
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            UMORA
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Labour Leakage Engine
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Converts attendance, clocking, roster and payroll problems into estimated rand-value loss.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-rose-600 to-orange-500 p-5 text-white shadow-[0_18px_45px_rgba(225,29,72,0.25)]">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-rose-100">
            Estimated exposure
          </div>
          <div className="mt-2 text-4xl font-black">{exposure}</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {leakageItems.map((item) => (
          <article key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <TrendingUp className="h-5 w-5 text-rose-500" />
            </div>

            <div className="mt-6 text-3xl font-black text-slate-950">{item.value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{item.title}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-3">
        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <WalletCards className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Payroll Protection Rule</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Do not export payroll while unresolved blocker value is above the company risk threshold.
          </p>
        </div>

        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <Clock3 className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Manager Review SLA</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            All missing clocks and overtime issues should be cleared before payroll close.
          </p>
        </div>

        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <TrendingDown className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Savings Target</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Set a leakage-reduction target once a full pay period of live data is available.
          </p>
        </div>
      </div>
    </section>
  );
}
