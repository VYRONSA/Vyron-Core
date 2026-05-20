$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1) Add onAddStore prop to EditableStoresScreen
$content = $content.Replace(
'function EditableStoresScreen({
  stores,
  exceptions,
  onRefresh,
  companyId,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  onRefresh: () => void;
  companyId: string;
}) {',
'function EditableStoresScreen({
  stores,
  exceptions,
  onRefresh,
  onAddStore,
  companyId,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  onRefresh: () => void;
  onAddStore: () => void;
  companyId: string;
}) {'
)

# 2) Replace the top Refresh-only button with Add Store + Refresh buttons
$content = $content.Replace(
'          <button onClick={onRefresh} className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
            Refresh stores
          </button>',
'          <div className="flex flex-wrap gap-3">
            <button onClick={onAddStore} className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
              Add Store
            </button>
            <button onClick={onRefresh} className="w-fit rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
              Refresh stores
            </button>
          </div>'
)

# 3) Replace empty state text with an Add Store button
$content = $content.Replace(
'              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                No stores captured yet. Use Add Store from the original store workflow or dashboard quick action.
              </div>',
'              <div className="rounded-2xl bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-500">No stores captured yet.</div>
                <button onClick={onAddStore} className="mt-4 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
                  Add first store
                </button>
              </div>'
)

# 4) Update Stores route to pass onAddStore
$content = $content.Replace(
'if (active === "Stores") return <EditableStoresScreen stores={stores} exceptions={exceptions} onRefresh={refreshData} companyId={currentCompanyId} />;',
'if (active === "Stores") return <EditableStoresScreen stores={stores} exceptions={exceptions} onRefresh={refreshData} onAddStore={() => setAddStoreOpen(true)} companyId={currentCompanyId} />;'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Store create fix applied."
Write-Host "Stores page now has Add Store buttons connected to the existing AddStoreModal."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
