$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"
$source = ".\app\app-page.tsx"

if (!(Test-Path $source)) {
  throw "Run this script from the extracted ZIP folder that contains app\app-page.tsx"
}

Copy-Item -Path $source -Destination "$root\app\app-page.tsx" -Force

# Only copy to page.tsx if the file exists and you want the main route to match the fixed uploaded file.
# This is recommended if the visible app is using app\page.tsx instead of app\app-page.tsx.
Copy-Item -Path $source -Destination "$root\app\page.tsx" -Force

Write-Host "Copied fixed app-page.tsx to:"
Write-Host "$root\app\app-page.tsx"
Write-Host "$root\app\page.tsx"
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
