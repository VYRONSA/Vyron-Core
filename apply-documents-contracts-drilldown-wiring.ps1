$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$component = @'

function DocumentDrilldownActionButton({
  label,
  target,
  setActive,
  tone = "dark",
}: {
  label: string;
  target: string;
  setActive: (value: string) => void;
  tone?: "dark" | "light" | "danger" | "success";
}) {
  const cls =
    tone === "danger"
      ? "bg-rose-500 text-white"
      : tone === "success"
      ? "bg-emerald-500 text-white"
      : tone === "light"
      ? "bg-slate-100 text-slate-700"
      : "bg-slate-950 text-cyan-300";

  return (
    <button
      type="button"
      onClick={() => setActive(target)}
      className={`rounded-2xl px-4 py-2 text-sm font-black transition hover:-translate-y-0.5 ${cls}`}
    >
      {label}
    </button>
  );
}

function ContractsCentrePageV3({
  employees,
  hrDocuments,
  setActive
}: {
  employees: EmployeeRow[];
  hrDocuments: HrDocumentRow[];
  setActive: (value: string) => void;
}) {
  const contractDocs = (hrDocuments || []).filter((item) => item.document_type === "contract");

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">CONTRACT CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Employee Contracts</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Contract register with drilldowns into employee files, uploads, warnings, leave history and HR actions.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <DocumentDrilldownActionButton label="Employee HR File" target="Employee HR File" setActive={setActive} tone="light" />
            <DocumentDrilldownActionButton label="Documents" target="Documents" setActive={setActive} tone="success" />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Employees</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employees.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Open employee master files.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Open HR File →</div>
        </button>

        <button onClick={() => setActive("Documents")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Uploaded Contracts</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{contractDocs.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Review stored contract files.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open Documents →</div>
        </button>

        <button onClick={() => setActive("Warnings")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Contract Risk</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Check</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Review HR risk before contract action.</p>
          <div className="mt-4 text-sm font-black text-amber-700">Open Warnings →</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Contract drilldowns by employee</h2>
            <p className="mt-2 text-sm text-slate-500">
              Every row opens real workflows for the selected employee context.
            </p>
          </div>
          <DocumentDrilldownActionButton label="Open Document Vault" target="Documents" setActive={setActive} />
        </div>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No employees found.</div>
          ) : (
            employees.slice(0, 20).map((employee) => {
              const employeeContracts = contractDocs.filter((doc) => String(doc.employee_id || "") === String(employee.id));

              return (
                <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-cyan-200">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                      <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        {employee.employee_number || "No employee number"} · {employee.employment_type || "No employment type"} · {employeeContracts.length} contract file(s)
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-3">
                      <DocumentDrilldownActionButton label="HR File" target="Employee HR File" setActive={setActive} />
                      <DocumentDrilldownActionButton label="Upload Contract" target="Employee HR File" setActive={setActive} tone="success" />
                      <DocumentDrilldownActionButton label="Warnings" target="Warnings" setActive={setActive} tone="danger" />
                      <DocumentDrilldownActionButton label="Leave" target="Leave Management" setActive={setActive} tone="light" />
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                    <HrDocumentHistoryList documents={hrDocuments || []} employeeId={employee.id} documentType="contract" />
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

function DocumentsCentrePageV3({
  employees,
  hrCases,
  leaveRequests,
  hrDocuments,
  setActive
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  leaveRequests: LeaveRequestRow[];
  hrDocuments: HrDocumentRow[];
  setActive: (value: string) => void;
}) {
  const nonContractDocs = (hrDocuments || []).filter((item) => item.document_type !== "contract");

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">HR DOCUMENT VAULT</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Employee Documents</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Document vault with drilldowns into employee HR files, warning evidence, leave records and case history.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <DocumentDrilldownActionButton label="Employee HR File" target="Employee HR File" setActive={setActive} tone="light" />
            <DocumentDrilldownActionButton label="Contracts" target="Contracts" setActive={setActive} tone="success" />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-4">
        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Employee Files</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employees.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Open employee master files.</p>
          <div className="mt-4 text-sm font-black text-cyan-700">Open HR File →</div>
        </button>

        <button onClick={() => setActive("Documents")} className="rounded-[2rem] bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-blue-700">Documents</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{nonContractDocs.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Uploaded non-contract HR docs.</p>
          <div className="mt-4 text-sm font-black text-blue-700">Review Documents →</div>
        </button>

        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-rose-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">HR Evidence</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{hrCases.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Open HR cases and evidence.</p>
          <div className="mt-4 text-sm font-black text-rose-700">Open HR Cases →</div>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave Forms</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{leaveRequests.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Open leave approval records.</p>
          <div className="mt-4 text-sm font-black text-emerald-700">Open Leave →</div>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Document drilldowns by employee</h2>
            <p className="mt-2 text-sm text-slate-500">
              Use this page for ID documents, warnings, medical notes, leave forms and disciplinary evidence.
            </p>
          </div>
          <DocumentDrilldownActionButton label="Open Contracts" target="Contracts" setActive={setActive} />
        </div>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No employees found.</div>
          ) : (
            employees.slice(0, 20).map((employee) => {
              const employeeDocs = nonContractDocs.filter((doc) => String(doc.employee_id || "") === String(employee.id));
              const employeeHrCases = hrCases.filter((item) => item.employee_id === employee.id);
              const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(employee.id));

              return (
                <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-cyan-200">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                      <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        {employeeDocs.length} document(s) · {employeeHrCases.length} HR case(s) · {employeeLeave.length} leave record(s)
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-3">
                      <DocumentDrilldownActionButton label="HR File" target="Employee HR File" setActive={setActive} />
                      <DocumentDrilldownActionButton label="HR Cases" target="HR Cases" setActive={setActive} tone="danger" />
                      <DocumentDrilldownActionButton label="Warnings" target="Warnings" setActive={setActive} tone="danger" />
                      <DocumentDrilldownActionButton label="Leave" target="Leave Management" setActive={setActive} tone="success" />
                      <DocumentDrilldownActionButton label="WhatsApp" target="Employee Notifications" setActive={setActive} tone="light" />
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                    <HrDocumentHistoryList documents={hrDocuments || []} employeeId={employee.id} />
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

if ($content -notmatch "function ContractsCentrePageV3") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Force routes to V3.
$content = [regex]::Replace(
  $content,
  'if \(active === "Contracts"\)[^\n]*return [^;]+;',
  'if (active === "Contracts") return <ContractsCentrePageV3 employees={employees} hrDocuments={hrDocuments} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Documents"\)[^\n]*return [^;]+;',
  'if (active === "Documents") return <DocumentsCentrePageV3 employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} hrDocuments={hrDocuments} setActive={setActive} />;'
)

if ($content -notmatch 'active === "Contracts"\) return <ContractsCentrePageV3') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Contracts") return <ContractsCentrePageV3 employees={employees} hrDocuments={hrDocuments} setActive={setActive} />;' + "`r`n" +
    '    if (active === "Documents") return <DocumentsCentrePageV3 employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} hrDocuments={hrDocuments} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Documents and Contracts drilldown wiring applied."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
