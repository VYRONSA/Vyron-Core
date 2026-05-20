$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

$connectedScreens = @'

function ActionHubCard({
  title,
  value,
  subtitle,
  target,
  setActive,
}: {
  title: string;
  value?: string | number;
  subtitle: string;
  target: string;
  setActive: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => setActive(target)}
      className="group w-full rounded-[28px] border border-white/80 bg-white/95 p-5 text-left text-slate-950 shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(37,99,235,0.16)]"
    >
      <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-700">{title}</div>
      {value !== undefined && <div className="mt-4 text-4xl font-black tracking-tight">{value}</div>}
      <p className="mt-3 text-sm leading-6 text-slate-500">{subtitle}</p>
      <div className="mt-5 text-sm font-black text-cyan-700">Open workflow →</div>
    </button>
  );
}

function ConnectedDashboardScreen({
  stores,
  employees,
  exceptions,
  hrCases,
  payrollHours,
  payrollClockChecks,
  leaveRequests,
  setActive,
  onRefresh,
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  payrollClockChecks: PayrollClockCheckRow[];
  leaveRequests: LeaveRequestRow[];
  setActive: (value: string) => void;
  onRefresh: () => void;
}) {
  const openExceptions = exceptions.filter(exceptionIsOpen).length;
  const openHrCases = hrCases.filter(hrCaseIsOpen).length;
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem).length + payrollClockChecks.filter((item) => item.manager_review_status !== "approved").length;
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending").length;

  return (
    <div className="min-h-screen bg-[#07101f] p-4 text-white md:p-8">
      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">VYRON CORE</div>
          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">Dashboard</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            Every card opens a real workflow. This dashboard is the live control centre for staff, clocking, HR, leave and payroll.
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
          Refresh live data
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <ActionHubCard title="Active Staff" value={employees.filter((item) => item.active).length} subtitle="Open staff records, HR files and employee actions." target="Employees" setActive={setActive} />
        <ActionHubCard title="Stores" value={stores.length} subtitle="Open locations, GPS rules and store setup." target="Stores" setActive={setActive} />
        <ActionHubCard title="Open Exceptions" value={openExceptions} subtitle="Investigate unresolved exceptions." target="Exceptions" setActive={setActive} />
        <ActionHubCard title="Payroll Blockers" value={payrollBlockers} subtitle="Review payroll checks and blockers." target="Payroll Prep" setActive={setActive} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <ActionHubCard title="Clocking Issues" subtitle="Review live clocking and missing events." target="Clocking" setActive={setActive} />
        <ActionHubCard title="HR Risk" value={openHrCases} subtitle="Open HR cases and warnings." target="HR Cases" setActive={setActive} />
        <ActionHubCard title="Leave Approvals" value={pendingLeave} subtitle="Open pending leave decisions." target="Leave Management" setActive={setActive} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ActionHubCard title="Business Insights" subtitle="Open labour, payroll and store intelligence." target="Workforce Intelligence" setActive={setActive} />
        <ActionHubCard title="Smart Alerts" subtitle="Open live alerts and action queues." target="Smart Detection" setActive={setActive} />
      </div>
    </div>
  );
}

