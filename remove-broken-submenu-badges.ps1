$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

# Remove any unsafe variable lines created by the submenu badge patch.
$content = [regex]::Replace(
  $content,
  '\s*const safeItemBadgeCount = alertCounts\[item\] \|\| alertCounts\[resolved\] \|\| 0;\s*',
  "`r`n"
)

$content = [regex]::Replace(
  $content,
  '\s*const itemBadgeCount = alertCounts\[item\] \|\| alertCounts\[resolved\] \|\| 0;\s*',
  "`r`n"
)

# Remove any JSX blocks that reference safeItemBadgeCount.
$content = [regex]::Replace(
  $content,
  '\s*\{safeItemBadgeCount > 0 && \([\s\S]*?\)\}\s*',
  "`r`n"
)

# Remove any JSX blocks that reference itemBadgeCount.
$content = [regex]::Replace(
  $content,
  '\s*\{itemBadgeCount > 0 && \([\s\S]*?\)\}\s*',
  "`r`n"
)

# Remove any half-broken expressions if they exist.
$content = $content.Replace("safeItemBadgeCount > 0 &&", "false &&")
$content = $content.Replace("itemBadgeCount > 0 &&", "false &&")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Broken submenu badge code removed."
Write-Host "The app should open again with the stable group-level red indicators."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
