$ErrorActionPreference = "Stop"
$source = ".\app\page.tsx"
$target = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $source)) { throw "Run this from inside BATCH_08_FINAL_ALL_IN_ONE." }
Copy-Item -Path $source -Destination $target -Force
Write-Host "Final all-in-one page.tsx copied."
