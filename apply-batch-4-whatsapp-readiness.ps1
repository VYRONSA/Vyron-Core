$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find: $path" }

$content = Get-Content $path -Raw

$component = @'

function WhatsAppAutomationTestPanel({
  employees,
  leaveRequests,
  hrCases,
  exceptions,
  payrollHours,
  setActive,
}: {
  employees: EmployeeRow[];
  leaveRequests: LeaveRequestRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const readyEmployees = employees.filter((employee) => Boolean(employee.phone));
  const missingPhone = employees.filter((employee) => !employee.phone);

  return (
    <Panel dark>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.4em] text-emerald-300">AUTOMATION TEST CENTRE</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight">WhatsApp automation readiness</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            Quick test summary before switching on full automated workflows.
          </p>
        </div>

        <button
          onClick={() => setActive("Employee HR File")}
          className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"
        >
          Open Employee HR File
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-5">
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Employees Ready</div>
          <div className="mt-3 text-4xl font-black">{readyEmployees.length}</div>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-rose-300">Missing Phone</div>
          <div className="mt-3 text-4xl font-black">{missingPhone.length}</div>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">Leave Pending</div>
          <div className="mt-3 text-4xl font-black">{leaveRequests.filter((item) => item.status === "pending").length}</div>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">Exceptions</div>
          <div className="mt-3 text-4xl font-black">{exceptions.filter(exceptionIsOpen).length}</div>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Payroll Blockers</div>
          <div className="mt-3 text-4xl font-black">{payrollHours.filter(rowHasPayrollProblem).length}</div>
        </div>
      </div>
    </Panel>
  );
}

'@

if ($content -notmatch "function WhatsAppAutomationTestPanel") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

if ($content -match "function WhatsAppActionCentreLive" -and $content -notmatch "<WhatsAppAutomationTestPanel") {
  $content = $content.Replace(
    '<div className="grid gap-5 md:grid-cols-3">',
    '<WhatsAppAutomationTestPanel employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />' + "`r`n`r`n" +
    '<div className="grid gap-5 md:grid-cols-3">',
    1
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 4 applied: WhatsApp automation readiness panel."
