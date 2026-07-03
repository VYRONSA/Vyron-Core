"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Building2,
  HeartPulse,
  Monitor,
  Rocket,
  Upload,
  WalletCards,
} from "lucide-react";
import ClientHealthDashboard from "@/components/pilot-readiness/ClientHealthDashboard";
import CompanySetupWizard from "@/components/pilot-readiness/CompanySetupWizard";
import EmployeeImportWizard from "@/components/pilot-readiness/EmployeeImportWizard";
import FirstPayrollChecklist from "@/components/pilot-readiness/FirstPayrollChecklist";
import KioskDeploymentWizard from "@/components/pilot-readiness/KioskDeploymentWizard";
import TrainingCentrePanel from "@/components/TrainingCentrePanel";
import { supabase } from "@/lib/supabase";
import {
  computePilotReadiness,
  readTrainingProgress,
} from "@/lib/pilot-client-readiness";

type StoreRow = { id: string; name: string };
type EmployeeRow = {
  id: string;
  pin_code?: string | null;
  kiosk_access_enabled?: boolean | null;
};
type RosterShiftRow = { id: string };
type ClockEventRow = { id: string };
type PayrollHoursRow = { id: string; status?: string | null };
type ExceptionRow = { status: string };
type HrCaseRow = { status?: string | null };

type TabId = "overview" | "company" | "employees" | "kiosks" | "payroll" | "training";

type Props = {
  companyId: string;
  companyName: string;
  companyContactSet?: boolean;
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  payrollHours: PayrollHoursRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  onRefresh: () => void;
  onNavigate: (route: string) => void;
};

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Health", icon: <HeartPulse className="h-4 w-4" /> },
  { id: "company", label: "Company", icon: <Building2 className="h-4 w-4" /> },
  { id: "employees", label: "Employees", icon: <Upload className="h-4 w-4" /> },
  { id: "kiosks", label: "Kiosks", icon: <Monitor className="h-4 w-4" /> },
  { id: "payroll", label: "Payroll", icon: <WalletCards className="h-4 w-4" /> },
  { id: "training", label: "Training", icon: <BookOpen className="h-4 w-4" /> },
];

export default function PilotClientReadinessProgram({
  companyId,
  companyName,
  companyContactSet = false,
  stores,
  employees,
  rosterShifts,
  clockEvents,
  payrollHours,
  exceptions,
  hrCases,
  onRefresh,
  onNavigate,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [trainingProgress, setTrainingProgress] = useState<string[]>([]);
  const [profileContactSet, setProfileContactSet] = useState(companyContactSet);

  useEffect(() => {
    setTrainingProgress(readTrainingProgress(companyId));
  }, [companyId, activeTab]);

  useEffect(() => {
    setProfileContactSet(companyContactSet);
  }, [companyContactSet]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("companies")
        .select("contact_person,phone")
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled || !data) return;
      setProfileContactSet(
        Boolean(String(data.contact_person || "").trim() || String(data.phone || "").trim())
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, companyName]);

  const report = useMemo(
    () =>
      computePilotReadiness({
        companyId,
        companyName,
        companyContactSet: profileContactSet,
        stores,
        employees,
        rosterShifts,
        clockEvents,
        payrollHours,
        exceptions,
        hrCases,
        trainingCompletedIds: trainingProgress,
      }),
    [
      companyId,
      companyName,
      profileContactSet,
      stores,
      employees,
      rosterShifts,
      clockEvents,
      payrollHours,
      exceptions,
      hrCases,
      trainingProgress,
    ]
  );

  function handleTrainingProgressChange(ids: string[]) {
    setTrainingProgress(ids);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-white/80 bg-gradient-to-r from-[#06101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.4em] text-cyan-300">
              <Rocket className="h-4 w-4" />
              Pilot Client Readiness
            </div>
            <h1 className="mt-3 text-4xl font-black tracking-tight">30-minute onboarding program</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              Guided wizards for company setup, employee import, kiosk deployment, first payroll, and
              training — with live completion metrics.
            </p>
          </div>
          <div className="rounded-[1.5rem] bg-white/10 px-6 py-4 text-center backdrop-blur">
            <div className="text-xs font-black uppercase tracking-wider text-cyan-200">Overall</div>
            <div className="text-4xl font-black">{report.overallPercent}%</div>
            <div className="mt-1 text-xs text-slate-300">
              ~{report.estimatedMinutesRemaining}m remaining
            </div>
          </div>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition ${
              activeTab === tab.id
                ? "bg-[#06101f] text-cyan-300 shadow-lg"
                : "bg-white text-slate-700 shadow-sm hover:bg-slate-50"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && <ClientHealthDashboard report={report} />}

      {activeTab === "company" && (
        <CompanySetupWizard
          companyId={companyId}
          companyName={companyName}
          stores={stores}
          onRefresh={onRefresh}
        />
      )}

      {activeTab === "employees" && (
        <EmployeeImportWizard
          companyId={companyId}
          stores={stores}
          employeeCount={employees.length}
          onRefresh={onRefresh}
          onOpenFullImport={() => onNavigate("Import Staff")}
        />
      )}

      {activeTab === "kiosks" && (
        <KioskDeploymentWizard report={report} employeeCount={employees.length} />
      )}

      {activeTab === "payroll" && (
        <FirstPayrollChecklist report={report} onNavigate={onNavigate} />
      )}

      {activeTab === "training" && (
        <TrainingCentrePanel
          companyId={companyId}
          onProgressChange={handleTrainingProgressChange}
        />
      )}
    </div>
  );
}