function ConnectedInsightsScreen({
  stores,
  employees,
  exceptions,
  hrCases,
  payrollHours,
  payrollClockChecks,
  setActive,
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  payrollClockChecks: PayrollClockCheckRow[];
  setActive: (value: string) => void;
}) {
  const openExceptions = exceptions.filter(exceptionIsOpen).length;
  const openHrCases = hrCases.filter(hrCaseIsOpen).length;
  const payrollRisk = payrollHours.filter(rowHasPayrollProblem).length + payrollClockChecks.filter((item) => item.manager_review_status !== "approved").length;

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Business Insights</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Actionable workforce intelligence</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Every insight opens a real operational workflow.</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <ActionHubCard title="Labour Risk" value={openExceptions} subtitle="Open exception investigations." target="Exceptions" setActive={setActive} />
        <ActionHubCard title="HR Exposure" value={openHrCases} subtitle="Open HR case review." target="HR Cases" setActive={setActive} />
        <ActionHubCard title="Payroll Risk" value={payrollRisk} subtitle="Open payroll blockers." target="Payroll Prep" setActive={setActive} />
        <ActionHubCard title="Store Performance" value={stores.length} subtitle="Open stores and locations." target="Stores" setActive={setActive} />
        <ActionHubCard title="Staff Coverage" value={employees.filter((item) => item.active).length} subtitle="Open active staff list." target="Employees" setActive={setActive} />
        <ActionHubCard title="Reports" subtitle="Open reports centre." target="Reports Centre" setActive={setActive} />
      </div>
    </div>
  );
}

function AutomationWorkflowHubScreen({ setActive }: { setActive: (value: string) => void }) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Automation</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Automation action hub</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Automation shortcuts now open the live workflow where action happens.</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2">
        <ActionHubCard title="Exception Triage" subtitle="Open open exceptions and manager actions." target="Exceptions" setActive={setActive} />
        <ActionHubCard title="Payroll Rules" subtitle="Open payroll checks and export readiness." target="Payroll Prep" setActive={setActive} />
        <ActionHubCard title="Smart Alerts" subtitle="Open missing clocking and risk alerts." target="Smart Detection" setActive={setActive} />
        <ActionHubCard title="Notifications" subtitle="Open employee and manager notifications." target="Employee Notifications" setActive={setActive} />
      </div>
    </div>
  );
}

function AIAssistantHubScreen({ setActive }: { setActive: (value: string) => void }) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">AI Assistant</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Manager guidance hub</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Each AI suggestion now opens the workflow it relates to.</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <ActionHubCard title="Explain payroll blockers" subtitle="Open payroll review." target="Payroll Prep" setActive={setActive} />
        <ActionHubCard title="Review employee risk" subtitle="Open HR cases." target="HR Cases" setActive={setActive} />
        <ActionHubCard title="Investigate late clocking" subtitle="Open clocking." target="Clocking" setActive={setActive} />
        <ActionHubCard title="Leave conflict check" subtitle="Open leave management." target="Leave Management" setActive={setActive} />
        <ActionHubCard title="Store risk summary" subtitle="Open stores." target="Stores" setActive={setActive} />
        <ActionHubCard title="Generate report view" subtitle="Open reports." target="Reports Centre" setActive={setActive} />
      </div>
    </div>
  );
}

function SmartAlertsHubScreen({
  exceptions,
  hrCases,
  payrollHours,
  payrollClockChecks,
  leaveRequests,
  setActive,
}: {
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  payrollClockChecks: PayrollClockCheckRow[];
  leaveRequests: LeaveRequestRow[];
  setActive: (value: string) => void;
}) {
  const openExceptions = exceptions.filter(exceptionIsOpen).length;
  const openHrCases = hrCases.filter(hrCaseIsOpen).length;
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem).length + payrollClockChecks.filter((item) => item.manager_review_status !== "approved").length;
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending").length;

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Smart Alerts</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Live alert action centre</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Every alert opens the page where the manager can investigate or correct the issue.</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <ActionHubCard title="Open Exceptions" value={openExceptions} subtitle="Open exception queue." target="Exceptions" setActive={setActive} />
        <ActionHubCard title="HR Cases" value={openHrCases} subtitle="Open HR action list." target="HR Cases" setActive={setActive} />
        <ActionHubCard title="Payroll Blockers" value={payrollBlockers} subtitle="Open payroll prep." target="Payroll Prep" setActive={setActive} />
        <ActionHubCard title="Leave Pending" value={pendingLeave} subtitle="Open leave approvals." target="Leave Management" setActive={setActive} />
      </div>
    </div>
  );
}

