$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

$patch = @'

function PayrollClockEngineScreen({
  payrollClockChecks,
  onRefresh,
}: {
  payrollClockChecks: PayrollClockCheckRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  companyId?: string;
  onRefresh: () => void;
}) {
  const missingClockIn = payrollClockChecks.filter((item) => item.missing_clock_in).length;
  const missingClockOut = payrollClockChecks.filter((item) => item.missing_clock_out).length;
  const reviewRequired = payrollClockChecks.filter((item) => item.manager_review_status !== "approved").length;
  const payableHours = payrollClockChecks.reduce((sum, item) => sum + safeNumber(item.payable_minutes), 0) / 60;

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Payroll Clock Engine</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Clock-to-payroll validation</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Compare rostered shifts, clock events and payroll review status before export.
        </p>
      </Panel>

      <div className="grid gap-5 md:grid-cols-4">
        <StatCard title="Clock Checks" value={String(payrollClockChecks.length)} subtitle="Generated validations" icon={<Clock3 className="h-6 w-6" />} />
        <StatCard title="Missing In" value={String(missingClockIn)} subtitle="Missing clock-in events" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Missing Out" value={String(missingClockOut)} subtitle="Missing clock-out events" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Payable Hours" value={formatHours(payableHours)} subtitle={`${reviewRequired} checks need review`} icon={<WalletCards className="h-6 w-6" />} />
      </div>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-2xl font-black tracking-tight text-slate-950">Payroll Clock Checks</h3>
            <p className="mt-2 text-sm text-slate-500">Review missing clocks, late minutes, early leave and payable minutes.</p>
          </div>

          <button onClick={onRefresh} className="w-fit rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
            Refresh Engine
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {payrollClockChecks.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <div className="text-lg font-black text-slate-950">No payroll clock checks found</div>
              <p className="mt-2 text-sm text-slate-500">Generate payroll prep checks to populate this engine.</p>
            </div>
          ) : (
            payrollClockChecks.slice(0, 100).map((item) => (
              <article key={item.id} className="rounded-[26px] border border-white/80 bg-white/95 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.09)] backdrop-blur-xl">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h4 className="text-lg font-black text-slate-950">{item.employee_name}</h4>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{item.store_name || "No store"} · {formatDate(item.shift_date)}</p>
                  </div>
                  <StatusPill value={item.manager_review_status || item.payroll_status || "review_required"} />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <InfoBox label="Clock In" value={item.actual_clock_in ? formatTime(item.actual_clock_in) : "Missing"} />
                  <InfoBox label="Clock Out" value={item.actual_clock_out ? formatTime(item.actual_clock_out) : "Missing"} />
                  <InfoBox label="Late" value={`${safeNumber(item.late_minutes)} min`} />
                  <InfoBox label="Payable" value={`${formatHours(safeNumber(item.payable_minutes) / 60)} hrs`} />
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function StoresRostersHub({ setActive }: { setActive: (value: string) => void }) {
  const items = [
    { title: "Stores", subtitle: "Manage store setup, GPS radius and operating times.", target: "Stores", icon: <Store className="h-6 w-6" /> },
    { title: "Rosters", subtitle: "Build and review planned employee shifts.", target: "Rosters", icon: <Clock3 className="h-6 w-6" /> },
    { title: "Roster Intelligence", subtitle: "Review overtime, coverage and shift risk.", target: "Roster Intelligence", icon: <Zap className="h-6 w-6" /> },
    { title: "Workforce Movement", subtitle: "Track transfers and workforce movement.", target: "Workforce Movement", icon: <Users className="h-6 w-6" /> },
  ];

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Stores & Rosters</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Store and roster command hub</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Control store setup, roster planning, workforce movement and schedule intelligence from one place.
        </p>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.title}
            onClick={() => setActive(item.target)}
            className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_28px_80px_rgba(37,99,235,0.18)]"
          >
            <div className="w-fit rounded-2xl bg-[#06101f] p-3 text-cyan-300 shadow-lg shadow-cyan-950/15">{item.icon}</div>
            <div className="mt-5 text-xl font-black text-slate-950">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StoresManagementPanel({
  stores,
  exceptions,
  onRefresh,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  onRefresh: () => void;
  companyId?: string;
}) {
  const activeStores = stores.filter((store) => store.status === "active").length;
  const storeRiskCount = stores.filter((store) =>
    exceptions.some((exception) => exception.store_id === store.id && exceptionIsOpen(exception))
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-3">
        <StatCard title="Total Stores" value={String(stores.length)} subtitle="Stores loaded from Supabase" icon={<Store className="h-6 w-6" />} />
        <StatCard title="Active Stores" value={String(activeStores)} subtitle="Ready for rostering and clocking" icon={<CheckCircle2 className="h-6 w-6" />} />
        <StatCard title="Risk Stores" value={String(storeRiskCount)} subtitle="Stores with open exceptions" icon={<AlertTriangle className="h-6 w-6" />} />
      </div>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">Stores</h2>
            <p className="mt-2 text-sm text-slate-500">View store status, operating times and GPS radius rules.</p>
          </div>
          <button onClick={onRefresh} className="w-fit rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {stores.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center xl:col-span-2">
              <div className="text-lg font-black text-slate-950">No stores found</div>
              <p className="mt-2 text-sm text-slate-500">Add stores from the command centre to begin rostering.</p>
            </div>
          ) : (
            stores.map((store) => {
              const openStoreExceptions = exceptions.filter((exception) => exception.store_id === store.id && exceptionIsOpen(exception)).length;

              return (
                <article key={store.id} className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-black text-slate-950">{store.name}</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {[store.city, store.region].filter(Boolean).join(" · ") || "Location not set"}
                      </p>
                    </div>
                    <StatusPill value={store.status || "active"} />
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <InfoBox label="Opening" value={formatTimeOnly(store.opening_time)} />
                    <InfoBox label="Closing" value={formatTimeOnly(store.closing_time)} />
                    <InfoBox label="GPS Radius" value={`${store.gps_radius_meters || 0}m`} />
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                    {openStoreExceptions > 0 ? `${openStoreExceptions} open exceptions linked to this store.` : "No open exceptions linked to this store."}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

function RosterManagementPanel({
  rosterShifts,
  employees,
  stores,
  onOpenCreateShift,
  onRefresh,
}: {
  rosterShifts: RosterShiftRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  onOpenCreateShift: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-3">
        <StatCard title="Roster Shifts" value={String(rosterShifts.length)} subtitle="Loaded planned shifts" icon={<Clock3 className="h-6 w-6" />} />
        <StatCard title="Employees" value={String(employees.filter((employee) => employee.active).length)} subtitle="Available staff" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Stores" value={String(stores.length)} subtitle="Roster locations" icon={<Store className="h-6 w-6" />} />
      </div>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">Rosters</h2>
            <p className="mt-2 text-sm text-slate-500">Create, review and control planned employee shifts.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={onRefresh} className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">Refresh</button>
            <button onClick={onOpenCreateShift} className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">Create Shift</button>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {rosterShifts.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <div className="text-lg font-black text-slate-950">No roster shifts found</div>
              <p className="mt-2 text-sm text-slate-500">Create shifts to begin payroll and clocking validation.</p>
            </div>
          ) : (
            rosterShifts.slice(0, 80).map((shift) => {
              const employee = employees.find((item) => item.id === shift.employee_id);
              const store = stores.find((item) => item.id === shift.store_id);

              return (
                <article key={shift.id} className="rounded-[26px] border border-white/80 bg-white/95 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.09)] backdrop-blur-xl">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-lg font-black text-slate-950">{employee ? `${employee.first_name} ${employee.last_name}` : "Unassigned employee"}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">{store?.name || "No store"} · {shift.role || "No role"}</div>
                    </div>
                    <StatusPill value={shift.status || "scheduled"} />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <InfoBox label="Date" value={formatDate(shift.shift_date)} />
                    <InfoBox label="Start" value={formatTime(shift.planned_start)} />
                    <InfoBox label="End" value={formatTime(shift.planned_end)} />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

function LeaveManagementHub({ setActive }: { setActive: (value: string) => void }) {
  const items = [
    { title: "Leave Approvals", target: "Leave Approvals", subtitle: "Approve, decline or amend employee leave requests.", icon: <CheckCircle2 className="h-6 w-6" /> },
    { title: "Leave Balance Control", target: "Leave Balance Control", subtitle: "Review and update employee leave balances.", icon: <CalendarDays className="h-6 w-6" /> },
    { title: "Leave Decision Audit", target: "Leave Decision Audit", subtitle: "Audit leave decisions and manager actions.", icon: <ShieldCheck className="h-6 w-6" /> },
    { title: "Leave Control Centre", target: "Leave Control Centre", subtitle: "Central leave management and control dashboard.", icon: <Clock3 className="h-6 w-6" /> },
  ];

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Leave Management</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Leave command hub</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Manage leave approvals, balances, decision history and workforce availability.</p>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <button key={item.title} onClick={() => setActive(item.target)} className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_28px_80px_rgba(37,99,235,0.18)]">
            <div className="w-fit rounded-2xl bg-[#06101f] p-3 text-cyan-300 shadow-lg shadow-cyan-950/15">{item.icon}</div>
            <div className="mt-5 text-xl font-black text-slate-950">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HrDocumentsManagementPanel({
  hrDocuments,
  employees,
  onRefresh,
  userEmail,
}: {
  hrDocuments: HrDocumentRow[];
  employees: EmployeeRow[];
  onRefresh: () => void;
  userEmail: string | null;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  function localEmployeeName(employeeId: string | null | undefined) {
    if (!employeeId) return "No employee linked";
    const employee = employees.find((item) => item.id === employeeId || item.employee_number === employeeId);
    if (!employee) return "Unknown employee";
    return `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || "Unknown employee";
  }

  const filteredDocuments = hrDocuments.filter((document) => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return true;

    return [
      document.employee_name || "",
      localEmployeeName(document.employee_id),
      document.document_type || "",
      document.document_title || "",
      document.document_notes || "",
      document.file_name || "",
      document.status || "",
      document.uploaded_by || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">VYRON CORE</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight">HR Documents</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              View uploaded HR documents, warnings, forms, signed records and employee document evidence.
            </p>
            <div className="mt-4 text-xs font-semibold text-slate-400">Logged in as {userEmail || "admin user"}</div>
          </div>

          <button onClick={onRefresh} className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
            Refresh Documents
          </button>
        </div>
      </Panel>

      <section className="grid gap-5 md:grid-cols-3">
        <StatCard title="Active Documents" value={String(hrDocuments.filter((document) => document.status !== "archived").length)} subtitle="Current employee HR records" icon={<FileText className="h-6 w-6" />} />
        <StatCard title="Uploaded Files" value={String(hrDocuments.filter((document) => document.file_path || document.file_url).length)} subtitle="Documents with stored files" icon={<ImageIcon className="h-6 w-6" />} />
        <StatCard title="Archived" value={String(hrDocuments.filter((document) => document.status === "archived").length)} subtitle="Closed or archived records" icon={<ShieldCheck className="h-6 w-6" />} />
      </section>

      <Panel>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-2xl font-black tracking-tight text-slate-950">Document Register</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">Uses your existing HR document records and keeps uploads/signatures/document-vault logic untouched.</p>
          </div>

          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search documents..." className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400 md:w-72" />
        </div>

        <div className="mt-6 space-y-4">
          {filteredDocuments.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <div className="text-lg font-black text-slate-950">No HR documents found</div>
              <p className="mt-2 text-sm text-slate-500">Uploaded HR documents will appear here once saved against employees.</p>
            </div>
          ) : (
            filteredDocuments.map((document) => (
              <article key={document.id} className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-700">{(document.document_type || "Document").replaceAll("_", " ")}</span>
                      <StatusPill value={document.status || "active"} />
                    </div>
                    <h4 className="mt-3 text-xl font-black text-slate-950">{document.document_title || document.file_name || "Untitled HR document"}</h4>
                    <p className="mt-2 text-sm font-semibold text-slate-600">{document.employee_name || localEmployeeName(document.employee_id)}</p>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function ComplianceManagementPanel({
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  payrollClockChecks,
}: {
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollClockChecks: PayrollClockCheckRow[];
}) {
  const openExceptions = exceptions.filter(exceptionIsOpen).length;
  const openHrCases = hrCases.filter(hrCaseIsOpen).length;
  const payrollReviews = payrollClockChecks.filter((item) => item.manager_review_status !== "approved").length;
  const complianceRisk = openExceptions + openHrCases + payrollReviews;
  const complianceScore = Math.max(0, Math.min(100, 100 - complianceRisk * 4));

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Compliance</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Compliance command centre</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Track workforce compliance pressure across rosters, clock events, HR cases and payroll review items.
        </p>
      </Panel>

      <div className="grid gap-5 md:grid-cols-4">
        <StatCard title="Compliance Score" value={`${complianceScore}%`} subtitle="Live risk-adjusted score" icon={<ShieldCheck className="h-6 w-6" />} />
        <StatCard title="Open Exceptions" value={String(openExceptions)} subtitle="Clocking and roster issues" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Open HR Cases" value={String(openHrCases)} subtitle="Unresolved HR matters" icon={<Gavel className="h-6 w-6" />} />
        <StatCard title="Payroll Reviews" value={String(payrollReviews)} subtitle="Clock checks needing attention" icon={<WalletCards className="h-6 w-6" />} />
      </div>

      <ComplianceScreen exceptions={exceptions} hrCases={hrCases} rosterShifts={rosterShifts} clockEvents={clockEvents} />
    </div>
  );
}

function ReportsCentreScreen({ setActive }: { setActive: (value: string) => void }) {
  const reports = [
    { title: "Executive Reports", target: "Executive Reports", subtitle: "High-level payroll, HR, workforce and compliance reporting.", icon: <FileText className="h-6 w-6" /> },
    { title: "History Reports", target: "History Reports", subtitle: "Historical leave, HR, payroll and workforce movement records.", icon: <Clock3 className="h-6 w-6" /> },
    { title: "Payroll Prep", target: "Payroll Prep", subtitle: "Payroll readiness, blocker control and export preparation.", icon: <WalletCards className="h-6 w-6" /> },
    { title: "Compliance", target: "Compliance", subtitle: "Compliance risk scoring and unresolved action tracking.", icon: <ShieldCheck className="h-6 w-6" /> },
  ];

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Reports Centre</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Executive reporting hub</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Open payroll, compliance, workforce and executive reporting screens.</p>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {reports.map((item) => (
          <button key={item.title} onClick={() => setActive(item.target)} className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_28px_80px_rgba(37,99,235,0.18)]">
            <div className="w-fit rounded-2xl bg-[#06101f] p-3 text-cyan-300 shadow-lg shadow-cyan-950/15">{item.icon}</div>
            <div className="mt-5 text-xl font-black text-slate-950">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
'@

$functionNames = @(
  "PayrollClockEngineScreen",
  "StoresRostersHub",
  "StoresManagementPanel",
  "RosterManagementPanel",
  "LeaveManagementHub",
  "HrDocumentsManagementPanel",
  "ComplianceManagementPanel",
  "ReportsCentreScreen"
)

foreach ($fn in $functionNames) {
  if ($content -notmatch "function\s+$fn\s*\(") {
    $pattern = "function $fn"
    $start = $patch.IndexOf($pattern)

    if ($start -lt 0) {
      throw "Patch source missing function: $fn"
    }

    $next = $patch.IndexOf("`nfunction ", $start + 1)

    if ($next -lt 0) {
      $block = $patch.Substring($start).Trim()
    } else {
      $block = $patch.Substring($start, $next - $start).Trim()
    }

    $marker = "`n`nexport default function"

    if ($content.Contains($marker)) {
      $content = $content.Replace($marker, "`n" + $block + "`n" + $marker)
      Write-Host "Added missing function: $fn"
    } else {
      throw "Could not find export default function marker to insert $fn"
    }
  } else {
    Write-Host "Already exists: $fn"
  }
}

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host ""
Write-Host "All missing app-page internal screen functions have been checked."
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
