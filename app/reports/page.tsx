"use client";

import ExecutiveDashboard from "@/components/ExecutiveDashboard";
import PayrollRiskEngine from "@/components/PayrollRiskEngine";

export default function ReportsPage() {
  return (
    <main className="vyron-shell p-6 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-8">
        <ExecutiveDashboard />
        <PayrollRiskEngine />
      </div>
    </main>
  );
}