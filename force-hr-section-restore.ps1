$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1) Replace the whole navGroups block with a proper grouped sidebar including HR.
$newNavGroups = @'
const navGroups = [
  {
    label: "Main",
    items: [
      "Dashboard",
      "Staff",
      "Clocking",
      "Rosters",
      "Leave",
      "Payroll",
      "Reports",
    ],
  },
  {
    label: "HR",
    items: [
      "HR Cases",
      "Warnings",
      "Contracts",
      "Documents",
      "Employee HR File",
      "Leave History",
    ],
  },
  {
    label: "Operations",
    items: [
      "Stores",
      "Tasks",
      "Notifications",
    ],
  },
  {
    label: "Advanced",
    items: [
      "Insights",
      "Automation",
      "Integrations",
      "AI Assistant",
      "Smart Alerts",
      "Audit Logs",
    ],
  },
];
'@

$content = [regex]::Replace(
  $content,
  'const navGroups = \[[\s\S]*?\];\s*function Sidebar',
  $newNavGroups + "`r`nfunction Sidebar",
  1
)

# 2) Make sure resolveNavigationTarget knows where to route these HR pages.
# Add aliases into existing aliases object if they do not exist.
$aliasInsert = @'
    Warnings: "Warnings",
    Contracts: "Contracts",
    Documents: "Documents",
    "Employee HR File": "Employee HR File",
    "Leave History": "Leave Management",
'@

if ($content -notmatch 'Warnings: "Warnings"') {
  $content = $content.Replace(
    'const aliases: Record<string, string> = {',
    'const aliases: Record<string, string> = {' + "`r`n" + $aliasInsert
  )
}

# 3) Add proper screens if missing.
$hrScreens = @'

function WarningsCommandCentre({
  employees,
  hrCases,
  setActive
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  setActive: (value: string) => void;
}) {
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const suggestedWarnings = employees.filter((employee) => employee.active).slice(0, 8);

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-amber-300">HR RISK CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Warnings Command Centre</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              See who needs warnings, track disciplinary risk, issue warnings, and prepare WhatsApp notifications.
            </p>
          </div>

          <button
            onClick={() => setActive("HR Cases")}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Open HR Cases
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-500">Open HR Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">Cases still requiring manager action</div>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-500">Suggested Warnings</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{suggestedWarnings.length}</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">Employees flagged for review</div>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-500">WhatsApp Actions</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Ready</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">Warning and leave notification workflow</div>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Employees needing HR review</h2>
        <p className="mt-2 text-sm text-slate-500">
          This is the place where warning recommendations, WhatsApp notices and disciplinary history must live.
        </p>

        <div className="mt-6 grid gap-4">
          {suggestedWarnings.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No active employees found.
            </div>
          ) : (
            suggestedWarnings.map((employee) => (
              <div key={employee.id} className="rounded-3xl border border-amber-100 bg-amber-50/50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      Review attendance, conduct, HR history and active exceptions before issuing warning.
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setActive("HR Cases")}
                      className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300"
                    >
                      Open HR Case
                    </button>

                    <button className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">
                      Issue Warning
                    </button>

                    <button className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">
                      Send WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function ContractsDocumentsCentre({
  employees,
  setActive
}: {
  employees: EmployeeRow[];
  setActive: (value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">EMPLOYEE RECORD VAULT</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Contracts & HR Documents</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Upload and manage employment contracts, warnings, leave approvals, disciplinary notes and full HR history.
            </p>
          </div>

          <button
            onClick={() => setActive("Employees")}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Open Employees
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-600">Contracts</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Vault</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Employment contracts and signed documents</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-600">HR History</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Full</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Warnings, notes, leave and disciplinary trail</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-600">Uploads</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Ready</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Upload workflow placeholder connected to employees</p>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Employee document vault</h2>
        <p className="mt-2 text-sm text-slate-500">
          Each employee must keep a permanent HR record: contracts, warnings, leave approvals and case history.
        </p>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No employees found.
            </div>
          ) : (
            employees.slice(0, 12).map((employee) => (
              <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      Contract · Warnings · Leave history · HR notes · Disciplinary records
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">
                      Upload Contract
                    </button>

                    <button
                      onClick={() => setActive("Employee HR File")}
                      className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700"
                    >
                      Open HR File
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

'@

if ($content -notmatch 'function WarningsCommandCentre') {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$hrScreens`nfunction EmptyWorkAreaScreen")
}

# 4) Add render routes before fallback.
$routeInsert = @'
    if (active === "Warnings") return <WarningsCommandCentre employees={employees} hrCases={hrCases} setActive={setActive} />;
    if (active === "Contracts") return <ContractsDocumentsCentre employees={employees} setActive={setActive} />;
    if (active === "Documents") return <ContractsDocumentsCentre employees={employees} setActive={setActive} />;

'@

if ($content -notmatch 'active === "Warnings"') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    $routeInsert + '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "===================================="
Write-Host " VYRON CORE FORCE HR SECTION RESTORE"
Write-Host "===================================="
Write-Host ""
Write-Host "HR sidebar group restored:"
Write-Host "- HR Cases"
Write-Host "- Warnings"
Write-Host "- Contracts"
Write-Host "- Documents"
Write-Host "- Employee HR File"
Write-Host "- Leave History"
Write-Host ""
Write-Host "Restart:"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
