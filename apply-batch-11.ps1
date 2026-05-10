$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$insert = @'

const DEFAULT_MANAGER_TABS = [
  "Dashboard",
  "Staff",
  "Clocking",
  "Rosters",
  "Leave",
  "Payroll",
  "Reports",
];

'@

if ($content -notmatch "DEFAULT_MANAGER_TABS") {
  $content = $insert + "`r`n" + $content
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 11 complete: manager mode foundation added."
