"use client";

import { CheckCircle2, Download, FileSpreadsheet, Lock, ShieldCheck, WalletCards } from "lucide-react";

const exportRows = [
  {
    employee: "Jason Peters",
    normal: "173.50",
    overtime: "8.25",
    status: "Ready",
  },
  {
    employee: "Amy Daniels",
    normal: "168.00",
    overtime: "0.00",
    status: "Ready",
  },
  {
    employee: "John Smith",
    normal: "155.25",
    overtime: "12.50",
    status: "Review",
  },
];

function downloadPayrollCsv() {
  const header = ["Employee", "Normal Hours", "Overtime Hours", "Status"];
  const rows = exportRows.map((row) => [row.employee, row.normal, row.overtime, row.status]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vyron-core-payroll-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PayrollExportCommandCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
              <WalletCards className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
                Payroll Export
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                Payroll Export Command Centre
              </h2>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">
            Prepare clean payroll exports for Sage Pastel, SimplePay or generic payroll import after blockers have been cleared.
          </p>
        </div>

        <button
          onClick={downloadPayrollCsv}
          className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Export Readiness", "87%", <ShieldCheck className="h-6 w-6" />],
          ["Ready Employees", "42", <CheckCircle2 className="h-6 w-6" />],
          ["Blocked Employees", "6", <Lock className="h-6 w-6" />],
          ["Export Formats", "3", <FileSpreadsheet className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700 w-fit">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-[28px] border border-slate-200 bg-white">
        <div className="grid grid-cols-4 bg-slate-50 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          <div>Employee</div>
          <div>Normal</div>
          <div>Overtime</div>
          <div>Status</div>
        </div>

        {exportRows.map((row) => (
          <div key={row.employee} className="grid grid-cols-4 border-t border-slate-100 px-5 py-4 text-sm font-semibold text-slate-700">
            <div className="font-black text-slate-950">{row.employee}</div>
            <div>{row.normal}</div>
            <div>{row.overtime}</div>
            <div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${
                row.status === "Ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}>
                {row.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
