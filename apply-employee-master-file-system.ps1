$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$masterFileComponent = @'

function EmployeeMasterFileSystem({
  employees,
  stores,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  clockEvents,
  setActive,
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  clockEvents: ClockEventRow[];
  setActive: (value: string) => void;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(employees[0]?.id || "");

  useEffect(() => {
    if (!selectedEmployeeId && employees[0]?.id) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) || employees[0] || null;

  function storeName(storeId: string | null | undefined) {
    if (!storeId) return "No default store";
    return stores.find((store) => store.id === storeId)?.name || "Unknown store";
  }

  if (!selectedEmployee) {
    return (
      <div className="space-y-8">
        <Panel dark>
          <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Employee Master File</div>
          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">No employees yet</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">Create employees first before using the HR master file.</p>
        </Panel>
      </div>
    );
  }

  const employeeHrCases = hrCases.filter((item) => item.employee_id === selectedEmployee.id);
  const employeeOpenHrCases = employeeHrCases.filter(hrCaseIsOpen);
  const employeeExceptions = exceptions.filter((item) => item.employee_id === selectedEmployee.id);
  const employeeOpenExceptions = employeeExceptions.filter(exceptionIsOpen);
  const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === selectedEmployee.id);
  const employeePayroll = payrollHours.filter((item) => item.employee_id === selectedEmployee.id);
  const employeeClockEvents = clockEvents.filter((item) => item.employee_id === selectedEmployee.id);

  const riskScore =
    employeeOpenHrCases.length * 25 +
    employeeOpenExceptions.length * 15 +
    employeeLeave.filter((item) => item.status === "pending").length * 10 +
    employeePayroll.filter(rowHasPayrollProblem).length * 20;

  const riskLabel = riskScore >= 60 ? "High Risk" : riskScore >= 30 ? "Watch" : "Clean";

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Employee Master File</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
              {getEmployeeDisplayName(selectedEmployee)}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Permanent HR record: contracts, warnings, leave history, clocking, payroll blockers, documents and WhatsApp actions.
            </p>
          </div>

          <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-white/10 p-4">
            <label className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Select employee</label>
            <select
              value={selectedEmployee.id}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none"
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplayName(employee)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-600">HR Cases</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{employeeOpenHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open HR issues</p>
        </button>

        <button onClick={() => setActive("Warnings")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Warnings</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{employeeOpenHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Issue / review warnings</p>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{employeeLeave.length}</div>
          <p className="mt-2 text-sm text-slate-500">Leave history</p>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-cyan-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Payroll</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{employeePayroll.filter(rowHasPayrollProblem).length}</div>
          <p className="mt-2 text-sm text-slate-500">Payroll blockers</p>
        </button>

        <button onClick={() => setActive("Clocking")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Risk Score</div>
          <div className="mt-4 text-4xl font-black">{riskLabel}</div>
          <p className="mt-2 text-sm text-slate-300">{riskScore} risk points</p>
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Employee profile</h2>
          <div className="mt-6 grid gap-3">
            <InfoBox label="Employee number" value={selectedEmployee.employee_number || "Not set"} />
            <InfoBox label="Job title" value={selectedEmployee.job_title || "Not set"} />
            <InfoBox label="Default store" value={storeName(selectedEmployee.default_store_id)} />
            <InfoBox label="Employment type" value={selectedEmployee.employment_type || "Not set"} />
            <InfoBox label="Phone" value={selectedEmployee.phone || "Not set"} />
            <InfoBox label="Email" value={selectedEmployee.email || "Not set"} />
          </div>

          <div className="mt-6 grid gap-3">
            <button onClick={() => setActive("Contracts")} className="rounded-2xl bg-slate-950 px-5 py-3 text-left text-sm font-black text-cyan-300">
              Open contracts & documents →
            </button>
            <button onClick={() => setActive("Documents")} className="rounded-2xl bg-slate-100 px-5 py-3 text-left text-sm font-black text-slate-700">
              Upload / view HR documents →
            </button>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Smart HR recommendations</h2>
          <p className="mt-2 text-sm text-slate-500">
            VYRON flags repeated issues and suggests manager actions.
          </p>

          <div className="mt-6 grid gap-3">
            {employeeOpenExceptions.length > 0 && (
              <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-amber-50 p-5 text-left">
                <div className="font-black text-slate-950">Review clocking / attendance exceptions</div>
                <p className="mt-1 text-sm text-slate-500">{employeeOpenExceptions.length} unresolved exception(s) linked to this employee.</p>
              </button>
            )}

            {employeeOpenHrCases.length > 0 && (
              <button onClick={() => setActive("Warnings")} className="rounded-2xl bg-rose-50 p-5 text-left">
                <div className="font-black text-slate-950">Consider warning or disciplinary follow-up</div>
                <p className="mt-1 text-sm text-slate-500">{employeeOpenHrCases.length} active HR case(s) require review.</p>
              </button>
            )}

            {employeePayroll.filter(rowHasPayrollProblem).length > 0 && (
              <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-cyan-50 p-5 text-left">
                <div className="font-black text-slate-950">Resolve payroll blockers before export</div>
                <p className="mt-1 text-sm text-slate-500">Payroll impact detected for this employee.</p>
              </button>
            )}

            {employeeOpenExceptions.length === 0 && employeeOpenHrCases.length === 0 && employeePayroll.filter(rowHasPayrollProblem).length === 0 && (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
                No urgent HR, exception or payroll risks for this employee.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel>
          <h3 className="text-xl font-black text-slate-950">HR timeline</h3>
          <div className="mt-5 grid gap-3">
            {employeeHrCases.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">No HR cases yet.</div>
            ) : (
              employeeHrCases.slice(0, 6).map((item) => (
                <button key={item.id} onClick={() => setActive("HR Cases")} className="rounded-2xl bg-white p-4 text-left shadow-sm">
                  <div className="font-black text-slate-950">{item.title || item.case_type}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{statusToClientText(item.status)}</div>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <h3 className="text-xl font-black text-slate-950">Leave timeline</h3>
          <div className="mt-5 grid gap-3">
            {employeeLeave.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">No leave history yet.</div>
            ) : (
              employeeLeave.slice(0, 6).map((item) => (
                <button key={item.id} onClick={() => setActive("Leave Management")} className="rounded-2xl bg-white p-4 text-left shadow-sm">
                  <div className="font-black text-slate-950">{item.leave_type || "Leave"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{formatDate(item.start_date)} - {formatDate(item.end_date)} · {statusToClientText(item.status)}</div>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <h3 className="text-xl font-black text-slate-950">Clocking timeline</h3>
          <div className="mt-5 grid gap-3">
            {employeeClockEvents.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">No clocking history yet.</div>
            ) : (
              employeeClockEvents.slice(0, 6).map((item) => (
                <button key={item.id} onClick={() => setActive("Clocking")} className="rounded-2xl bg-white p-4 text-left shadow-sm">
                  <div className="font-black text-slate-950">{statusToClientText(item.event_type)}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{niceDateTime(item.event_time)} · {item.source || "web"}</div>
                </button>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">WhatsApp action centre</h2>
        <p className="mt-2 text-sm text-slate-500">
          These buttons prepare the workflows for employee messages. Full WhatsApp API integration comes next.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <button onClick={() => setActive("Warnings")} className="rounded-2xl bg-rose-500 px-5 py-4 text-left text-sm font-black text-white">
            Send warning notice →
          </button>
          <button onClick={() => setActive("Leave Management")} className="rounded-2xl bg-emerald-500 px-5 py-4 text-left text-sm font-black text-white">
            Send leave feedback →
          </button>
          <button onClick={() => setActive("Employee Notifications")} className="rounded-2xl bg-cyan-500 px-5 py-4 text-left text-sm font-black text-white">
            Send HR notification →
          </button>
        </div>
      </Panel>
    </div>
  );
}

'@

if ($content -notmatch "function EmployeeMasterFileSystem") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$masterFileComponent`nfunction EmptyWorkAreaScreen")
}

# Route Employee HR File to new master file screen.
$content = [regex]::Replace(
  $content,
  'if \(active === "Employee HR File"\)[\s\S]*?;\s*',
  'if (active === "Employee HR File") return <EmployeeMasterFileSystem employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} clockEvents={clockEvents} setActive={setActive} />;' + "`r`n"
)

# If no route existed, add one before fallback.
if ($content -notmatch 'active === "Employee HR File"\) return <EmployeeMasterFileSystem') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Employee HR File") return <EmployeeMasterFileSystem employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} clockEvents={clockEvents} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Employee Master File System applied."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
