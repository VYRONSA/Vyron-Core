$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$content = $content.Replace("Executive Command Centre", "Executive Dashboard")
$content = $content.Replace("Payroll Hardening", "Payroll Review")
$content = $content.Replace("Smart Detection", "Smart Alerts")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 10 complete: quick actions simplified."