function CleanIntegrationsHubScreen({ setActive }: { setActive: (value: string) => void }) {
  const items = [
    { title: "CSV Export", status: "Ready", subtitle: "Payroll-ready export workflow with no demo employee names.", target: "Payroll Prep" },
    { title: "Sage Payroll", status: "Planned", subtitle: "Prepare payroll mapping for Sage payroll imports.", target: "Payroll Prep" },
    { title: "SimplePay", status: "Planned", subtitle: "Prepare approved hours for SimplePay uploads.", target: "Payroll Prep" },
    { title: "Xero", status: "Future", subtitle: "Future finance reporting connection.", target: "Reports Centre" },
  ];

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Integrations</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Integration readiness</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Clean client-facing integration hub. No demo names. Only workflow links.</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2">
        {items.map((item) => (
          <Panel key={item.title}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-black text-slate-950">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</p>
              </div>
              <StatusPill value={item.status === "Ready" ? "ready" : "scheduled"} />
            </div>
            <button type="button" onClick={() => setActive(item.target)} className="mt-5 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
              Open related workflow
            </button>
          </Panel>
        ))}
      </div>
    </div>
  );
}

'@

if ($content -notmatch "function ConnectedDashboardScreen") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$connectedScreens`nfunction EmptyWorkAreaScreen")
}

$patterns = @(
  @{
    Pattern = 'if \(active === "Command Centre"\) return <VyronCoreCostStyleCommandCentre stores=\{stores\} employees=\{employees\} exceptions=\{exceptions\} hrCases=\{hrCases\} onRefresh=\{refreshData\} companyId=\{currentCompanyId\} />;'
    Replacement = 'if (active === "Command Centre") return <ConnectedDashboardScreen stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} payrollClockChecks={payrollClockChecks} leaveRequests={leaveRequests} setActive={setActive} onRefresh={refreshData} />;'
  },
  @{
    Pattern = 'if \(active === "Smart Detection"\) return <SmartDetectionEnginePanel exceptions=\{exceptions\} onUpdated=\{refreshData\} onNavigate=\{setActive\} />;'
    Replacement = 'if (active === "Smart Detection") return <SmartAlertsHubScreen exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} payrollClockChecks={payrollClockChecks} leaveRequests={leaveRequests} setActive={setActive} />;'
  },
  @{
    Pattern = 'if \(active === "Automation Centre"\) return <AutomationCentreScreen />;'
    Replacement = 'if (active === "Automation Centre") return <AutomationWorkflowHubScreen setActive={setActive} />;'
  },
  @{
    Pattern = 'if \(active === "Workforce Intelligence"\) return <WorkforceIntelligenceScreen />;'
    Replacement = 'if (active === "Workforce Intelligence") return <ConnectedInsightsScreen stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} payrollClockChecks={payrollClockChecks} setActive={setActive} />;'
  },
  @{
    Pattern = 'if \(active === "AI Intelligence Layer"\) return <AIIntelligenceLayerScreen />;'
    Replacement = 'if (active === "AI Intelligence Layer") return <AIAssistantHubScreen setActive={setActive} />;'
  },
  @{
    Pattern = 'if \(active === "Integrations"\) return <IntegrationsHubScreen setActive=\{setActive\} />;'
    Replacement = 'if (active === "Integrations") return <CleanIntegrationsHubScreen setActive={setActive} />;'
  }
)

foreach ($item in $patterns) {
  $content = [regex]::Replace($content, $item.Pattern, $item.Replacement)
}

if ($content -notmatch 'if \(active === "Integrations"\) return <CleanIntegrationsHubScreen') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Integrations") return <CleanIntegrationsHubScreen setActive={setActive} />;' + "`r`n`r`n" + '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

$content = $content.Replace(
  "This workspace is registered in the navigation but does not have a dedicated live screen yet.",
  "This workspace is being connected to a live workflow. Return to Dashboard or choose a related module from the sidebar."
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Drilldown action patch applied to app/page.tsx."
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
