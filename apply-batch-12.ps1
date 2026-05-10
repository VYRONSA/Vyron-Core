$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$content = $content.Replace(
"Workforce control, payroll readiness, HR visibility and rostering in one clean system.",
"Today's workforce status, payroll readiness, HR alerts and operational insights in one clear dashboard."
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 12 complete: executive dashboard wording improved."
