$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$component = @'

function WarningsDrilldownOnlyPage({
  employees,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  setActive,
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const openExceptions = exceptions.filter(exceptionIsOpen);
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  const employeesWithRisk = employees
    .map((employee) => {
      const employeeCases = openHrCases.filter((item) => item.employee_id === employee.id);
      const employeeExceptions = openExceptions.filter((item) => item.employee_id === employee.id);
      const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(employee.id));
      const employeePayroll = payrollBlockers.filter((item) => item.employee_id === employee.id);

      return {
        employee,
        employeeCases,
        employeeExceptions,
        employeeLeave,
        employeePayroll,
        score:
          employeeCases.length * 25 +
          employeeExceptions.length * 15 +
          employeePayroll.length * 20 +
          employeeLeave.filter((item) => item.status === "pending").length * 10,
      };
    })
    .filter((item) => item.score > 0 || item.employeeCases.length > 0)
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-amber-300">WARNING CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Warnings</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Drill down into employees who may need warnings, HR action, leave review, payroll review or attendance investigation.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActive("HR Cases")}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
            >
              Open HR Cases
            </button>

            <button
              type="button"
              onClick={() => setActive("Employee HR File")}
              className="rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300"
            >
              Open HR File
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-rose-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">Open HR Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Review case details.</p>
          <div className="mt-4 text-sm font-black text-rose-700">Open cases</div>
        </button>

        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Employee Files</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employeesWithRisk.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open employee HR file.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Open file</div>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Attendance Issues</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openExceptions.length}</div>
          <p className="mt-2 text-sm text-slate-500">Investigate exceptions.</p>
          <div className="mt-4 text-sm font-black text-amber-700">Open exceptions</div>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave Review</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{leaveRequests.filter((item) => item.status === "pending").length}</div>
          <p className="mt-2 text-sm text-slate-500">Review leave context.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open leave</div>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Payroll Impact</div>
          <div className="mt-4 text-5xl font-black">{payrollBlockers.length}</div>
          <p className="mt-2 text-sm text-slate-300">Check payroll risk.</p>
          <div className="mt-4 text-sm font-black text-cyan-300">Open payroll</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Employees needing warning review</h2>
            <p className="mt-2 text-sm text-slate-500">
              Each row has drilldowns into HR cases, employee file, attendance, leave and payroll.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setActive("HR Cases")}
            className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
          >
            Create / review HR case
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {employeesWithRisk.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
              No employees currently require warning review.
            </div>
          ) : (
            employeesWithRisk.map(({ employee, employeeCases, employeeExceptions, employeeLeave, employeePayroll, score }) => (
              <div key={employee.id} className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      Risk score {score} · {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{employeeCases.length} HR case(s)</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{employeeExceptions.length} exception(s)</span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{employeeLeave.length} leave record(s)</span>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{employeePayroll.length} payroll blocker(s)</span>
                    </div>
                  </button>

                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => setActive("Employee HR File")} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">HR File</button>
                    <button onClick={() => setActive("HR Cases")} className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">HR Case</button>
                    <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-black text-white">Attendance</button>
                    <button onClick={() => setActive("Leave Management")} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">Leave</button>
                    <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Payroll</button>
                    <button onClick={() => setActive("Employee Notifications")} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-white">WhatsApp</button>
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

if ($content -notmatch "function WarningsDrilldownOnlyPage") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Force only Warnings route to this component.
$content = [regex]::Replace(
  $content,
  'if \(active === "Warnings"\)[^\n]*return [^;]+;',
  'if (active === "Warnings") return <WarningsDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;'
)

# Handle multiline warning route if present.
$content = [regex]::Replace(
  $content,
  'if \(active === "Warnings"\) \{[\s\S]*?\n\s*\}',
  'if (active === "Warnings") return <WarningsDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;'
)

if ($content -notmatch 'active === "Warnings"\) return <WarningsDrilldownOnlyPage') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Warnings") return <WarningsDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Warnings drilldown-only fix applied."
Write-Host "No other routes or pages were intentionally changed."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
