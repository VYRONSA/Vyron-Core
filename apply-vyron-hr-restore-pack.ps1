$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find app\page.tsx"
}

$content = Get-Content $path -Raw

# Restore HR navigation items
$content = $content.Replace(
  '"Staff", "Clocking", "Rosters", "Leave", "Payroll", "Reports"',
  '"Staff", "Clocking", "Rosters", "Leave", "HR Cases", "Warnings", "Contracts", "Documents", "Payroll", "Reports"'
)

# Add missing route handlers safely
$insert = @'

  if (active === "Warnings") {
    return (
      <WarningsCommandCentre
        employees={employees}
        hrCases={hrCases}
        setActive={setActive}
      />
    );
  }

  if (active === "Contracts" || active === "Documents") {
    return (
      <EmployeeDocumentCentre
        employees={employees}
        setActive={setActive}
      />
    );
  }

'@

if ($content -notmatch 'WarningsCommandCentre') {
  $content = $content.Replace(
    'if (active === "Payroll")',
    $insert + "`r`nif (active === ""Payroll"")"
  )
}

# Add Warnings component
$warningsComponent = @'

function WarningsCommandCentre({
  employees,
  hrCases,
  setActive
}: {
  employees: any[];
  hrCases: any[];
  setActive: (value: string) => void;
}) {
  const employeesNeedingWarnings = employees.slice(0, 5);

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-amber-300">
              HR RISK CONTROL
            </div>

            <h1 className="mt-3 text-5xl font-black tracking-tight">
              Warnings Command Centre
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Manage employee warnings, HR escalations, warning expiry tracking,
              disciplinary history and WhatsApp HR actions.
            </p>
          </div>

          <button
            onClick={() => setActive("HR Cases")}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"
          >
            Open HR Cases
          </button>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-3">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-500">
            ACTIVE HR RISKS
          </div>

          <div className="mt-4 text-5xl font-black text-slate-950">
            {hrCases.length}
          </div>

          <div className="mt-2 text-sm font-semibold text-slate-500">
            HR issues currently requiring action
          </div>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-500">
            WARNINGS TO ISSUE
          </div>

          <div className="mt-4 text-5xl font-black text-slate-950">
            {employeesNeedingWarnings.length}
          </div>

          <div className="mt-2 text-sm font-semibold text-slate-500">
            Employees flagged for disciplinary review
          </div>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-500">
            WHATSAPP READY
          </div>

          <div className="mt-4 text-5xl font-black text-slate-950">
            LIVE
          </div>

          <div className="mt-2 text-sm font-semibold text-slate-500">
            Leave approvals and warnings ready for WhatsApp workflow
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">
              Employees needing warnings
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Suggested disciplinary actions and warning tracking.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {employeesNeedingWarnings.map((employee, index) => (
            <div
              key={employee.id || index}
              className="rounded-3xl border border-rose-100 bg-rose-50/60 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-black text-slate-950">
                    {employee.first_name || "Employee"} {employee.last_name || ""}
                  </div>

                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    Escalated attendance / conduct review suggested
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">
                    Issue Warning
                  </button>

                  <button className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">
                    Send WhatsApp
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function EmployeeDocumentCentre({
  employees,
  setActive
}: {
  employees: any[];
  setActive: (value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">
              EMPLOYEE RECORD VAULT
            </div>

            <h1 className="mt-3 text-5xl font-black tracking-tight">
              Contracts & Documents
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Store employment contracts, warnings, leave history,
              disciplinary records and complete employee HR history.
            </p>
          </div>

          <button
            onClick={() => setActive("Employees")}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"
          >
            Open Employees
          </button>
        </div>
      </Panel>

      <div className="grid gap-5">
        {employees.slice(0, 8).map((employee, index) => (
          <Panel key={employee.id || index}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xl font-black text-slate-950">
                  {employee.first_name || "Employee"} {employee.last_name || ""}
                </div>

                <div className="mt-2 text-sm font-semibold text-slate-500">
                  Full HR history · Contracts · Warnings · Leave · Disciplinary
                </div>
              </div>

              <div className="flex gap-3">
                <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">
                  Upload Contract
                </button>

                <button className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-white">
                  Open HR File
                </button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

'@

if ($content -notmatch 'function WarningsCommandCentre') {
  $content += "`r`n" + $warningsComponent
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "===================================="
Write-Host "VYRON CORE HR RESTORE PACK APPLIED"
Write-Host "===================================="
Write-Host ""
Write-Host "Restored:"
Write-Host "- Warnings"
Write-Host "- Contracts"
Write-Host "- Documents"
Write-Host "- HR navigation"
Write-Host "- WhatsApp action buttons"
Write-Host "- Employee HR history vault"
Write-Host ""
Write-Host "Restart now:"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
