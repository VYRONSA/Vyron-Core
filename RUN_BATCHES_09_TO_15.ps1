$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

& "$root\BATCH_09_COLLAPSIBLE_SIDEBAR\apply-batch-09.ps1"
& "$root\BATCH_10_QUICK_ACTIONS_SIMPLIFICATION\apply-batch-10.ps1"
& "$root\BATCH_11_MANAGER_MODE\apply-batch-11.ps1"
& "$root\BATCH_12_EXECUTIVE_DASHBOARD_POLISH\apply-batch-12.ps1"
& "$root\BATCH_13_OWNER_TOOLS_LOCKDOWN\apply-batch-13.ps1"
& "$root\BATCH_14_VISUAL_SPACING_AND_CLARITY\apply-batch-14.ps1"
& "$root\BATCH_15_FINAL_PREMIUM_POLISH\apply-batch-15.ps1"

Write-Host ""
Write-Host "All batches 09 to 15 applied."
Write-Host "Restart Next.js:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
