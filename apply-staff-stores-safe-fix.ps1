$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$components = @'

function StaffDrilldownSafeCentre({
  employees,
  stores,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  setActive,
  onAddEmployee,
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
  onAddEmployee: () => void;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const openExceptions = exceptions.filter(exceptionIsOpen);
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  function storeName(storeId: string | null | undefined) {
    if (!storeId) return "No default store";
    return stores.find((store) => store.id === storeId)?.name || "Unknown store";
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">STAFF COMMAND</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Staff</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Staff drilldown hub for HR files, warnings, leave, payroll blockers, clocking and employee records.
            </p>
          </div>

          <button
            type="button"
            onClick={onAddEmployee}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Add Employee
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Active Staff</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{activeEmployees.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open employee HR files.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Open HR File →</div>
        </button>

        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-rose-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">HR Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open HR cases.</p>
          <div className="mt-4 text-sm font-black text-rose-700">Open Cases →</div>
        </button>

        <button onClick={() => setActive("Warnings")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Warnings</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Issue and review warnings.</p>
          <div className="mt-4 text-sm font-black text-amber-700">Open Warnings →</div>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{pendingLeave.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open leave requests.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open Leave →</div>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Payroll</div>
          <div className="mt-4 text-5xl font-black">{payrollBlockers.length}</div>
          <p className="mt-2 text-sm text-slate-300">Payroll blockers.</p>
          <div className="mt-4 text-sm font-black text-cyan-300">Open Payroll →</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Employee drilldowns</h2>
            <p className="mt-2 text-sm text-slate-500">Every employee row opens the correct workflow.</p>
          </div>

          <button
            type="button"
            onClick={onAddEmployee}
            className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
          >
            Add Employee
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-500">No employees found.</div>
              <button
                type="button"
                onClick={onAddEmployee}
                className="mt-4 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300"
              >
                Add first employee
              </button>
            </div>
          ) : (
            employees.slice(0, 30).map((employee) => {
              const employeeCases = openHrCases.filter((item) => item.employee_id === employee.id);
              const employeeExceptions = openExceptions.filter((item) => item.employee_id === employee.id);
              const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(employee.id));

              return (
                <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-cyan-200">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                      <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"} · {storeName(employee.default_store_id)}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{employee.active ? "Active" : "Inactive"}</span>
                        <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{employeeCases.length} HR case(s)</span>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{employeeExceptions.length} exception(s)</span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{employeeLeave.length} leave record(s)</span>
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-3">
                      <button onClick={() => setActive("Employee HR File")} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">HR File</button>
                      <button onClick={() => setActive("HR Cases")} className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">HR Cases</button>
                      <button onClick={() => setActive("Warnings")} className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-black text-white">Warnings</button>
                      <button onClick={() => setActive("Leave Management")} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">Leave</button>
                      <button onClick={() => setActive("Clocking")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Clocking</button>
                      <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Payroll</button>
                    </div>
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

function StoresWithAddButtonSafe({
  stores,
  exceptions,
  setActive,
  onAddStore,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  setActive: (value: string) => void;
  onAddStore: () => void;
}) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">STORE CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Stores</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Manage stores, branches, locations and store-linked workforce operations.
            </p>
          </div>

          <button
            type="button"
            onClick={onAddStore}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Add Store
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <button onClick={onAddStore} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Create</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Add</div>
          <p className="mt-2 text-sm text-slate-500">Create a new store or location.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Add Store →</div>
        </button>

        <button onClick={() => setActive("Rosters")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Stores</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{stores.length}</div>
          <p className="mt-2 text-sm text-slate-500">Stores currently captured.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open Rosters →</div>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Store Issues</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{exceptions.filter(exceptionIsOpen).length}</div>
          <p className="mt-2 text-sm text-slate-500">Open exceptions linked to stores.</p>
          <div className="mt-4 text-sm font-black text-amber-700">Open Exceptions →</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Store list</h2>
            <p className="mt-2 text-sm text-slate-500">Use Add Store to create more locations.</p>
          </div>

          <button
            type="button"
            onClick={onAddStore}
            className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
          >
            Add Store
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {stores.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-500">No stores captured yet.</div>
              <button
                type="button"
                onClick={onAddStore}
                className="mt-4 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300"
              >
                Add first store
              </button>
            </div>
          ) : (
            stores.map((store) => {
              const storeExceptions = exceptions.filter((item) => item.store_id === store.id && exceptionIsOpen(item));

              return (
                <div key={store.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <div className="text-lg font-black text-slate-950">{store.name}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        {store.city || "No city"} · {store.region || "No region"} · {formatTimeOnly(store.opening_time)} - {formatTimeOnly(store.closing_time)}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{store.status || "active"}</span>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{storeExceptions.length} exception(s)</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">GPS {store.gps_radius_meters || 150}m</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button onClick={() => setActive("Rosters")} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">Rosters</button>
                      <button onClick={() => setActive("Clocking")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Clocking</button>
                      <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Exceptions</button>
                      <button onClick={onAddStore} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">Add Store</button>
                    </div>
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

'@

if ($content -notmatch "function StaffDrilldownSafeCentre") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$components`nfunction EmptyWorkAreaScreen")
}

# Force Staff and Employees route to the drilldown centre.
$content = [regex]::Replace(
  $content,
  'if \(active === "Staff"\)[^\n]*return [^;]+;',
  'if (active === "Staff") return <StaffDrilldownSafeCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onAddEmployee={() => setAddEmployeeOpen(true)} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Employees"\)[^\n]*return [^;]+;',
  'if (active === "Employees") return <StaffDrilldownSafeCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onAddEmployee={() => setAddEmployeeOpen(true)} />;'
)

# Force Stores route to safe store screen with add button.
$content = [regex]::Replace(
  $content,
  'if \(active === "Stores"\)[^\n]*return [^;]+;',
  'if (active === "Stores") return <StoresWithAddButtonSafe stores={stores} exceptions={exceptions} setActive={setActive} onAddStore={() => setAddStoreOpen(true)} />;'
)

# If routes are missing, add them before fallback.
if ($content -notmatch 'active === "Staff"\) return <StaffDrilldownSafeCentre') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Staff") return <StaffDrilldownSafeCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onAddEmployee={() => setAddEmployeeOpen(true)} />;' + "`r`n" +
    '    if (active === "Employees") return <StaffDrilldownSafeCentre employees={employees} stores={stores} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} onAddEmployee={() => setAddEmployeeOpen(true)} />;' + "`r`n" +
    '    if (active === "Stores") return <StoresWithAddButtonSafe stores={stores} exceptions={exceptions} setActive={setActive} onAddStore={() => setAddStoreOpen(true)} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Staff drilldowns and Store Add button fixed safely."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
