$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

# Remove any old bad global badge count block.
$content = [regex]::Replace(
  $content,
  'const activeLeaveRequestCount =[\s\S]*?const activeExceptionCount =[\s\S]*?;\s*',
  ''
)

# Strengthen alertCounts inside the main component.
$newAlertCounts = @'
  const alertCounts = useMemo(
    () => ({
      Dashboard: openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,
      "Command Centre": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,

      Staff: openHrCaseCount,
      Employees: openHrCaseCount,
      "HR Cases": openHrCaseCount,
      "Employee HR File": openHrCaseCount,

      Leave: pendingLeaveCount,
      "Leave Management": pendingLeaveCount,
      "Leave Approvals": pendingLeaveCount,
      "Staff Leave": pendingLeaveCount,

      Exceptions: openExceptionCount,
      Clocking: openExceptionCount,
      "Clocking Review": openExceptionCount,
      "Staff Clocking": openExceptionCount,

      Payroll: blockedPayrollCount,
      "Payroll Prep": blockedPayrollCount,
      "Payroll Clock Engine": blockedPayrollCount,

      "Smart Alerts": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,
      "Smart Detection": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,
      Insights: openExceptionCount + openHrCaseCount + blockedPayrollCount,
      "Workforce Intelligence": openExceptionCount + openHrCaseCount + blockedPayrollCount,
    }),
    [pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount]
  );
'@

if ($content -match 'const alertCounts = useMemo\(') {
  $content = [regex]::Replace(
    $content,
    'const alertCounts = useMemo\(\s*\(\) => \(\{[\s\S]*?\}\),\s*\[pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount\]\s*\);',
    $newAlertCounts
  )
} else {
  # Insert after blockedPayrollCount if alertCounts was missing.
  $content = [regex]::Replace(
    $content,
    '(const blockedPayrollCount[\s\S]*?;\s*)',
    '$1' + "`r`n" + $newAlertCounts + "`r`n",
    1
  )
}

# Make group alert counts check both visible item and resolved target.
$content = [regex]::Replace(
  $content,
  'const groupAlertCount = group\.items\.reduce\(\s*\(sum, item\) => sum \+ \(alertCounts\[item\] \|\| 0\),\s*0\s*\);',
  'const groupAlertCount = group.items.reduce((sum, item) => {
            const resolved = resolveNavigationTarget(item);
            return sum + (alertCounts[item] || alertCounts[resolved] || 0);
          }, 0);'
)

# Inside item map, ensure itemBadgeCount exists after resolved/isActive.
$content = [regex]::Replace(
  $content,
  '(const resolved = resolveNavigationTarget\(item\);\s*const isActive = active === resolved;\s*)',
  '$1' + "`r`n" + '                  const itemBadgeCount = alertCounts[item] || alertCounts[resolved] || 0;' + "`r`n",
  1
)

# Replace old alertCounts[item] badge logic with itemBadgeCount.
$content = $content.Replace('alertCounts[item] > 0', 'itemBadgeCount > 0')
$content = $content.Replace('{alertCounts[item] > 99 ? "99+" : alertCounts[item]}', '{itemBadgeCount > 99 ? "99+" : itemBadgeCount}')

# If no item badge block exists, insert it after the display label span.
if ($content -notmatch 'itemBadgeCount > 0') {
  $content = $content.Replace(
    '<span className="flex-1">{displayNavigationLabel(item)}</span>',
    '<span className="flex-1">{displayNavigationLabel(item)}</span>' + "`r`n" +
    '                      {itemBadgeCount > 0 && (' + "`r`n" +
    '                        <span className="ml-auto rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-500/30">' + "`r`n" +
    '                          {itemBadgeCount > 99 ? "99+" : itemBadgeCount}' + "`r`n" +
    '                        </span>' + "`r`n" +
    '                      )}'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Forced sidebar badge fix applied."
Write-Host ""
Write-Host "Important:"
Write-Host "- Badges only show if there are pending leave requests, open HR cases, open exceptions, or payroll blockers."
Write-Host "- If all counts are 0, no red badge will show."
Write-Host ""
Write-Host "Restart now:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
