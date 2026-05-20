$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1) Update dashboard component props to accept setActive, without changing the look.
$content = $content.Replace(
'function VyronCoreCostStyleCommandCentre({
  stores,
  employees,
  exceptions,
  hrCases,
  onRefresh,
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  onRefresh: () => void;
  companyId: string;
}) {',
'function VyronCoreCostStyleCommandCentre({
  stores,
  employees,
  exceptions,
  hrCases,
  onRefresh,
  setActive,
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  onRefresh: () => void;
  companyId: string;
  setActive: (value: string) => void;
}) {'
)

# 2) Update the Command Centre route to pass setActive.
$content = $content.Replace(
'if (active === "Command Centre") return <VyronCoreCostStyleCommandCentre stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} onRefresh={refreshData} companyId={currentCompanyId} />;',
'if (active === "Command Centre") return <VyronCoreCostStyleCommandCentre stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} onRefresh={refreshData} companyId={currentCompanyId} setActive={setActive} />;'
)

# 3) Make the top pills clickable.
$content = $content.Replace(
'<span className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-[#06101f]">
                  {openExceptions} Exceptions
                </span>',
'<button type="button" onClick={() => setActive("Exceptions")} className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-[#06101f] transition hover:-translate-y-0.5">
                  {openExceptions} Exceptions
                </button>'
)

$content = $content.Replace(
'<span className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                  {openHrCases} HR Cases
                </span>',
'<button type="button" onClick={() => setActive("HR Cases")} className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300 transition hover:-translate-y-0.5">
                  {openHrCases} HR Cases
                </button>'
)

$content = $content.Replace(
'<span className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                  Payroll {payrollReadiness}
                </span>',
'<button type="button" onClick={() => setActive("Payroll Prep")} className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300 transition hover:-translate-y-0.5">
                  Payroll {payrollReadiness}
                </button>'
)

# 4) Make KPI cards clickable while preserving the same visual classes.
$content = $content.Replace(
'<div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Users className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Active Employees</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{activeEmployees}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Live workforce</div>
          </div>',
'<button type="button" onClick={() => setActive("Employees")} className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(37,99,235,0.18)]">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Users className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Active Employees</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{activeEmployees}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Live workforce</div>
          </button>'
)

$content = $content.Replace(
'<div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Store className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Stores</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{stores.length}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Controlled locations</div>
          </div>',
'<button type="button" onClick={() => setActive("Stores")} className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(37,99,235,0.18)]">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Store className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Stores</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{stores.length}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Controlled locations</div>
          </button>'
)

$content = $content.Replace(
'<div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-amber-50 p-3 text-amber-700">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Open Exceptions</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{openExceptions}</div>
            <div className="mt-2 text-sm font-black text-amber-700">{openExceptions === 0 ? "Clean" : "Needs review"}</div>
          </div>',
'<button type="button" onClick={() => setActive("Exceptions")} className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(245,158,11,0.18)]">
            <div className="w-fit rounded-2xl bg-amber-50 p-3 text-amber-700">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Open Exceptions</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{openExceptions}</div>
            <div className="mt-2 text-sm font-black text-amber-700">{openExceptions === 0 ? "Clean" : "Needs review"}</div>
          </button>'
)

$content = $content.Replace(
'<div className="rounded-[2rem] bg-[#06101f] p-6 text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)]">
            <div className="w-fit rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
              <WalletCards className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-300">Payroll Readiness</div>
            <div className="mt-2 text-4xl font-black">{payrollReadiness}</div>
            <div className="mt-2 text-sm font-black text-cyan-300">Command status</div>
          </div>',
'<button type="button" onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(34,211,238,0.22)]">
            <div className="w-fit rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
              <WalletCards className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-300">Payroll Readiness</div>
            <div className="mt-2 text-4xl font-black">{payrollReadiness}</div>
            <div className="mt-2 text-sm font-black text-cyan-300">Command status</div>
          </button>'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Dashboard look preserved and clickable drilldowns added."
Write-Host ""
Write-Host "Now restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
