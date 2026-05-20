$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find app/page.tsx"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "C:\Users\humres\vyron-core-web\app\page.backup-before-force-hr-docs-$timestamp.tsx"
Copy-Item $path $backupPath -Force

$content = Get-Content $path -Raw

# 1) Rename the old Contracts nav/page concept to HR Documents everywhere.
# This keeps the correct Contracts functionality/style, but makes it the HR Documents area.
$content = $content.Replace('"Contracts"', '"HR Documents"')
$content = $content.Replace('>Contracts<', '>HR Documents<')
$content = $content.Replace('Contracts & HR Documents', 'HR Documents')
$content = $content.Replace('Contracts and HR Documents', 'HR Documents')
$content = $content.Replace('Contracts', 'HR Documents')

# 2) Remove the old separate Documents nav item from the HR nav group by removing quoted Documents.
$content = $content.Replace('      "Documents",' + "`r`n", "")
$content = $content.Replace('      "Documents",' + "`n", "")

# 3) Remove duplicate Employee HR File nav item if it appears as separate sidebar item.
$content = $content.Replace('      "Employee HR File",' + "`r`n", "")
$content = $content.Replace('      "Employee HR File",' + "`n", "")

# 4) De-duplicate repeated HR Documents entries in nav arrays.
# If replacing Contracts caused both Contracts and HR Documents to become HR Documents, this removes repeated adjacent duplicates.
$content = $content.Replace('      "HR Documents",' + "`r`n" + '      "HR Documents",', '      "HR Documents",')
$content = $content.Replace('      "HR Documents",' + "`n" + '      "HR Documents",', '      "HR Documents",')

# 5) Make sure HR group contains HR Documents after Warnings if it got removed.
if ($content -notmatch '"HR Documents"') {
  $content = $content.Replace('      "Warnings",' + "`r`n", '      "Warnings",' + "`r`n" + '      "HR Documents",' + "`r`n")
  $content = $content.Replace('      "Warnings",' + "`n", '      "Warnings",' + "`n" + '      "HR Documents",' + "`n")
}

# 6) Route old Documents and Employee HR File clicks to HR Documents if any old state is still stored.
if ($content -match "function resolveNavigationTarget\(item: string\)") {
  if ($content -notmatch 'if \(item === "Documents"\) return "HR Documents";') {
    $content = $content -replace 'function resolveNavigationTarget\(item: string\) \{', @'
function resolveNavigationTarget(item: string) {
  if (item === "Documents") return "HR Documents";
  if (item === "Employee HR File") return "HR Documents";
'@
  }
}

# 7) If the Header title or current active page says Documents from old route, keep it clean.
$content = $content.Replace('active === "Documents"', 'active === "HR Documents"')
$content = $content.Replace('active === "Employee HR File"', 'active === "HR Documents"')

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Done."
Write-Host "Backup created at:"
Write-Host $backupPath
Write-Host "Contracts functionality is now renamed to HR Documents and duplicate Documents/Employee HR File nav items were removed."
