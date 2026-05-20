$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$component = @'

function HrCasesDrilldownOnlyPage({
  employees,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  setActive,
  onRefresh,
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
  onRefresh: () => void;
}) {
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const closedHrCases = hrCases.filter((item) => !hrCaseIsOpen(item));
  const openExceptions = exceptions.filter(exceptionIsOpen);
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  function employeeName(employeeId: string | null | undefined) {
    const employee = employees.find((item) => item.id === employeeId);
    return employee ? getEmployeeDisplayName(employee) : "Unknown employee";
  }

  function employeeNumber(employeeId: string | null | undefined) {
    const employee = employees.find((item) => item.id === employeeId);
    return employee?.employee_number || "No employee number";
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-rose-300">HR CASE CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">HR Cases</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Drill down from every HR case into the employee file, warnings, attendance exceptions, leave records, payroll blockers and WhatsApp actions.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActive("Warnings")}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
            >
              Open Warnings
            </button>

            <button
              type="button"
              onClick={onRefresh}
              className="rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300"
            >
              Refresh
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Open Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open employee files linked to cases.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Open HR file</div>
        </button>

        <button onClick={() => setActive("Warnings")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Warnings</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Review warnings or disciplinary follow-up.</p>
          <div className="mt-4 text-sm font-black text-amber-700">Open Warnings</div>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-rose-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">Exceptions</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openExceptions.length}</div>
          <p className="mt-2 text-sm text-slate-500">Investigate attendance exceptions.</p>
          <div className="mt-4 text-sm font-black text-rose-700">Open Exceptions</div>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{pendingLeave.length}</div>
          <p className="mt-2 text-sm text-slate-500">Review leave context before HR action.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open Leave</div>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Payroll Risk</div>
          <div className="mt-4 text-5xl font-black">{payrollBlockers.length}</div>
          <p className="mt-2 text-sm text-slate-300">Check payroll impact.</p>
          <div className="mt-4 text-sm font-black text-cyan-300">Open Payroll</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Open HR case drilldowns</h2>
            <p className="mt-2 text-sm text-slate-500">
              Every case row opens the correct linked workflow without changing other pages.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setActive("Employee HR File")}
            className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
          >
            Open employee master file
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {openHrCases.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
              No open HR cases right now.
            </div>
          ) : (
            openHrCases.map((hrCase) => {
              const linkedEmployee = employees.find((item) => item.id === hrCase.employee_id);
              const employeeExceptions = openExceptions.filter((item) => item.employee_id === hrCase.employee_id);
              const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(hrCase.employee_id));
              const employeePayroll = payrollBlockers.filter((item) => item.employee_id === hrCase.employee_id);

              return (
                <div key={hrCase.id} className="rounded-3xl border border-rose-100 bg-white p-5 shadow-sm transition hover:border-rose-200">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                      <div className="text-lg font-black text-slate-950">
                        {hrCase.title || hrCase.case_type || "HR Case"}
                      </div>

                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        {employeeName(hrCase.employee_id)} · {employeeNumber(hrCase.employee_id)}
                      </div>

                      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                        {hrCase.description || "No case description captured."}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{statusToClientText(hrCase.status)}</span>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{statusToClientText(hrCase.validity_status || "review_required")}</span>
                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{employeeExceptions.length} exception(s)</span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{employeeLeave.length} leave record(s)</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{employeePayroll.length} payroll blocker(s)</span>
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-3">
                      <button onClick={() => setActive("Employee HR File")} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">HR File</button>
                      <button onClick={() => setActive("Warnings")} className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-black text-white">Warning</button>
                      <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">Attendance</button>
                      <button onClick={() => setActive("Leave Management")} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">Leave</button>
                      <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Payroll</button>
                      <button onClick={() => setActive("Employee Notifications")} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-white">WhatsApp</button>
                    </div>
                  </div>

                  {linkedEmployee && (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                      Linked employee: {getEmployeeDisplayName(linkedEmployee)} · {linkedEmployee.job_title || "No job title"}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Panel>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Closed case history</h2>
        <p className="mt-2 text-sm text-slate-500">Closed HR cases are kept for permanent employee history.</p>

        <div className="mt-6 grid gap-3">
          {closedHrCases.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No closed cases yet.</div>
          ) : (
            closedHrCases.slice(0, 8).map((hrCase) => (
              <button key={hrCase.id} onClick={() => setActive("Employee HR File")} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm">
                <div className="font-black text-slate-950">{hrCase.title || hrCase.case_type || "Closed HR case"}</div>
                <div className="mt-1 text-sm text-slate-500">{employeeName(hrCase.employee_id)} · {statusToClientText(hrCase.status)}</div>
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

'@

if ($content -notmatch "function HrCasesDrilldownOnlyPage") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Force only HR Cases route to this component.
$content = [regex]::Replace(
  $content,
  'if \(active === "HR Cases"\)[^\n]*return [^;]+;',
  'if (active === "HR Cases") return <HrCasesDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onRefresh={refreshData} />;'
)

# Handle multiline HR Cases route if present.
$content = [regex]::Replace(
  $content,
  'if \(active === "HR Cases"\) \{[\s\S]*?\n\s*\}',
  'if (active === "HR Cases") return <HrCasesDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onRefresh={refreshData} />;'
)

if ($content -notmatch 'active === "HR Cases"\) return <HrCasesDrilldownOnlyPage') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "HR Cases") return <HrCasesDrilldownOnlyPage employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onRefresh={refreshData} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "HR Cases drilldown-only fix applied."
Write-Host "No other routes or pages were intentionally changed."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
