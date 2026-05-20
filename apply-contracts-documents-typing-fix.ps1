$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1) Clean corrupted characters visible in the UI.
$badToGood = @{
  "â†’" = "→"
  "â†" = "←"
  "âœ“" = "✓"
  "âœ…" = "✅"
  "âš ï¸" = "⚠️"
  "ðŸ”¥" = "🔥"
  "ðŸš€" = "🚀"
  "Â·" = "·"
  "Â " = " "
  "Â" = ""
  "â€“" = "–"
  "â€”" = "—"
  "â€™" = "'"
  "â€œ" = '"'
  "â€" = '"'
}

foreach ($bad in $badToGood.Keys) {
  $content = $content.Replace($bad, $badToGood[$bad])
}

# 2) Add two proper separate pages: ContractsCentrePage and DocumentsCentrePage.
$separatePages = @'

function ContractsCentrePage({
  employees,
  setActive
}: {
  employees: EmployeeRow[];
  setActive: (value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">CONTRACT CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Employee Contracts</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Manage employment contracts, signed agreements, renewal dates, contract status and employee contract history.
            </p>
          </div>

          <button
            onClick={() => setActive("Employee HR File")}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Open employee master file
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Contracts on file</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employees.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Employees available for contract tracking.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Missing contracts</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Check</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Review employees without uploaded signed contracts.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Renewals</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Track</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Monitor fixed-term contract expiry dates.</p>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Contract register</h2>
        <p className="mt-2 text-sm text-slate-500">
          Each employee must have a contract record, upload status and signed document history.
        </p>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No employees found.
            </div>
          ) : (
            employees.slice(0, 12).map((employee) => (
              <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {employee.employee_number || "No employee number"} · {employee.employment_type || "No employment type"} · Contract status required
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">
                      Upload Contract
                    </button>
                    <button
                      onClick={() => setActive("Employee HR File")}
                      className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700"
                    >
                      Open HR File
                    </button>
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

function DocumentsCentrePage({
  employees,
  hrCases,
  leaveRequests,
  setActive
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  leaveRequests: LeaveRequestRow[];
  setActive: (value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">HR DOCUMENT VAULT</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Employee Documents</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Store ID documents, certificates, warning letters, leave forms, disciplinary evidence, medical notes and HR attachments.
            </p>
          </div>

          <button
            onClick={() => setActive("Employee HR File")}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Open employee master file
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-4">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Employee files</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employees.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Document folders by employee.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">HR evidence</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{hrCases.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Documents linked to HR cases.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave forms</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{leaveRequests.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Leave documents and approval records.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Compliance</div>
          <div className="mt-4 text-5xl font-black text-slate-950">Vault</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Audit-ready HR document storage.</p>
        </Panel>
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Document folders</h2>
        <p className="mt-2 text-sm text-slate-500">
          This page is for all non-contract HR files and evidence. Contracts remain separate under Employee Contracts.
        </p>

        <div className="mt-6 grid gap-4">
          {employees.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No employees found.
            </div>
          ) : (
            employees.slice(0, 12).map((employee) => (
              <div key={employee.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      ID · certificates · warnings · medical notes · leave forms · disciplinary evidence
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">
                      Upload Document
                    </button>
                    <button
                      onClick={() => setActive("Employee HR File")}
                      className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700"
                    >
                      Open HR File
                    </button>
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

if ($content -notmatch "function ContractsCentrePage") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$separatePages`nfunction EmptyWorkAreaScreen")
}

# 3) Route Contracts and Documents to different pages.
$content = [regex]::Replace(
  $content,
  'if \(active === "Contracts"\)[\s\S]*?;\s*',
  'if (active === "Contracts") return <ContractsCentrePage employees={employees} setActive={setActive} />;' + "`r`n"
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Documents"\)[\s\S]*?;\s*',
  'if (active === "Documents") return <DocumentsCentrePage employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} setActive={setActive} />;' + "`r`n"
)

# If routes missing, add before fallback.
if ($content -notmatch 'active === "Contracts"\) return <ContractsCentrePage') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Contracts") return <ContractsCentrePage employees={employees} setActive={setActive} />;' + "`r`n" +
    '    if (active === "Documents") return <DocumentsCentrePage employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Contracts/Documents separation and typing cleanup applied."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
