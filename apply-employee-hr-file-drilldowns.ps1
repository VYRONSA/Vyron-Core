$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$component = @'

function EmployeeHrFileDrilldownCentre({
  employees,
  stores,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  clockEvents,
  hrDocuments,
  setActive,
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  clockEvents: ClockEventRow[];
  hrDocuments: HrDocumentRow[];
  setActive: (value: string) => void;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(employees[0]?.id || "");

  useEffect(() => {
    if (!selectedEmployeeId && employees[0]?.id) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const employee = employees.find((item) => item.id === selectedEmployeeId) || employees[0] || null;

  if (!employee) {
    return (
      <div className="space-y-8">
        <Panel dark>
          <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Employee HR File</div>
          <h1 className="mt-3 text-4xl font-black tracking-tight">No employee selected</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">Create employees first before opening the HR file.</p>
        </Panel>
      </div>
    );
  }

  const employeeName = getEmployeeDisplayName(employee);
  const employeeStore = stores.find((store) => store.id === employee.default_store_id);
  const employeeHrCases = hrCases.filter((item) => item.employee_id === employee.id);
  const openHrCases = employeeHrCases.filter(hrCaseIsOpen);
  const employeeExceptions = exceptions.filter((item) => item.employee_id === employee.id);
  const openExceptions = employeeExceptions.filter(exceptionIsOpen);
  const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(employee.id));
  const pendingLeave = employeeLeave.filter((item) => item.status === "pending");
  const employeePayroll = payrollHours.filter((item) => item.employee_id === employee.id);
  const payrollBlockers = employeePayroll.filter(rowHasPayrollProblem);
  const employeeClockEvents = clockEvents.filter((item) => item.employee_id === employee.id);
  const employeeDocs = hrDocuments.filter((item) => String(item.employee_id || "") === String(employee.id));
  const contractDocs = employeeDocs.filter((item) => item.document_type === "contract");
  const generalDocs = employeeDocs.filter((item) => item.document_type !== "contract");

  const riskScore =
    openHrCases.length * 25 +
    openExceptions.length * 15 +
    payrollBlockers.length * 20 +
    pendingLeave.length * 10;

  const riskLabel = riskScore >= 60 ? "High Risk" : riskScore >= 30 ? "Watch" : "Clean";

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Employee HR File</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">{employeeName}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Full employee drilldown: contracts, documents, warnings, HR cases, leave, clocking, payroll and WhatsApp actions.
            </p>
          </div>

          <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-white/10 p-4">
            <label className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Select employee</label>
            <select
              value={employee.id}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none"
            >
              {employees.map((item) => (
                <option key={item.id} value={item.id}>
                  {getEmployeeDisplayName(item)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-white/95 p-5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-rose-600">HR Cases</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open case list</p>
        </button>

        <button onClick={() => setActive("Warnings")} className="rounded-[2rem] bg-amber-50 p-5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-amber-700">Warnings</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Issue warning</p>
        </button>

        <button onClick={() => setActive("Contracts")} className="rounded-[2rem] bg-cyan-50 p-5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">Contracts</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{contractDocs.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open contract vault</p>
        </button>

        <button onClick={() => setActive("Documents")} className="rounded-[2rem] bg-blue-50 p-5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-blue-700">Documents</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{generalDocs.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open document vault</p>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-emerald-700">Leave</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{employeeLeave.length}</div>
          <p className="mt-2 text-sm text-slate-500">Leave history</p>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-5 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Risk</div>
          <div className="mt-4 text-4xl font-black">{riskLabel}</div>
          <p className="mt-2 text-sm text-slate-300">{riskScore} points</p>
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Employee profile</h2>

          <div className="mt-6 grid gap-3">
            <InfoBox label="Employee number" value={employee.employee_number || "Not set"} />
            <InfoBox label="Job title" value={employee.job_title || "Not set"} />
            <InfoBox label="Default store" value={employeeStore?.name || "No default store"} />
            <InfoBox label="Employment type" value={employee.employment_type || "Not set"} />
            <InfoBox label="Phone" value={employee.phone || "Not set"} />
            <InfoBox label="Email" value={employee.email || "Not set"} />
          </div>

          <div className="mt-6 grid gap-3">
            <button onClick={() => setActive("Contracts")} className="rounded-2xl bg-slate-950 px-5 py-3 text-left text-sm font-black text-cyan-300">
              Open contracts →
            </button>
            <button onClick={() => setActive("Documents")} className="rounded-2xl bg-slate-100 px-5 py-3 text-left text-sm font-black text-slate-700">
              Open documents →
            </button>
            <button onClick={() => setActive("Clocking")} className="rounded-2xl bg-slate-100 px-5 py-3 text-left text-sm font-black text-slate-700">
              Open attendance →
            </button>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Smart recommendations</h2>
          <p className="mt-2 text-sm text-slate-500">VYRON flags what the manager should review next.</p>

          <div className="mt-6 grid gap-3">
            {openHrCases.length > 0 && (
              <button onClick={() => setActive("Warnings")} className="rounded-2xl bg-rose-50 p-5 text-left">
                <div className="font-black text-slate-950">Review warning / disciplinary action</div>
                <p className="mt-1 text-sm text-slate-500">{openHrCases.length} open HR case(s) linked to this employee.</p>
              </button>
            )}

            {openExceptions.length > 0 && (
              <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-amber-50 p-5 text-left">
                <div className="font-black text-slate-950">Investigate attendance exceptions</div>
                <p className="mt-1 text-sm text-slate-500">{openExceptions.length} open exception(s) linked to this employee.</p>
              </button>
            )}

            {payrollBlockers.length > 0 && (
              <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-cyan-50 p-5 text-left">
                <div className="font-black text-slate-950">Resolve payroll blocker</div>
                <p className="mt-1 text-sm text-slate-500">{payrollBlockers.length} payroll issue(s) found for this employee.</p>
              </button>
            )}

            {openHrCases.length === 0 && openExceptions.length === 0 && payrollBlockers.length === 0 && (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
                No urgent HR, attendance or payroll risks for this employee.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel>
          <h3 className="text-xl font-black text-slate-950">HR case timeline</h3>
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
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {formatDate(item.start_date)} - {formatDate(item.end_date)} · {statusToClientText(item.status)}
                  </div>
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <h3 className="text-xl font-black text-slate-950">Contracts on file</h3>
          <div className="mt-5">
            <HrDocumentHistoryList documents={hrDocuments || []} employeeId={employee.id} documentType="contract" />
          </div>
        </Panel>

        <Panel>
          <h3 className="text-xl font-black text-slate-950">Documents on file</h3>
          <div className="mt-5">
            <HrDocumentHistoryList documents={hrDocuments || []} employeeId={employee.id} />
          </div>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">WhatsApp action centre</h2>
        <p className="mt-2 text-sm text-slate-500">
          Prepare HR and employee communication actions from the employee master file.
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

if ($content -notmatch "function EmployeeHrFileDrilldownCentre") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Force Employee HR File route to this component.
$content = [regex]::Replace(
  $content,
  'if \(active === "Employee HR File"\)[^\n]*return [^;]+;',
  'if (active === "Employee HR File") return <EmployeeHrFileDrilldownCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} clockEvents={clockEvents} hrDocuments={hrDocuments} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Employee HR File"\) \{[\s\S]*?\n\s*\}',
  'if (active === "Employee HR File") return <EmployeeHrFileDrilldownCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} clockEvents={clockEvents} hrDocuments={hrDocuments} setActive={setActive} />;'
)

if ($content -notmatch 'active === "Employee HR File"\) return <EmployeeHrFileDrilldownCentre') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Employee HR File") return <EmployeeHrFileDrilldownCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} clockEvents={clockEvents} hrDocuments={hrDocuments} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Employee HR File drilldowns applied."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
