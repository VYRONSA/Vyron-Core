$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$content = $content.Replace("gap-2", "gap-3")
$content = $content.Replace("py-2", "py-3")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 14 complete: sidebar spacing improved."
