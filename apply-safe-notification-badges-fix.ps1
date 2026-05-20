$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

# 1) Remove the bad global count block if it was inserted before navGroups.
$content = [regex]::Replace(
  $content,
  'const activeLeaveRequestCount =\s*leaveRequests\?\.filter\(\(item\) => item\.status === "pending"\)\.length \|\| 0;\s*const activeHrCaseCount =\s*hrCases\?\.filter\(\(item\) => hrCaseIsOpen\(item\)\)\.length \|\| 0;\s*const activeExceptionCount =\s*exceptions\?\.filter\(\(item\) => exceptionIsOpen\(item\)\)\.length \|\| 0;\s*',
  ''
)

# 2) Replace the existing alertCounts object with a fuller safe mapping.
$old = @'
  const alertCounts = useMemo(
    () => ({
      "Manager Action Centre": pendingLeaveCount,
      "Leave Approvals": pendingLeaveCount,
      Exceptions: openExceptionCount,
      "HR Cases": openHrCaseCount,
      "Payroll Clock Engine": blockedPayrollCount
}),
    [pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount]
  );
'@

$new = @'
  const alertCounts = useMemo(
    () => ({
      Leave: pendingLeaveCount,
      "Leave Management": pendingLeaveCount,
      "Leave Approvals": pendingLeaveCount,
      "Manager Action Centre": pendingLeaveCount,
      Staff: openHrCaseCount,
      Employees: openHrCaseCount,
      "HR Cases": openHrCaseCount,
      Exceptions: openExceptionCount,
      Clocking: openExceptionCount,
      Payroll: blockedPayrollCount,
      "Payroll Prep": blockedPayrollCount,
      "Payroll Clock Engine": blockedPayrollCount,
      "Smart Alerts": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,
      "Smart Detection": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,
    }),
    [pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount]
  );
'@

if ($content.Contains($old)) {
  $content = $content.Replace($old, $new)
} else {
  Write-Host "Exact alertCounts block not found. Trying regex replacement..."
  $content = [regex]::Replace(
    $content,
    'const alertCounts = useMemo\(\s*\(\) => \(\{[\s\S]*?\}\),\s*\[pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount\]\s*\);',
    $new
  )
}

# 3) Ensure Sidebar button has visible badge support. Your file already supports alertCounts in group counts.
# This adds item-level badge only if it is missing.
if ($content -notmatch 'alertCounts\[item\] > 0') {
  $content = $content.Replace(
    '<span className="flex-1">{displayNavigationLabel(item)}</span>',
    '<span className="flex-1">{displayNavigationLabel(item)}</span>' + "`r`n" + 
    '                      {alertCounts[item] > 0 && (' + "`r`n" +
    '                        <span className="ml-auto rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-500/30">' + "`r`n" +
    '                          {alertCounts[item] > 99 ? "99+" : alertCounts[item]}' + "`r`n" +
    '                        </span>' + "`r`n" +
    '                      )}'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Safe notification badge fix applied."
Write-Host "This removes the leaveRequests crash and connects existing live counts to sidebar items."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
