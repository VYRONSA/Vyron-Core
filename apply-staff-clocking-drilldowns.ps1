$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

$inject = @'

function StaffDrilldownHubScreen({
  employees,
  stores,
  exceptions,
  hrCases,
  setActive,
  onAddEmployee,
  onRefresh,
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  setActive: (value: string) => void;
  onAddEmployee: () => void;
  onRefresh: () => void;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const openExceptions = exceptions.filter(exceptionIsOpen);

  function employeeStoreName(employee: EmployeeRow) {
    const store = stores.find((item) => item.id === employee.default_store_id);
    return store?.name || "No default store";
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Staff Control</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">Staff drilldown hub</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Open employees, HR cases, warnings, documents and payroll-related staff risks from one page.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={onAddEmployee} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
              Add employee
            </button>
            <button onClick={onRefresh} className="rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
              Refresh
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Active staff</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{activeEmployees.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Open HR file workflow</div>
        </button>

        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Open HR cases</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{openHrCases.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Open HR cases</div>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Staff exceptions</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{openExceptions.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Open exceptions</div>
        </button>

        <button onClick={() => setActive("Employee Notifications")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-300">Notifications</div>
          <div className="mt-3 text-4xl font-black">Open</div>
          <div className="mt-2 text-sm font-black text-cyan-300">Message staff</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-2xl font-black text-slate-950">Employee drilldowns</h3>
            <p className="mt-2 text-sm text-slate-500">Click a workflow button to open the correct live page.</p>
          </div>
          <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
            Open payroll impact
          </button>
        </div>

        <div className="mt-6 grid gap-3">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No employees captured yet.</div>
          ) : (
            employees.slice(0, 12).map((employee) => {
              const employeeExceptions = exceptions.filter((item) => item.employee_id === employee.id && exceptionIsOpen(item));
              const employeeCases = hrCases.filter((item) => item.employee_id === employee.id && hrCaseIsOpen(item));

              return (
                <div key={employee.id} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm xl:grid-cols-[1.2fr_1fr_auto] xl:items-center">
                  <div>
                    <div className="text-base font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"} · {employeeStoreName(employee)}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{employee.active ? "Active" : "Inactive"}</span>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{employeeExceptions.length} exceptions</span>
                    <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{employeeCases.length} HR cases</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setActive("Employee HR File")} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-cyan-300">HR file</button>
                    <button onClick={() => setActive("HR Cases")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Cases</button>
                    <button onClick={() => setActive("Payroll Prep")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Payroll</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

function ClockingDrilldownHubScreen({
  clockEvents,
  employees,
  stores,
  rosterShifts,
  exceptions,
  setActive,
  onManualEvent,
  onRefresh,
}: {
  clockEvents: ClockEventRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  rosterShifts: RosterShiftRow[];
  exceptions: ExceptionRow[];
  setActive: (value: string) => void;
  onManualEvent: () => void;
  onRefresh: () => void;
}) {
  const today = todayIsoDate();
  const todayEvents = clockEvents.filter((event) => dayKeyFromIso(event.event_time) === today);
  const openClockExceptions = exceptions.filter((item) => exceptionIsOpen(item) && String(item.exception_type || "").toLowerCase().includes("clock"));

  function employeeName(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    return getEmployeeDisplayName(employee);
  }

  function storeName(storeId: string | null) {
    if (!storeId) return "No store";
    return stores.find((item) => item.id === storeId)?.name || "Unknown store";
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Clocking Control</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">Clocking drilldown hub</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Review live clock events, missing clocking, exception actions and payroll impact.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={onManualEvent} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
              Manual clock event
            </button>
            <button onClick={onRefresh} className="rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
              Refresh
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setActive("Staff Clocking")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Today events</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{todayEvents.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Open staff clocking</div>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Clock exceptions</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{openClockExceptions.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Open exceptions</div>
        </button>

        <button onClick={() => setActive("Payroll Clock Engine")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-500">Payroll checks</div>
          <div className="mt-3 text-4xl font-black text-slate-950">Open</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Review clock impact</div>
        </button>

        <button onClick={() => setActive("Rosters")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-sm font-bold text-slate-300">Linked shifts</div>
          <div className="mt-3 text-4xl font-black">{rosterShifts.length}</div>
          <div className="mt-2 text-sm font-black text-cyan-300">Open rosters</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-2xl font-black text-slate-950">Recent clocking drilldowns</h3>
            <p className="mt-2 text-sm text-slate-500">Open the related workflow from each clocking event.</p>
          </div>
          <button onClick={() => setActive("Clocking Review")} className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
            Open clocking review
          </button>
        </div>

        <div className="mt-6 grid gap-3">
          {clockEvents.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No clock events captured yet.</div>
          ) : (
            clockEvents.slice(0, 12).map((event) => (
              <div key={event.id} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm xl:grid-cols-[1.2fr_1fr_auto] xl:items-center">
                <div>
                  <div className="text-base font-black text-slate-950">{employeeName(event.employee_id)}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {statusToClientText(event.event_type)} · {niceDateTime(event.event_time)} · {storeName(event.store_id)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{event.source || "web"}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{event.roster_shift_id ? "Shift linked" : "No linked shift"}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setActive("Clocking Review")} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-cyan-300">Review</button>
                  <button onClick={() => setActive("Exceptions")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Exception</button>
                  <button onClick={() => setActive("Payroll Prep")} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Payroll</button>
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

if ($content -notmatch "function StaffDrilldownHubScreen") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$inject`nfunction EmptyWorkAreaScreen")
}

$content = [regex]::Replace(
  $content,
  'if \(active === "Employees"\) return <EmployeesScreen employees=\{employees\} stores=\{stores\} exceptions=\{exceptions\} hrCases=\{hrCases\} onAddEmployee=\{\(\) => setAddEmployeeOpen\(true\)\} onRefresh=\{refreshData\} />;',
  'if (active === "Employees") return <StaffDrilldownHubScreen employees={employees} stores={stores} exceptions={exceptions} hrCases={hrCases} setActive={setActive} onAddEmployee={() => setAddEmployeeOpen(true)} onRefresh={refreshData} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Clocking"\) return <ClockingManagementPanel clockEvents=\{clockEvents\} employees=\{employees\} stores=\{stores\} rosterShifts=\{rosterShifts\} exceptions=\{exceptions\} onManualEvent=\{\(\) => setManualClockOpen\(true\)\} onRefresh=\{refreshData\} />;',
  'if (active === "Clocking") return <ClockingDrilldownHubScreen clockEvents={clockEvents} employees={employees} stores={stores} rosterShifts={rosterShifts} exceptions={exceptions} setActive={setActive} onManualEvent={() => setManualClockOpen(true)} onRefresh={refreshData} />;'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Staff + Clocking drilldown batch applied."
Write-Host ""
Write-Host "Now restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
