$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$content = $content.Replace("AI Assistant", "Vyron AI")
$content = $content.Replace("Insights", "Business Insights")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 15 complete: premium naming polish applied."
