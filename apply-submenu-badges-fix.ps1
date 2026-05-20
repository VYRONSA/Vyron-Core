$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

# Remove any unsafe old itemBadgeCount lines first.
$content = [regex]::Replace($content, '\s*const itemBadgeCount = alertCounts\[item\] \|\| alertCounts\[resolved\] \|\| 0;\s*', "`r`n")

# Add safe item badge count inside the sidebar item map, directly after resolved/isActive.
$content = [regex]::Replace(
  $content,
  '(const resolved = resolveNavigationTarget\(item\);\s*const isActive = active === resolved;\s*)',
  '$1' + "`r`n" + '                  const safeItemBadgeCount = alertCounts[item] || alertCounts[resolved] || 0;' + "`r`n",
  1
)

# Remove any broken old itemBadgeCount badge blocks.
$content = [regex]::Replace(
  $content,
  '\s*\{itemBadgeCount > 0 && \([\s\S]*?\)\}\s*',
  "`r`n",
  1
)

# Remove duplicate old alertCounts[item] badge block if present.
$content = [regex]::Replace(
  $content,
  '\s*\{alertCounts\[item\] > 0 && \([\s\S]*?\{alertCounts\[item\] > 99 \? "99\+" : alertCounts\[item\]\}[\s\S]*?\)\}\s*',
  "`r`n",
  1
)

# Add safe exact page badge after the menu label if not already present.
if ($content -notmatch 'safeItemBadgeCount > 0') {
  $content = $content.Replace(
    '<span className="flex-1">{displayNavigationLabel(item)}</span>',
    '<span className="flex-1">{displayNavigationLabel(item)}</span>' + "`r`n" +
    '                      {safeItemBadgeCount > 0 && (' + "`r`n" +
    '                        <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 py-1 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-500/30">' + "`r`n" +
    '                          {safeItemBadgeCount > 99 ? "99+" : safeItemBadgeCount}' + "`r`n" +
    '                        </span>' + "`r`n" +
    '                      )}'
  )
}

# Improve group badge visibility by making it a little larger if the common class exists.
$content = $content.Replace(
  'rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black leading-none text-white',
  'rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black leading-none text-white'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Sidebar submenu badges fixed."
Write-Host "Now the opened sidebar group should show the exact page with the red count."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
