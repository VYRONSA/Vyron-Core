$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find app/page.tsx"
}

# Safety backup before touching the file
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "C:\Users\humres\vyron-core-web\app\page.backup-before-hr-cleanup-$timestamp.tsx"
Copy-Item $path $backupPath -Force

$content = Get-Content $path -Raw

# 1) Clean HR nav group only.
# Old:
# HR Cases, Warnings, Contracts, Documents, Employee HR File, Leave History
# New:
# HR Cases, Warnings, HR Documents, Leave History
$oldHrGroup = @'
    items: [
      "HR Cases",
      "Warnings",
      "Contracts",
      "Documents",
      "Employee HR File",
      "Leave History",
    ],
'@

$newHrGroup = @'
    items: [
      "HR Cases",
      "Warnings",
      "HR Documents",
      "Leave History",
    ],
'@

if ($content.Contains($oldHrGroup)) {
  $content = $content.Replace($oldHrGroup, $newHrGroup)
} else {
  # Fallback smaller replacements in case spacing changed
  $content = $content.Replace('      "Contracts",' + "`r`n", "")
  $content = $content.Replace('      "Documents",' + "`r`n", "")
  $content = $content.Replace('      "Employee HR File",' + "`r`n", "")
  if ($content -notmatch '"HR Documents"') {
    $content = $content.Replace('      "Warnings",' + "`r`n", '      "Warnings",' + "`r`n" + '      "HR Documents",' + "`r`n")
  }
}

# 2) Add navigation resolver mapping so old buttons/routes go to HR Documents if anything still calls them.
if ($content -match "function resolveNavigationTarget\(item: string\)") {
  if ($content -notmatch 'if \(item === "Contracts"\) return "HR Documents";') {
    $content = $content -replace 'function resolveNavigationTarget\(item: string\) \{', @'
function resolveNavigationTarget(item: string) {
  if (item === "Contracts") return "HR Documents";
  if (item === "Documents") return "HR Documents";
  if (item === "Employee HR File") return "HR Documents";
  if (item === "HR Documents") return "HR Documents";
'@
  }
}

# 3) Make the displayed label cleaner.
if ($content -match "function displayNavigationLabel\(item: string\)") {
  if ($content -notmatch 'if \(item === "HR Documents"\) return "HR Documents";') {
    $content = $content -replace 'function displayNavigationLabel\(item: string\) \{', @'
function displayNavigationLabel(item: string) {
  if (item === "HR Documents") return "HR Documents";
'@
  }
}

# 4) Add visible Logout button beside Export Payroll Pack, without changing dashboard layout.
$oldExportButton = @'
        <button className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-xl">
          Export Payroll Pack
        </button>
'@

$newExportAndLogout = @'
        <div className="flex flex-wrap items-center gap-3">
          <button className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-xl">
            Export Payroll Pack
          </button>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.reload();
            }}
            className="w-fit rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-xl hover:bg-white/20"
          >
            Logout
          </button>
        </div>
'@

if ($content.Contains($oldExportButton) -and $content -notmatch ">Logout<") {
  $content = $content.Replace($oldExportButton, $newExportAndLogout)
}

# 5) If renderSection has old exact routes, make them resolve to the same HR Documents page.
# This does not remove component code; it only prevents separate old routes from being reachable.
$content = $content.Replace('if (active === "Contracts")', 'if (active === "HR Documents")')
$content = $content.Replace('if (active === "Documents")', 'if (active === "HR Documents")')
$content = $content.Replace('if (active === "Employee HR File")', 'if (active === "HR Documents")')

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Done. Backup created at:"
Write-Host $backupPath
Write-Host "HR sidebar cleaned and Logout button restored."
